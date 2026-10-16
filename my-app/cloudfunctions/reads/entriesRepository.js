// 日精进表的数据访问：固定 SQL 与参数组装集中在这里。
// 一条 SELECT 同时读取列表和总数，使用同一数据库快照。
const ENTRIES_SQL = `
WITH scoped AS (
  SELECT id, entry_date, to_char(entry_date, 'YYYY-MM-DD') AS entry_date_text,
    text, text_version, revision, created_at, updated_at, adopted_analysis, origin
  FROM public.entries WHERE owner_id = $1
), page_rows AS (
  SELECT * FROM scoped
  WHERE $2::date IS NULL OR entry_date < $2::date
    OR (entry_date = $2::date AND created_at < $3::timestamptz)
    OR (entry_date = $2::date AND created_at = $3::timestamptz AND id > $4::text)
  ORDER BY entry_date DESC, created_at DESC, id ASC LIMIT $5::integer
)
SELECT (SELECT count(*) FROM scoped)::text AS total,
  COALESCE((SELECT jsonb_agg(to_jsonb(page_rows)
    ORDER BY entry_date DESC, created_at DESC, id ASC) FROM page_rows), '[]'::jsonb) AS rows`;

// ID 每次新建独立生成；数据库唯一索引抵挡并发同文，不能用已删除的 ID 重建。
// 必须先执行 db/day22-entry-identity.sql，再部署本版本写接口。
const INSERT_ENTRY_SQL = `
INSERT INTO public.entries (id, owner_id, entry_date, text)
SELECT $1::text, $2::text, $3::date, $4::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.entries
  WHERE owner_id = $2::text AND entry_date = $3::date
    AND text COLLATE "C" = $4::text COLLATE "C"
)
ON CONFLICT DO NOTHING
RETURNING id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date_text,
  text, text_version, revision, created_at, updated_at, adopted_analysis, origin`;
const PATCH_ENTRY_SQL = `
WITH locked AS MATERIALIZED (
  SELECT * FROM public.entries WHERE owner_id = $1::text AND id = $2::text FOR UPDATE
), duplicate AS MATERIALIZED (
  SELECT 1 FROM public.entries AS other, locked
  WHERE other.owner_id = $1::text AND other.id <> locked.id
    AND other.entry_date = CASE WHEN $4::boolean THEN $5::date ELSE locked.entry_date END
    AND other.text COLLATE "C" =
      (CASE WHEN $6::boolean THEN $7::text ELSE locked.text END) COLLATE "C"
), changed AS (
  UPDATE public.entries AS target SET
    entry_date = CASE WHEN $4::boolean THEN $5::date ELSE locked.entry_date END,
    text = CASE WHEN $6::boolean THEN $7::text ELSE locked.text END,
    text_version = locked.text_version + CASE WHEN $6::boolean
      AND locked.text COLLATE "C" IS DISTINCT FROM $7::text COLLATE "C" THEN 1 ELSE 0 END,
    adopted_analysis = CASE WHEN $6::boolean
      AND locked.text COLLATE "C" IS DISTINCT FROM $7::text COLLATE "C"
      THEN NULL ELSE locked.adopted_analysis END,
    revision = locked.revision + 1, updated_at = CURRENT_TIMESTAMP
  FROM locked WHERE target.owner_id = $1::text AND target.id = locked.id
    AND locked.revision = $3::bigint AND target.revision = $3::bigint
    AND NOT EXISTS (SELECT 1 FROM duplicate)
  RETURNING target.id, to_char(target.entry_date, 'YYYY-MM-DD') AS entry_date_text,
    target.text, target.text_version, target.revision, target.created_at,
    target.updated_at, target.adopted_analysis, target.origin
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 'not_found'
  WHEN (SELECT revision FROM locked) <> $3::bigint THEN 'version_conflict'
  WHEN EXISTS (SELECT 1 FROM duplicate) THEN 'duplicate'
  WHEN NOT EXISTS (SELECT 1 FROM changed) THEN 'version_conflict' ELSE 'updated' END AS outcome,
  (SELECT to_jsonb(changed) FROM changed) AS record`;

// 清关联必须先消费 RETURNING 结果，再删除父记录；任一约束失败整句回滚。
// favorites 的既有同用户外键 ON DELETE CASCADE 仅清理本条收藏。
const DELETE_ENTRY_SQL = `
WITH locked AS MATERIALIZED (
  SELECT * FROM public.entries WHERE owner_id = $1::text AND id = $2::text FOR UPDATE
), linked AS MATERIALIZED (
  SELECT notes.id, notes.book_id FROM public.reading_notes AS notes
  JOIN locked ON notes.owner_id = locked.owner_id AND notes.summary_entry_id = locked.id
  FOR UPDATE OF notes
), decision AS MATERIALIZED (
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 'not_found'
    WHEN (SELECT revision FROM locked) <> $3::bigint THEN 'version_conflict'
    WHEN EXISTS (
      SELECT 1 FROM linked, locked WHERE locked.origin->>'type' IS DISTINCT FROM 'reading-note'
        OR locked.origin->>'noteId' IS DISTINCT FROM linked.id
        OR locked.origin->>'bookId' IS DISTINCT FROM linked.book_id
    ) THEN 'link_conflict' ELSE 'delete' END AS outcome
), cleared AS (
  UPDATE public.reading_notes AS notes SET summary_entry_id = NULL, summary_active = NULL,
    summary_linked_at = NULL, summary_entry_revision_at_link = NULL,
    summary_preserve_on_cancel = NULL, revision = notes.revision + 1
  FROM locked, decision WHERE decision.outcome = 'delete'
    AND notes.owner_id = $1::text AND notes.summary_entry_id = locked.id
    AND notes.id IN (SELECT id FROM linked)
  RETURNING notes.id
), deleted AS (
  DELETE FROM public.entries AS target USING locked, decision
  WHERE decision.outcome = 'delete' AND target.owner_id = $1::text AND target.id = locked.id
    AND target.revision = $3::bigint
    AND (SELECT count(*) FROM cleared) = (SELECT count(*) FROM linked)
  RETURNING target.id
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM deleted) THEN 'deleted'
  WHEN decision.outcome = 'delete' THEN 'version_conflict' ELSE decision.outcome END AS outcome
FROM decision`;

function createEntriesRepository({ query }) {
  return {
    list({ ownerId, keys, limit }) {
      return query(ENTRIES_SQL, [ownerId, ...(keys || [null, null, null]), limit]);
    },
    insert({ id, ownerId, entryDate, text }) {
      return query(INSERT_ENTRY_SQL, [id, ownerId, entryDate, text]);
    },
    patch({ ownerId, entryId, expectedRevision, body }) {
      return query(PATCH_ENTRY_SQL, [ownerId, entryId, expectedRevision,
        Object.prototype.hasOwnProperty.call(body, 'entryDate'), body.entryDate ?? null,
        Object.prototype.hasOwnProperty.call(body, 'text'), body.text ?? null]);
    },
    remove({ ownerId, entryId, expectedRevision }) {
      return query(DELETE_ENTRY_SQL, [ownerId, entryId, expectedRevision]);
    },
  };
}

module.exports = { ENTRIES_SQL, INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, DELETE_ENTRY_SQL, createEntriesRepository };

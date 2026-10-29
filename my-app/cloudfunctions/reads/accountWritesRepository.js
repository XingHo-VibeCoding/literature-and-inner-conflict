// Day 30：账户数据的固定原子写语句；所有动态值均经参数传入。
const INSERT_NOTE_SQL = `
INSERT INTO public.reading_notes (id, owner_id, book_id, body, save_order)
SELECT $1::text, $2::text, $3::text, $4::text,
  COALESCE((SELECT max(save_order) FROM public.reading_notes
    WHERE owner_id = $2::text AND book_id = $3::text), 0) + 1
RETURNING *`;

// 删除感悟只删除其本人最新历史；已加入总结的独立副本和来源快照保留。
const DELETE_NOTE_SQL = `
WITH locked AS MATERIALIZED (
  SELECT * FROM public.reading_notes WHERE owner_id = $1::text AND id = $2::text FOR UPDATE
), latest AS MATERIALIZED (
  SELECT notes.id FROM public.reading_notes AS notes, locked
  WHERE notes.owner_id = $1::text AND notes.book_id = locked.book_id
  ORDER BY notes.saved_at DESC, notes.save_order DESC, notes.id DESC LIMIT 1
), decision AS MATERIALIZED (
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 'not_found'
    WHEN (SELECT revision FROM locked) <> $3::bigint THEN 'version_conflict'
    WHEN (SELECT id FROM latest) IS DISTINCT FROM $2::text THEN 'not_latest'
    ELSE 'delete' END AS outcome
), deleted AS (
  DELETE FROM public.reading_notes AS notes USING locked, decision
  WHERE decision.outcome = 'delete' AND notes.owner_id = $1::text AND notes.id = locked.id
    AND notes.revision = $3::bigint RETURNING notes.id
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM deleted) THEN 'deleted'
  WHEN decision.outcome = 'delete' THEN 'version_conflict' ELSE decision.outcome END AS outcome
FROM decision`;

// 与既有删除日精进相同，先锁关联的日精进，再锁感悟，避免反向锁序。
// 新副本、关联更新与未修改副本的删除在同一句 SQL 内完成。
const SET_NOTE_SUMMARY_SQL = `
WITH existing AS MATERIALIZED (
  SELECT entries.*, to_char(entries.entry_date, 'YYYY-MM-DD') AS entry_date_text
  FROM public.entries AS entries JOIN public.reading_notes AS notes
    ON entries.owner_id = notes.owner_id AND entries.id = notes.summary_entry_id
  WHERE notes.owner_id = $1::text AND notes.id = $2::text FOR UPDATE OF entries
), locked AS MATERIALIZED (
  SELECT * FROM public.reading_notes
  WHERE owner_id = $1::text AND id = $2::text AND (SELECT count(*) FROM existing) >= 0 FOR UPDATE
), catalog AS MATERIALIZED (
  SELECT value->>'id' AS id, value->>'title' AS title FROM jsonb_array_elements($6::jsonb)
), decision AS MATERIALIZED (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 'not_found'
    WHEN NOT EXISTS (SELECT 1 FROM catalog, locked WHERE catalog.id = locked.book_id) THEN 'book_not_found'
    WHEN EXISTS (SELECT 1 FROM locked WHERE summary_entry_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM existing, locked WHERE existing.id = locked.summary_entry_id
        AND existing.origin->>'type' = 'reading-note' AND existing.origin->>'noteId' = locked.id
        AND existing.origin->>'bookId' = locked.book_id
        AND existing.origin->>'noteSavedAt' = to_char(locked.saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      THEN 'link_conflict'
    WHEN NOT $4::boolean AND NOT COALESCE((SELECT summary_active FROM locked), false) THEN 'unchanged'
    WHEN $4::boolean AND COALESCE((SELECT summary_active FROM locked), false)
      AND EXISTS (SELECT 1 FROM existing) THEN 'unchanged'
    WHEN (SELECT revision FROM locked) <> $3::bigint THEN 'version_conflict'
    WHEN $4::boolean AND EXISTS (SELECT 1 FROM existing) THEN 'reused'
    WHEN $4::boolean THEN 'added'
    WHEN EXISTS (SELECT 1 FROM existing, locked WHERE NOT locked.summary_preserve_on_cancel
      AND existing.revision = locked.summary_entry_revision_at_link) THEN 'removed'
    ELSE 'preserved-edited' END AS outcome
), inserted AS (
  INSERT INTO public.entries (id, owner_id, entry_date, text, origin)
  SELECT $5::text, $1::text, (locked.saved_at AT TIME ZONE 'Asia/Shanghai')::date, locked.body,
    jsonb_build_object('type', 'reading-note', 'noteId', locked.id, 'bookId', locked.book_id,
      'bookTitle', catalog.title, 'noteSavedAt', to_char(locked.saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM locked, decision, catalog WHERE decision.outcome = 'added' AND catalog.id = locked.book_id
    AND NOT EXISTS (SELECT 1 FROM public.entries AS duplicate WHERE duplicate.owner_id = $1::text
      AND duplicate.entry_date = (locked.saved_at AT TIME ZONE 'Asia/Shanghai')::date
      AND duplicate.text COLLATE "C" = locked.body COLLATE "C")
  ON CONFLICT DO NOTHING
  RETURNING *, to_char(entry_date, 'YYYY-MM-DD') AS entry_date_text
), changed AS (
  UPDATE public.reading_notes AS notes SET
    summary_entry_id = CASE WHEN decision.outcome = 'added' THEN (SELECT id FROM inserted)
      WHEN decision.outcome = 'removed' THEN NULL ELSE locked.summary_entry_id END,
    summary_active = CASE WHEN decision.outcome = 'removed' THEN NULL ELSE $4::boolean END,
    summary_linked_at = CASE WHEN decision.outcome = 'removed' THEN NULL
      WHEN $4::boolean THEN CURRENT_TIMESTAMP ELSE locked.summary_linked_at END,
    summary_entry_revision_at_link = CASE WHEN decision.outcome = 'added' THEN 1
      WHEN decision.outcome = 'removed' THEN NULL ELSE locked.summary_entry_revision_at_link END,
    summary_preserve_on_cancel = CASE WHEN decision.outcome = 'removed' THEN NULL
      WHEN decision.outcome = 'added' THEN false WHEN decision.outcome = 'preserved-edited' THEN true
      ELSE locked.summary_preserve_on_cancel OR (SELECT revision FROM existing) <> locked.summary_entry_revision_at_link END,
    revision = locked.revision + 1
  FROM locked, decision WHERE notes.owner_id = $1::text AND notes.id = locked.id
    AND notes.revision = $3::bigint AND decision.outcome IN ('added', 'reused', 'removed', 'preserved-edited')
    AND (decision.outcome <> 'added' OR EXISTS (SELECT 1 FROM inserted))
  RETURNING notes.*
), deleted AS (
  DELETE FROM public.entries AS entries USING existing, decision
  WHERE decision.outcome = 'removed' AND entries.owner_id = $1::text AND entries.id = existing.id
    AND EXISTS (SELECT 1 FROM changed) RETURNING entries.id
)
SELECT CASE WHEN decision.outcome = 'added' AND NOT EXISTS (SELECT 1 FROM inserted) THEN 'duplicate'
    WHEN decision.outcome IN ('added', 'reused', 'removed', 'preserved-edited')
      AND NOT EXISTS (SELECT 1 FROM changed) THEN 'version_conflict'
    WHEN decision.outcome = 'removed' AND NOT EXISTS (SELECT 1 FROM deleted) THEN 'version_conflict'
    ELSE decision.outcome END AS outcome,
  COALESCE((SELECT to_jsonb(changed) FROM changed), (SELECT to_jsonb(locked) FROM locked)) AS note_record,
  CASE WHEN decision.outcome = 'removed' THEN NULL ELSE
    COALESCE((SELECT to_jsonb(inserted) FROM inserted), (SELECT to_jsonb(existing) FROM existing)) END AS entry_record
FROM decision`;

const SET_FAVORITE_SQL = `
WITH target_entry AS MATERIALIZED (
  SELECT id FROM public.entries WHERE $2::text = 'entry' AND owner_id = $1::text AND id = $3::text FOR KEY SHARE
), target AS MATERIALIZED (
  SELECT $3::text AS id WHERE $2::text = 'book' OR EXISTS (SELECT 1 FROM target_entry)
), inserted AS (
  INSERT INTO public.favorites (owner_id, target_type, target_id)
  SELECT $1::text, $2::text, target.id FROM target WHERE $4::boolean
  ON CONFLICT (owner_id, target_type, target_id) DO UPDATE SET favorited_at = favorites.favorited_at
  RETURNING favorited_at
), deleted AS (
  DELETE FROM public.favorites AS favorites USING target
  WHERE NOT $4::boolean AND favorites.owner_id = $1::text
    AND favorites.target_type = $2::text AND favorites.target_id = target.id RETURNING favorites.target_id
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
  WHEN $4::boolean AND NOT EXISTS (SELECT 1 FROM inserted) THEN 'write_failed' ELSE 'saved' END AS outcome,
  (SELECT favorited_at FROM inserted) AS favorited_at,
  (SELECT count(*) FROM deleted) AS removed_count`;

const ADOPT_DEMO_ANALYSIS_SQL = `
WITH locked AS MATERIALIZED (
  SELECT * FROM public.entries WHERE owner_id = $1::text AND id = $2::text FOR UPDATE
), decision AS MATERIALIZED (
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 'not_found'
    WHEN (SELECT revision FROM locked) <> $3::bigint THEN 'version_conflict'
    WHEN (SELECT text_version FROM locked) <> $4::bigint
      OR (SELECT btrim(text, chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) COLLATE "C" FROM locked) <> $5::text COLLATE "C"
      THEN 'context_mismatch' ELSE 'update' END AS outcome
), changed AS (
  UPDATE public.entries AS entries SET adopted_analysis = jsonb_build_object(
      'source', 'demo', 'demoId', 'discussion-v1', 'sourceTextVersion', locked.text_version,
      'summary', $6::text, 'questions', $7::jsonb, 'adoptedAt', $8::text),
    revision = locked.revision + 1, updated_at = CURRENT_TIMESTAMP
  FROM locked, decision WHERE decision.outcome = 'update' AND entries.owner_id = $1::text
    AND entries.id = locked.id AND entries.revision = $3::bigint
  RETURNING entries.*, to_char(entries.entry_date, 'YYYY-MM-DD') AS entry_date_text
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM changed) THEN 'updated'
  WHEN decision.outcome = 'update' THEN 'version_conflict' ELSE decision.outcome END AS outcome,
  (SELECT to_jsonb(changed) FROM changed) AS record FROM decision`;

function createAccountWritesRepository({ query }) {
  return {
    insertNote: ({ id, ownerId, bookId, body }) => query(INSERT_NOTE_SQL, [id, ownerId, bookId, body]),
    deleteNote: ({ ownerId, noteId, expectedRevision }) => query(DELETE_NOTE_SQL, [ownerId, noteId, expectedRevision]),
    setSummary: ({ ownerId, noteId, expectedRevision, enabled, entryId, catalog }) =>
      query(SET_NOTE_SUMMARY_SQL, [ownerId, noteId, expectedRevision, enabled, entryId, JSON.stringify(catalog)]),
    setFavorite: ({ ownerId, targetType, targetId, favorite }) => query(SET_FAVORITE_SQL, [ownerId, targetType, targetId, favorite]),
    adoptAnalysis: ({ ownerId, entryId, body, demoText, adoptedAt }) => query(ADOPT_DEMO_ANALYSIS_SQL,
      [ownerId, entryId, body.expectedRevision, body.sourceTextVersion, demoText, body.summary, JSON.stringify(body.questions), adoptedAt]),
  };
}
module.exports = { INSERT_NOTE_SQL, DELETE_NOTE_SQL, SET_NOTE_SUMMARY_SQL, SET_FAVORITE_SQL,
  ADOPT_DEMO_ANALYSIS_SQL, createAccountWritesRepository };

// 阅读感悟表的数据访问：固定 SQL 与参数组装集中在这里。
// 一条 SELECT 同时读取列表、总数与最新感悟，使用同一数据库快照。
const NOTES_SQL = `
WITH scoped AS (
  SELECT id, book_id, body, revision, created_at, updated_at, saved_at, save_order,
    summary_entry_id, summary_active, summary_linked_at,
    summary_entry_revision_at_link, summary_preserve_on_cancel
  FROM public.reading_notes WHERE owner_id = $1 AND book_id = $2
), page_rows AS (
  SELECT * FROM scoped
  WHERE $3::timestamptz IS NULL OR saved_at < $3::timestamptz
    OR (saved_at = $3::timestamptz AND save_order < $4::integer)
    OR (saved_at = $3::timestamptz AND save_order = $4::integer AND id < $5::text)
  ORDER BY saved_at DESC, save_order DESC, id DESC LIMIT $6::integer
)
SELECT (SELECT count(*) FROM scoped)::text AS total,
  (SELECT id FROM scoped ORDER BY saved_at DESC, save_order DESC, id DESC LIMIT 1) AS latest_note_id,
  COALESCE((SELECT jsonb_agg(to_jsonb(page_rows)
    ORDER BY saved_at DESC, save_order DESC, id DESC) FROM page_rows), '[]'::jsonb) AS rows`;

function createReadingNotesRepository({ query }) {
  return {
    list({ ownerId, bookId, keys, limit }) {
      return query(NOTES_SQL, [ownerId, bookId, ...(keys || [null, null, null]), limit]);
    },
  };
}

module.exports = { NOTES_SQL, createReadingNotesRepository };

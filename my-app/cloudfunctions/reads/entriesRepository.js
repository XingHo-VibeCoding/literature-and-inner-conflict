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

// 旧记录按原文精确查重；新请求以同一主键抵挡并发重发。
// 所有用户输入只进入参数，不拼接 SQL。
const INSERT_ENTRY_SQL = `
INSERT INTO public.entries (id, owner_id, entry_date, text)
SELECT $1::text, $2::text, $3::date, $4::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.entries
  WHERE owner_id = $2::text AND entry_date = $3::date
    AND text COLLATE "C" = $4::text COLLATE "C"
)
ON CONFLICT (id) DO NOTHING
RETURNING id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date_text,
  text, text_version, revision, created_at, updated_at, adopted_analysis, origin`;

function createEntriesRepository({ query }) {
  return {
    list({ ownerId, keys, limit }) {
      return query(ENTRIES_SQL, [ownerId, ...(keys || [null, null, null]), limit]);
    },
    insert({ id, ownerId, entryDate, text }) {
      return query(INSERT_ENTRY_SQL, [id, ownerId, entryDate, text]);
    },
  };
}

module.exports = { ENTRIES_SQL, INSERT_ENTRY_SQL, createEntriesRepository };

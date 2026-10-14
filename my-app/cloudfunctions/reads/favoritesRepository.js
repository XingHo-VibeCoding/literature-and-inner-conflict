// 收藏表的数据访问：固定 SQL 与参数组装集中在这里。
// 一条 SELECT 同时读取列表和总数，使用同一数据库快照。
const FAVORITES_SQL = `
WITH scoped AS (
  SELECT target_type, target_id, favorited_at FROM public.favorites
  WHERE owner_id = $1 AND ($2::text IS NULL OR target_type = $2::text)
), page_rows AS (
  SELECT * FROM scoped
  WHERE $3::timestamptz IS NULL OR favorited_at < $3::timestamptz
    OR (favorited_at = $3::timestamptz AND target_type > $4::text)
    OR (favorited_at = $3::timestamptz AND target_type = $4::text AND target_id > $5::text)
  ORDER BY favorited_at DESC, target_type ASC, target_id ASC LIMIT $6::integer
)
SELECT (SELECT count(*) FROM scoped)::text AS total,
  COALESCE((SELECT jsonb_agg(to_jsonb(page_rows)
    ORDER BY favorited_at DESC, target_type ASC, target_id ASC) FROM page_rows), '[]'::jsonb) AS rows`;

function createFavoritesRepository({ query }) {
  return {
    list({ ownerId, targetType, keys, limit }) {
      return query(FAVORITES_SQL, [ownerId, targetType, ...(keys || [null, null, null]), limit]);
    },
  };
}

module.exports = { FAVORITES_SQL, createFavoritesRepository };

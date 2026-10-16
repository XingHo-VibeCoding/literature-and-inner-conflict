-- Day 22：先执行本迁移，再部署使用独立随机 ID 的 POST/PATCH/DELETE。
-- 保留全部既有 ID、原文、日期和关联；不清空、不重建 entries。
BEGIN;

-- 原始文字先固定编码成 UTF-8，再使用 PostgreSQL 内置 SHA256，无需扩展。
-- 固定编码的结果不依赖会话参数；包装函数只执行该确定性计算。
CREATE OR REPLACE FUNCTION public.day22_entry_text_sha256(raw_text text)
RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.sha256(pg_catalog.convert_to(raw_text, 'UTF8'))
$function$;

-- 避免检查重复与建立唯一索引之间出现新的写入；普通读取仍可继续。
LOCK TABLE public.entries IN SHARE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.entries
    GROUP BY owner_id COLLATE "C", entry_date, public.day22_entry_text_sha256(text)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Day 22 迁移已停止：存在同一用户、同一日期和相同原文的重复记录，或原文摘要冲突。请先人工核对；本迁移未清理或覆盖数据。';
  END IF;
END
$migration$;

-- SHA256 按原始 UTF-8 字节区分空白、换行和不同 Unicode 表示，不规范化原文。
CREATE UNIQUE INDEX IF NOT EXISTS day22_entries_owner_date_text_sha256_uq
ON public.entries (owner_id COLLATE "C", entry_date, public.day22_entry_text_sha256(text));

COMMIT;

-- Day 30：只扩展已采纳分析的来源校验，保留既有原文、日期、版本和全部关联。
-- 供用户人工核对后执行；本文件的存在不表示已经执行或已经部署。
-- 旧 AI 分支仍须 generationRequestId；固定演示单独保留 demoId 与 source='demo'。
-- 整段执行。验证失败会回滚，既有检查不会因失败而永久移除。
BEGIN;
LOCK TABLE public.entries IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.entries DROP CONSTRAINT IF EXISTS entries_analysis_check;
ALTER TABLE public.entries ADD
CONSTRAINT entries_analysis_check CHECK (
        adopted_analysis IS NULL OR
        CASE
            WHEN jsonb_typeof(adopted_analysis) = 'object'
                 AND jsonb_typeof(adopted_analysis -> 'questions') = 'array'
            THEN (
                (
                    (
                        adopted_analysis ->> 'source' = 'ai'
                        AND jsonb_typeof(adopted_analysis -> 'generationRequestId') = 'string'
                        AND char_length(btrim(adopted_analysis ->> 'generationRequestId')) > 0
                    )
                    OR (
                        adopted_analysis ->> 'source' = 'demo'
                        AND adopted_analysis ->> 'demoId' = 'discussion-v1'
                        AND NOT (adopted_analysis ? 'generationRequestId')
                    )
                )
                AND jsonb_typeof(adopted_analysis -> 'sourceTextVersion') = 'number'
                AND (adopted_analysis ->> 'sourceTextVersion') ~ '^[1-9][0-9]*(\.0+)?$'
                AND jsonb_typeof(adopted_analysis -> 'summary') = 'string'
                AND char_length(adopted_analysis ->> 'summary') > 0
                AND jsonb_array_length(adopted_analysis -> 'questions') BETWEEN 1 AND 2
                AND jsonb_typeof(adopted_analysis -> 'questions' -> 0) = 'string'
                AND char_length(adopted_analysis -> 'questions' ->> 0) > 0
                AND (
                    jsonb_array_length(adopted_analysis -> 'questions') = 1
                    OR (
                        jsonb_typeof(adopted_analysis -> 'questions' -> 1) = 'string'
                        AND char_length(adopted_analysis -> 'questions' ->> 1) > 0
                    )
                )
                AND jsonb_typeof(adopted_analysis -> 'adoptedAt') = 'string'
                AND char_length(btrim(adopted_analysis ->> 'adoptedAt')) > 0
            ) IS TRUE
            ELSE FALSE
        END
    ) NOT VALID;
ALTER TABLE public.entries VALIDATE CONSTRAINT entries_analysis_check;
COMMIT;

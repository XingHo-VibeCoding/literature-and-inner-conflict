-- Day 16｜文学与内心冲突：PostgreSQL 17.11 建表脚本。
-- 按 api-contract.md 第 3 节及第 5 节创建三张表。
-- 整段执行；同一版本可以重复执行，保留已有数据。
-- IF NOT EXISTS 不负责迁移与本脚本不同的旧表结构。
-- 种子数据留在第③板块，不在本脚本中插入。

BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS public.entries (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    entry_date DATE NOT NULL,
    text TEXT NOT NULL,
    text_version INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    adopted_analysis JSONB,
    origin JSONB,

    CONSTRAINT entries_pkey PRIMARY KEY (id),
    CONSTRAINT entries_owner_id_key UNIQUE (owner_id, id),
    CONSTRAINT entries_identity_check CHECK (
        char_length(btrim(id)) > 0 AND char_length(btrim(owner_id)) > 0
    ),
    CONSTRAINT entries_date_check CHECK (
        entry_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    ),
    CONSTRAINT entries_text_check CHECK (char_length(text) > 0),
    CONSTRAINT entries_versions_check CHECK (text_version >= 1 AND revision >= 1),
    CONSTRAINT entries_timestamps_check CHECK (
        isfinite(created_at) AND isfinite(updated_at)
    ),
    -- 整体要求为真，避免 JSON 缺少键时 CHECK 因空值而放行。
    CONSTRAINT entries_analysis_check CHECK (
        adopted_analysis IS NULL OR
        CASE
            WHEN jsonb_typeof(adopted_analysis) = 'object'
                 AND jsonb_typeof(adopted_analysis -> 'questions') = 'array'
            THEN (
                adopted_analysis ->> 'source' = 'ai'
                AND jsonb_typeof(adopted_analysis -> 'generationRequestId') = 'string'
                AND char_length(btrim(adopted_analysis ->> 'generationRequestId')) > 0
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
    ),
    -- 来源是历史快照；不反向强制引用感悟，删感悟后仍保留来源。
    CONSTRAINT entries_origin_check CHECK (
        origin IS NULL OR (
            jsonb_typeof(origin) = 'object'
            AND origin ->> 'type' = 'reading-note'
            AND jsonb_typeof(origin -> 'noteId') = 'string'
            AND char_length(btrim(origin ->> 'noteId')) > 0
            AND jsonb_typeof(origin -> 'bookId') = 'string'
            AND char_length(btrim(origin ->> 'bookId')) > 0
            AND jsonb_typeof(origin -> 'bookTitle') = 'string'
            AND char_length(origin ->> 'bookTitle') > 0
            AND jsonb_typeof(origin -> 'noteSavedAt') = 'string'
            AND char_length(btrim(origin ->> 'noteSavedAt')) > 0
        ) IS TRUE
    )
);

CREATE TABLE IF NOT EXISTS public.reading_notes (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    body TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    saved_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    save_order INTEGER NOT NULL,
    summary_entry_id TEXT,
    summary_active BOOLEAN,
    summary_linked_at TIMESTAMPTZ(3),
    summary_entry_revision_at_link INTEGER,
    summary_preserve_on_cancel BOOLEAN,

    CONSTRAINT reading_notes_pkey PRIMARY KEY (id),
    CONSTRAINT reading_notes_owner_book_order_key UNIQUE (owner_id, book_id, save_order),
    CONSTRAINT reading_notes_owner_summary_key UNIQUE (owner_id, summary_entry_id),
    CONSTRAINT reading_notes_identity_check CHECK (
        char_length(btrim(id)) > 0
        AND char_length(btrim(owner_id)) > 0
        AND char_length(btrim(book_id)) > 0
    ),
    CONSTRAINT reading_notes_body_check CHECK (char_length(body) > 0),
    CONSTRAINT reading_notes_versions_check CHECK (revision >= 1 AND save_order >= 1),
    CONSTRAINT reading_notes_timestamps_check CHECK (
        isfinite(created_at) AND isfinite(updated_at) AND isfinite(saved_at)
    ),
    -- 未入库时五列全空；有关联时五列完整，取消但保留副本必须有保护标记。
    CONSTRAINT reading_notes_summary_check CHECK (
        (
            summary_entry_id IS NULL
            AND summary_active IS NULL
            AND summary_linked_at IS NULL
            AND summary_entry_revision_at_link IS NULL
            AND summary_preserve_on_cancel IS NULL
        )
        OR (
            summary_entry_id IS NOT NULL
            AND summary_active IS NOT NULL
            AND summary_linked_at IS NOT NULL
            AND summary_entry_revision_at_link IS NOT NULL
            AND summary_preserve_on_cancel IS NOT NULL
            AND char_length(btrim(summary_entry_id)) > 0
            AND isfinite(summary_linked_at)
            AND summary_entry_revision_at_link >= 1
            AND (summary_active OR summary_preserve_on_cancel)
        )
    ),
    -- 删除日精进前，未来接口须先在事务内完整清空对应关联；感悟原文保留。
    CONSTRAINT reading_notes_summary_entry_fkey
        FOREIGN KEY (owner_id, summary_entry_id)
        REFERENCES public.entries (owner_id, id)
        MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.favorites (
    owner_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    favorited_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 只有日精进收藏需要引用 entries；作品收藏对应发布的 catalog.json。
    entry_target_id TEXT GENERATED ALWAYS AS (
        CASE WHEN target_type = 'entry' THEN target_id ELSE NULL END
    ) STORED,

    CONSTRAINT favorites_pkey PRIMARY KEY (owner_id, target_type, target_id),
    CONSTRAINT favorites_identity_check CHECK (
        char_length(btrim(owner_id)) > 0 AND char_length(btrim(target_id)) > 0
    ),
    CONSTRAINT favorites_type_check CHECK (target_type IN ('book', 'entry')),
    CONSTRAINT favorites_timestamp_check CHECK (isfinite(favorited_at)),
    -- 删除日精进只清理它的收藏；不连带删除感悟。
    CONSTRAINT favorites_entry_fkey
        FOREIGN KEY (owner_id, entry_target_id)
        REFERENCES public.entries (owner_id, id)
        MATCH SIMPLE ON DELETE CASCADE ON UPDATE RESTRICT
);

-- 三个索引分别对应契约里的列表排序，不改变接口字段或返回规则。
CREATE INDEX IF NOT EXISTS entries_owner_date_index
    ON public.entries (owner_id, entry_date DESC, created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS reading_notes_owner_book_saved_index
    ON public.reading_notes (owner_id, book_id, saved_at DESC, save_order DESC, id DESC);
CREATE INDEX IF NOT EXISTS favorites_owner_time_index
    ON public.favorites (owner_id, favorited_at DESC, target_type ASC, target_id ASC);

COMMENT ON TABLE public.entries IS 'Day 16：日精进与阅读感悟的独立入库副本；原文、分析与来源分开保存。';
COMMENT ON COLUMN public.entries.id IS '记录主键，使用不透明字符串标识，由未来服务生成。';
COMMENT ON COLUMN public.entries.owner_id IS '记录所属用户，由未来可信身份确定，不接受客户端指定归属。';
COMMENT ON COLUMN public.entries.entry_date IS '原始记录日期；只存日历日，不因时区偏移改变日期。';
COMMENT ON COLUMN public.entries.text IS '用户原文，保留输入空格和换行；有效字符长度由未来接口按契约校验。';
COMMENT ON COLUMN public.entries.text_version IS '原文版本，初始为1；仅原文字符发生变化时递增。';
COMMENT ON COLUMN public.entries.revision IS '整条记录版本，初始为1；与原文版本分别维护。';
COMMENT ON COLUMN public.entries.created_at IS '创建时刻，带时区且精确到毫秒；未来接口输出UTC格式。';
COMMENT ON COLUMN public.entries.updated_at IS '记录修改时刻；由未来写入事务维护。';
COMMENT ON COLUMN public.entries.adopted_analysis IS '独立的已采纳分析对象，内部键沿用契约的camelCase；未采纳为空。';
COMMENT ON COLUMN public.entries.origin IS '阅读入库来源快照；普通记录为空，删除原感悟后快照仍保留。';

COMMENT ON TABLE public.reading_notes IS 'Day 16：每次保存追加一条阅读感悟历史，不覆盖此前原文。';
COMMENT ON COLUMN public.reading_notes.id IS '感悟主键，每次保存使用独立字符串标识。';
COMMENT ON COLUMN public.reading_notes.owner_id IS '感悟所属用户；关联副本必须属于同一用户。';
COMMENT ON COLUMN public.reading_notes.book_id IS '作品标识，对应随版本发布的catalog.json，不新增书籍数据库表。';
COMMENT ON COLUMN public.reading_notes.body IS '感悟原文，保留输入空格和换行；有效字符长度由未来接口按契约校验。';
COMMENT ON COLUMN public.reading_notes.revision IS '感悟整条记录版本，初始为1，关联状态变化也由未来事务更新。';
COMMENT ON COLUMN public.reading_notes.created_at IS '该条历史的创建时刻，带时区且精确到毫秒。';
COMMENT ON COLUMN public.reading_notes.updated_at IS '正文保存时刻；关联状态变化不自动刷新此字段。';
COMMENT ON COLUMN public.reading_notes.saved_at IS '原感悟保存时刻；入库日期按此时刻转换到Asia/Shanghai取得。';
COMMENT ON COLUMN public.reading_notes.save_order IS '同用户同作品的保存顺序，至少为1，由未来事务递增。';
COMMENT ON COLUMN public.reading_notes.summary_entry_id IS 'summaryLink.entryId；独立日精进副本标识，未入库时为空。';
COMMENT ON COLUMN public.reading_notes.summary_active IS 'summaryLink.active；是否启用关联，与其他关联字段整组保存。';
COMMENT ON COLUMN public.reading_notes.summary_linked_at IS 'summaryLink.linkedAt；关联状态变化的时刻。';
COMMENT ON COLUMN public.reading_notes.summary_entry_revision_at_link IS 'summaryLink.entryRevisionAtLink；关联时副本版本，用于未来取消保护判断。';
COMMENT ON COLUMN public.reading_notes.summary_preserve_on_cancel IS 'summaryLink.preserveOnCancel；取消关联时是否必须保留已改副本。';

COMMENT ON TABLE public.favorites IS 'Day 16：作品与日精进收藏；同用户同目标只保留一条收藏。';
COMMENT ON COLUMN public.favorites.owner_id IS '收藏所属用户，由未来可信身份确定。';
COMMENT ON COLUMN public.favorites.target_type IS '收藏目标类型，只允许book或entry。';
COMMENT ON COLUMN public.favorites.target_id IS '收藏目标标识；作品对应书库ID，日精进对应entries.id。';
COMMENT ON COLUMN public.favorites.favorited_at IS '首次收藏时刻，重复设为收藏不得改写此时刻。';
COMMENT ON COLUMN public.favorites.entry_target_id IS '自动生成的内部外键辅助列；日精进收藏取target_id，作品收藏为空，不手工填写。';

COMMIT;

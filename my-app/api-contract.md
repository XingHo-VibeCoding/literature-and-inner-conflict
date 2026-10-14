# 文学与内心冲突｜API 契约（Day 15 创建，Day 16 补充表结构）

编制日期：2026-10-09；接口契约核对日期：2026-10-12；Day16表结构补充日期：2026-10-13；Day17验证更新日期：2026-10-14（Asia/Shanghai）。状态：**已由用户确认的第3周接口契约**。Day17三个列表GET已实现、部署并通过真实测试用户HTTP200核对；格式A、范围A、身份A，29项本地模拟检查通过。entries改库后新正文和版本2已同步到接口与核验页；两次感悟原文及收藏均保留，最终两张截图已核对。用户已确认仅提交12个Day17文件。其他16项业务接口仍为未来占位；历史证据保留文末。

## 1. 范围、事实与 AI 推导

**Day 15 用户要求（历史范围）：** 只实现 GET /api/health，返回精确服务 JSON；同时从第 2 周前端推导全部未来接口与表，今天只登记占位，不实现业务、建表或跨域。

**Day 15 历史事实（2026-10-12核对）：** health源文件已生成并本地验证，CloudBase云函数literature-health及/api/health路由已部署，实际公网GET返回200和指定JSON，用户浏览器也已确认JSON。当时其余19个业务接口全部是占位，没有部署、调用或改动现有前端。

**Day 17 用户确认与当前范围（2026-10-13）：** 用户确认「格式 A，范围 A，身份 A」：业务响应统一为恰好三个键的 `{ok,data,error}`；实现 `GET /api/entries`、`GET /api/books/:bookId/notes`、`GET /api/favorites` 三个列表读取接口；使用 CloudBase 真实用户身份核验。此次只读取现有 PostgreSQL 表，不改表结构、不写业务写入接口、不新增登录页面或认证接口。代码状态见第4.2、4.14、4.17节，部署和真库验证仍须独立核对。

**现有页面：** 原文与感悟存 IndexedDB；分析和讲解是明确标注的固定虚构演示；书本和日总结收藏是会话状态，刷新重置；当前列表没有分页。首页 homeMock 是固定虚构样例，不读个人记录。本契约不新增首页真实聚合接口、登录页面、管理后台、分析历史或修改往期感悟。

**AI 推导：** 将本地记录、感悟、收藏映射为未来后端接口；持久收藏、分页与逻辑表名是本轮建议。用户已于2026-10-12确认本文作为第 3 周建表与接口实现的唯一契约依据。此轮不表示已把个人数据搬到云端，也不自动导入本机数据。

旧 `../TECH_DESIGN.md` §6 仅规划两个 AI HTTP 接口，个人 CRUD 留本地。本稿按用户新要求补全未来接口，保留 `POST /api/analysis` 与 `POST /api/book-explanation`；未来实现以核对后的本契约为准，不继续依照旧“同作品单条可编辑备注”模型。当前代码的多条历史与保护规则是字段依据。

## 2. 公共约定

- 线上使用 HTTPS。health成功和错误维持第4.1节独立形状；用户于 Day 17 确认业务响应统一为恰好三个键的 `{ok,data,error}`。成功为 `{ok:true,data:业务数据,error:null}`，失败为 `{ok:false,data:null,error:错误对象}`；HTTP状态码仍按契约使用，不把失败伪装成200。业务响应正文不再包含requestId。
- 请求 body 为 application/json，最大64 KiB。GET/DELETE无body；DELETE的expectedRevision放query。拒绝未登记字段，不静默截断原文。
- 用户文字按去首尾空白后的 Unicode 码点数校验，但原始空格、换行与日期原样保存。AI文字与原文分字段，不自动替换。
- 普通日精进的当前日期校验依据设备本地日历。未来写接口约定由前端附带 `X-Client-Time-Zone` IANA时区（本项目常用Asia/Shanghai，省略默认Asia/Shanghai），服务端按该时区的日历今天校验，日期本身不转UTC。无效时区返回400 INVALID_INPUT。此传输约定尚未接入；前端仍保持现行设备日期规则。
- 记录日期为有效YYYY-MM-DD且不能晚于上述今天；时间戳由服务端生成UTC ISO 8601字符串。感悟入库日期固定由savedAt按Asia/Shanghai转换，与普通手填日期不同。
- 私人接口必须有经验证的身份：`Authorization: Bearer <用户 access_token>`。ownerId仅由可信身份确定，不能由body/query指定；不信客户端自行填写的用户ID请求头。无身份或无效身份返回401；找不到本人资源（包括他人ID）返回404。Day 17 不新增登录页面或认证接口，浏览器验证需已有 CloudBase 真实用户会话提供有效用户access_token。
- Day 17 真实身份核验：HTTP函数向 `GET https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/auth/v1/user/me` 主动发送该Bearer用户access_token，并仅以认证服务验证后返回的可信 `sub` 作为数据库 `owner_id`。`CLOUDBASE_ENV_ID` 由服务端环境配置确定，不由客户端指定；不能仅解码未经验证的token或直接相信透传用户头。认证服务读取失败不伪装成空列表或已登录；返回不泄露内部信息的失败响应。实现见 [auth.js](./cloudfunctions/reads/auth.js)。
- Day 16 固定虚构种子属于 `day16-demo-owner-001`，它与 CloudBase 真实用户的uid/sub不同。新账号若没有本人数据库数据，应得到成功空列表；不能把真实账号固定映射到虚构owner，也不能自动导入浏览器本地记录或将种子冒充本人数据。真库验证只能由用户在控制台为本人可信uid准备明确标注的虚构验证数据。
- 公开书库接口如提供无效身份凭证也返回401，不把无效身份悄悄当公开用户。只有health为无需身份的健康检查。
- 每次业务响应通过 `X-Request-Id` 响应头返回关联ID，正文只含ok、data、error。其他业务请求的关联ID由服务端随机生成，不信客户端传入的关联ID。未来AI请求body仍必须提供新requestId，并由响应头 `X-Request-Id` 原样回传；AI请求体、generationRequestId与已采纳分析的内部字段不因此改名。requestId用于关联，不是账号身份。
- 列表query：limit默认20，整数1–100；cursor为上一次nextCursor的不透明串。响应含items、筛选后的total、page:{limit,nextCursor,hasMore}；最后一页nextCursor=null/hasMore=false。空列表200，不把读取失败写成空列表。游标必须绑定当前用户、筛选与排序；无效返回400。分页是未来约定，现有页面尚未分页。
- 成功写入必须整笔事务完成后才返回。失败保留旧数据；客户端保留草稿。expectedRevision与textVersion不能混用。
- AI只针对本次明确请求的原文或作品，不提交个人历史。失败不返回伪造分析；草稿可编辑、采纳或放弃。AI分析摘要1–300字符，问题1–2个，每个1–100；书本讲解与一个阅读问题分别非空、合计≤300。
- 请求关联ID、记录版本、推荐条件变化时，前端作废迟到结果；页面等待30秒、模型处理预算25秒沿用旧设计规划，实际函数/网关超时待部署时核对。用户主动重试，新建requestId，不自动循环调用。
- Day 15 历史范围：未登记OPTIONS业务接口、未设置CORS、未接前端网络请求；Day 16 历史范围：仅处理表结构与数据脚本，不写接口、不改前端。Day 17 当前范围包含三项列表GET代码、部署与验证；不把其他接口或现有前端记作已接入云端个人数据。

业务错误完整 JSON（虚构示例，响应头另含 `X-Request-Id: demo-request-001`）：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_INPUT",
    "message": "原文不能为空。",
    "retryable": false,
    "fields": {
      "text": "至少1个有效字符。"
    }
  }
}
```

fields仅在字段错误时提供；message不泄露内部堆栈、供应商凭证或其他用户信息。不可重试输入/版本错误为retryable:false；频率/暂时服务故障可true，但由用户主动决定重试。日志不记原文、感悟、AI正文、密钥或完整请求头。

书库版本不一致时，错误对象必须返回当前发布版本，便于前端核对；这是未来接口约定，不是 Day 17 三项列表GET已经实现的错误响应。响应头另含 `X-Request-Id: demo-request-001`：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "CATALOG_VERSION_MISMATCH",
    "message": "书库版本已变化，请先核对未保存内容，再重新读取书库。",
    "retryable": false,
    "currentCatalogVersion": "2026-09-23.2"
  }
}
```

错误码约定（不是CloudBase平台原生错误码）：

- 400 INVALID_INPUT：字段、日期、ID、标签或游标无效。
- 401 UNAUTHENTICATED：私人接口没有可验证身份，或提供了无效身份凭证。
- 404 ENTRY_NOT_FOUND / BOOK_NOT_FOUND / NOTE_NOT_FOUND：目标不存在或不属于当前用户；不泄露他人资源是否存在。
- 409 VERSION_CONFLICT：预期 revision 或原文 textVersion 失效。
- 409 CATALOG_VERSION_MISMATCH：请求书库版本与服务端发布版本不同。
- 409 NOTE_NOT_LATEST：删除的不是该作品最新感悟。
- 409 NOTE_LINK_CONFLICT：备注与总结副本来源不匹配。
- 409 ANALYSIS_CONTEXT_MISMATCH：草稿关联与当前记录／原文版本不一致。
- 413 PAYLOAD_TOO_LARGE：JSON 请求体超过 64 KiB。
- 415 UNSUPPORTED_MEDIA_TYPE：有请求体却不是 application/json。
- 429 RATE_LIMITED：请求频率达到部署后的实际限额。
- 404 NOT_FOUND：未登记的业务路径。
- 405 METHOD_NOT_ALLOWED：业务路径不支持所用方法，响应头列出允许的方法。
- 500 INTERNAL_ERROR：读取失败。
- 500 WRITE_FAILED：写入事务失败，旧数据不变。
- 502 AI_INVALID_OUTPUT：模型响应缺字段、超长、格式错误或作品归属不符。
- 503 AI_UNAVAILABLE：真实 AI 未配置、被停用或不可用。
- 504 AI_TIMEOUT：模型响应超过服务端约定等待时间。
- 409 RECOMMENDATION_CONTEXT_MISMATCH：作品不在当前版本与条件对应的指定推荐组内。

每条业务接口下面的错误清单均使用上述完整封套，code和HTTP状态按列出的对应值；health不使用此封套。

## 3. 数据模型与表结构

以下逻辑表在 Day 15 登记为占位。Day 16 用户确认使用 PostgreSQL 17.11，今日建 entries、reading_notes、favorites 三张表；物理结构与存储映射见第3.7节，本地脚本已生成，云端三表、种子输入副本两次执行、查询与截图均已核对。API使用camelCase字段；物理存储映射不改变本契约的JSON形状。

| 逻辑表／资源 | 字段与关系 | 必须保留的约束 |
| --- | --- | --- |
| entries | ownerId + Entry字段；adoptedAnalysis、origin为可空独立对象 | 主键id；每条属于本人；revision与textVersion≥1；列表按日期/创建时间/ID稳定排序 |
| reading_notes | ownerId + ReadingNote字段；bookId关联发布书库；summaryLink关联独立entries副本 | 主键id；按(ownerId,bookId)分组；saveOrder在该组事务内递增；不覆盖历史 |
| favorites | ownerId,targetType,targetId,favoritedAt | (ownerId,targetType,targetId)唯一；targetType仅book/entry；重复设状态不重复建条目 |
| 发布书库 | shared/catalog.json中的版本、标签、作品与来源 | 继续随版本发布JSON；不必新增books/标签数据库表；只读，无编辑后台 |
| 派生结果 | 两组推荐、AI草稿与讲解、最新感悟指针 | 不新增个人历史表；未采纳的AI草稿不进入entries；最新指针由历史计算 |

JSON值为虚构或字段形状样例，不能作为真实AI输出、用户经历或新文学引文。书目来源从现有人工书库取，不在本稿编造引用。示例只有1项，不代表实际6本书库或匹配总数。

### 3.1 Entry

origin普通记录为null；阅读入库时为第3.4节对象。当前普通本地对象可能省略origin，未来HTTP统一返回null。ownerId仅内部，不发回普通详情。

```json
{
  "id": "demo-entry-001",
  "entryDate": "2026-10-08",
  "text": "【虚构·契约样例】今天读完一页后，我记下了一个问题。\n",
  "textVersion": 1,
  "revision": 1,
  "createdAt": "2026-10-08T01:00:00.000Z",
  "updatedAt": "2026-10-08T01:00:00.000Z",
  "adoptedAnalysis": null,
  "origin": null
}
```

### 3.2 AdoptedAnalysis

```json
{
  "source": "ai",
  "generationRequestId": "demo-analysis-001",
  "sourceTextVersion": 1,
  "summary": "【虚构·形状样例】这次阅读后留下了一个问题。",
  "questions": [
    "这个问题与你的哪次经历有关？"
  ],
  "adoptedAt": "2026-10-08T01:02:00.000Z"
}
```

真实AI工作流source为ai；generationRequestId关联生成草稿的请求，由服务端核对属于本人、对应entryId/textVersion。source不能由用户改为ai。服务端内部如何验证草稿关联不改变HTTP字段，不要求新增个人分析历史表。用户编辑正文后仍标注其工作流来源；不得声称编辑后的每个字都由AI生成。当前固定demo只保存在浏览器，不冒充已支持真实AI采纳，也不自动上传。

### 3.3 ReadingNote 与 SummaryLink

未入库summaryLink=null；每次保存独立ID，正文不可被新保存覆盖。最新副本缓存不是新的持久逻辑表。

```json
{
  "id": "demo-note-001",
  "bookId": "walden",
  "body": "【虚构·契约样例】我想重新核对哪些安排确有必要。\n",
  "revision": 2,
  "createdAt": "2026-10-08T01:00:00.000Z",
  "updatedAt": "2026-10-08T01:00:00.000Z",
  "savedAt": "2026-10-08T01:00:00.000Z",
  "saveOrder": 1,
  "summaryLink": {
    "entryId": "demo-note-entry-001",
    "active": true,
    "linkedAt": "2026-10-08T01:05:00.000Z",
    "entryRevisionAtLink": 1,
    "preserveOnCancel": false
  }
}
```

summaryLink.active=false表示关联已取消，但因副本被改动而保留可复用的来源关联。updatedAt为正文保存时间；关联状态改变用revision/linkedAt表达，不擅自覆盖原文日期。

### 3.4 阅读入库的 Entry.origin

```json
{
  "type": "reading-note",
  "noteId": "demo-note-001",
  "bookId": "walden",
  "bookTitle": "瓦尔登湖",
  "noteSavedAt": "2026-10-08T01:00:00.000Z"
}
```

noteSavedAt保留原感悟保存时间；bookTitle是入库时的来源快照。取消入库不抹掉已保留副本的来源。

### 3.5 Book

```json
{
  "id": "walden",
  "title": "瓦尔登湖",
  "author": "亨利·戴维·梭罗",
  "categories": [
    "literature",
    "philosophy"
  ],
  "literaryForms": [
    "散文"
  ],
  "intro": "【响应字段样例】实际简介返回已核对的人工书库文字。",
  "topics": [
    "简朴生活与个人需要"
  ],
  "sources": [
    {
      "name": "Penguin Random House：Walden 作品资料",
      "url": "https://www.penguinrandomhouse.com/books/469576/walden-by-henry-david-thoreau/"
    }
  ],
  "displayOrder": 2,
  "situationMatches": [
    {
      "tagId": "rethink-life",
      "basis": "【响应字段样例】返回人工整理的处境匹配依据。"
    }
  ],
  "directionMatches": [
    {
      "tagId": "simpler-life",
      "basis": "【响应字段样例】返回人工整理的改变方向依据。"
    }
  ]
}
```

返回经核对的人工资料；不完整作品不展示。catalogVersion目前是2026-09-23.2，以shared/catalog.json实际发布值为准。两类推荐说明必须连到本次处境／方向；文学原文引用需可核实出处，未核实明确标记，不生成伪引文。

### 3.6 Favorite 与个人书目状态

```json
{
  "targetType": "book",
  "targetId": "walden",
  "favoritedAt": "2026-10-08T01:00:00.000Z"
}
```

私人书目状态为 `{favorite:boolean,hasNotes:boolean,latestNoteId:string|null}`；未读取个人数据的公开响应为null，不能以false伪装读取成功。当前会话Set<bookId>/Set<entryId>映射到未来targetType/targetId；这里不新增收藏页面。

### 3.7 Day 16 物理表结构（2026-10-13）

**用户确认：** 今日同时建 `entries`、`reading_notes`、`favorites` 三张表，每张至少五行虚构示例；数据库已开通 PostgreSQL 17.11、状态运行中（用户报告）。第①板块模型核对后，用户以「进入下一板块」授权第②板块。

**当前事实：** [db/schema.sql](./db/schema.sql) 和 [db/seed.sql](./db/seed.sql) 已本地生成。用户随后明确授权AI代操作CloudBase，原话为「授权，这三张表的现有数据可以清空」。经授权在原项目 `ritchie`、环境 `ritchie-d5gd1dg1yd29783e8` 的PostgreSQL控制台核对：版本查询返回17.11，数据库为 `postgres-gbu0fd7s`，执行前public没有表。种子输入副本连续执行两次，控制台分别显示「执行成功」24ms与36ms；每次执行后查询三表行数均为5／5／5。

**执行副本与本地文件的区别：** 为适配控制台SQL编辑器的注释提示，输入副本仅去掉以 `--` 开头的说明行；可执行SQL及 `COMMENT ON` 均与本地 `seed.sql` 一致，两次粘贴读回比较均为true。本地 `schema.sql` 与 `seed.sql` 没有因此修改；不声称含全部说明行的本地文件已逐字执行。独立 `schema.sql` 原版尚未单独重跑，已取得的是种子输入副本两次重建的成功证据。

**已核对的云端查询：** `entries`、`reading_notes`、`favorites` 分别实际返回五行虚构数据。感悟与副本的同用户关联查询返回五行：001→003（active=true、preserve=false，副本revision／关联时版本为1／1）；002无关联；003→004（true／false，1／1）；004无关联；005→005（false／true，2／1，已取消但保留已改副本）。三条有关联记录的来源与上海日期匹配均为true，两条无关联记录的比较结果为空；当前启用关联仅两条。约束查询返回五行，包含三张表的PRIMARY KEY和 `favorites_entry_fkey`、`reading_notes_summary_entry_fkey` 两个外键。

**截图与收尾状态（2026-10-13）：** 用户已提供favorites、entries、reading_notes三张CloudBase表数据页截图；三张均完整显示表名、五行虚构数据和底部共5条，已核对通过。entries与reading_notes右下角截图提示没有遮挡关键证据。用户已于2026-10-13说「今天做完了」，本段记录提交前验收状态；待用户核对三份Day16提交文件清单后才提交推送。Day 16 收尾时业务接口仍全部未实现；Day 17 的代码状态见第4节。种子状态与数据库查询核对不表示已运行删除、取消入库或版本保护等业务流程。

物理列使用 snake_case，API继续返回本契约原有camelCase字段；`adopted_analysis` 与 `origin` 的JSON内部键也保持camelCase。存储映射不新增请求字段、不改变响应形状；`owner_id`仅内部使用。

| entries 列 | PostgreSQL 类型 | 契约字段与约束 |
| --- | --- | --- |
| id | TEXT，非空 | id；主键，非空字符串（排除纯普通空格） |
| owner_id | TEXT，非空 | 内部ownerId；非空字符串（排除纯普通空格）；与id另设联合唯一供外键引用 |
| entry_date | DATE，非空 | entryDate；年份0001–9999，日期不晚于用户当地今天由未来接口校验 |
| text | TEXT，非空 | text；至少含一个字符，保留原始空格与换行；有效字符1–5000按原契约校验 |
| text_version | INTEGER，非空，默认1 | textVersion；至少1，原文版本 |
| revision | INTEGER，非空，默认1 | revision；至少1，整条记录版本 |
| created_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | createdAt；有限的实际时刻，未来API输出UTC ISO 8601 |
| updated_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | updatedAt；由未来事务显式维护，不添加自动更新触发器 |
| adopted_analysis | JSONB，可空 | adoptedAnalysis；SQL NULL映射API null；非空时检查对象及第3.2节必需键、字段基本类型、source=ai、正整数原文版本和1–2个非空字符串问题 |
| origin | JSONB，可空 | origin；SQL NULL映射API null；非空时检查第3.4节来源对象及必要字符串；它是历史快照，不强制引用感悟表 |

| reading_notes 列 | PostgreSQL 类型 | 契约字段与约束 |
| --- | --- | --- |
| id | TEXT，非空 | id；主键，非空字符串（排除纯普通空格） |
| owner_id | TEXT，非空 | 内部ownerId；非空字符串（排除纯普通空格） |
| book_id | TEXT，非空 | bookId；非空字符串（排除纯普通空格），未来接口核对发布的catalog.json |
| body | TEXT，非空 | body；至少含一个字符，保留原始空格与换行；有效字符1–1000按原契约校验 |
| revision | INTEGER，非空，默认1 | revision；至少1 |
| created_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | createdAt；有限的实际时刻 |
| updated_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | updatedAt；正文保存时刻，关联状态变化不自动更新 |
| saved_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | savedAt；原感悟保存时刻，入库日期按Asia/Shanghai取得 |
| save_order | INTEGER，非空 | saveOrder；至少1；(owner_id,book_id,save_order)唯一，递增由未来事务维护 |
| summary_entry_id | TEXT，可空 | summaryLink.entryId；非空时为非空字符串（排除纯普通空格） |
| summary_active | BOOLEAN，可空 | summaryLink.active |
| summary_linked_at | TIMESTAMPTZ(3)，可空 | summaryLink.linkedAt；存在时必须为有限时刻 |
| summary_entry_revision_at_link | INTEGER，可空 | summaryLink.entryRevisionAtLink；存在时至少1 |
| summary_preserve_on_cancel | BOOLEAN，可空 | summaryLink.preserveOnCancel |

五个 `summary_*` 列必须全部为空（API `summaryLink:null`），或全部完整（按第3.3节组回对象）。完整关联中 `active=false` 必须有 `preserveOnCancel=true`；重新启用保留副本时允许两者均为true。同用户的非空 `summary_entry_id` 唯一，多条未入库感悟可以同时为空。

| favorites 列 | PostgreSQL 类型 | 契约字段与约束 |
| --- | --- | --- |
| owner_id | TEXT，非空 | 内部ownerId；非空字符串（排除纯普通空格） |
| target_type | TEXT，非空 | targetType；仅book/entry |
| target_id | TEXT，非空 | targetId；非空字符串（排除纯普通空格） |
| favorited_at | TIMESTAMPTZ(3)，非空，默认当前时刻 | favoritedAt；有限的首次收藏时刻 |
| entry_target_id | TEXT，自动生成并存储 | 内部辅助列；target_type=entry时取target_id，作品收藏时为空；不接受手填，不出现在API响应 |

`favorites` 以 `(owner_id,target_type,target_id)` 为复合主键，保证同用户同目标唯一。重复收藏true时保留首次时间、取消收藏false不误报错误，仍由未来接口按第5.9节执行。

**外键与删除保护：**

- `reading_notes(owner_id,summary_entry_id)` → `entries(owner_id,id)`，使用 `MATCH SIMPLE`，允许未入库时为空；删除与更新规则为 `RESTRICT`。删除Entry前，未来事务必须完整清空仍对应的五个关联字段；感悟原文保留。
- `favorites(owner_id,entry_target_id)` → `entries(owner_id,id)`，使用 `MATCH SIMPLE`；删除规则为 `CASCADE`，仅清理被删Entry的收藏；更新规则为 `RESTRICT`。
- `entries.origin.noteId` 是保留的来源快照，不设反向强制外键；删除感悟后Entry和origin仍保留。作品标识由未来服务核对书库，不新增books或标签表。

**索引与重跑：** 三个列表索引分别对应第4.2、4.17、4.14节已登记排序。`schema.sql` 在事务内使用 `CREATE TABLE/INDEX IF NOT EXISTS`，重复执行保留数据并更新同样的中文注释；它不迁移与当前脚本不同的旧表结构。`seed.sql` 已生成可直接复制到控制台的自包含脚本，建表定义与schema一致。在单次事务中按favorites→reading_notes→entries删除三表，再重建并按entries→reading_notes→favorites插入；没有用DROP CASCADE扩大删除范围。执行会删除这三张表的原有数据，仅用于已确认可重置的测试数据库；重跑恢复同一组固定示例；去掉说明行的种子输入副本已在云端连续执行两次成功，独立schema.sql原版尚未单独重跑。

**固定种子示例（已通过云端查询核对）：** 所有行属于虚构用户 `day16-demo-owner-001`，ID和2026-10-08至2026-10-12的时间固定。`entries` 为两条普通记录与三条独立阅读副本；`reading_notes` 为五条历史，包含同一本书两次保存、未入库、已入库、取消后保留已改副本；`favorites` 为三条作品收藏与两条日精进收藏。作品ID与标题来自现有catalog.json，正文和分析对象均明确标注虚构，没有新增文学引文或调用真实AI。本轮已通过种子输入副本的实际执行和查询核对云端三表；三张表数据页截图现已收到并核对通过；独立schema.sql原版单独重跑仍没有证据，Day16提交仍待用户按规则确认。

**类型与验证边界：** 标识符的数据库检查仅排除空字符串与纯普通空格，更完整的ID合法性由未来接口核对。`TEXT`保留原文；`DATE`保留日历日；正整数分别表达版本和顺序；`TIMESTAMPTZ(3)`保存毫秒时刻，控制台显示受会话时区影响；`JSONB`保存独立对象；`BOOLEAN`保存状态。数据库只执行结构与必要约束，Unicode去空白后的长度、客户端时区今天、JSON时间字符串有效性、分析上下文、来源匹配、最新感悟、版本递增与原子事务保护仍须未来接口实现；今天不编写这些接口、触发器、权限策略或改前端。

## 4. 接口逐项定义

下列JSON是实际传输形状样例，没有省略号；业务响应已统一为第2节的三键形状。health维持已验证的独立响应；Day 17 三项列表GET的代码已实现，29项本地虚构数据检查已通过（含当前安全诊断），三条路由已保存，无Bearer公网HTTP均401；entries带身份真库已通过，其余两GET和最终含地址栏截图待验证；其余16项业务接口仍为**未来占位**。普通业务响应样例另含 `X-Request-Id: demo-request-001` 响应头；两项未来AI响应头使用各自请求body中的requestId。每项列出自己的特定错误；发生基础请求格式错误时也遵守第2节413/415约定。

### 4.1 GET /api/health

- 用途：公网最小健康检查。
- 页面依据：`cloudfunctions/health/index.js`。
- 身份／状态：公开，无登录。Day 15 唯一有代码的接口；2026-10-12已通过公网GET 200及指定JSON验证。Day 17 三项列表GET的状态另列，不改变本health响应。
- 已验证公网地址：[打开 health](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/health)。
- 参数：无 path/body 参数。没有业务查询参数；当前实现忽略查询串。路径必须恰好 /api/health。

成功：HTTP 200。

```json
{"ok":true,"service":"【literature-and-inner-conflict】"}
```

错误返回：404 NOT_FOUND（其他路径）；405 METHOD_NOT_ALLOWED（本路径的非 GET 方法，Allow: GET）。health 错误为独立形状：{"ok":false,"error":{"code":"METHOD_NOT_ALLOWED","message":"此接口仅支持 GET 请求。"}}。未知路径 message 为“接口不存在。”；HEAD响应按HTTP约定没有正文。网关可能另外返回平台错误，不混同函数错误。

### 4.2 GET /api/entries

- 实现状态：**已实现并通过Day17主任务验证：云函数与公网路由已部署；真实HTTP200、原文/日期映射、控制台改单行后新正文与版本2返回、页面显示均已核对；本地29项检查通过。limit1真库跨页及跨用户隔离未实测**。代码见 [index.js](./cloudfunctions/reads/index.js)、[service.js](./cloudfunctions/reads/service.js)、[auth.js](./cloudfunctions/reads/auth.js)；部署与人工验证见 [deploy-day17.md](./deploy-day17.md)。

- 用途：日精进／总结库列表读取；不可遗漏的记录表读接口。
- 页面依据：`src/services/localStore.js readEntries；src/pages/JournalPage.jsx 历史列表`。
- 身份／状态：私人。
- 参数：query：limit 可选，默认20、1–100整数；cursor 可选、服务端返回的不透明游标。无请求体。当前页面没有日期区间或搜索筛选，本契约不增加。按 entryDate降序、createdAt降序、id升序。

成功：HTTP 200。

```json
{"ok":true,"data":{"items":[{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。空结果仍200，items:[]、total:0，不以空数组代替读取失败。

### 4.3 GET /api/entries/:entryId

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：回看／重新读取单条日精进。
- 页面依据：`src/services/localStore.js readEntry；src/pages/JournalPage.jsx`。
- 身份／状态：私人。
- 参数：path：entryId 必需，为列表返回的非空不透明ID。无 query/body。

成功：HTTP 200。

```json
{"ok":true,"data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；500 INTERNAL_ERROR。

### 4.4 POST /api/entries

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：新建日精进，保留用户原文和日期。
- 页面依据：`src/services/localStore.js createEntry；shared/validation.js validateEntry`。
- 身份／状态：私人。
- 参数：body：entryDate、text 必需。entryDate 为有效 YYYY-MM-DD 日期；text 校验为1–5000个有效字符，保存原始输入。ID、版本、时间、ownerId、origin和adoptedAnalysis不由客户端指定。

请求JSON示例：

```json
{"entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n"}
```

成功：HTTP 201。

```json
{"ok":true,"data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null},"error":null}
```

错误返回：400 INVALID_INPUT（fields可含entryDate/text）；401 UNAUTHENTICATED；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.5 PATCH /api/entries/:entryId

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：修改当前记录；原文变化时原子清除旧分析。
- 页面依据：`src/services/entryModel.js reviseEntry；src/services/localStore.js updateEntry`。
- 身份／状态：私人。
- 参数：path：entryId 必需。body：expectedRevision 必需，为≥1整数；entryDate/text至少一个且沿用新建校验。缺少的字段保持当前值。text只要任意字符变化就textVersion+1并清空adoptedAnalysis；仅改日期保留分析。成功写入revision+1。

请求JSON示例：

```json
{"entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我又记下一个问题。\n","expectedRevision":1}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我又记下一个问题。\n","textVersion":2,"revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:03:00.000Z","adoptedAnalysis":null,"origin":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.6 DELETE /api/entries/:entryId

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：删除日精进及其仍对应的入库关联。
- 页面依据：`src/services/localStore.js deleteEntry`。
- 身份／状态：私人。
- 参数：path：entryId 必需。query：expectedRevision 必需，为≥1整数。无body。当前用户的关联收藏一并清理；若origin为reading-note，原子清除仍指向本记录的summaryLink，保留阅读感悟原文。

成功：HTTP 200。

```json
{"ok":true,"data":{"deleted":true,"entryId":"demo-entry-001"},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；409 NOTE_LINK_CONFLICT；500 WRITE_FAILED。不借删除恢复已删资源。

### 4.7 PUT /api/entries/:entryId/adopted-analysis

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：用户核对并采纳已生成的分析草稿。
- 页面依据：`src/pages/AnalysisPanel.jsx adopt；src/services/analysisModel.js adoptDemoAnalysis 的版本保护`。
- 身份／状态：私人。真实AI采纳为未来占位；当前demo仍只本地。
- 参数：path：entryId 必需。body：expectedRevision、sourceTextVersion、generationRequestId、summary、questions均必需。前两项为≥1整数；generationRequestId取POST /api/analysis成功响应头X-Request-Id的值；summary为1–300字符；questions为1–2项，每项1–100字符。source由服务端继承生成上下文，客户端不能把demo改成ai。核对草稿归属、记录版本与原文版本，写入只改变adoptedAnalysis/revision/updatedAt，不改变text或entryDate。

请求JSON示例：

```json
{"expectedRevision":1,"sourceTextVersion":1,"generationRequestId":"demo-analysis-001","summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"]}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:02:00.000Z","adoptedAnalysis":{"source":"ai","generationRequestId":"demo-analysis-001","sourceTextVersion":1,"summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"],"adoptedAt":"2026-10-08T01:02:00.000Z"},"origin":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；409 ANALYSIS_CONTEXT_MISMATCH；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。未生成、失效或属于别的记录的草稿不能采纳。

### 4.8 POST /api/analysis

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：针对本次已保存原文生成可编辑分析草稿。
- 页面依据：`../TECH_DESIGN.md §6.2；src/pages/AnalysisPanel.jsx 的未来真实AI按钮`。
- 身份／状态：私人，须用户主动触发；当前未接入AI。
- 参数：body：requestId、entryId、textVersion、text均必需。requestId为本次新生成的非空随机标识；textVersion≥1；text为1–5000字符，原文保留。未来服务端先读取本人记录并核对版本及原文，再只发送本次原文给模型，不提交历史、收藏或备注。生成不自动采纳，不修改记录。

请求JSON示例：

```json
{"requestId":"demo-analysis-001","entryId":"demo-entry-001","textVersion":1,"text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n"}
```

成功：HTTP 200。响应头 `X-Request-Id: demo-analysis-001` 与请求body的requestId一致。

```json
{"ok":true,"data":{"entryId":"demo-entry-001","textVersion":1,"baseRevision":1,"source":"ai","summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"]},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；429 RATE_LIMITED；502 AI_INVALID_OUTPUT；503 AI_UNAVAILABLE；504 AI_TIMEOUT。

### 4.9 GET /api/catalog

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：读取书库版本、类型与两组选择标签。
- 页面依据：`shared/catalog.json；src/services/catalog.js bookCategories/situationTags/directionTags`。
- 身份／状态：公开。未来只读接口，发布资料来自同版JSON。
- 参数：无 path/query/body。metadata拆为本接口，作品通过GET /api/books读取；这是未来HTTP拆分约定，当前仍直接导入JSON。

成功：HTTP 200。

```json
{"ok":true,"data":{"catalogVersion":"2026-09-23.2","categories":[{"id":"all","label":"全部"},{"id":"literature","label":"文学"},{"id":"philosophy","label":"哲学"},{"id":"humanities-social-sciences","label":"人文社科"}],"situationTags":[{"id":"rethink-life","label":"正在重新思考怎样生活"},{"id":"relationship-confusion","label":"在人际关系中感到困惑"},{"id":"beyond-the-self","label":"觉得困扰不只来自自己"}],"directionTags":[{"id":"review-choices","label":"重新审视生活中的重要选择"},{"id":"simpler-life","label":"尝试更简朴的生活"},{"id":"social-perspective","label":"从社会背景理解经历"}]},"error":null}
```

错误返回：500 INTERNAL_ERROR；有身份凭证但无效时401 UNAUTHENTICATED。

### 4.10 GET /api/books

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：按类型读取书单及“我的收藏／有备注”视图。
- 页面依据：`src/pages/BooksPage.jsx books；src/services/catalog.js listBooks`。
- 身份／状态：view=all可公开；favorites/noted视图须身份。all提供有效身份时也返回自己的personalState。
- 参数：query：category可选默认all，枚举all/literature/philosophy/humanities-social-sciences；view可选默认all，枚举all/favorites/noted；limit/cursor按列表公约。仅完整可用书目；按displayOrder升序、id升序（新增稳定并列规则）。

成功：HTTP 200。

```json
{"ok":true,"data":{"catalogVersion":"2026-09-23.2","items":[{"book":{"id":"walden","title":"瓦尔登湖","author":"亨利·戴维·梭罗","categories":["literature","philosophy"],"literaryForms":["散文"],"intro":"【响应字段样例】实际简介返回已核对的人工书库文字。","topics":["简朴生活与个人需要"],"sources":[{"name":"Penguin Random House：Walden 作品资料","url":"https://www.penguinrandomhouse.com/books/469576/walden-by-henry-david-thoreau/"}],"displayOrder":2,"situationMatches":[{"tagId":"rethink-life","basis":"【响应字段样例】返回人工整理的处境匹配依据。"}],"directionMatches":[{"tagId":"simpler-life","basis":"【响应字段样例】返回人工整理的改变方向依据。"}]},"personalState":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。已验证身份时personalState为{"favorite":false,"hasNotes":false,"latestNoteId":null}；公开读取为null，不能假冒已读取私人状态。

### 4.11 GET /api/books/:bookId

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：作品详情、核对来源及自己的阅读状态。
- 页面依据：`src/services/catalog.js getBook；src/pages/BookReadingPanel.jsx`。
- 身份／状态：基本书目公开；有效身份附带本人personalState。
- 参数：path：bookId必需，为发布书库中的ID。无query/body。个人感悟正文通过notes列表读，不混入公开响应。

成功：HTTP 200。

```json
{"ok":true,"data":{"catalogVersion":"2026-09-23.2","book":{"id":"walden","title":"瓦尔登湖","author":"亨利·戴维·梭罗","categories":["literature","philosophy"],"literaryForms":["散文"],"intro":"【响应字段样例】实际简介返回已核对的人工书库文字。","topics":["简朴生活与个人需要"],"sources":[{"name":"Penguin Random House：Walden 作品资料","url":"https://www.penguinrandomhouse.com/books/469576/walden-by-henry-david-thoreau/"}],"displayOrder":2,"situationMatches":[{"tagId":"rethink-life","basis":"【响应字段样例】返回人工整理的处境匹配依据。"}],"directionMatches":[{"tagId":"simpler-life","basis":"【响应字段样例】返回人工整理的改变方向依据。"}]},"personalState":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED（提供无效凭证）；404 BOOK_NOT_FOUND；500 INTERNAL_ERROR。私人状态形状同GET /api/books。

### 4.12 POST /api/recommendations

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：按当前处境与改变方向生成两组人工标签匹配推荐。
- 页面依据：`src/services/catalog.js buildRecommendations；src/pages/BooksPage.jsx`。
- 身份／状态：公开；不读取个人原文。当前计算在前端，本HTTP版本为未来占位。
- 参数：body：catalogVersion、category、situationTagId、directionTagId必需。category使用类型枚举，两个tagId必须存在于当前版本。按类型筛全库，再按人工匹配basis选组，组内去重、跨组同书允许，每组最多3项。

请求JSON示例：

```json
{"catalogVersion":"2026-09-23.2","category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life"}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"catalogVersion":"2026-09-23.2","conditions":{"category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life"},"situationLabel":"正在重新思考怎样生活","directionLabel":"尝试更简朴的生活","groups":[{"id":"mirror","title":"映照当下","tagLabel":"正在重新思考怎样生活","totalMatches":1,"items":[{"bookId":"walden","baseReason":"【虚构·形状样例】这里返回人工整理的本次处境联系。"}]},{"id":"change","title":"探索改变","tagLabel":"尝试更简朴的生活","totalMatches":1,"items":[{"bookId":"walden","baseReason":"【虚构·形状样例】这里返回人工整理的本次方向联系。"}]}]},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED（提供无效身份凭证）；409 CATALOG_VERSION_MISMATCH；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 INTERNAL_ERROR。无匹配仍200，两组items:[]且totalMatches:0；不能换书或借收藏决定推荐。

### 4.13 POST /api/book-explanation

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：用户主动请求某次推荐中某组作品的讲解。
- 页面依据：`../TECH_DESIGN.md §6.2；src/services/explanationDemo.js；src/pages/BooksPage.jsx`。
- 身份／状态：有效身份，便于归属与频率控制；当前未接入AI。
- 参数：body：requestId、catalogVersion、bookId、group、category、situationTagId、directionTagId均必需；group只能mirror/change。HTTP保留旧设计group字段，前端上下文groupId映射到group。后端按同版发布JSON核对作品确在该组最多3项中，不信任客户端提交的简介或来源。explanation/readingQuestion分别非空且合计≤300字符。

请求JSON示例：

```json
{"requestId":"demo-explanation-001","catalogVersion":"2026-09-23.2","bookId":"walden","group":"mirror","category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life"}
```

成功：HTTP 200。响应头 `X-Request-Id: demo-explanation-001` 与请求body的requestId一致。

```json
{"ok":true,"data":{"source":"ai","catalogVersion":"2026-09-23.2","bookId":"walden","group":"mirror","category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life","explanation":"【虚构·形状样例】实际讲解须说明作品与本次处境的联系，并有可核对来源。","readingQuestion":"【虚构】你想核对哪一项日常安排？"},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；409 CATALOG_VERSION_MISMATCH；409 RECOMMENDATION_CONTEXT_MISMATCH（不属于本组或条件）；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；429 RATE_LIMITED；502 AI_INVALID_OUTPUT；503 AI_UNAVAILABLE；504 AI_TIMEOUT。讲解临时展示，不写个人历史表。

### 4.14 GET /api/favorites

- 实现状态：**已实现并通过Day17主任务验证：已部署；真实HTTP200，完整JSON的book/walden关联、favoritedAt、total1及limit20末页字段与三键封套均已截图核对；本地29项检查通过**。代码见 [index.js](./cloudfunctions/reads/index.js)、[service.js](./cloudfunctions/reads/service.js)、[auth.js](./cloudfunctions/reads/auth.js)；部署与人工验证见 [deploy-day17.md](./deploy-day17.md)。

- 用途：读取未来收藏状态，支持书单收藏视图恢复。
- 页面依据：`src/pages/BooksPage.jsx 收藏视图；JournalPage.jsx 会话收藏按钮；src/services/temporaryFavorite.js`。
- 身份／状态：私人。持久收藏是本次草案建议，当前会话收藏行为未变；不增加新的日总结收藏列表页面。
- 参数：query：targetType可选，book/entry，省略读两类；limit/cursor按列表公约。按favoritedAt降序、targetType升序、targetId升序。targetType=book的targetId映射当前bookId；entry映射entryId。

成功：HTTP 200。

```json
{"ok":true,"data":{"items":[{"targetType":"book","targetId":"walden","favoritedAt":"2026-10-08T01:00:00.000Z"}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。该列表仅返回收藏关联；作品或记录详情由其读取接口获得。

### 4.15 PUT /api/books/:bookId/favorite

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：明确设置作品收藏或取消目标状态。
- 页面依据：`src/pages/BookReadingPanel.jsx 收藏按钮；src/services/temporaryFavorite.js`。
- 身份／状态：私人；今天仍会话演示，未来才持久化。
- 参数：path：bookId必需。body：favorite必需、严格boolean。重复true不重复建记录/不改favoritedAt；重复false保持未收藏。取消收藏不删感悟或入库副本。

请求JSON示例：

```json
{"favorite":true}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"targetType":"book","targetId":"walden","favorite":true,"favoritedAt":"2026-10-08T01:00:00.000Z"},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。取消成功同形状，favorite:false、favoritedAt:null。

### 4.16 PUT /api/entries/:entryId/favorite

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：设置日总结收藏目标状态。
- 页面依据：`src/pages/JournalPage.jsx toggleFavorite；src/services/temporaryFavorite.js`。
- 身份／状态：私人；当前没有持久“日总结收藏”模型，未来建议与作品共用favorites。
- 参数：path：entryId必需。body：favorite必需、严格boolean。同一目标重复设置幂等；只改变收藏关联，不改变原文、分析或记录revision。

请求JSON示例：

```json
{"favorite":true}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"targetType":"entry","targetId":"demo-entry-001","favorite":true,"favoritedAt":"2026-10-08T01:00:00.000Z"},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。取消为favorite:false、favoritedAt:null。

### 4.17 GET /api/books/:bookId/notes

- 实现状态：**已实现并通过Day17主任务验证：已部署；真实HTTP200，两次感悟原文完整保留，002在前/001在后，total2、saveOrder2/1及latestNoteId002均已截图核对；本地29项检查通过。limit1真库跨页未实测**。代码见 [index.js](./cloudfunctions/reads/index.js)、[service.js](./cloudfunctions/reads/service.js)、[auth.js](./cloudfunctions/reads/auth.js)；部署与人工验证见 [deploy-day17.md](./deploy-day17.md)。

- 用途：读取当前作品全部阅读备注与感悟历史。
- 页面依据：`src/services/localStore.js readNoteHistory；src/pages/BookReadingPanel.jsx 往期列表`。
- 身份／状态：私人。
- 参数：path：bookId必需。query：limit/cursor按列表公约。按savedAt降序、saveOrder降序、id降序；必须读历史而非只读最新备注。最新条目ID为全量筛选的首项ID，不是任意页第一项。

成功：HTTP 200。

```json
{"ok":true,"data":{"bookId":"walden","latestNoteId":"demo-note-001","items":[{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；500 INTERNAL_ERROR。无感悟为items:[]、latestNoteId:null、total:0。

### 4.18 POST /api/books/:bookId/notes

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：每次保存追加一条独立感悟，保留过去原文。
- 页面依据：`src/services/localStore.js appendNote；src/services/readingModel.js createHistoryNote`。
- 身份／状态：私人，不要求先收藏。
- 参数：path：bookId必需。body：body必需，1–1000个有效字符，原样保存。id/revision/timestamps/saveOrder由服务端生成；同一用户同书saveOrder事务内递增。此接口不覆盖旧历史，不兼作PUT编辑接口。

请求JSON示例：

```json
{"body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n"}
```

成功：HTTP 201。

```json
{"ok":true,"data":{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.19 DELETE /api/notes/:noteId

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：删除该作品最新的一条感悟，保护往期与入库副本。
- 页面依据：`src/services/localStore.js deleteHistoryNote；src/pages/BookReadingPanel.jsx`。
- 身份／状态：私人。
- 参数：path：noteId必需。query：expectedRevision必需，≥1整数；无body。事务内检查版本和是否仍是本人该书最新条目。删除后最新指针变为上一条；已入总结库的独立记录与来源保留。

成功：HTTP 200。

```json
{"ok":true,"data":{"deleted":true,"noteId":"demo-note-001","bookId":"walden","latestNoteId":null},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 NOTE_NOT_FOUND；409 VERSION_CONFLICT；409 NOTE_NOT_LATEST；500 WRITE_FAILED。不能删除历史条目后再顺手删总结。

### 4.20 PUT /api/notes/:noteId/summary-link

- 实现状态：**未来占位，未实现**；此次仅同步已确认的统一业务响应形状，不增加接口代码。

- 用途：将任意历史感悟入库，或取消其入库关联。
- 页面依据：`src/services/localStore.js setNoteInSummary；src/services/readingModel.js createNoteSummary/canRemoveNoteSummary`。
- 身份／状态：私人。
- 参数：path：noteId必需。body：enabled必需、严格boolean；expectedRevision必需、≥1整数。最新和往期均可。入库复制body到entries.text，日期由note.savedAt按Asia/Shanghai取得，origin保存来源，原感悟不变。状态变化核对revision；重复相同目标且现有资源一致时返回unchanged。

请求JSON示例：

```json
{"enabled":true,"expectedRevision":1}
```

成功：HTTP 200。

```json
{"ok":true,"data":{"note":{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":{"entryId":"demo-note-entry-001","active":true,"linkedAt":"2026-10-08T01:05:00.000Z","entryRevisionAtLink":1,"preserveOnCancel":false}},"entry":{"id":"demo-note-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:05:00.000Z","updatedAt":"2026-10-08T01:05:00.000Z","adoptedAnalysis":null,"origin":{"type":"reading-note","noteId":"demo-note-001","bookId":"walden","bookTitle":"瓦尔登湖","noteSavedAt":"2026-10-08T01:00:00.000Z"}},"outcome":"added"},"error":null}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 NOTE_NOT_FOUND；409 VERSION_CONFLICT；409 NOTE_LINK_CONFLICT；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。outcome仅added/reused/removed/preserved-edited/unchanged；取消时entry可null或保留的Entry，按第5节规则处理。

## 5. 必须原子完成的流程与保护规则

1. **日精进与分析：** 新建textVersion/revision为1；原文任意字符改变才textVersion+1，同时清空adoptedAnalysis。仅改日期保留分析。每次成功修改revision+1。采纳核对entryId、原文版本、expectedRevision与草稿关联，失败不恢复已删记录。
2. **分析先草稿后采纳：** POST /api/analysis不写原文或自动采纳；PUT adopted-analysis保存用户核对的草稿。放弃草稿是前端内存操作，不额外造删除草稿接口。
3. **感悟每次追加：** POST notes新增历史，不覆盖此前body/savedAt。历史无编辑按钮，故不登记PATCH /api/notes/:id。只能删除该书最新一条，同时检查expectedRevision与最新性。
4. **入库：** PUT summary-link enabled=true时，复制该条body到独立Entry，textVersion/revision初始为1、adoptedAnalysis=null，建立origin及summaryLink。同一状态/已存在副本不再创建重复条目，分别返回unchanged或reused。
5. **取消入库：** enabled=false时，仅在来源noteId/bookId匹配、Entry.revision等于entryRevisionAtLink、preserveOnCancel=false时删除副本。副本任何后续写入改变revision，包括采纳分析，都必须保留：outcome=preserved-edited，entry返回保留对象，summaryLink.active=false/preserveOnCancel=true。正常删除为removed、entry:null、summaryLink:null。再次入库复用保留副本，不能重写用户后来修改的原文。
6. **关联冲突：** 若entry来源与note不匹配，409 NOTE_LINK_CONFLICT，不能删除其他Entry。状态变化revision+1；目标状态未变且资源一致时unchanged，不因版本旧而重复写入。
7. **删除感悟：** 已入库副本独立保留及其origin；历史删除后的最新指针指向上一条。不能为清理关联而删用户总结。
8. **删除日精进：** 若是reading-note副本，清除仍对应的note.summaryLink；感悟原文保留，后续可重新入库。收藏的同一entry关联一并清理。事务失败全部回滚。
9. **收藏独立：** 取消收藏不删除感悟、记录或分析。所有设置使用明确目标boolean，不采用“toggle”翻转；同一true保留原favoritedAt，同一false不报伪失败。
10. **两组推荐：** 全库先按类型筛选，然后根据situationMatches/directionMatches的人工作品依据匹配；每组按书库顺序最多3项，组内去重、跨组允许同书。totalMatches是取前三项之前的匹配数。收藏和感悟不改变推荐。当前版本作品资料不完整时排除，但不连带删除私人收藏、感悟或已入库原文。
11. **讲解上下文：** 同书不同组不能共用讲解；请求/响应都含版本、组与本次选择。前端selectionId/contextKey为内存关联，不存表；改条件、作品或组立即作废迟到结果。没有有效推荐上下文的直接详情不请求本次讲解。
12. **来源与原文：** text/body保存用户原话和日期；AI总结、推测与建议另标source，未经用户采纳不得覆盖记录。入库是原文复制，不把“保存到总结库”误解为调用AI重新总结。

outcome固定枚举与响应关系：

| outcome | 含义 | entry / summaryLink |
| --- | --- | --- |
| added | 首次创建副本并关联 | Entry / active=true |
| reused | 重新启用保留的独立副本 | 原Entry / active=true，保护标记保留 |
| removed | 已取消；未改动的副本被删，或无副本可删 | null / null |
| preserved-edited | 已取消；副本因后续写入保留 | 保留Entry / active=false,preserveOnCancel=true |
| unchanged | 已处于同一目标状态且关联资源一致 | 与已有状态一致，不新增、不覆盖 |

## 6. 虚构验收场景（未来接口实现后执行，今天未验证）

- 用“【虚构·接口验证】今天读完一页。”创建Entry；GET /api/entries必须读到它，GET单条原文/日期一致。修改后再列表读取，排序、total与revision正确。
- 以旧expectedRevision修改或删除，期望409且旧记录不变；删除本人记录后GET为404，不能通过采纳旧草稿恢复。
- 生成分析只出现草稿，不改原文；用户采纳后adoptedAnalysis有独立source。改原文清分析；仅改日期保留。模拟AI失败，返回真实错误，不填固定AI结果。
- 同一本书保存两次不同虚构感悟，GET notes应返回2项。入库第一条和第二条分别对应自己的原文；取消未改副本可删，取消已改或已采纳分析的副本须保留。
- 删除最新感悟保留其已入库总结，最新指针回上一条；删除旧条返回409 NOTE_NOT_LATEST。删除入库Entry后备注关联清空，可再次入库。
- 设作品收藏true两次，GET favorites只有一条；取消后列表不再出现，notes仍在。记录收藏同理。当前会话版尚未支持这些HTTP检查。
- 推荐mirror/change各最多3项；同书换组不串用讲解；错误版本返回409，空匹配仍成功，失败读取不能伪装为空。

## 7. 当前验证边界与交接

- Day 15 历史事实：当时仅实现health，其余19项业务接口未实现、未调用、未验证。
- Day17当前代码状态：三个列表GET已实现、部署并通过真实测试用户HTTP200核对；29项本地模拟检查通过。entries改单行跟随及核验页新正文/版本2、两次完整感悟原文与最新ID、book/walden收藏完整JSON均已核对，最终两图已收到。主React仍用本地数据，独立day17-check.html显示公网实际响应；真实limit1跨页与跨用户隔离未实测，其余16项业务接口未实现。Day17提交范围已获用户确认。详见[Day17部署说明](./deploy-day17.md)。
- Day 16 已在用户明确授权清空三表现有数据后，由AI在原CloudBase环境控制台核对PostgreSQL 17.11；种子输入副本两次执行均成功，两次查询行数均为5／5／5，三表实际select和五行关联查询均已核对；主键与两个指定外键已查到。详见第3.7节，不将虚构种子当成用户经历或真实AI结果。
- 云端输入副本只去掉以--开头的说明行，保留全部可执行SQL及COMMENT ON；两次粘贴读回核对一致。本地脚本没有因此改动，独立schema.sql原版尚未单独重跑；已核对的重复执行证据来自种子输入副本。
- Day 16 三张表数据页截图已由用户提供并核对通过：favorites、entries、reading_notes均有完整表名、五行虚构数据和共5条计数。尚未提交；截图和种子查询不表示真实业务接口或保护流程已实现。
- health本地与公网HTTP检查均已通过，用户浏览器JSON截图已取得；React构建及首页、JS、CSS公网检查已通过，用户前端浏览器截图已取得，同伴手机及两个页面刷新检查由用户人工确认。证据见本地日志。health完整地址栏JSON截图、前端公网页面截图及环境ID/额度/到期同框截图均已取得，由用户提供并已核对。
- 前端mock公网地址：[打开页面](https://ritchie-d5gd1dg1yd29783e8-1502569246.tcloudbaseapp.com/)。前端仍使用原有mock及浏览器本地数据。
- 契约中的逻辑表、持久收藏、分页、身份前置条件、时区header及HTTP拆分已于2026-10-12获用户确认。Day 17 三项列表GET落实读取、分页与真实用户身份核验的代码；其余写入、AI、时区header传输及前端接入仍是未来实现约定，不把它们写成现有页面已支持。
- 第3周以本契约为唯一接口依据；若后续变化，先确认再改契约，不由实现擅自改变字段或保护规则。
- Day 15 部署操作、截图与收尾见[Day 15部署说明](./deploy-day15.md)；Day 17 三项读取接口部署、浏览器带身份验证与控制台改行验证见[Day 17部署说明](./deploy-day17.md)。不提交dist、部署ZIP或本地_logs，不把.env、用户access_token、密钥或数据库连接串写进契约。

- Day 17 旧版（PG协议直连）本地验证证据：在 Node.js 24.19.0 执行 node --test cloudfunctions/reads/reads.test.js，19项通过、0失败。检查原文与日期映射、分页作用域、参数绑定、认证拒绝、HTTP封套和上游结果变化；全部使用明确虚构数据，不能替代CloudBase真实凭证、PostgreSQL SQL执行或Node20云端验证。测试文件见 [reads.test.js](./cloudfunctions/reads/reads.test.js)。

- Day 17 第②板块数据准备已核对（2026-10-13）：用户人工创建并报告登录核验通过的测试账号，其ID为字符串2110018353410285570。用户在现有PostgreSQL控制台执行独立虚构新增脚本，随后合并查询截图共4行：entries指定ID1行、reading_notes两个指定ID2行、favorites的book/walden1行；日期均2026-10-13、归属一致。截图正文截断处另经同一查询结果的只读完整文本核对，三段虚构正文与脚本一致。此事实仅证明测试数据已在真库，不证明本函数的三条参数化SQL、真实身份联调、公网GET或前端接库已验证；这些仍待第③/④板块。过程由用户执行，AI未代写数据库；未新增业务写接口、改表或重跑seed。

- Day 17 第③板块连接层调整（2026-10-14，继续Day17）：用户选择原话「B」。当前读取函数已改用CloudBase官方HTTPS参数化SQL接口，入口显式读取服务端CLOUDBASE_APIKEY，调用固定cloudbase_read_only_user角色；db.js仅允许本项目三个固定SELECT，SQL与parameters分开传递，数组响应包装成rows。客户端用户access_token仍仅由auth.js核验，不用管理员Key代替用户身份。service.js、auth.js、schema.sql和seed.sql内容与调整前一致，三GET路径、分页、字段和三键响应不变，不增加业务写入或任意SQL代理。
- 当前本地验证证据：node --test cloudfunctions/reads/reads.test.js，Node.js24.19.0，26项通过、0失败，新增覆盖HTTPS固定地址/只读角色、三查询参数原样传递、凭证隔离、格式/权限/网络/超时错误及无秘密泄露。全部模拟上游；不作为管理员真实凭证、三表只读权限、CTE/JSONB真实返回或平台总执行时限的证据。
- 当前运行文件新增 [db.js](./cloudfunctions/reads/db.js)，移除pg生产依赖；本地reads.zip已重打包为七个根目录运行文件，内容与当前源码一致，启动LF/0755，11306字节。连接层调整时要求实际上传重新选择新ZIP，管理员Key准备和函数创建/部署当时尚未执行。其后在用户明确授权电脑操作后完成了以下云端步骤，仍属Day17第③板块。

- Day 17 第③板块云端部署证据（2026-10-14）：用户明确授权代理操作CloudBase，并选择函数名literature-reads；同环境已创建HTTP云函数，资源标识lam-fb1jcmvh，Node.js20.19、监听9000、内存256MB、初始化65秒、执行时限3秒。当前上传内容含HTTPS适配db.js及其他运行文件。创建后在线编辑器解压显示未部署改动；没有修改云端源码，部署并确认$LATEST后状态正常、显示“与已部署代码一致”。上述是代码部署证据，不表示公网路由已经配置。
- 该部署小步仅执行一次控制台HTTP启动检查：GET /api/entries，无Bearer、无请求体，返回HTTP401，Body恰为 {"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"请使用注册用户的登录凭证。","retryable":false}}。与契约错误响应一致，证明HTTP服务已启动并处理该读取路径的身份检查；未调用另外两条路径，也没有使用真实用户令牌读取数据。不能据此确认管理员Key的SQL权限、身份上游连通、真实CTE/JSONB响应、完整认证加SQL在3秒内返回或公网接口成功。
- 日志边界：日志页要求确认服务条款与付费模式后开通，当前未开通。控制台测试附带的SearchClsLog查询提示ResourceNotFound.TopicNotExist；此为日志查询失败，同次HTTP响应已独立返回401。没有为消除该提示开通付费日志，实际启动日志仍未取得。本轮以HTTP响应证明启动，不记录为“启动日志已验证”。
- 后端配置：CLOUDBASE_ENV_ID及随机CURSOR_SECRET已填写；API Key选择器刷新后选中服务端Key literature-reads-day17，控制台显示到期2026-11-13 10:44:55。CLOUDBASE_APIKEY由平台关联注入，选择器显示名称不等于应将名称或KeyId当作凭证值。本契约不保存任何秘密；真实SQL鉴权仍待带用户身份的读库验证。网关配置及无Bearer公网HTTP401检查现已完成；带身份读取、浏览器JSON截图、前端接入、真库改行跟随和日终提交推送均未完成。

- Day 17第③板块网关证据（2026-10-14）：用户明确「确认保存三条路由」后，保存/api/entries、/api/favorites、/api/books三个前缀，均启用并关联literature-reads，路径透传与跨域开启、网关前置身份认证关闭，函数自身真实Bearer验证保持。没有改动/api/health原绑定。实际网关为https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com，从控制台链接读取。
- 公网HTTP证据：无Bearer的GET /api/entries、/api/favorites、/api/books/walden/notes分别返回401；三次正文均为 {"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"请先登录再读取个人数据。","retryable":false}}。含JSON类型、Bearer挑战和X-Request-Id；仅证明缺少登录凭证时的公网转发与身份拦截，不表示成功读取数据库。
- 浏览器证据限制：entries默认域名访问提示点击一次后仍停留；公网HTTP响应含Content-Disposition: attachment。官方默认域名机制见[说明](https://docs.cloudbase.net/service/alias)。未取得浏览器内联JSON截图，不声称已满足当天两张截图；未购买/绑定自定义域名或尝试去除提示。真实身份读库、SQL权限、3秒完整链路、分页/隔离、改行跟随与前端显示仍待第④板块。本步停下等用户继续，不提交或推送。
- Day17第④板块首条联调实际失败（2026-10-14）：用户先报告「登录 200，UID 一致」，再提供GET /api/entries?limit=20实际HTTP500截图。响应仍为三键封套，error为INTERNAL_ERROR/message「读取失败，请核对服务端配置或稍后重试。」/retryable:false。该精确提示对应db.js的SQL上游非成功状态分支，按当前代码说明用户身份核验后进入SQL调用，但未取得成功数据；不记为真库验证通过。
- 一次只读权限元数据查询显示同环境当前SQL会话中的cloudbase_read_only_user精确角色不存在：三个既有表的readonly_role均NULL、role_exists均false；其它权限false由缺角色分支产生，不能写成已存在角色但缺授权。仍缺HTTPS SQL上游具体HTTP状态和脱敏错误代码，尚不能断言本次失败唯一原因；未建角色、GRANT、改SQL执行角色、开付费日志或改表。完整证据及拟定安全诊断见deploy-day17.md文末，计划等待用户确认，不修改本契约响应结构。
- Day17第④板块安全诊断变更（2026-10-14）：用户明确同意后，仅调整db.js上游非成功响应的error.message，包含安全HTTP数字及固定代码白名单；未知/非JSON标为UNCLASSIFIED，不透传供应商原消息、details、SQL/参数、请求编号或凭证。业务顶层与error字段、error.code INTERNAL_ERROR、retryable、真实用户身份、三条参数化SQL和只读role保持。仅补诊断，不将此变更记为权限修复。
- 本次本地检查29项/29通过/0失败（模拟身份与SQL）；初次8项本机HTTP受EACCES限制，批准外部执行后原套全部通过。当前reads.zip已重打包为11737字节、七根文件/LF/0755，与本地源码一致。已上传并部署同一literature-reads的$LATEST，界面正常/与已部署代码一致，配置和权限未改。用户需用保留在本机的短期凭证再执行entries GET一次，真实诊断响应尚未取得；此前真实500事实保留，真库成功、其他GET、改单行与前端仍未验证。完整过程见部署说明及本地日志，不提交ZIP/_logs或秘密。
- Day17第④板块安全诊断实际复核（2026-10-14）：用户截图中entries GET仍HTTP500，安全message明确SQL服务HTTP400/DATABASE_42501，retryable:false；新诊断生效，真库成功未通过。官方将该码定义为数据库权限不足，不能仅凭该码断言缺哪一层权限。
- 实际角色权限核查更正：控制台系统只读角色带实例后缀cloudbase_read_only_user_postgres_gbu0fd7s；此前pg_roles查询无后缀名称NULL不能当作系统角色不存在。一次只读metadata SELECT（完整读回一致、11ms、三行）确认实际角色存在、public USAGE=true，而entries/reading_notes/favorites SELECT=false，RLS=false。拟最小修法仅GRANT SELECT三指定表给该既有角色，等待用户明确确认。未执行授权、改函数角色、建角色、改表或写业务数据；接口形状和已实现状态不变，未将本次诊断记为真实读取成功。详细证据见deploy-day17.md末节。

- Day17第④板块权限修复小步（2026-10-14）：用户明确「同意执行」后，已在同环境SQL控制台执行唯一一条GRANT SELECT，精确目标public.entries/public.reading_notes/public.favorites及cloudbase_read_only_user_postgres_gbu0fd7s。完整语句读回一致；查询成功6ms，未返回业务行。
- 一次授权后只读回核（完整读回一致、12ms、3行）显示三表SELECT=true，而INSERT/UPDATE/DELETE任一权限=false。仅证明后台只读角色取得读取能力，未验证真实带身份GET成功。云函数源码、HTTP固定role、表结构、业务数据、RLS、响应契约和接口实现状态未变；未向客户端角色授权。实际entries复核仍由用户本机凭证执行一次，失败/空列表则停止，不继续其他GET、改行或前端。完整证据见deploy-day17.md末节。

- Day17第④板块首条真实读取成功（2026-10-14）：用户在浏览器执行GET /api/entries?limit=20，截图codex-clipboard-59f5118f-05d0-4ab5-8414-c9537cc5c346.png显示本次HTTP200、ok:true/error:null。data.items只有day17-test-entry-001，entryDate=2026-10-13，虚构原文与准备脚本一致，textVersion/revision=1，两个时间戳2026-10-13T01:00:00.000Z，adoptedAnalysis/origin=null，total=1，page.limit=20/nextCursor=null/hasMore=false。与第4.2节的十个Entry字段和列表结构一致；明确为真库内虚构数据，不写成用户真实经历。
- 仅entries的本次真实身份/SQL/字段转换链路核对通过，已更新其实现验证状态；notes/favorites仍待真实验证。此前500、42501与读取授权历史保留。此图裁切到控制台，没有完整地址栏/响应头，最终提交两图仍不完整；分页变化/跨用户/改单行/前端仍未验证。没有执行新的请求、改代码、写数据库或Git；停止等用户「进入下一板块」。
- Day17连续核验授权与页面（2026-10-14）：用户授权「直接帮我完成今天」及电脑代核验，新增独立只读day17-check.html以显示三个已登记公网GET的实际返回；不新增业务接口、用户名密码登录、前端本地数据导入或改表。凭证页内提交清空输入，仅闭包内存，退出清除；数据/JSON/分页/前后变化均据实际返回，不填虚构成功。静态代码检查通过；实际请求尚未执行。页面本地地址不等于公网API地址，目标公网来源固定。
- 用户在Chrome/Edge准备的凭证不与Codex内置浏览器页面共享；只需在可接管核验页内准备已有短期凭证，不向聊天发送。当前entries先前真实读取仍已通过，notes/favorites、limit跨页、改行跟随、页面显示和最终截图仍未核验，不因用户同意连续工作而自动记为完成。

- Day17核验页最新停点（2026-10-14）：用户已在Codex页准备单行access_token，但首个entries请求发生浏览器网络失败，另两GET未发送。此前entries HTTP200截图结论保留。浏览器工具随后明确按URL策略拒绝页面访问；已停止操作并撤回未验证的本机转发，页面保持直接读取公网GET及单行凭证格式检查。notes/favorites、分页、改行跟随、页面成功显示与最终截图仍未通过。详情见部署说明最新节。

- Day17核验页实际响应更新（2026-10-14）：用户截图显示entries HTTP401/UNAUTHENTICATED/登录凭证无效或已过期，后续GET停止。该提示对应身份验证拒绝，尚未执行SQL；页面能取得HTTP响应，但真实读取未通过，须重新登录后再核验。此前entries HTTP200历史证据保留，其他未完成项不变。

- Day17单行更新实际证据（2026-10-14）：在用户连续核验授权下，代理先核对原记录，再仅执行一次带owner/id/原日期/精确原文/版本1/NULL前置条件及恰好1行断言的事务。数据库回核day17-test-entry-001新正文为「【虚构·Day17接口验证】我在数据库控制台改了一条记录。」，text_version/revision=2，日期仍2026-10-13，updated_at控制台显示2026-10-14 16:39:45+08。另查两条感悟原文与book/walden收藏均保留。只有数据库更新已通过，仍待新GET实际响应确认接口跟随；用户重新登录200/UID一致的报告不替代GET成功。

- Day17最新成功截图（2026-10-14，codex-clipboard-2743ba7d-f2a6-449b-8a32-ec664f663002.png）：entries HTTP200，指定新正文、原日期、textVersion/revision2、总数1均可见；结合版本1的原成功截图及已执行UPDATE，改一行后接口和页面跟随通过。notes HTTP200及note002正文/顺序2可见，note001只露出开头。三GET成功总提示经源码复核有真实请求与封套校验条件，不能替代收藏精确状态和明细；完整JSON/收藏/分页仍待补证。本地核验页地址栏不能当作公网API地址。

- Day17最终补图核对（2026-10-14）：6719d6d6...数据图完整显示三个HTTP200、entries版本2/原日期、notes两次原文及total2/latestNoteId002、收藏book/walden；ace12912...完整收藏JSON确认顶层ok/data/error、ok=true/error=null、favoritedAt=2026-10-13T01:25:00.000Z、total1、limit20/nextCursor=null/hasMore=false，符合第4.14节。主任务实现和验证完成，提交推送待用户确认12文件清单。图中本地地址栏与页面内公网API地址明确区分；不声称主React已接库或核验页已公开部署。

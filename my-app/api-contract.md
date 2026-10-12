# 文学与内心冲突｜API 契约（Day 15）

编制日期：2026-10-09；核对日期：2026-10-12（Asia/Shanghai）。状态：**已由用户确认的第 3 周接口契约**（2026-10-12确认）。

## 1. 范围、事实与 AI 推导

**用户要求：** 只实现 GET /api/health，返回精确服务 JSON；同时从第 2 周前端推导全部未来接口与表，今天只登记占位，不实现业务、建表或跨域。

**已执行事实（2026-10-12核对）：** health源文件已生成并本地验证，CloudBase云函数literature-health及/api/health路由已部署，实际公网GET返回200和指定JSON，用户浏览器也已确认JSON。以下其余19个业务接口全部是占位，没有部署、调用或改动现有前端。

**现有页面：** 原文与感悟存 IndexedDB；分析和讲解是明确标注的固定虚构演示；书本和日总结收藏是会话状态，刷新重置；当前列表没有分页。首页 homeMock 是固定虚构样例，不读个人记录。本契约不新增首页真实聚合接口、登录页面、管理后台、分析历史或修改往期感悟。

**AI 推导：** 将本地记录、感悟、收藏映射为未来后端接口；持久收藏、分页与逻辑表名是本轮建议。用户已于2026-10-12确认本文作为第 3 周建表与接口实现的唯一契约依据。此轮不表示已把个人数据搬到云端，也不自动导入本机数据。

旧 `../TECH_DESIGN.md` §6 仅规划两个 AI HTTP 接口，个人 CRUD 留本地。本稿按用户新要求补全未来接口，保留 `POST /api/analysis` 与 `POST /api/book-explanation`；未来实现以核对后的本契约为准，不继续依照旧“同作品单条可编辑备注”模型。当前代码的多条历史与保护规则是字段依据。

## 2. 公共约定

- 线上使用 HTTPS。health 成功和错误独立；业务接口成功为 `{requestId,data}`，失败为 `{requestId,error}`。
- 请求 body 为 application/json，最大64 KiB。GET/DELETE无body；DELETE的expectedRevision放query。拒绝未登记字段，不静默截断原文。
- 用户文字按去首尾空白后的 Unicode 码点数校验，但原始空格、换行与日期原样保存。AI文字与原文分字段，不自动替换。
- 普通日精进的当前日期校验依据设备本地日历。未来写接口约定由前端附带 `X-Client-Time-Zone` IANA时区（本项目常用Asia/Shanghai，省略默认Asia/Shanghai），服务端按该时区的日历今天校验，日期本身不转UTC。无效时区返回400 INVALID_INPUT。此传输约定尚未接入；前端仍保持现行设备日期规则。
- 记录日期为有效YYYY-MM-DD且不能晚于上述今天；时间戳由服务端生成UTC ISO 8601字符串。感悟入库日期固定由savedAt按Asia/Shanghai转换，与普通手填日期不同。
- 私人接口必须有经验证的身份（未来 `Authorization: Bearer <token>`）。ownerId仅由可信身份确定，不能由body/query指定。无身份返回401；找不到本人资源（包括他人ID）返回404。当前没有登录实现；身份方案是上线私人接口的前置条件，不为今天增加认证接口。
- 公开书库接口如提供无效身份凭证也返回401，不把无效身份悄悄当公开用户。只有health为无需身份的健康检查。
- 每次请求带／返回随机requestId。AI请求必须body提供新requestId并原样回传；其他业务请求由服务端生成。requestId用于关联，不是账号身份。
- 列表query：limit默认20，整数1–100；cursor为上一次nextCursor的不透明串。响应含items、筛选后的total、page:{limit,nextCursor,hasMore}；最后一页nextCursor=null/hasMore=false。空列表200，不把读取失败写成空列表。游标必须绑定当前用户、筛选与排序；无效返回400。分页是未来约定，现有页面尚未分页。
- 成功写入必须整笔事务完成后才返回。失败保留旧数据；客户端保留草稿。expectedRevision与textVersion不能混用。
- AI只针对本次明确请求的原文或作品，不提交个人历史。失败不返回伪造分析；草稿可编辑、采纳或放弃。AI分析摘要1–300字符，问题1–2个，每个1–100；书本讲解与一个阅读问题分别非空、合计≤300。
- 请求关联ID、记录版本、推荐条件变化时，前端作废迟到结果；页面等待30秒、模型处理预算25秒沿用旧设计规划，实际函数/网关超时待部署时核对。用户主动重试，新建requestId，不自动循环调用。
- 今天不登记OPTIONS业务接口，不设置CORS，不接前端网络请求。

业务错误完整 JSON（虚构示例）：

```json
{
  "requestId": "demo-request-001",
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

书库版本不一致时，错误对象必须返回当前发布版本，便于前端核对；这是未来接口约定，不是今天已实现的错误响应：

```json
{
  "requestId": "demo-request-001",
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

## 3. 数据模型与逻辑表占位

这些是第三周的逻辑表／集合依据，今天不选择数据库类型、不写SQL、不建表。API使用camelCase字段；物理存储可映射但不能改变本契约的JSON形状。

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

## 4. 接口逐项定义

下列JSON是实际传输形状样例，没有省略号。除health之外，均为**未来占位**。每项列出自己的特定错误；发生基础请求格式错误时也遵守第2节413/415约定。

### 4.1 GET /api/health

- 用途：公网最小健康检查。
- 页面依据：`cloudfunctions/health/index.js`。
- 身份／状态：公开，无登录。今天唯一有代码的接口；2026-10-12已通过公网GET 200及指定JSON验证。
- 已验证公网地址：[打开 health](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/health)。
- 参数：无 path/body 参数。没有业务查询参数；当前实现忽略查询串。路径必须恰好 /api/health。

成功：HTTP 200。

```json
{"ok":true,"service":"【literature-and-inner-conflict】"}
```

错误返回：404 NOT_FOUND（其他路径）；405 METHOD_NOT_ALLOWED（本路径的非 GET 方法，Allow: GET）。health 错误为独立形状：{"ok":false,"error":{"code":"METHOD_NOT_ALLOWED","message":"此接口仅支持 GET 请求。"}}。未知路径 message 为“接口不存在。”；HEAD响应按HTTP约定没有正文。网关可能另外返回平台错误，不混同函数错误。

### 4.2 GET /api/entries

- 用途：日精进／总结库列表读取；不可遗漏的记录表读接口。
- 页面依据：`src/services/localStore.js readEntries；src/pages/JournalPage.jsx 历史列表`。
- 身份／状态：私人。
- 参数：query：limit 可选，默认20、1–100整数；cursor 可选、服务端返回的不透明游标。无请求体。当前页面没有日期区间或搜索筛选，本契约不增加。按 entryDate降序、createdAt降序、id升序。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"items":[{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。空结果仍200，items:[]、total:0，不以空数组代替读取失败。

### 4.3 GET /api/entries/:entryId

- 用途：回看／重新读取单条日精进。
- 页面依据：`src/services/localStore.js readEntry；src/pages/JournalPage.jsx`。
- 身份／状态：私人。
- 参数：path：entryId 必需，为列表返回的非空不透明ID。无 query/body。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；500 INTERNAL_ERROR。

### 4.4 POST /api/entries

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
{"requestId":"demo-request-001","data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","adoptedAnalysis":null,"origin":null}}
```

错误返回：400 INVALID_INPUT（fields可含entryDate/text）；401 UNAUTHENTICATED；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.5 PATCH /api/entries/:entryId

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
{"requestId":"demo-request-001","data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我又记下一个问题。\n","textVersion":2,"revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:03:00.000Z","adoptedAnalysis":null,"origin":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.6 DELETE /api/entries/:entryId

- 用途：删除日精进及其仍对应的入库关联。
- 页面依据：`src/services/localStore.js deleteEntry`。
- 身份／状态：私人。
- 参数：path：entryId 必需。query：expectedRevision 必需，为≥1整数。无body。当前用户的关联收藏一并清理；若origin为reading-note，原子清除仍指向本记录的summaryLink，保留阅读感悟原文。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"deleted":true,"entryId":"demo-entry-001"}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；409 NOTE_LINK_CONFLICT；500 WRITE_FAILED。不借删除恢复已删资源。

### 4.7 PUT /api/entries/:entryId/adopted-analysis

- 用途：用户核对并采纳已生成的分析草稿。
- 页面依据：`src/pages/AnalysisPanel.jsx adopt；src/services/analysisModel.js adoptDemoAnalysis 的版本保护`。
- 身份／状态：私人。真实AI采纳为未来占位；当前demo仍只本地。
- 参数：path：entryId 必需。body：expectedRevision、sourceTextVersion、generationRequestId、summary、questions均必需。前两项为≥1整数；generationRequestId取POST /api/analysis成功的requestId；summary为1–300字符；questions为1–2项，每项1–100字符。source由服务端继承生成上下文，客户端不能把demo改成ai。核对草稿归属、记录版本与原文版本，写入只改变adoptedAnalysis/revision/updatedAt，不改变text或entryDate。

请求JSON示例：

```json
{"expectedRevision":1,"sourceTextVersion":1,"generationRequestId":"demo-analysis-001","summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"]}
```

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"id":"demo-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n","textVersion":1,"revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:02:00.000Z","adoptedAnalysis":{"source":"ai","generationRequestId":"demo-analysis-001","sourceTextVersion":1,"summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"],"adoptedAt":"2026-10-08T01:02:00.000Z"},"origin":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；409 ANALYSIS_CONTEXT_MISMATCH；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。未生成、失效或属于别的记录的草稿不能采纳。

### 4.8 POST /api/analysis

- 用途：针对本次已保存原文生成可编辑分析草稿。
- 页面依据：`../TECH_DESIGN.md §6.2；src/pages/AnalysisPanel.jsx 的未来真实AI按钮`。
- 身份／状态：私人，须用户主动触发；当前未接入AI。
- 参数：body：requestId、entryId、textVersion、text均必需。requestId为本次新生成的非空随机标识；textVersion≥1；text为1–5000字符，原文保留。未来服务端先读取本人记录并核对版本及原文，再只发送本次原文给模型，不提交历史、收藏或备注。生成不自动采纳，不修改记录。

请求JSON示例：

```json
{"requestId":"demo-analysis-001","entryId":"demo-entry-001","textVersion":1,"text":"【虚构·契约样例】今天读完一页后，我记下了一个问题。\n"}
```

成功：HTTP 200。

```json
{"requestId":"demo-analysis-001","data":{"entryId":"demo-entry-001","textVersion":1,"baseRevision":1,"source":"ai","summary":"【虚构·形状样例】这次阅读后留下了一个问题。","questions":["这个问题与你的哪次经历有关？"]}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；409 VERSION_CONFLICT；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；429 RATE_LIMITED；502 AI_INVALID_OUTPUT；503 AI_UNAVAILABLE；504 AI_TIMEOUT。

### 4.9 GET /api/catalog

- 用途：读取书库版本、类型与两组选择标签。
- 页面依据：`shared/catalog.json；src/services/catalog.js bookCategories/situationTags/directionTags`。
- 身份／状态：公开。未来只读接口，发布资料来自同版JSON。
- 参数：无 path/query/body。metadata拆为本接口，作品通过GET /api/books读取；这是未来HTTP拆分约定，当前仍直接导入JSON。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"catalogVersion":"2026-09-23.2","categories":[{"id":"all","label":"全部"},{"id":"literature","label":"文学"},{"id":"philosophy","label":"哲学"},{"id":"humanities-social-sciences","label":"人文社科"}],"situationTags":[{"id":"rethink-life","label":"正在重新思考怎样生活"},{"id":"relationship-confusion","label":"在人际关系中感到困惑"},{"id":"beyond-the-self","label":"觉得困扰不只来自自己"}],"directionTags":[{"id":"review-choices","label":"重新审视生活中的重要选择"},{"id":"simpler-life","label":"尝试更简朴的生活"},{"id":"social-perspective","label":"从社会背景理解经历"}]}}
```

错误返回：500 INTERNAL_ERROR；有身份凭证但无效时401 UNAUTHENTICATED。

### 4.10 GET /api/books

- 用途：按类型读取书单及“我的收藏／有备注”视图。
- 页面依据：`src/pages/BooksPage.jsx books；src/services/catalog.js listBooks`。
- 身份／状态：view=all可公开；favorites/noted视图须身份。all提供有效身份时也返回自己的personalState。
- 参数：query：category可选默认all，枚举all/literature/philosophy/humanities-social-sciences；view可选默认all，枚举all/favorites/noted；limit/cursor按列表公约。仅完整可用书目；按displayOrder升序、id升序（新增稳定并列规则）。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"catalogVersion":"2026-09-23.2","items":[{"book":{"id":"walden","title":"瓦尔登湖","author":"亨利·戴维·梭罗","categories":["literature","philosophy"],"literaryForms":["散文"],"intro":"【响应字段样例】实际简介返回已核对的人工书库文字。","topics":["简朴生活与个人需要"],"sources":[{"name":"Penguin Random House：Walden 作品资料","url":"https://www.penguinrandomhouse.com/books/469576/walden-by-henry-david-thoreau/"}],"displayOrder":2,"situationMatches":[{"tagId":"rethink-life","basis":"【响应字段样例】返回人工整理的处境匹配依据。"}],"directionMatches":[{"tagId":"simpler-life","basis":"【响应字段样例】返回人工整理的改变方向依据。"}]},"personalState":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。已验证身份时personalState为{"favorite":false,"hasNotes":false,"latestNoteId":null}；公开读取为null，不能假冒已读取私人状态。

### 4.11 GET /api/books/:bookId

- 用途：作品详情、核对来源及自己的阅读状态。
- 页面依据：`src/services/catalog.js getBook；src/pages/BookReadingPanel.jsx`。
- 身份／状态：基本书目公开；有效身份附带本人personalState。
- 参数：path：bookId必需，为发布书库中的ID。无query/body。个人感悟正文通过notes列表读，不混入公开响应。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"catalogVersion":"2026-09-23.2","book":{"id":"walden","title":"瓦尔登湖","author":"亨利·戴维·梭罗","categories":["literature","philosophy"],"literaryForms":["散文"],"intro":"【响应字段样例】实际简介返回已核对的人工书库文字。","topics":["简朴生活与个人需要"],"sources":[{"name":"Penguin Random House：Walden 作品资料","url":"https://www.penguinrandomhouse.com/books/469576/walden-by-henry-david-thoreau/"}],"displayOrder":2,"situationMatches":[{"tagId":"rethink-life","basis":"【响应字段样例】返回人工整理的处境匹配依据。"}],"directionMatches":[{"tagId":"simpler-life","basis":"【响应字段样例】返回人工整理的改变方向依据。"}]},"personalState":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED（提供无效凭证）；404 BOOK_NOT_FOUND；500 INTERNAL_ERROR。私人状态形状同GET /api/books。

### 4.12 POST /api/recommendations

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
{"requestId":"demo-request-001","data":{"catalogVersion":"2026-09-23.2","conditions":{"category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life"},"situationLabel":"正在重新思考怎样生活","directionLabel":"尝试更简朴的生活","groups":[{"id":"mirror","title":"映照当下","tagLabel":"正在重新思考怎样生活","totalMatches":1,"items":[{"bookId":"walden","baseReason":"【虚构·形状样例】这里返回人工整理的本次处境联系。"}]},{"id":"change","title":"探索改变","tagLabel":"尝试更简朴的生活","totalMatches":1,"items":[{"bookId":"walden","baseReason":"【虚构·形状样例】这里返回人工整理的本次方向联系。"}]}]}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED（提供无效身份凭证）；409 CATALOG_VERSION_MISMATCH；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 INTERNAL_ERROR。无匹配仍200，两组items:[]且totalMatches:0；不能换书或借收藏决定推荐。

### 4.13 POST /api/book-explanation

- 用途：用户主动请求某次推荐中某组作品的讲解。
- 页面依据：`../TECH_DESIGN.md §6.2；src/services/explanationDemo.js；src/pages/BooksPage.jsx`。
- 身份／状态：有效身份，便于归属与频率控制；当前未接入AI。
- 参数：body：requestId、catalogVersion、bookId、group、category、situationTagId、directionTagId均必需；group只能mirror/change。HTTP保留旧设计group字段，前端上下文groupId映射到group。后端按同版发布JSON核对作品确在该组最多3项中，不信任客户端提交的简介或来源。explanation/readingQuestion分别非空且合计≤300字符。

请求JSON示例：

```json
{"requestId":"demo-explanation-001","catalogVersion":"2026-09-23.2","bookId":"walden","group":"mirror","category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life"}
```

成功：HTTP 200。

```json
{"requestId":"demo-explanation-001","data":{"source":"ai","catalogVersion":"2026-09-23.2","bookId":"walden","group":"mirror","category":"all","situationTagId":"rethink-life","directionTagId":"simpler-life","explanation":"【虚构·形状样例】实际讲解须说明作品与本次处境的联系，并有可核对来源。","readingQuestion":"【虚构】你想核对哪一项日常安排？"}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；409 CATALOG_VERSION_MISMATCH；409 RECOMMENDATION_CONTEXT_MISMATCH（不属于本组或条件）；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；429 RATE_LIMITED；502 AI_INVALID_OUTPUT；503 AI_UNAVAILABLE；504 AI_TIMEOUT。讲解临时展示，不写个人历史表。

### 4.14 GET /api/favorites

- 用途：读取未来收藏状态，支持书单收藏视图恢复。
- 页面依据：`src/pages/BooksPage.jsx 收藏视图；JournalPage.jsx 会话收藏按钮；src/services/temporaryFavorite.js`。
- 身份／状态：私人。持久收藏是本次草案建议，当前会话收藏行为未变；不增加新的日总结收藏列表页面。
- 参数：query：targetType可选，book/entry，省略读两类；limit/cursor按列表公约。按favoritedAt降序、targetType升序、targetId升序。targetType=book的targetId映射当前bookId；entry映射entryId。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"items":[{"targetType":"book","targetId":"walden","favoritedAt":"2026-10-08T01:00:00.000Z"}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；500 INTERNAL_ERROR。该列表仅返回收藏关联；作品或记录详情由其读取接口获得。

### 4.15 PUT /api/books/:bookId/favorite

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
{"requestId":"demo-request-001","data":{"targetType":"book","targetId":"walden","favorite":true,"favoritedAt":"2026-10-08T01:00:00.000Z"}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。取消成功同形状，favorite:false、favoritedAt:null。

### 4.16 PUT /api/entries/:entryId/favorite

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
{"requestId":"demo-request-001","data":{"targetType":"entry","targetId":"demo-entry-001","favorite":true,"favoritedAt":"2026-10-08T01:00:00.000Z"}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 ENTRY_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。取消为favorite:false、favoritedAt:null。

### 4.17 GET /api/books/:bookId/notes

- 用途：读取当前作品全部阅读备注与感悟历史。
- 页面依据：`src/services/localStore.js readNoteHistory；src/pages/BookReadingPanel.jsx 往期列表`。
- 身份／状态：私人。
- 参数：path：bookId必需。query：limit/cursor按列表公约。按savedAt降序、saveOrder降序、id降序；必须读历史而非只读最新备注。最新条目ID为全量筛选的首项ID，不是任意页第一项。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"bookId":"walden","latestNoteId":"demo-note-001","items":[{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；500 INTERNAL_ERROR。无感悟为items:[]、latestNoteId:null、total:0。

### 4.18 POST /api/books/:bookId/notes

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
{"requestId":"demo-request-001","data":{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":1,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 BOOK_NOT_FOUND；413 PAYLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；500 WRITE_FAILED。

### 4.19 DELETE /api/notes/:noteId

- 用途：删除该作品最新的一条感悟，保护往期与入库副本。
- 页面依据：`src/services/localStore.js deleteHistoryNote；src/pages/BookReadingPanel.jsx`。
- 身份／状态：私人。
- 参数：path：noteId必需。query：expectedRevision必需，≥1整数；无body。事务内检查版本和是否仍是本人该书最新条目。删除后最新指针变为上一条；已入总结库的独立记录与来源保留。

成功：HTTP 200。

```json
{"requestId":"demo-request-001","data":{"deleted":true,"noteId":"demo-note-001","bookId":"walden","latestNoteId":null}}
```

错误返回：400 INVALID_INPUT；401 UNAUTHENTICATED；404 NOTE_NOT_FOUND；409 VERSION_CONFLICT；409 NOTE_NOT_LATEST；500 WRITE_FAILED。不能删除历史条目后再顺手删总结。

### 4.20 PUT /api/notes/:noteId/summary-link

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
{"requestId":"demo-request-001","data":{"note":{"id":"demo-note-001","bookId":"walden","body":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","revision":2,"createdAt":"2026-10-08T01:00:00.000Z","updatedAt":"2026-10-08T01:00:00.000Z","savedAt":"2026-10-08T01:00:00.000Z","saveOrder":1,"summaryLink":{"entryId":"demo-note-entry-001","active":true,"linkedAt":"2026-10-08T01:05:00.000Z","entryRevisionAtLink":1,"preserveOnCancel":false}},"entry":{"id":"demo-note-entry-001","entryDate":"2026-10-08","text":"【虚构·契约样例】我想重新核对哪些安排确有必要。\n","textVersion":1,"revision":1,"createdAt":"2026-10-08T01:05:00.000Z","updatedAt":"2026-10-08T01:05:00.000Z","adoptedAnalysis":null,"origin":{"type":"reading-note","noteId":"demo-note-001","bookId":"walden","bookTitle":"瓦尔登湖","noteSavedAt":"2026-10-08T01:00:00.000Z"}},"outcome":"added"}}
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

- 今天只实现health；其余19项均未实现、未建表、未调用、未验证。
- health本地与公网HTTP检查均已通过，用户浏览器JSON截图已取得；React构建及首页、JS、CSS公网检查已通过，用户前端浏览器截图已取得，同伴手机及两个页面刷新检查由用户人工确认。证据见本地日志。health完整地址栏JSON截图、前端公网页面截图及环境ID/额度/到期同框截图均已取得，由用户提供并已核对。
- 前端mock公网地址：[打开页面](https://ritchie-d5gd1dg1yd29783e8-1502569246.tcloudbaseapp.com/)。前端仍使用原有mock及浏览器本地数据。
- 契约中的逻辑表、持久收藏、分页、身份前置条件、时区header及HTTP拆分已于2026-10-12获用户确认，均属于未来实现约定；不把它们写成现有页面已支持。
- 第3周以本契约为唯一接口依据；若后续变化，先确认再改契约，不由实现擅自改变字段或保护规则。
- 部署操作、截图与Day15收尾见[部署说明](./deploy-day15.md)。不提交dist、health.zip或本地_logs，不把.env或密钥写进契约。

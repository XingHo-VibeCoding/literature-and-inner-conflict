# Day 18｜日精进 POST 部署与验证

日期：2026-10-14（Asia/Shanghai）。当前状态：Day18主任务与两张交付截图已核对通过。正常POST 201、重复409、缺原文400均有完整实际响应；数据库匹配行数1、版本均1，POST/SELECT/GET三处ID一致；GET entries与favorites均200，原收藏保留。本地56项模拟测试通过。用户已确认下方10文件提交范围；历史失败与当时待验证状态保留于后文。

本日只实现 POST /api/entries。必填 entryDate 与 text，不添加示例打卡应用的计划项、完成状态。用户已确认同用户同日期完全相同原文返回409；同日不同原文允许。新日精进用 GET /api/entries 读回；最后 GET /api/favorites 核对原收藏，不新增 PUT/PATCH/DELETE 或批量写入。

## 本地检查与部署

在 my-app 目录执行：

~~~powershell
node --test .\cloudfunctions\reads\reads.test.js .\cloudfunctions\reads\writes.test.js
python .\cloudfunctions\reads\package.py
~~~

部署包仍为 cloudfunctions/reads.zip，已由既有 .gitignore 排除。根目录恰好八文件：index.js、service.js、auth.js、db.js、writer.js、package.json、scf_bootstrap、catalog.json；启动文件 LF/0755。不包含测试、配置、日志或凭证。

在同一 CloudBase 环境打开既有 literature-reads HTTP 云函数，上传新包、核对差异并部署。继续使用已有环境变量和服务端凭证；不新建或复制密钥，不改 literature-health。现有 /api/entries 前缀需支持 POST 并透传路径；其余读取路由保持。实际部署页面与 HTTP 结果取得前都标为未验证。

固定写 SQL 使用官方 HTTPS SQL 支持的 cloudbase_postgres 平台管理角色，三个读取 SQL 继续使用只读角色。写角色权限较广，靠服务端固定 SQL 白名单限制用途，不提供客户端 SQL/角色参数；本日不新增数据库对象或 GRANT。[官方角色说明](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)。

## 三条测试命令

在本机 PowerShell 中安全输入已有真实用户短期 access_token；不发到聊天、不写进文件。下面只在当前进程内准备凭证，不修改永久环境变量：

~~~powershell
$day18Credential = Read-Host '输入已有用户 access_token（不会显示）' -AsSecureString
$env:DAY18_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $day18Credential).Password
~~~

在 my-app 目录按顺序每条执行一次：

~~~powershell
node .\verify-day18.mjs normal
node .\verify-day18.mjs duplicate
node .\verify-day18.mjs missing
~~~

| 命令 | 预期 | 数据库预期 |
| --- | --- | --- |
| normal | HTTP201，ok=true，data为完整Entry，error=null | 新增一条虚构记录 |
| duplicate | HTTP409，DUPLICATE_ENTRY，中文提示，data=null | 不新增、不覆盖 |
| missing | HTTP400，INVALID_INPUT，fields.text说明请填写原文 | 不新增 |

三个请求使用固定虚构样例「【虚构·Day18接口验证】正常写入并读回。」与2026-10-14日期。已有同输入时 normal 会409，应先核对数据库，不能为凑成功删除数据或循环重试。

再执行读回与收藏核对：

~~~powershell
node .\verify-day18.mjs read
node .\verify-day18.mjs favorites
Remove-Item Env:DAY18_ACCESS_TOKEN -ErrorAction SilentlyContinue
$day18Credential = $null
~~~

read读取第一页最多100条，按日期与完整原文找恰好一条。favorites只显示原收藏关联；新日精进不会自动出现在其中。核对本次 favorites 与原收藏是否一致；不将成功HTTP200自动当作具体收藏状态正确。

## 数据库 SELECT 独立核对

先用真实身份认证服务核对当前测试用户 UID，不相信客户端自填 ownerId。以下仅将占位符替换为已验证 UID，不输入密码或连接串。

首次 POST 前后各查一次；重复、缺字段后再查一次：

~~~sql
SELECT count(*) AS matching_rows
FROM public.entries
WHERE owner_id = '<已验证测试用户 UID>'
  AND entry_date = DATE '2026-10-14'
  AND text COLLATE "C" = '【虚构·Day18接口验证】正常写入并读回。' COLLATE "C";
~~~

预期0→1→1→1。如开始不是0，暂停并说明已有数据。成功响应的 ID 与 SELECT、GET 读回的 ID 要一致：

~~~sql
SELECT id, entry_date, text, text_version, revision,
       created_at, updated_at, adopted_analysis, origin
FROM public.entries
WHERE owner_id = '<已验证测试用户 UID>'
  AND id = '<POST 成功返回的 ID>';
~~~

预期恰好一行、正文及日期原样、两个版本为1、origin和adopted_analysis为NULL；API时间为UTC，控制台可能显示上海时区，两者应表示同一时刻。补查同用户 entries 总数前后恰好增加1，可与上述精确匹配计数一起证明没有失败写入。

## 证据与边界

交两张截图：①正常 POST 的 HTTP201及完整 {ok,data,error} JSON，②数据库新增行；两处 ID、日期、正文一致。重复409、缺字段400和GET读回也要留实际响应证据，不仅展示测试代码。凭证、请求头与控制台秘密配置不入图。

代码加了一条写入成功服务端日志，只记录 requestId、POST路径、HTTP状态与固定结果码，不记录原文、日期、用户身份或凭证。未取得平台实际日志前只记“代码已添加”，不开通付费日志服务。

当前防重针对 POST 新增流程；旧随机ID记录用同一SQL按用户、日期和完整原文查重（不按origin排除阅读副本），新请求由相同服务端SHA256 ID与数据库主键阻挡并发重发。没有真实数据库并发实测时应标未验证；直接SQL和未来PATCH不在本轮保护范围，未来实现PATCH前需要调整可编辑记录防重模型。

## 实际验证记录（按发生顺序保留早期状态）

- 用户已确认范围与防重规则，授权连续完成及 Edge 操作。
- 已生成 POST 代码；尚未部署，尚未真实写入数据库。
- 上次电脑控制因无法可靠识别当前 Edge 网址自动停止，用户本次回复“继续”。
- 本地测试、ZIP核对、部署、真实请求、SELECT、截图、提交推送结果在取得后逐项补充，不预填成功。

- 本地实际检查：node --test cloudfunctions/reads/reads.test.js cloudfunctions/reads/writes.test.js 返回56项通过、0失败（29项读取回归＋27项写入），退出码0。全部使用虚构数据及模拟上游，不等于真库验证。
- 审查后去掉查重SQL的origin筛选：同用户、同日期、完全相同原文的所有entries记录均纳入查重，符合用户原话；上述56项通过结果对应此修正后的代码。

- 用户部署证据（2026-10-14）：截图 codex-clipboard-ee18f0c9-343f-49f9-8f65-acd4f66060bc.png 显示 literature-reads 状态正常、$LATEST“与已部署代码一致”，Node.js20.19/端口9000，文件列表包含writer.js。仅确认部署界面与文件到位，不能由此断言已成功写库。
- 本次公网探测：POST /api/entries，Content-Type application/json，body={}，不携带Authorization。实际HTTP401，响应为 {"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"请先登录再读取个人数据。","retryable":false}}，X-Request-Id=007d8a61-6644-498c-afc2-ebba9987a983。证明公网POST方法已进入身份拦截，未写数据库。
- 仍需由用户在本机准备已有真实用户短期access_token，再执行normal/duplicate/missing、SELECT、GET entries与favorites。凭证不发到聊天，不保存到文件。当前没有带身份写入成功证据。

- 带凭证的首次normal实际失败（2026-10-14）：用户截图codex-clipboard-ea2b1eec-652e-493f-ba06-37be828437d4.png显示“凭证已读入，开始验证”，POST /api/entries返回HTTP401，三键封套ok=false/data=null/error.code=UNAUTHENTICATED/message“登录凭证无效或已过期，请重新登录。”/retryable=false；X-Request-Id=dadf0f29-04d5-4d15-9bf9-cb2f861f292e。该精确提示对应auth.js认证上游400/401/403分支，SQL尚未执行；后续四模式按脚本退出码停止。不能仅由401断定具体是过期、撤销或复制错误。
- 接下来复用deploy-day17.md §6.1的既有测试账号登录步骤，取得登录HTTP200和身份核验HTTP200/UID一致true后再准备新的用户token。当前身份问题不需要改POST源码、云配置或数据库权限。

- 最新真实读回与收藏证据（2026-10-14）：用户截图codex-clipboard-f26892c2-a72d-4247-9fd1-e89b0564fdb1.png可见“读回匹配 ID：entry-312e204cf4981cda5d13bac80ec779ca5ad5a4018dee7e2077125fe76517ccd6”及检查通过提示；favorites HTTP200、X-Request-Id=7f010dad-e773-45a9-9b59-913caf7631a2，完整JSON为ok=true/error=null，items仅book/walden、favoritedAt=2026-10-13T01:25:00.000Z，total=1，limit=20、nextCursor=null、hasMore=false，与Day17原收藏一致。
- 代理使用此前已验证测试用户UID、2026-10-14和固定虚构原文按实际writer算法本地计算ID，与截图完整ID相同；此为本地一致性核对，不是新的数据库请求。
- 图上未显示normal201、duplicate409、missing400及read的完整响应。结合已核对的脚本断言、用户采用失败即break的五步顺序和实际执行到favorites，可间接支持这四项通过；仍须补截原有POST成功完整JSON，不能把裁切图称为直接展示201/409/400。不要为了截图重新运行normal，它现在应409。
- 下一步只读SQL：在同环境SQL编辑器执行下方查询，预期恰好1行、matching_rows=1、ID与读回一致、版本均1。用户尚未执行，此处不预填成功；未取得写入前行数，不能补造0→1→1→1历史计数。

~~~sql
SELECT id, entry_date, text, text_version, revision,
       created_at, updated_at, adopted_analysis, origin,
       count(*) OVER () AS matching_rows
FROM public.entries
WHERE owner_id = '2110018353410285570'
  AND entry_date = DATE '2026-10-14'
  AND text COLLATE "C" = '【虚构·Day18接口验证】正常写入并读回。' COLLATE "C";
~~~

- 数据库独立证据（2026-10-14）：用户截图codex-clipboard-2faa5e76-da91-4cf3-b4f3-19f2aece5863.png显示同环境SQL编辑器按已验证用户2110018353410285570、日期2026-10-14和固定完整虚构原文精确查询，结果恰好1行、matching_rows=1、text_version=1、revision=1。完整ID为entry-312e204cf4981cda5d13bac80ec779ca5ad5a4018dee7e2077125fe76517ccd6，与此前GET读回匹配ID一致。
- 本图可作数据库记录交付截图：结果表正文列被截短，但上方精确查询显示完整原文，ID、日期、版本和计数清晰。未查询created_at/updated_at/adopted_analysis/origin，不能称这些列已在数据库截图核对；上方Day16旧查询文本不改变下方六列结果对应Day18查询的事实。没有写入前计数，不声称已观察0→1历史过程。
- 尚需从原PowerShell输出补截normal HTTP201完整JSON，并提供duplicate HTTP409和missing HTTP400的中文错误结果；无需重新写入。数据库、GET与POST三处ID的最终比对待POST截图。尚未提交或推送。

- 完整读回响应补证（2026-10-14）：用户截图codex-clipboard-893a6a22-64ce-4b30-8f3b-5cbe7afbd32c.png直接显示read HTTP200，X-Request-Id=9e575a26-2c0c-4800-ad4d-c8a7eeaeb703；完整顶层ok=true、data、error=null。items有两条：Day18新记录及Day17原记录，total=2、limit=100、nextCursor=null、hasMore=false。新记录ID与数据库一致，entryDate=2026-10-14，text为固定完整虚构原文，textVersion/revision均1，createdAt/updatedAt均2026-10-14T12:14:46.685Z，adoptedAnalysis/origin均null。Day17原记录日期、正文及版本2保留。此图直接补足GET状态和九字段对象证据，不再仅依赖匹配提示。
- 同轮截图codex-clipboard-2ce9d53f-8f5a-489d-9d5c-1885ea05749b.png展示此前已有的normal HTTP401，requestId仍为dadf0f29-04d5-4d15-9bf9-cb2f861f292e，并露出下一次命令块开头；没有新的失败请求证据。两图之间的normal201/duplicate409/missing400区域仍未展示。

## Day18最终验收与提交前清单

用户截图codex-clipboard-8630a148-369d-4238-9ef5-dbabb6293f19.png完整展示三次POST响应：

| 模式 | 实际状态与结果 | X-Request-Id |
| --- | --- | --- |
| normal | HTTP201；ok=true、error=null，data为完整9字段Entry | 0261ee78-005c-42e2-b300-4bc0110bbf6a |
| duplicate | HTTP409；ok=false、data=null，DUPLICATE_ENTRY，提示「这一天已经保存过完全相同的原文，请勿重复提交。」，retryable=false | c05cde9f-7d37-4c52-99c8-1c79e98efcd3 |
| missing | HTTP400；ok=false、data=null，INVALID_INPUT，提示「请检查必填字段和输入内容。」，fields.text=「请填写原文。」，retryable=false | 8ce56e7d-40d4-4525-ae4a-d7d033a0bd77 |

POST返回ID为entry-312e204cf4981cda5d13bac80ec779ca5ad5a4018dee7e2077125fe76517ccd6，与数据库SELECT和GET完全一致。entryDate=2026-10-14，text原样为固定虚构样例，textVersion/revision均1，createdAt/updatedAt均2026-10-14T12:14:46.685Z，adoptedAnalysis/origin均null。新补的codex-clipboard-50a18cbe-892f-4a88-9d0b-9999f6c727fd.png也展示相同GET HTTP200、完整新旧两记录与原收藏关联。

| 完成标准 | 状态 | 证据 |
| --- | --- | --- |
| POST部署并真实写入，响应形状与契约一致 | 已完成 | 用户部署图、normal HTTP201完整JSON、数据库SELECT记录 |
| 同用户、同日期、完全相同原文重复被拒 | 已完成 | duplicate HTTP409中文错误；之后SELECT精确匹配仅1行 |
| 缺必填字段被拒并说明中文字段错误 | 已完成 | missing HTTP400及fields.text「请填写原文。」 |
| 新记录读回，最后核对原收藏 | 已完成 | entries HTTP200、ID三处一致；favorites HTTP200原book/walden保留 |
| 三条测试命令与SELECT方法 | 已完成 | 本文与verify-day18.mjs |
| 两张交付截图 | 已完成 | 本轮三种POST响应图＋此前数据库单行图 |
| 服务端日志加练 | 已完成（代码） | index.js记录requestId/路径/状态/结果码；平台实际日志未查看 |
| 提交并推送 | 已获授权，执行结果以Git及本地日志为准 | 用户回复「确认提交」，仅限下方10文件 |

未取得写入前独立计数截图，不声称观察过0→1→1→1全过程；实际201插入响应、数据库唯一匹配行及GET读回相互对应。真实并发未实测；本日没有PATCH、DELETE或批量接口。

提交候选如下，全部属于Day18；云函数既有文件只提交本日增量：

| 文件（相对my-app） | 当日用途 |
| --- | --- |
| api-contract.md | 已确认防重规则、错误码、POST状态与验收证据 |
| cloudfunctions/reads/index.js | POST入口、请求校验响应和服务端日志 |
| cloudfunctions/reads/db.js | 固定写SQL白名单及写角色选择 |
| cloudfunctions/reads/service.js | 复用Entry响应映射 |
| cloudfunctions/reads/package.json | 函数说明与写入测试命令 |
| cloudfunctions/reads/package.py | 部署包纳入writer.js |
| cloudfunctions/reads/writer.js | 必填/格式校验、精确防重与参数化写入 |
| cloudfunctions/reads/writes.test.js | 27项新增写入测试 |
| deploy-day18.md | 部署、测试命令、SELECT与实际验收记录 |
| verify-day18.mjs | 五种真实接口核验模式 |

_logs/、reads.zip、凭证、.env及此前已有的前端/依赖修改不属于本次提交。按用户AGENTS.md第5条，具体清单确认前不暂存、提交或推送。

拟提交标题：Day 18｜部署日精进写入并验证防重与读回

说明两行：
改了什么：实现日精进POST写入，统一响应并补充契约与部署验证记录。
加了什么：中文字段校验、同用户同日原文防重、服务端日志及写入测试。

群内可回：今天防住了同用户同日期完全相同原文的重复提交，以及缺少原文的错误输入。正常201、重复409、缺字段400；SQL查到唯一记录，GET读回ID一致，原收藏保留。

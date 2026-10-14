# Day 19｜后端 repository 分层重构

三张核心表的数据库操作已经拆到独立 repository。新文件已在既有 `literature-reads` 云函数部署，五个已上线接口的正常链路及日精进重复/缺字段行为回归通过。接口路径、字段名和响应形状保持原样，没有新增业务功能。用户已于2026-10-14回复“确认提交”，批准下方九个文件、标题及两行说明；Git执行结果记录于本地当日日志及提交历史。

## 查数据库的代码从哪移到哪

| 原位置 | 新位置 | 操作 |
| --- | --- | --- |
| service.js 的 ENTRIES_SQL、参数组装、query 调用 | entriesRepository.js 的 list | 读取日精进列表 |
| writer.js 的 INSERT_ENTRY_SQL、参数组装、query 调用 | entriesRepository.js 的 insert | 新增日精进，保留原有原子防重 SQL |
| service.js 的 NOTES_SQL、参数组装、query 调用 | readingNotesRepository.js 的 list | 读取感悟、总数及全量最新感悟 ID |
| service.js 的 FAVORITES_SQL、参数组装、query 调用 | favoritesRepository.js 的 list | 读取收藏及原有筛选 |

`repository` 是专门访问某张表的文件。业务函数调用 `list()` 或 `insert()`，由 repository 组装固定 SQL 参数并调用数据库连接层。

读取顺序：`index.js → service.js → 对应 repository → db.js → 数据库`。写入顺序：`index.js → writer.js → entriesRepository.js → db.js → 数据库`。

- index.js 保留 HTTP 路由、鉴权、请求解析、调用业务函数及返回响应。
- service.js / writer.js 保留原有输入校验、字段映射、游标、防重 ID 和业务错误处理。
- repository 集中四条 SQL、占位符参数与数据库调用，原样返回数据库结果。
- db.js 保留原有 HTTPS 连接、固定 SQL 白名单、读写角色和安全错误处理；白名单 SQL 改从 repository 导入。

四条 SQL 字符串及参数顺序与重构前严格相同；`limit + 1` 仍由业务层传入。三个 SELECT 使用原只读角色，INSERT 使用原写角色。旧 SQL 导出、query 注入方式和原测试均兼容，表结构未改。

## 重构后的目录

```text
my-app/
├─ cloudfunctions/
│  ├─ health/
│  │  └─ index.js                  原健康检查，无数据库访问
│  ├─ reads/
│  │  ├─ index.js                  接请求、鉴权、调业务、返响应
│  │  ├─ service.js                读取校验、字段映射、分页与游标
│  │  ├─ writer.js                 写入校验、防重 ID、返回映射
│  │  ├─ entriesRepository.js      日精进表 SELECT / INSERT
│  │  ├─ readingNotesRepository.js 阅读感悟表 SELECT
│  │  ├─ favoritesRepository.js    收藏表 SELECT
│  │  ├─ db.js                     HTTPS 数据库连接与 SQL 白名单
│  │  ├─ auth.js                   原身份核验
│  │  ├─ reads.test.js             原读取测试
│  │  ├─ writes.test.js            原写入测试
│  │  ├─ package.py                打包清单加入三个 repository
│  │  ├─ package.json
│  │  └─ scf_bootstrap
│  └─ reads.zip                    已忽略的本地部署包
├─ verify-day19.mjs                真实 HTTP 回归工具
├─ refactor-day19.md               分层、验证与交付说明
└─ _logs/                         已忽略的本地验证证据
```

## 已执行回归与证据

实际已上线五个接口，未来十五项占位接口未实现。本机测试使用虚构数据和模拟认证/数据库；云端回归使用既有同一普通测试用户和真实 HTTP 请求，两类证据分别记录。

| 接口 / 场景 | 本机重构前后 | 新部署后云端证据 |
| --- | --- | --- |
| GET /api/health | 原源码字节未变，本机200/405/404一致 | 实际GET200，精确原ok/service两字段 |
| GET /api/entries | 完整JSON、参数、排序与分页一致 | 新部署后截图200，两条旧记录及九字段不变；write前后GET完整分页校验通过 |
| GET /api/books/walden/notes | 字段、最新ID及跨页行为一致 | write前后真实GET200，完整列表形状与最新ID校验、内容前后严格相等 |
| GET /api/favorites | 三字段、筛选及分页一致 | write前后真实GET200，完整列表前后严格相等；截图旧book/walden关联保留 |
| POST /api/entries | 201封套、原文、日期、防重和错误一致 | 真实201，完整Entry九字段、原始空白/换行/日期、版本1/1、两个NULL通过 |
| 同输入重复POST | 409，不增加模拟行 | 真实409 DUPLICATE_ENTRY，既有中文提示；最终GET断言仅新增一条 |
| POST缺text | 400，中文fields，不执行写库 | 真实400 INVALID_INPUT，fields.text为“请填写原文。” |
| 三GET及entries POST无身份 | 原401三键、身份头与校验顺序一致 | 新部署确认后实际均401，原中文提示、Bearer身份头及请求编号存在 |
| POST后GET读回与旧列表 | 九字段读回、收藏不变 | GET与POST九字段严格相等，旧entries、favorites、notes严格保留 |
| 参数、游标、空列表、方法及其他错误边界 | 原56测试及本机前后对比覆盖 | limit0、跨页、未知作品、业务405等额外分支未在本轮云端逐项实测 |

所有业务成功/失败仍是原 `ok/data/error` 三键；health 保持原独立形状。随机请求编号核对存在/格式，不要求前后值相同。

### 本机验证

- 命令：在 cloudfunctions/reads 执行 `node --test reads.test.js writes.test.js`；重构前 **56/56**、重构后 **56/56**，均退出0。
- HEAD `4c2794d` 与重构后工作区的前后差异：**33项检查通过、0失败**，**23组HTTP对比、46次实际本机请求**；完整JSON与六个关键头一致。
- 四段 SQL 原文严格相等；每版本十二次query调用的次数和参数完全一致；四项HTTPS适配器模拟上游请求/角色/返回一致。
- 五个新增/改动源码及db.js语法检查通过；Git差异与九候选行尾空白检查通过，仅既有LF/CRLF提示。
- 回归工具语法与内存模拟通过：28项baseline/compare场景、write正常链路及失败即停/重复样例停止/证据保护。模拟不调用云端或写真实基线。

本机前后证据：[摘要](_logs/day19-regression/difference-summary.txt)、[完整结果](_logs/day19-regression/difference-results.json)、[一次性脚本](_logs/day19-regression/compare.cjs)。临时基线与脚本只留本地，不提交。

### 部署与真实写入回归

部署图 `codex-clipboard-cb75ed50-af2a-4061-919b-98de20405148.png`：literature-reads正常、$LATEST与已部署代码一致、Node20.19/9000、三个repository可见。用户此前对部署情况原话为“不确定”，后续截图补足部署一致状态；未核验远端文件哈希。代理电脑控制因Edge地址识别失败停止，没有代上传或读取用户凭证。

reads.zip精确十一项顶层运行文件，三repository均入包，scf_bootstrap为LF/0755；解包后七模块加载通过。测试、日志、配置、凭证不在包内，ZIP被忽略。

用户于2026-10-14在本机执行 `node .\verify-day19.mjs write`，报告“写入回归通过：HTTP 201、409、400，GET 九字段一致，旧记录、收藏和感悟保留。”及“验证程序退出码：0”。本地同一run的五份阶段文件已独立核对，时间递增，三次POST响应逐步累计且一致。

最终证据：[真实阶段JSON](_logs/day19-cloud-write-2026-10-14T14-05-24.100Z-5270e9e2-feff-48d1-b582-5a815c145cb1-05.json)，savedAt=2026-10-14T14:05:27.602Z。完整保存201/409/400三次POST响应，最终stage为“写入回归全部通过：201、409、400、GET 九字段一致，旧记录、收藏和感悟保留”。

201新记录：id=`entry-9bf94b9519051aee55c5e85f50749fb2e45348083706d06a1324673016304133`，entryDate=2026-10-14，createdAt/updatedAt=2026-10-14T14:05:26.443Z，textVersion/revision=1，adoptedAnalysis/origin=null。原文明确是虚构测试，首尾各两个空格及中间换行原样保留，与固定fixture逐字相等；ID按已核验的同一测试用户/日期/完整原文离线计算匹配，没有读取用户令牌。未修改旧记录。

GET原始JSON没有写入阶段文件；GET结论由实际脚本断言支持：只有三资源写前/写后完整GET、条数只增1、POST/GET九字段相等、旧记录与收藏感悟严格不变全部通过，才写入最终stage。截图另直接核对新部署后的日精进GET及旧记录。

未验证：真实并发、Day19新行的独立SQL查询、第二测试用户隔离，以及本轮云端全部分页/空列表/额外错误分支。没有保存部署前带身份云端基线，不能把部署后新建baseline称为旧版本；云端逐字前后比较未实测。本机HEAD严格前后比较已完成，不扩大两者结论。

## 两张交付截图

| 交付 | 最终选用的用户原图 | 核对结果 |
| --- | --- | --- |
| 项目文件结构 | codex-clipboard-1ce3bafc-518b-4b85-b5ee-595c818429ad.png | 三个repository完整文件名及原接口/业务文件清晰可见 |
| 重构后接口正常返回 | codex-clipboard-a1bf0288-9170-4ea2-bec5-1ef1b4b6eb62.png | 地址栏127.0.0.1:4173/day17-check.html、页面公网entries请求、HTTP200、完整两条九字段JSON同屏，无凭证露出 |

第二图复用既有本地核验页展示真实公网响应，本地页面地址不等同于公网接口地址。它是在新增Day19虚构样例之前保存的正常读取图，不声称图内已有新增样例。

较早核对图7107e55f为收藏200完整JSON，fe3020c7为裁切日精进验证图；保留在本地日志的证据历史中，不替代上述最终交付选图。

群内可回：“数据库查询和写入已拆到三张核心表的repository；接口路径、字段和响应形状保持不变，五个已上线接口及201/409/400与读回回归通过。”提交推送状态须取得实际成功后再补，不提前声称。

## 提交范围与核对

独立数据库操作文件、五个已上线接口回归和两张交付图已核对。用户已确认以下九文件、提交标题及两行说明；实际Git提交/推送结果以命令输出为准，保存于本地当日日志与提交历史，不在本文预填提交号。

下列九文件全部属于Day19；既有文件仅提交本日分层增量：

| 文件 | 所属任务 | 内容 |
| --- | --- | --- |
| cloudfunctions/reads/entriesRepository.js | Day19 | 新增日精进SELECT/INSERT数据访问层 |
| cloudfunctions/reads/readingNotesRepository.js | Day19 | 新增感悟SELECT数据访问层 |
| cloudfunctions/reads/favoritesRepository.js | Day19 | 新增收藏SELECT数据访问层 |
| cloudfunctions/reads/service.js | Day19增量 | 读取业务改调repository |
| cloudfunctions/reads/writer.js | Day19增量 | 写入业务改调repository |
| cloudfunctions/reads/db.js | Day19增量 | 固定SQL白名单改从repository导入 |
| cloudfunctions/reads/package.py | Day19增量 | 三repository纳入原部署包 |
| verify-day19.mjs | Day19 | 真实HTTP回归工具，无新业务接口 |
| refactor-day19.md | Day19 | 分层、目录、实际证据、截图与收尾说明 |

十二项原有前端/依赖/测试修改不纳入。_logs/、reads.zip、.env及凭证不提交。用户原话“确认提交”已授权九文件清单、标题、两行说明及正常推送；提交范围限定本表，不纳入其它改动。执行结果记录于本地当日日志与Git历史。

拟提交标题：`Day 19｜将核心表数据库操作拆入 repository 并回归验证`

两行说明：

```text
改了什么：将读取和写入业务改为调用 repository，保持接口路径、字段与返回行为。
加了什么：三张核心表的 repository、部署打包清单与前后回归验证说明及工具。
```

# Day 17｜读取接口部署与验证

项目：文学与内心冲突。Day17主任务验证已完成（2026-10-14，Asia/Shanghai）：GET /api/entries、GET /api/books/:bookId/notes、GET /api/favorites均已实现、部署并通过真实测试用户HTTP200核对；页面显示来自真实数据库的明确虚构测试数据。控制台单行修改已反映到entries新正文、版本2/2和页面，原日期保持；两次感悟原文和收藏保留。29项本地模拟检查通过，最终数据视图及收藏完整JSON截图已收到。用户已确认下方12个Day17文件的提交与推送范围；本文件记录提交前验收，最终提交和远端结果以Git历史及本地日志为准。历史失败、修复及授权记录保留。

## 1. 我的数据从哪来

1. 日精进、阅读感悟和收藏是用户产出的数据；现有 Day 16 种子是明确标注的虚构示例。
2. 项目需要回看过去，所以要保存原文、日期和每次感悟历史。
3. 用户昨天的输入如果不存就会丢失，因此本次从自己的 PostgreSQL 表读取，不找外部热搜 API。

| 本次已实现的读取接口 | 数据来源 | 返回内容 |
| --- | --- | --- |
| `GET /api/entries` | `public.entries` | 本人日精进与独立总结副本，带分页 |
| `GET /api/books/:bookId/notes` | `public.reading_notes` | 本人同一作品的全部感悟历史，带分页和最新条目 ID |
| `GET /api/favorites` | `public.favorites` | 本人的作品／日精进收藏关联，支持类型筛选与分页 |

业务响应顶层恰好三键：成功 `{ok:true,data:…,error:null}`；失败 `{ok:false,data:null,error:{code,message,retryable,…}}`。关联请求的编号在 `X-Request-Id` 响应头。health沿用Day15独立响应；写接口未实现，表结构未改。主React页面仍读取本地数据，独立day17-check.html核验页已显示公网读取的实际数据。

## 2. 表字段与接口哪里对不上

发现方法：逐列对照 `db/schema.sql` 和 `api-contract.md`，再核对虚构响应。通过读取时转换适配，不改表。

| 数据库存储 | API 契约 | 转换与原因 |
| --- | --- | --- |
| `entry_date`，DATE | `entryDate` | 转为原始 `YYYY-MM-DD` 日历日，不因时区前移／后移 |
| `text_version`、`created_at`、`updated_at` 等 | `textVersion`、`createdAt`、`updatedAt` 等 | 下划线名称转 camelCase；时间戳统一 UTC ISO 8601 |
| 感悟的五个 `summary_*` 列 | 一个 `summaryLink` 对象 | 无关联时为 `null`；有关联时按契约组合五个字段 |
| `owner_id` | 不对普通列表返回 | 只使用验证后的真实用户 ID 限定读取范围 |
| 收藏的 `entry_target_id` | 不返回 | 数据库内部自动生成的外键辅助列 |
| Day 16 `day16-demo-owner-001` | 真实账号的用户 ID | 二者不是同一用户。新账号应读到空列表，不能为看到种子而绕过身份检查 |

SQL 的用户 ID、筛选、游标位置和条数通过 `$1`、`$2` 等占位符绑定；不把请求文字拼进 SQL。当前 `db.js` 的 `createCloudBaseQuery(envId, apiKey, fetchImpl)` 使用 Node.js 内置 fetch，向 `POST https://环境ID.api.tcloudbasegateway.com/v1/rdb/exec-pgsql` 发送 `{sql,parameters,role:'cloudbase_read_only_user'}`。官方 SQL 接口仅管理员可调用，成功返回 JSON 数组；本项目仍对外转换为契约规定的三键列表响应。[执行 SQL 语句](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)

函数后台固定使用只读角色，所有读取继续限定已验证用户的 `owner_id`；不接受客户端提供 SQL、角色或管理员密钥。普通测试用户的 access_token 只用于验证用户身份，不能替代后台 SQL 管理员 API Key。实例只读角色三表SELECT已授权并核查；三条查询的实际业务响应均已通过公网HTTP200及页面数据核对；发生权限不足时停止排查，不切换管理角色绕过。过去的 pg 协议直连方案仅保留为末尾历史记录。

## 3. 你操作：准备测试账号

这一步决定“谁的数据可以被读取”。请在同一环境 `ritchie-d5gd1dg1yd29783e8` 操作。

1. 打开 CloudBase「身份认证 → 登录方式」，只查看已启用的是哪种方式；不要另开登录方式。
2. 在「身份认证 → 用户管理」创建一个普通注册测试用户，按已经启用的方式填写控制台要求的信息。
3. 确认用户创建成功、状态可登录，保存该用户 ID 供后面的虚构数据验证。不要把密码、令牌或连接串发到对话或写进文件。

官方说明控制台用户管理可以创建注册用户，PG 模式下登录用户为注册用户。[用户管理](https://docs.cloudbase.net/authentication-v2/auth/manage-users)

如果当前已启用的是账号密码登录，可以按官方 `POST /auth/v1/signin`，使用测试账号的 `username`、`password` 登录获取 `access_token`；用浏览器请求时让密码通过临时输入获取，不把它写进代码、地址栏或截图。若启用的是短信、邮箱验证码或其他方式，使用对应现有登录流程，待确认方式后再执行具体登录步骤。[AccessToken 获取方式](https://docs.cloudbase.net/http-api/basic/access-token)

本次不新增项目登录页。`access_token` 是短期用户身份凭证，不是管理员 API Key。函数把 Bearer 令牌提交给官方 `GET /auth/v1/user/me` 验证，使用响应中的 `sub` 作为读库归属；不信任客户端自报的 UID。[获取当前用户信息](https://docs.cloudbase.net/http-api/auth/user-me)

## 4. 部署操作步骤（已执行进度见文末）

下面保留上传与配置步骤。HTTPS SQL 适配、本地检查和重新打包已完成；其后在用户明确授权电脑操作下完成服务端Key准备、函数创建和代码部署。三条公网路由及无Bearer公网401检查已完成；entries带身份读库已取得用户控制台JSON截图，另外两GET及最终含地址栏截图仍待验证，不能把操作说明本身当作成功证据。

重新生成上传包，在项目目录执行：

```powershell
cd 'E:\vibe coding\my-app'
python .\cloudfunctions\reads\package.py
```

命令生成本轮的 `cloudfunctions/reads.zip`，替换此前包含 pg 直连代码的旧包。打开 ZIP，根目录应恰好有 `index.js`、`service.js`、`auth.js`、`db.js`、`package.json`、`scf_bootstrap`、`catalog.json` 七个运行文件，不能多套一层 reads 文件夹。`package.json` 没有生产依赖，不带 `pg` 或 `node_modules`；包不包含密钥、`.env`、测试文件和打包脚本。

1. **服务端 API Key 配置：** 同一环境进入「环境管理 → API Key 配置」，在服务端区域准备Key。本次经用户确认创建literature-reads-day17，有效期30天。函数创建页开启「API Key 设置」后，右侧实际是密钥选择器：原页可能缓存空列表，展开后用刷新按钮，再选中该名称；平台随后关联注入CLOUDBASE_APIKEY。这里不把Key名称或KeyId当作完整凭证填写，也不向聊天或前端粘贴Key。本项目显式读取process.env.CLOUDBASE_APIKEY用于HTTPS SQL，真实权限仍待读库测试。[令牌类型与权限](https://docs.cloudbase.net/http-api/basic/access-token)、[HTTP云函数鉴权](https://docs.cloudbase.net/cloud-function/develop/how-to-writing-functions-code)
2. 同一环境进入「云函数／托管 → 新建云函数 → 通过代码包创建」表单，选择 **HTTP 云函数**。名称示例为 `literature-reads`，由你确定后填写；不要覆盖 `literature-health`。如仍停留在此前创建表单，应重新选择本轮重打包的 `reads.zip`。
3. 运行时选 **Node.js 20／20.19**，监听端口为 **9000**。启动文件使用 `/var/lang/node20/bin/node`；若没有该运行时选项，停下报告可选版本。
4. 当前函数零生产依赖，创建页「自动安装依赖」可以关闭；无需安装旧方案的 `pg@8.16.3`。依赖模拟或表单选项都不能证明函数部署成功。
5. 展开「环境配置」，只填写下表三个必填变量。后续人工步骤获确认后再提交创建／部署，核对状态正常且无未部署改动。

HTTP 云函数需监听 `0.0.0.0:9000` 并提供可执行、LF 换行的 `scf_bootstrap`。控制台上传包根目录须包含入口文件。[Node.js HTTP 云函数](https://docs.cloudbase.net/cloud-function/quickstart/httpfunc/nodejs)、[启动文件](https://docs.cloudbase.net/en/cloud-function/develop/scf-bootstrap)、[控制台部署](https://docs.cloudbase.net/cloud-function/manage)

| 当前必填环境变量 | 填写方式 |
| --- | --- |
| `CLOUDBASE_ENV_ID` | `ritchie-d5gd1dg1yd29783e8`，再与当前环境核对 |
| `CURSOR_SECRET` | 自行生成的随机秘密，至少 32 个随机字节，仅存函数配置；用于防止分页游标被篡改 |
| `CLOUDBASE_APIKEY` | 同环境服务端管理员 API Key，仅用于函数后台调用 SQL 接口；不能填应用测试用户令牌 |

当前无需填写 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE` 或 `PGSSLROOTCERT`；新代码不使用这些旧方案配置。凭证只在你本地查看和填写，截图遮住其值。未配置必填变量时应核对函数启动日志，不把读取失败当成空列表。

**超时与套餐先核对：** 此前创建页已看到内存256MB、初始化超时65秒、执行超时默认3秒。曾直接建议30秒而遗漏套餐限制，此处保留更正：HTTP 技术文档写明默认3秒、可选范围1–7200秒；套餐表写免费体验版3秒且不可修改，但未区分 HTTP 特例。当前是否能调整未确认，以本函数在当前环境的实际可设范围为准，不断言一定锁定3秒，也不承诺一定能设30秒。本轮没有实测30秒权限，不强制升级或修改套餐。认证与 SQL fetch 各自的8000毫秒等待上限不等于平台允许的总执行时间；后续部署时需核对认证加 SQL 的完整链路是否能在实际期限内返回。[套餐能力与价格](https://cloud.tencent.com/document/product/876/127357)、[函数基础配置](https://docs.cloudbase.net/cloud-function/function-configuration/config)

HTTPS 路线不要求开启数据库外网或重置数据库密码。后续若 SQL 接口报权限、认证或结构错误，先核对服务端 API Key、只读角色权限与实际返回；不通过放开管理角色或返回空数据掩盖错误。

## 5. 你操作：配置三个网关路由

网关把公网路径送到新函数。复制控制台实际显示的完整网关域名；Day 15 的历史域名只能作核对参考，不能据环境 ID 拼猜新地址。

| 触发路径 | 关联资源 | 设置 |
| --- | --- | --- |
| `/api/entries` | 新读取 HTTP 云函数 | 开启路径透传 |
| `/api/favorites` | 同一新函数 | 开启路径透传 |
| `/api/books` | 同一新函数 | 开启路径透传，覆盖 `/api/books/walden/notes` |

仅新建上述路由，不把 `/api` 整段改绑；否则可能接管现有 `/api/health`。函数仅实现登记的三个 GET，其他作品路径返回 404；非 GET 返回 405。

本次新读取路由的**网关前置身份认证关闭，由函数严格验证 CloudBase 用户 Bearer 令牌**，这样无令牌也能得到契约规定的 401 三键响应。关闭前置认证不会取消函数身份核验或放开数据归属。不要改 health 或其他资源的设置。

如果改为开启网关前置认证，平台可能先跳转登录页或返回平台凭证错误，函数不会执行，响应也可能不符合本项目封套。官方说明这两种访问行为，并说明关闭路径透传会剥离前缀。[网关身份认证](https://docs.cloudbase.net/service/authentication)、[网关路径透传](https://docs.cloudbase.net/service/introduce)

## 6. 你操作：浏览器查看结果

首先打开 `https://实际网关域名/api/entries`。地址栏直接打开没有 Bearer 请求头，应得到 HTTP 401 和下列形状。当前默认域名实测先显示CloudBase访问提示，HTTP响应带Content-Disposition: attachment；直接打开可能触发下载，不能承诺在页面内显示JSON。浏览器截图仍待后续实际核对。

```json
{"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"…","retryable":false}}
```

### 6.1 只有账号密码时：先在本机重新登录（用户执行）

本小步只取得当前有效的普通用户登录凭证，先不读数据库或改数据。2026-10-14用户原话「只有测试账号和密码」；前一天的登录核验报告不表示今天已有可用令牌。

1. 使用你此前完成登录核验的浏览器，打开 https://ritchie-d5gd1dg1yd29783e8.api.tcloudbasegateway.com/auth/v1/user/me 。直接打开没有Bearer，未登录响应不代表账号密码有误。内置浏览器此前打开该地址被客户端阻止，代理没有重试或绕过；若你自己的页面也被拦截，先报告错误名称，不修改安全设置。
2. 按F12打开Console（控制台），粘贴并执行下方完整片段；它先核对当前网址，只有在指定认证主机页面上才会请求你输入创建账号时设置的用户名和密码。密码临时输入框没有遮罩，输入期间不要截图；不要把密码写进片段。
3. 看到「登录 HTTP 200」和「身份核验 HTTP 200 UID 一致 true」后，只回复这两项结果。保留该标签页，不刷新或关闭；令牌留在day17Token内存变量中，后续同一读库验证小步再使用。不要输出该变量、整个登录响应或请求头，也不要把凭证发到聊天。

```javascript
var day17Token = null;
void (async () => {
  const authOrigin = 'https://ritchie-d5gd1dg1yd29783e8.api.tcloudbasegateway.com';
  if (location.origin !== authOrigin) {
    console.log('请先打开指定认证地址，再执行。');
    return;
  }
  let username = window.prompt('输入创建测试账号时设置的用户名');
  if (username === null) return;
  let password = window.prompt('输入该测试账号密码，输入时不要截图');
  if (password === null) return;
  try {
    const login = await fetch('/auth/v1/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'omit', redirect: 'error', cache: 'no-store'
    });
    username = password = null;
    console.log('登录 HTTP', login.status);
    if (!login.ok) return;
    const session = await login.json();
    if (typeof session.access_token !== 'string' || !session.access_token) {
      console.log('登录响应未提供有效凭证，请只报告此提示。');
      return;
    }
    const me = await fetch('/auth/v1/user/me', {
      headers: { Authorization: 'Bearer ' + session.access_token },
      credentials: 'omit', redirect: 'error', cache: 'no-store'
    });
    const profile = me.ok ? await me.json() : null;
    const matched = me.ok && profile?.sub === '2110018353410285570';
    console.log('身份核验 HTTP', me.status, 'UID 一致', matched);
    if (matched) day17Token = session.access_token;
  } catch {
    console.log('临时登录或身份核验未完成，请只报告此提示，不发送凭证。');
  } finally {
    username = password = null;
  }
})();
```

这段片段没有写入文件、地址栏或浏览器本地存储，不打印密码、令牌、完整身份资料；只在登录和可信UID核验都成功后保存用户短期令牌到标签页内存。2026-10-14用户随后报告「登录 200，UID 一致」；记录为用户在本机完成当前登录和身份核验，不表示代理取得或检查了真实凭证。读取函数与数据库的联调仍待验证。登录非200、UID不一致或网络错误时停下报告，不自动重试，不重置密码或创建新账号。[官方用户名密码登录接口](https://docs.cloudbase.net/http-api/auth/auth-sign-in)、[获取当前用户信息](https://docs.cloudbase.net/http-api/auth/user-me)

### 6.2 核验成功后：先验证一条日精进读取

用户已报告当前登录200、UID一致，继续同一第④板块读取小步。认证页面和公网网关是不同主机，变量不跨标签页；下面先准备代码，再复制本机凭证，避免复制代码覆盖令牌。代理不读取剪贴板，不让用户把令牌发送到聊天。

1. 保留刚才登录成功的认证标签页，在同一浏览器另开 https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/entries 。如出现平台默认域名提示，按页面正常确认，不修改安全设置或绕过浏览器警告。按F12打开这个网关标签页的Console，先粘贴并执行下方完整代码；它只准备工具，不弹出凭证输入框，也不发业务请求。

```javascript
var day17Token = null;
var day17SetToken = null;
var day17Get = null;
void (() => {
  const readOrigin = 'https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com';
  if (location.origin !== readOrigin) {
    console.log('请先打开指定公网网关地址，再执行。');
    return;
  }
  day17SetToken = function () {
    const token = window.prompt('粘贴刚才本机复制的用户登录凭证，输入期间不要截图');
    day17Token = typeof token === 'string' ? token.trim() : null;
    console.log(day17Token ? '登录凭证已临时准备。' : '未输入登录凭证。');
  };
  day17Get = async function (path) {
    const target = new URL(path, readOrigin);
    if (target.origin !== readOrigin) {
      console.log('停止：只能读取当前项目的公网网关。');
      return null;
    }
    if (!day17Token) {
      console.log('请先用day17SetToken输入用户登录凭证。');
      return null;
    }
    try {
      const response = await fetch(target.href, {
        headers: { Authorization: 'Bearer ' + day17Token },
        credentials: 'omit', redirect: 'error', cache: 'no-store'
      });
      console.log('HTTP', response.status, '请求编号', response.headers.get('X-Request-Id'));
      const result = await response.json();
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch {
      console.log('请求未完成或响应不是JSON，请报告此提示，不发送凭证。');
      return null;
    }
  };
})();
```

2. 回到刚才登录成功的认证标签页Console，复制并执行下面这一行。它使用开发者工具的本地copy功能，不打印令牌；不要在普通终端执行。

```javascript
void (typeof day17Token === 'string' && day17Token ? copy(day17Token) : console.log('当前登录凭证不存在，请先完成第6.1节。'));
```

3. 回到网关标签页Console，手动键入day17SetToken()并回车，再在弹框中粘贴本机刚复制的令牌。此时不要复制别的代码，以免覆盖剪贴板；弹框输入期间不截图，不输入后台管理员Key。看到「登录凭证已临时准备。」后，令牌已进入此标签页内存。
4. 现在再复制并执行这一条，先只查日精进：

```javascript
await day17Get('/api/entries?limit=20');
```

预期HTTP200，顶层ok:true/error:null，data为列表对象。items应含id为day17-test-entry-001的记录，entryDate保持2026-10-13，text为「【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。」。这条数据是此前写入真库的独立虚构验证记录，不是用户实际经历；不能把今天2026-10-14自动覆盖到它。若账号后来已有更多数据，total可能大于1，按指定ID核对；指定记录缺失、空列表、非200或响应错误时先报告，不继续其他请求或修改数据库。

5. 截图保留地址栏、控制台HTTP状态、JSON中的指定ID/日期/虚构正文，避开密码/令牌输入框、请求头和网络详情。该截图只能验证本次接口读取，不证明现有前端已接入。本次先把这一条实际结果交回核对。复制第4步代码会替换剪贴板中的令牌；如仍保留令牌，改用普通无关文字替换。保留两个标签页且不刷新，供后续同一读取小步使用。

下列是首条成功且经核对后再执行的另外两条，不与首条一起批量运行：

```javascript
await day17Get('/api/books/walden/notes?limit=20');
await day17Get('/api/favorites?targetType=book&limit=20');
```

感悟预期含day17-test-note-002及001，002在前、latestNoteId为002，两次虚构原文分别保留；收藏预期含targetType:book/targetId:walden。两者仍未实际验证，后续据真实返回更新状态。原limit1分页核对保留在下面加练，不把第一页一条当作两次感悟被覆盖。
其他核对：

- 分页：有两条感悟后，复制第一页 `data.page.nextCursor`，通过 `encodeURIComponent` 放入下一次的 cursor 参数；第二页仍是同一作品，`latestNoteId` 应保持最新条目 ID，不能变成第二页第一项。
- 收藏筛选：`targetType=book` 只返回作品关联；`targetType=entry` 只返回日精进关联。
- 无效输入：`await day17Get('/api/entries?limit=0')` 应为 400 `INVALID_INPUT`。
- 无令牌：`await fetch('/api/favorites').then(async r => console.log(r.status, await r.json()))` 应为 401 `UNAUTHENTICATED`。
- 无效令牌：把临时令牌改成明显无效的虚构字符串后应为 401；认证服务或数据库不可用应为 500 `INTERNAL_ERROR`，不能假装读取成功。

令牌到期后重新按已有方式登录。刷新标签页会清除上述变量，且地址栏读取仍不附带 Bearer；需要重新输入令牌并执行读取。结束后清空变量、关闭标签页；截图只保留地址栏与成功响应，不包含凭证。

## 7. 你操作：用独立虚构数据验证真库

目的：证明接口读的是数据库，且原文、历史和归属没有被混淆。这里只给控制台验证 SQL，没有新增业务写接口。下面的新增数据脚本已由用户人工执行，并通过合并查询结果核对；下方修改记录的 UPDATE 尚未执行，留到第④板块。**不要重跑 `db/seed.sql`：它会重建种子数据。**

本次脚本已将测试用户 ID 填为字符串 `2110018353410285570`，来自用户报告的已创建账号与登录核验；无需再替换。脚本里的“替换为测试账号的真实用户ID”只是防误用检查文字，保持原样。新测试账号应没有此前同作品记录。测试 ID 固定便于核对；如已有同 ID 却属于其他用户或不同来源，脚本报错并回滚，不覆盖已有记录。

```sql
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SELECT set_config('day17.test_uid', '2110018353410285570', true);

DO $$
DECLARE
  v_owner TEXT := current_setting('day17.test_uid');
BEGIN
  IF v_owner = '替换为测试账号的真实用户ID'
     OR btrim(v_owner) = '' OR v_owner = 'day16-demo-owner-001' THEN
    RAISE EXCEPTION '请填写真实测试用户ID，不使用Day16虚构用户。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.entries
    WHERE id = 'day17-test-entry-001'
      AND (owner_id <> v_owner OR text NOT LIKE '【虚构·Day17接口验证】%')
  ) OR EXISTS (
    SELECT 1 FROM public.reading_notes
    WHERE id IN ('day17-test-note-001', 'day17-test-note-002')
      AND (owner_id <> v_owner OR body NOT LIKE '【虚构·Day17接口验证】%')
  ) THEN
    RAISE EXCEPTION '测试ID已被其他用户或非本次虚构记录使用，已停止。';
  END IF;

  INSERT INTO public.entries
    (id, owner_id, entry_date, text, created_at, updated_at)
  VALUES
    ('day17-test-entry-001', v_owner, DATE '2026-10-13',
     '【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。',
     '2026-10-13T01:00:00Z', '2026-10-13T01:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_notes
    (id, owner_id, book_id, body, saved_at, save_order, created_at, updated_at)
  VALUES
    ('day17-test-note-001', v_owner, 'walden',
     '【虚构·Day17接口验证】第一次感悟：我想核对自己的安排。',
     '2026-10-13T01:10:00Z', 1, '2026-10-13T01:10:00Z', '2026-10-13T01:10:00Z'),
    ('day17-test-note-002', v_owner, 'walden',
     '【虚构·Day17接口验证】第二次感悟：我又留下一个不同问题。',
     '2026-10-13T01:20:00Z', 2, '2026-10-13T01:20:00Z', '2026-10-13T01:20:00Z')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.favorites (owner_id, target_type, target_id, favorited_at)
  VALUES (v_owner, 'book', 'walden', '2026-10-13T01:25:00Z')
  ON CONFLICT (owner_id, target_type, target_id) DO NOTHING;
END $$;
COMMIT;
```

新增脚本执行后，在数据库控制台分别运行以下三个只读查询。预期依次为1、2、1行；同时核对用户归属、原文、日期和两条独立历史。

```sql
SELECT id, owner_id, entry_date, text, text_version, revision
FROM public.entries
WHERE owner_id = '2110018353410285570'
  AND id = 'day17-test-entry-001';

SELECT id, owner_id, book_id, body, saved_at, save_order
FROM public.reading_notes
WHERE owner_id = '2110018353410285570'
  AND id IN ('day17-test-note-001', 'day17-test-note-002')
ORDER BY save_order;

SELECT owner_id, target_type, target_id, favorited_at
FROM public.favorites
WHERE owner_id = '2110018353410285570'
  AND target_type = 'book' AND target_id = 'walden';
```

以上三条独立SELECT可用于分别核对。本次用户实际执行了等价的UNION ALL合并查询，结果截图显示共4行、三个表依次1/2/1行；不将此记录为三条独立SELECT分别执行。三个GET的公网核对留到部署完成后。
预期控制台执行成功；部署完成后再执行上一节的三个读取：entries 可见指定日期和虚构原文；notes 的 `total` 为 2、`latestNoteId` 为 `day17-test-note-002`；第一页只显示第二次感悟，第二页显示第一次原文，两条没有互相覆盖；favorites 可见 `book / walden`。若账号已有数据，total 可能更大，以指定 ID 和内容核对；若 saveOrder 唯一约束报错，整笔回滚，停下报告，不清空旧数据。

下方严格限定原文、日期与版本的单行更新已于2026-10-14执行一次，并在数据库回核通过。不要重复执行；接口跟随仍须以新GET响应核对。它只修改专用虚构记录，不触碰Day16种子或用户真实原文。

```sql
BEGIN;
DO $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.entries
  SET text = '【虚构·Day17接口验证】我在数据库控制台改了一条记录。',
      text_version = text_version + 1,
      revision = revision + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 'day17-test-entry-001'
    AND owner_id = '2110018353410285570'
    AND entry_date = DATE '2026-10-13'
    AND text = '【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。'
    AND text_version = 1 AND revision = 1
    AND adopted_analysis IS NULL AND origin IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '匹配到%行，要求恰好1条原始虚构记录，已停止并回滚。', v_count;
  END IF;
END $$;
COMMIT;
```

预期控制台成功；重新执行 `await day17Get('/api/entries')`，对应 ID 的文字变为“我在数据库控制台改了一条记录。”，`textVersion` 与 `revision` 各增加 1，`updatedAt` 改变。重新读 notes，两次感悟原文仍分别保留。这就是“修改真库一行 → 接口返回跟着变”的可见证据。不要自动删除测试数据；后续处理由你决定。

## 8. 最终验证与提交前交接

你可以在项目目录运行 `node --test cloudfunctions/reads/reads.test.js`，亲眼查看本轮本地检查输出。此前 pg 直连版本已通过19项虚构数据检查，运行环境为 Node.js 24.19.0；这是过去的本地事实，不作为 HTTPS SQL 新版本的验收结果。本轮安全诊断版已通过29项虚构数据检查（tests 29 / pass 29 / fail 0）；云端Node20.19已通过无身份HTTP启动检查；三个GET均已通过真实测试用户HTTP200及真库数据核对。


| 项目 | 当前状态／下一步证据 |
| --- | --- |
| 本地代码与响应形状 | 当前安全诊断版29项检查通过，含本机HTTP；认证服务／SQL请求使用模拟，不能当作真库验证 |
| CloudBase 真实账号认证 | 用户已报告登录200、UID一致；entries带身份链路已截图核对HTTP200，失效或无效凭证401已截图核对，跨用户隔离仍未实测 |
| 测试用户名下数据准备 | 已核对：4行，entries/reading_notes/favorites分别1/2/1；日期及正文与脚本一致 |
| 新函数代码部署 | 已创建literature-reads，状态正常、与已部署代码一致；控制台无令牌GET /api/entries返回401 |
| 三个公网路由 | 三前缀已保存；三个无Bearer公网GET均401；最新两张截图确认三个带身份GET均HTTP200，收藏完整JSON符合契约 |
| HTTPS SQL 请求、管理员凭证与只读角色权限 | 三表SELECT授权与回核通过；三GET实际数据均核对，entries改单行跟随通过；后台保持固定只读角色 |
| 当前套餐的执行超时 | 保持现有3秒配置，三个实际请求已成功；未测量精确端到端耗时，未改套餐 |
| 修改一行后接口变化、跨用户隔离 | 指定虚构日精进从原文/版本1变为新正文/版本2，SQL回核及HTTP200页面结果相符，改行跟随通过；跨用户隔离仍未验证 |
| 前端显示云端用户数据 | 独立只读day17-check.html已显示日精进、两条感悟及book/walden收藏；主React页面仍使用本地记录 |
| 截图、日终核对、提交与推送 | 两张最终截图和12文件范围已由用户确认；仅按该清单提交推送，结果以Git记录及本地日志为准 |

主任务与两张截图已完成核对，停在提交前。limit参数和游标已实现并通过本地模拟检查，公网已核对limit=20；limit=1跨页及第二真实用户隔离未实测，属于当前验证边界，不记为已通过，也不作为本日清单之外的追加工作。

## 第②板块验收记录（2026-10-13）

用户已报告用户名密码测试账号创建、登录核验通过，用户 ID 为字符串 `2110018353410285570`。用户随后在现有 PostgreSQL 控制台执行新增脚本，并提供合并查询截图：结果共4行，执行历史显示11ms。

| 数据表 | 已核对的结果 |
| --- | --- |
| entries | day17-test-entry-001，1行，2026-10-13；【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。 |
| reading_notes | day17-test-note-001与002，2行，2026-10-13；第一次感悟“我想核对自己的安排。”、第二次感悟“我又留下一个不同问题。”各自保留 |
| favorites | book/walden，1行，2026-10-13 |

四行owner_id均为该测试用户ID。截图正文列有截断；AI仅只读查看同一已执行查询的完整结果文本，确认三段虚构正文与新增脚本一致，未再次执行查询或修改数据。

上述结果验证了数据库中测试数据的归属与内容。三项GET尚未部署，没有函数真实身份联调、函数直连数据库或改一行后接口变化的证据；现有前端仍未接入。本板块完成后停下等“进入下一板块”，再进入第③板块部署。

## 第③板块连接路线选择与历史（2026-10-14，继续 Day 17）

用户提供数据库配置截图：共享集群运行中、PostgreSQL17.11，内网地址显示“—”，外网IPv4地址只有“开启”入口。当前尚无可填写PGHOST的协议直连地址。实例ID不是连接主机，也不能未经核对当作数据库名称。

**决定前的事实：** 当时已有代码与 reads.zip 为 pg 协议直连方案，尚未创建读取函数。由于没有已核对的连接主机，当时向用户列出下列两路，未开启外网、重置密码或改套餐：

- A：保留现有代码，先核对协议直连所需网络开通、数据库账号、TLS和费用／访问限制。截图不能证明必须升级独享，也不能证明开外网免费。没有开启外网或重置密码。
- B：改用 CloudBase 官方 HTTPS 参数化 SQL 接口，只改函数连接适配层，保留三个 GET、SQL 占位符、用户归属与表结构；重新验证和打包，由用户配置仅供后端使用的管理员凭证。请求固定只读角色 `cloudbase_read_only_user`，不允许客户端传 SQL、角色或管理员密钥。

**用户当前决定：已选 B。** 本轮改用 `db.js` 适配 HTTPS SQL，移除 pg 生产依赖，将打包根文件增加到七个；当前部署配置只需 `CLOUDBASE_ENV_ID`、`CURSOR_SECRET`、`CLOUDBASE_APIKEY`。前述 A 不再是当前执行路线。旧版要求的 PGHOST／PGPORT／PGDATABASE／PGUSER／PGPASSWORD／PGSSLMODE／PGSSLROOTCERT 属于历史方案，当前不用准备；过去关于协议直连网络、数据库账号和 TLS 的核对要求不能转写为 HTTPS 新方案已经验证。

官方 SQL 接口为 `POST https://环境ID.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`，请求体 `sql/parameters/role`，成功为 JSON 数组；仅管理员可调用，普通用户令牌不能替代后端凭证。单条 CTE、JSONB 内嵌 rows 的实际返回类型与三表只读权限仍未实测，不把文档支持参数化或本地模拟通过当成当前环境已联调成功。连接层调整当时服务端Key尚待准备；其后已获用户授权完成的步骤见以下实际记录，文档不保存密钥值。

依据：[SQL接口](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)、[HTTP云函数鉴权限制](https://docs.cloudbase.net/api-reference/webv3/initialization)、[套餐能力与价格](https://cloud.tencent.com/document/product/876/127357)。按本函数在当前套餐的实际可设范围核对执行超时；代码里的8秒认证等待和8秒 SQL 等待上限不能直接当成平台允许的执行时长。


本轮上传包实际核对（2026-10-14）：reads.zip已重新生成，11306字节；七文件与当前源码逐字一致（归一化LF），启动0755，零生产依赖，不含测试/文档/配置/真实凭证。用户上传时重新选择此新包。

## 第③板块实际部署与启动检查记录（2026-10-14）

用户原话先授权「允许调用电脑使用网站cloudbase，帮我操作」，确认服务端Key创建后，又选择函数名「literature-reads」，并回复「进入下一板块」推进提交创建和启动核对。账号和虚构数据SQL仍由用户此前人工完成，本节记录的是代理获授权后实际执行的页面操作。

- 同一ritchie环境已创建HTTP云函数literature-reads，资源标识lam-fb1jcmvh。Node.js20.19、监听9000、内存256MB、初始化65秒、执行超时3秒；未升级套餐、开VPC或固定出口IP。
- 当前reads.zip已上传，包含db.js等七个运行文件。云端编辑器自动解压后显示未部署改动；代理没有编辑云端源码，点击部署并确认$LATEST后，函数状态正常，代码页显示「与已部署代码一致」。云编辑器自己的工作区辅助文件不记作本地代码改动。
- 后端三必填配置已提交：当前环境ID、32随机字节生成的分页密钥、选择器关联的服务端Key。Key控制台显示到期2026-11-13 10:44:55；文档和日志不存明文。启动检查只能证明配置通过程序的格式要求，不能证明SQL管理权限。
- 仅一次控制台HTTP测试：GET /api/entries，不带Bearer、不带请求体，实际HTTP401，Body为 {"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"请使用注册用户的登录凭证。","retryable":false}}。401是无登录凭证的预期结果，证明进程启动、监听和该路径的身份检查已执行。没有用真实用户令牌，未调用另外两个读取路径或SQL接口。
- 日志页要求确认服务条款及日志付费模式后开通，本步未开通。控制台测试附带的SearchClsLog查询提示ResourceNotFound.TopicNotExist；它是日志查询失败，同次HTTP响应已返回上述401。没有取得实际启动日志，不将HTTP验证写成日志验证。测试结束后关闭测试面板，日志查询提示已清空，没有保存额外测试模板。
- 该启动检查结束时公网路由未配置，管理员Key只读权限、身份服务联调、CTE/JSONB真实返回、3秒内完整认证加SQL、数据库改行后的接口变化以及前端云端数据显示仍未验证。本节不是当天全部完成或最终截图的证据。

可亲眼核对：[已部署函数详情](https://tcb.cloud.tencent.com/dev?envId=ritchie-d5gd1dg1yd29783e8#/scf/detail?id=literature-reads&NameSpace=ritchie-d5gd1dg1yd29783e8&tab=scf-code)。应见函数名literature-reads、「正常」及「与已部署代码一致」。本步结束停下，下一小步仍属第③板块的网关路由配置。

## 第③板块三条网关路由与无身份公网检查（2026-10-14）

用户原话「确认保存三条路由」。在可审查的表单配置准备完成后，代理按此确认保存三条；现有/api/health仍关联literature-health，未编辑其配置。

实际公共网关为 https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com ，从控制台现有链接读取并核对，未拼猜。三条新路由均启用、关联HTTP云函数literature-reads、跨域设置开、路径透传开、网关前置身份认证关。函数自身的Bearer身份核验继续执行，没有放开私人数据读取。

| 保存的触发前缀 | 实际公网无Bearer GET | 实际返回 |
| --- | --- | --- |
| /api/entries | [打开日精进](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/entries) | HTTP401，UNAUTHENTICATED |
| /api/favorites | [打开收藏](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/favorites) | HTTP401，UNAUTHENTICATED |
| /api/books | [打开瓦尔登湖感悟](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/books/walden/notes) | HTTP401，UNAUTHENTICATED |

三次实际正文相同：{"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"请先登录再读取个人数据。","retryable":false}}。响应含application/json、WWW-Authenticate: Bearer、X-Request-Id，以及x-cloudbase-upstream-status-code: 401和Tencent-SCF_HTTP标识。公网message对应auth.js缺少Bearer分支；此前控制台测试的message另见上一节，未改写历史响应。

浏览器实际打开entries先显示CloudBase默认域名访问提示，点击一次确定访问后仍停在提示页；未反复点击、改网关或改代码。后续直接读取公网HTTP响应，受限环境首次域名解析失败；获得外部网络执行批准后，三次均返回上述401。因此本次证据是公网HTTP响应和保存后的路由表，不是浏览器内联JSON或登录成功数据截图。

实际响应带Content-Disposition: attachment。官方说明默认域名对浏览器导航显示中间页、对其他请求添加附件下载响应头；当前页面现象与该机制相关，但没有仅凭响应头断言按钮停留的全部原因。[默认域名访问限制及中间页](https://docs.cloudbase.net/service/alias)

当前不新增或购买自定义域名、不尝试去除平台提示；这些不属于本步授权。三个401只证明公网路由能到达函数及缺少身份时的契约响应，不证明真实用户身份服务、SQL管理员Key/只读角色权限、数据库JSONB结果、完整带身份请求在3秒内返回、分页、跨用户隔离、改一行跟随或前端接入。下一步仍需进入第④板块独立验证；本步完成后停下等「进入下一板块」。
## 第④板块首条带身份GET失败与只读排查（2026-10-14）

用户先报告「登录 200，UID 一致」，随后提供首条GET /api/entries?limit=20控制台截图。实际HTTP500，正文为 {"ok":false,"data":null,"error":{"code":"INTERNAL_ERROR","message":"读取失败，请核对服务端配置或稍后重试。","retryable":false}}。没有读取到数据，不能记为首条真库读取通过；另外两个GET、分页、改一行和前端仍未验证。

对当前部署源码的只读核对：这条精确message只来自db.js的SQL服务非成功HTTP分支；retryable:false表明上游非2xx、状态低于500且不是429。按当前部署代码一致的执行顺序，authenticate已完成，进入真实SQL调用；尚未进行SQL成功数据/JSONB解析。具体上游状态和错误正文现已被代码丢弃，不能凭此次500断言是无效密钥、权限不足、SQL或字段错误，也不是本地limit参数校验失败。[官方SQL接口的错误分类](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)

代理获既有CloudBase网站操作授权，在同环境SQL编辑器以现有管理员控制台会话执行一次只读权限元数据SELECT，未读取额外用户记录、执行SET ROLE或任何写入/授权。完整查询在执行前从编辑器读回逐字一致，执行历史15ms，结果3行：

| 表 | readonly_role | role_exists | row_security |
| --- | --- | --- | --- |
| entries | NULL | false | false |
| favorites | NULL | false | false |
| reading_notes | NULL | false | false |

这说明当前SQL会话所在集群的pg_roles没有cloudbase_read_only_user这一精确角色。查询中schema_usage/can_select为false来自角色缺失的CASE分支，不代表已经存在该账号而只缺GRANT。尚不能据此独立证明HTTPS SQL执行服务采用同一会话角色映射，或本次500必由角色缺失引起。没有全量列共享集群角色、盲建角色、授予权限或改用cloudbase_postgres绕过。[PostgreSQL权限查询函数](https://www.postgresql.org/docs/17/functions-info.html)

该排查时点拟定下一步（当时未批准、未执行；其后已获用户同意，实际进度见下一节）：仅在现有失败提示文字中增加SQL上游HTTP状态与官方错误代码白名单，不返回原始message/details/SQL/参数/密钥；保持ok/data/error封套、现有业务error字段、用户身份、固定只读role、三条SQL和表结构。重新部署同一literature-reads后，只重试首条用户读取一次，以取得明确分流证据。待用户同意后才修改代码，不开通付费日志或改变权限。
## 第④板块安全诊断已修改并部署，待用户执行一次复核（2026-10-14）

用户明确回复「同意补充安全诊断」，范围仅为现有错误提示增加SQL服务HTTP状态及官方错误代码，重新部署同一literature-reads，并再验证日精进GET一次；不改数据库权限或读取身份。

本次db.js仅调整SQL上游非成功响应的错误提示：状态限定为整数100–599，否则UNKNOWN；只接收固定白名单的code，其它或非JSON统一UNCLASSIFIED。只读取错误对象的code用于精确匹配，不回显message/details/requestId、SQL、绑定参数、用户ID或凭证。响应顶层仍ok/data/error，error仍code/message/retryable；error.code保持INTERNAL_ERROR，retryable原判断保留，SQL与cloudbase_read_only_user角色未变。[CloudBase SQL错误分类](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)、[PostgreSQL 17错误码](https://www.postgresql.org/docs/17/errcodes-appendix.html)

以下仅为本地模拟的诊断形状示例，400/DATABASE_42704尚不是当前真实SQL服务返回，不能据此认定故障原因：

```json
{"ok":false,"data":null,"error":{"code":"INTERNAL_ERROR","message":"读取失败（SQL 服务 HTTP 400，错误代码：DATABASE_42704），请核对服务端配置。","retryable":false}}
```

本地实际检查：29项、29通过、0失败，全部上游虚构。第一次受限运行21通过/8失败，八项均因本机回环连接EACCES被阻止；获外部执行批准后同套29项全部通过，未改测试来掩盖失败。三项新增检查覆盖固定代码提取、未知/非JSON安全降级、HTTP三键与错误字段/日志不泄露虚构内部哨兵。不能当作真实SQL成功或Node20云端读库证据。

部署包重新生成并读回核对：11737字节、七个根文件逐字匹配当前源码，启动LF/0755；不包含测试、凭证、配置或日志。SHA256为a30af37f2092c82ede7044e2585efcd0af96219bba7a8b82c2de69786e392d1e；此前11306字节包属上一步历史。

实际云端操作：进入既有literature-reads（lam-fb1jcmvh）上传代码入口，选择当前reads.zip（UI11.7kB），点击部署并确认$LATEST一次。完成后函数状态正常、显示「与已部署代码一致」，上传选择已重置。未重建函数、改网关、运行时、端口、超时、环境变量、流量或其他资源，未开日志。在线编辑器自动重新解压后保留七个运行文件及其工作区辅助目录；代理没有在云端编辑源码或执行终端命令。

现在用户在保留day17Token/day17Get的公网标签页Console只执行一次：

```javascript
await day17Get('/api/entries?limit=20');
```

不刷新这个凭证标签页，因为刷新会清空临时变量；CloudBase函数详情页可以刷新查看部署状态。截图只显示地址栏、HTTP及JSON，不包含凭证输入框或请求头。若仍500，应取得新的安全HTTP状态/错误代码；若401说明用户凭证需重新核验；如果仍是旧提示，先报告，不连续重试。当前尚未收到此一次复核的实际返回，不能将安全诊断部署记为读取修复成功。首条读取、另两GET、真库改行、页面接入和当天最终截图仍未通过或完成。
## 第④板块安全诊断复核与实际角色权限核查（2026-10-14）

用户提供新的浏览器截图：GET /api/entries?limit=20 仍HTTP500，error.code仍INTERNAL_ERROR，message实际为「读取失败（SQL 服务 HTTP 400，错误代码：DATABASE_42501），请核对服务端配置。」，retryable:false。这是实际返回，证明新诊断部署生效；CloudBase将DATABASE_42501归为权限不足，PostgreSQL SQLSTATE42501为insufficient_privilege。真实读取仍未通过。证据为用户上传的codex-clipboard-7c554a73-084f-413e-a3b2-0b2eb568ed75.png；不含用户令牌或请求头。[CloudBase错误分类](https://docs.cloudbase.net/en/http-api/pgdb/exec-pgsql)、[PostgreSQL错误码](https://www.postgresql.org/docs/17/errcodes-appendix.html)

只读核查修正了前一次无后缀角色查询的解释：控制台「角色」中的受保护系统角色实际名为cloudbase_read_only_user_postgres_gbu0fd7s。前一次精确查询无后缀cloudbase_read_only_user得到NULL，只能证明该无后缀名称不在pg_roles，不能据此认定平台只读角色缺失或需要建角色。HTTP请求仍按官方契约使用无后缀role，不改变请求角色。控制台过滤后的「未找到匹配结果」属于用户角色区；系统角色区仍显示带后缀的目标，不能误读为空列表。

随后在既有管理员SQL控制台会话执行一次只读权限元数据SELECT：执行前将编辑器完整语句读回逐字一致，历史12/20、本次11ms、结果3行。数据库名postgres-gbu0fd7s；精确查询实际带后缀的角色。结果如下：

| 表 | role_exists | schema_usage | can_select | row_security |
| --- | --- | --- | --- | --- |
| entries | true | true | false | false |
| favorites | true | true | false | false |
| reading_notes | true | true | false | false |

可以确认当前实例只读角色缺三表读取权限。这与实际42501一致，是最小修复方向；尚未取得授权后的SQL服务成功，不能提前标记为已修复。没有执行SET ROLE、GRANT、CREATE ROLE、数据写入、开启RLS、改表或改云函数。

拟执行语句（仅计划，等待用户明确确认，不是执行记录）：

```sql
GRANT SELECT ON TABLE public.entries, public.reading_notes, public.favorites
TO cloudbase_read_only_user_postgres_gbu0fd7s;
```

这会让现有服务端只读角色能读取三张指定表的行；公网接口仍依照可信登录身份限定owner_id。不给anon/authenticated/PUBLIC新增权限，不授予INSERT/UPDATE/DELETE，不扩大到所有表或未来表，不创建角色或修改函数的SQL服务role，不改变网关与表结构。若用户批准，先仅执行这一授权小步并读回权限结果；真实带身份GET仍由用户用自己本机凭证再次核验，不在此刻连续请求或继续其它板块。

## 第④板块三表 SELECT 授权已执行，真实 GET 待复核（2026-10-14）

用户在看到精确三表和实例只读角色的授权语句后，明确回复「同意执行」。代理在同一ritchie环境、postgres-gbu0fd7s数据库的既有SQL控制台会话中，只执行以下授权一次；执行前完整编辑器内容读回与已确认语句逐字一致。

```sql
GRANT SELECT ON TABLE public.entries, public.reading_notes, public.favorites
TO cloudbase_read_only_user_postgres_gbu0fd7s;
```

控制台历史13/20，耗时6ms，显示「查询成功」「未返回任何数据」；最初「影响了0行」是权限语句没有返回业务行，不等于授权失败。随后执行一次只读权限回核，完整编辑器读回一致，历史14/20、12ms、返回3行：

| 数据表 | 可读取（SELECT） | 可写入（INSERT、UPDATE、DELETE 中是否有任一权限） |
| --- | --- | --- |
| entries | true | false |
| favorites | true | false |
| reading_notes | true | false |

本步证据证明既有后台只读角色已经能读取指定三表；不能直接当作真实带身份接口成功。没有建角色、授予其它表或未来表、schema/序列/成员关系/GRANT OPTION，也未向anon、authenticated或PUBLIC授权。表结构、业务记录、现有RLS、云函数源码与HTTP请求role保持；用户归属继续由现有参数化SQL绑定已验证的owner_id。

本轮没有改代码、重新打包或部署，也没有带真实用户凭证调用GET。用户可在控制台当前结果查看三个true/false；页面已保留。下一次人工核验仍仅执行原entries请求：保留登录凭证和day17Get的公网标签不要刷新，在Console运行await day17Get('/api/entries?limit=20')一次；预期HTTP200、ok:true、error:null，data.items包含day17-test-entry-001，原文为「【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。」，日期2026-10-13。这是此前独立入库的虚构验证记录，不是用户实际经历。若非200、空列表或指定记录缺失，先报告实际结果，不继续其它GET或增加权限。若凭证过期或变量丢失，仍由用户在本机重新登录核验，不将凭证发送到聊天。

部署说明和接口契约已记录本步权限成功，本地日志已续写；真实entries读取、另两GET、改一行跟随、页面接入和最终截图仍未通过或完成，不提交或推送。

## 第④板块首条 entries 真库读取已核对通过（2026-10-14）

用户在自己的浏览器执行await day17Get('/api/entries?limit=20')后提供codex-clipboard-59f5118f-05d0-4ab5-8414-c9537cc5c346.png。截图中的前一个折叠ok:false是旧请求；本次命令后的实际响应为HTTP200，顶层ok:true/data对象/error:null。指定真库虚构记录如下，原文和2026-10-13日期保持，与既有独立数据准备和契约第4.2节一致：

```json
{"ok":true,"data":{"items":[{"id":"day17-test-entry-001","entryDate":"2026-10-13","text":"【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。","textVersion":1,"revision":1,"createdAt":"2026-10-13T01:00:00.000Z","updatedAt":"2026-10-13T01:00:00.000Z","adoptedAnalysis":null,"origin":null}],"total":1,"page":{"limit":20,"nextCursor":null,"hasMore":false}},"error":null}
```

这是从真实数据库读出的虚构测试内容，不是用户实际经历。此一次成功证明本测试用户在当前entries链路中通过身份核验，服务端SQL得到数据，CTE/JSONB及字段映射成功；只补三表SELECT授权后，同一请求由42501失败变为200。本次没有改函数代码、响应字段、表结构或业务数据，没有重跑seed。截图未含完整地址栏/响应头，不能替代当天最终含地址栏的GET和页面两图；未测量请求耗时，不宣称具体3秒用时。

本次只验证limit=20及单记录末页形状，不证明不同limit的条数变化或跨页。notes/favorites真实成功、跨用户隔离、无效身份、改单行后接口跟随、前端接入仍未验证。修改真库脚本尚未执行。当前小步结束并停止，等用户「进入下一板块」后仅核对读书感悟GET；不自动连续执行其他请求或收尾提交。
## 连续核验用的独立只读页面（2026-10-14）

用户最新原话：「进入下一板块，直接帮我完成今天，允许调用我的电脑，直接完成核验我来截图即可」。本次可连续推进Day17剩余核验；Git提交仍需先核对具体文件清单。不提前业务写入或改表。

已新增my-app/day17-check.html，沿用现有界面风格，提供真实数据与真实JSON两视图，以及三GET、感悟limit1跨页和entries前后变化核对。现有React页面仍使用原本本地记录流程；本页不将云端记录写入IndexedDB，也不新增用户名密码登录接口。静态语法、DOM唯一性、必要控件与初始禁用状态检查已通过，真实页面读库尚未执行。

本机打开http://127.0.0.1:4173/day17-check.html；它的页面地址是本地地址，实际请求的三个GET仍使用已部署的公网网关。不能把localhost页面地址称为公网GET地址。用户最终截图需含地址栏及明确的公网请求地址/HTTP/实际JSON；数据图需显示真库中的虚构验证内容。该页不是默认域名的认证跳过工具，也不改变接口登录验证。

页面需要已有短期access_token。只在页内password输入，点「临时准备凭证」后立即清空隐藏输入，凭证仅闭包内存，刷新/关闭清除。不得粘贴管理员Key、账号密码，不把凭证发到聊天。初始不发请求。点「读取三个接口」后顺序读取三GET，失败则停止；limit1分页按钮使用实际返回游标；首次entries成功作为改行前基线，重新读取对比实际变化。

当前工具仅能接管Codex内置浏览器，不能接管用户Chrome/Edge；用户报告已准备凭证，随后确认是在Chrome/Edge，Codex两张核验页可见状态仍为未准备。需要在可接管页面准备同一已有凭证，才能由代理连续完成剩余GET/改行/截图准备。此时未代发带身份请求，也未执行UPDATE，不把页面制作或准备报告当作真库验证通过。


## 核验页的网络限制与当前停点（2026-10-14）

用户已在Codex核验页准备凭证，格式确认是access_token单行字符串。读取三个接口时，第一个entries请求在浏览器网络层失败，未取得HTTP响应；后两个请求没有发出。先前用户截图中的entries HTTP200仍有效，此次失败不能证明数据库或登录验证又出错。

本机无凭证诊断取得跨域预检204及GET 401，响应头允许本地核验来源及Authorization。内置浏览器直接打开公网主机报告ERR_BLOCKED_BY_CLIENT。随后尝试加入本机固定三GET转发，但未完成转发的真实请求验证；浏览器工具进一步明确以URL策略拒绝访问核验页，提示不允许的协议。已停止受阻的浏览器操作并撤回该转发，vite.config.js恢复原配置；不通过其他通道绕过拦截。day17-check.html保留单行凭证格式检查和原有直接公网读取。

当前等待用户确认核验页地址栏与可见准备状态，未读取凭证内容。notes/favorites真实成功、limit跨页、控制台改一行后跟随、页面成功显示及最终截图仍未完成。没有执行UPDATE、改权限、重新部署、暂存、提交或推送。


## 核验页收到真实身份拒绝响应（2026-10-14）

用户截图codex-clipboard-83a8b068-5d28-4099-b60e-e5c263d9c6fd.png显示凭证已临时准备，并执行了读取。GET /api/entries?limit=20收到HTTP401，错误代码UNAUTHENTICATED，提示「登录凭证无效或已过期，请重新登录。」页面停止后续读取，阅读感悟显示未读取。截图不含凭证，也未展示完整JSON；不据此推断具体是过期、撤销还是内容错误。

对照现有auth.js第39–40行，该提示来自CloudBase身份核验返回400/401/403的分支；请求尚未进入SQL读取。此次证据说明用户操作的核验页已经能收到应用响应，不再是此前无HTTP状态的网络失败；不证明代理的浏览器工具限制已解除。此前entries成功截图继续作为历史成功证据，notes/favorites及剩余核验仍待完成。

下一动作：用户按本说明第6.1节原有流程重新登录，确认登录HTTP200及UID一致，再用新access_token替换核验页旧凭证并读取三GET。页面上的「凭证已临时准备」只是本地准备状态，不等于服务端登录验证成功。此轮没有改代码、权限或数据库，没有重新部署、提交或推送。


## 单条虚构记录更新与数据库回核（2026-10-14）

用户继续授权「允许控制电脑，帮我完成验证」。原CloudBase SQL控制台仍能操作，代理没有再次访问受阻核验页。先SELECT核对day17-test-entry-001：owner为2110018353410285570，日期2026-10-13，原文「【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。」，text_version/revision均1，updated_at显示2026-10-13 09:00:00+08，analysis/origin均NULL。

按第7节收紧后的事务执行一次UPDATE。执行前通过编辑器可见前后段逐字拼合，573字符与计划SQL一致；仅匹配原owner/id/日期/原文/版本1及两个NULL，非恰好1行则抛错回滚。控制台显示查询成功、未返回任何数据、13ms。DO块没有返回业务行，不能仅凭界面的影响0行判定失败；另一次SELECT返回唯一记录，确认更新已持久化：

| 字段 | 修改前 | 数据库修改后 |
| --- | --- | --- |
| text | 【虚构·Day17接口验证】今天读完一页，我暂时记下一个问题。 | 【虚构·Day17接口验证】我在数据库控制台改了一条记录。 |
| text_version / revision | 1 / 1 | 2 / 2 |
| entry_date | 2026-10-13 | 2026-10-13 |
| updated_at（控制台显示） | 2026-10-13 09:00:00+08 | 2026-10-14 16:39:45+08 |
| adopted_analysis / origin | NULL / NULL | NULL / NULL |

随后仅读取同一测试用户两条感悟及book/walden收藏：返回3行，两条原感悟正文和save_order1/2均保留，收藏仍存在。没有修改notes或favorites，没有改表、权限或业务写接口。

用户报告重新登录HTTP200且UID一致，尚待替换核验页凭证后的实际响应。只有GET随后返回相同新正文与版本2，才算完成「改一行后接口跟着变」。核验页若重新准备凭证后第一次读到版本2，其内存对比基线也是2；可与先前用户HTTP200截图中的版本1及本节数据库证据对照，不制造假的页面基线。当前没有新GET证据、最终截图或Git提交。


## 公网读取与改单行跟随成功截图（2026-10-14）

用户提供codex-clipboard-2743ba7d-f2a6-449b-8a32-ec664f663002.png，地址栏为本地核验页127.0.0.1:4173/day17-check.html；页面列出真实公网请求地址。不可将本地页面地址记成公网API地址。

- entries明确HTTP200，记录day17-test-entry-001，新正文「【虚构·Day17接口验证】我在数据库控制台改了一条记录。」，entryDate2026-10-13，textVersion2/revision2，筛选总数1、本次1条、limit20。结合此前用户HTTP200截图的原文/版本1，以及本轮控制台唯一UPDATE和SELECT回核，可认定「改真库一行→GET返回变化→页面显示变化」通过。
- notes明确HTTP200，可见note002的新近条目原文「【虚构·Day17接口验证】第二次感悟：我又留下一个不同问题。」，saveOrder2/revision1，保存时间2026/10/13 09:20:00（上海）；下方露出第一次感悟开头。完整001正文、total/latestNoteId及收藏明细在本图范围之外，尚未逐字段核对。
- 总提示为「三个公网GET均读取成功，页面内容来自这三次实际返回」。只读复核页面代码：该提示仅在三次顺序请求全部为2xx、恰好ok/data/error三键、ok=true/error=null及基本列表分页结构有效时出现，失败会停止。可支持三请求均成功封套，不能单凭此提示断言favorites精确200、非空book/walden或所有业务字段正确。

本图显示真库中的明确虚构测试内容，不能记作用户实际经历。页面左侧有裁切，收藏与完整JSON未入图；最终应补完整数据视图与JSON视图，保留地址栏和可读的公网请求地址。当前没有limit1跨页或第二测试用户隔离的新证据，不把数据库SELECT替代这些接口测试。没有再修改代码、数据、权限、部署或Git。


## Day17最终两图与完成标准核对（2026-10-14）

用户本轮提交：

1. codex-clipboard-6719d6d6-6e25-440a-8c26-2f8ce3a2bfa9.png：含地址栏及三个公网GET地址，entries/notes/favorites均明确HTTP200。entries为指定新正文、日期2026-10-13、textVersion2/revision2、总数1。notes完整保留两个虚构原文，002在前/001在后，saveOrder2/1、revision均1，total2、本次2条、limit20、latestNoteId002。收藏显示book/walden。
2. codex-clipboard-ace12912-41d6-45f9-932a-d284e8d9a618.png：收藏GET实际公网地址和HTTP200，完整JSON顶层恰为ok/data/error；ok=true、error=null、items只有targetType=book/targetId=walden/favoritedAt=2026-10-13T01:25:00.000Z，total1，page.limit20/nextCursor=null/hasMore=false。右下角截图提示没有遮挡关键JSON。

两图地址栏均为本地核验页，图内列出已部署的公网请求地址；这是本地页面展示真实公网响应，不声称公开部署了该核验页面或主React已经接库。测试正文明确标注虚构，数据真实存储在数据库中。

| 本项目Day17完成标准 | 状态 | 证据 |
| --- | --- | --- |
| 核心表、记录表及收藏GET已部署并读到真实数据库数据 | 已完成 | 三个带身份公网GET均200，条数1/2/1，与数据库记录一致 |
| 统一ok/data/error且SQL参数化 | 已完成 | 服务实现、29项本地检查、原entries JSON及本次完整收藏JSON |
| 控制台改一行，接口和页面返回跟着变 | 已完成 | 更新前entries原文/版本1截图、受限UPDATE和数据库回核、更新后HTTP200新正文/版本2及原日期 |
| 页面数据及GET返回截图 | 已完成 | 本轮两图；完整数据视图和收藏JSON，含地址栏及公网请求地址 |
| 契约标记、部署与验证步骤 | 已完成 | api-contract.md三条GET状态及本文 |
| 提交并推送 | 未完成，等待文件清单确认 | 当前未暂存、未提交、未推送 |

今天学到的字段适配：数据库entry_date对应接口entryDate，感悟的五个summary_*列需组合为summaryLink。发现方法是逐列对照建表SQL和契约，再核对实际响应；不通过改表凑字段。

limit参数已实现，本地模拟包含limit1与跨页保护，公网截图显示limit20；真实limit1跨页、第二用户隔离未执行，不夸大覆盖范围。当前代码未新增业务写入接口，schema.sql/seed.sql未改。

提交前文件清单（以下12个文件均属Day17，等待用户确认）：

| 文件 | 用途 |
| --- | --- |
| .gitignore | 忽略Day17上传包与部署依赖 |
| api-contract.md | 三GET实现状态、字段约定与验证证据 |
| deploy-day17.md | 数据来源、部署步骤、真库验证与收尾记录 |
| day17-check.html | 只读核验页、实际JSON/数据、分页与前后对比控件 |
| cloudfunctions/reads/index.js | HTTP读取入口与统一响应 |
| cloudfunctions/reads/service.js | 参数化SQL、字段映射、筛选和分页 |
| cloudfunctions/reads/auth.js | 真实用户身份核验 |
| cloudfunctions/reads/db.js | 固定只读SQL服务连接与安全诊断 |
| cloudfunctions/reads/reads.test.js | 29项本地验证 |
| cloudfunctions/reads/package.json | 读取函数运行配置 |
| cloudfunctions/reads/scf_bootstrap | 云函数启动入口 |
| cloudfunctions/reads/package.py | 生成不含秘密的部署包 |

_logs/、reads.zip、dist/、.env和密钥不提交。vite.config.js已恢复；12项较早的前端/依赖改动所属日期未确认，排除本次提交。拟提交标题：Day 17｜部署并验证三项真实数据读取接口。说明两行：改了什么：统一读取响应并更新接口契约和验证记录。加了什么：三个只读接口、真实身份核验、参数化查询及核验页面。


## 提交范围确认（2026-10-14）

用户对精确12文件清单、Day17归属、提交标题和两行说明明确回复「确认」。仅提交本说明列出的12个文件；此前前端与依赖改动保持未暂存，不包括日志、ZIP、dist或秘密配置。本节为提交前确认记录；提交哈希和推送完成状态由后续Git历史与本地日志记录，失败时如实报告。

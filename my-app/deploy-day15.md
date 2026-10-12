# Day 15｜CloudBase 部署与验证

项目：文学与内心冲突。本文提供部署与验证步骤；实际完成状态见下方进度记录。

## 当前进度（2026-10-12）

- 已核对环境：ritchie，环境ID为ritchie-d5gd1dg1yd29783e8，上海体验版；截图到期时间为2027-04-09 23:59:59。额度以交图时控制台实际显示为准。
- 已创建并部署literature-health，运行时Node.js20.19，端口9000。已验证公网GET返回200及精确JSON，用户浏览器也已看到JSON。
- 健康检查地址：[GET /api/health](https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com/api/health)。
- 前端已构建，云端根目录已见index.html和assets/。实际静态站点域名、资源加载、浏览器渲染与同伴手机验证仍待完成。
- api-contract.md共有20项接口：health已实现，其余19项是未来占位，契约草案仍待用户核对。
- 按用户最新要求，剩余步骤一次性提供，截图集中在最终验收。提交仍须先列文件及任务归属，等用户确认后执行。

## 1. 今天交付什么

- HTTP 云函数：只实现 `GET /api/health`，无数据库、业务逻辑或 AI 调用。
- 前端：现有第 2 周 React mock 页面，构建后上传静态托管，不接后端、不处理跨域。
- 契约：`api-contract.md`，业务接口只登记未来占位。

成功应为 HTTP 200，响应类型为 `application/json; charset=utf-8`，正文精确如下：

```json
{"ok":true,"service":"【literature-and-inner-conflict】"}
```

`【】` 是用户指定的字符串内容。健康检查只能证明该 HTTP 服务响应正常，不能证明数据库或业务接口可用。

## 2. 环境与文件准备

注册、实名认证、开通环境、选择套餐、控制台点击、手机验证和截图由你操作。我负责文件与说明。

如果还没有 CloudBase 环境，先完成附录 M。本对话没有提供附录 M，不能声称已按其完成。环境名称、地域和套餐由你确认，以控制台实际费用与有效期为准。

登录 [CloudBase 控制台](https://tcb.cloud.tencent.com/)，选择实际开通的环境。核对环境 ID，截图显示剩余额度、到期日期的页面；不把账号密码或管理密钥写入项目。

本次相关文件：

```text
my-app/
├── cloudfunctions/
│   ├── health/
│   │   ├── index.js
│   │   ├── package.json
│   │   ├── scf_bootstrap
│   │   └── package.py
│   └── health.zip          # 生成的上传包，Git 忽略
├── dist/                   # 前端生成目录，Git 忽略
├── deploy-day15.md
└── api-contract.md
```

## 3. 准备云函数上传包

**位置与原因：** 云函数接收公网请求；先验证最小 health 服务，确认公网链路打通。

使用 Node.js 自带 HTTP 模块，无第三方依赖，不需要为函数运行 npm install。CloudBase HTTP 云函数需要监听 `0.0.0.0:9000` 并由启动文件启动。[编写 HTTP 云函数](https://docs.cloudbase.net/cloud-function/develop/how-to-writing-functions-code)

本包按 **Node.js 20** 运行时准备，启动文件如下：

```bash
#!/bin/bash
cd "$(dirname "$0")"
exec /var/lang/node20/bin/node index.js
```

控制台运行时必须与启动文件一致；这里不声称 Node.js 20 是最新版本。若下拉框没有该版本，先提供可选版本，确认修改后再重新打包。

`scf_bootstrap` 必须没有扩展名、使用 LF 换行和执行权限，并使用对应运行时的绝对路径。[启动文件说明](https://docs.cloudbase.net/cloud-function/develop/scf-bootstrap)

重新打包时，在 Windows PowerShell 运行：

```powershell
cd "E:\vibe coding\my-app"
python .\cloudfunctions\health\package.py
```

本机已发现 python。换电脑后如命令不存在，先停下告知。此脚本只打包三个运行文件，统一 LF，写入 Linux 0755 启动权限；不上传打包脚本。生成包为 `my-app/cloudfunctions/health.zip`。

打开 ZIP，顶层应直接有 `index.js`、`package.json`、`scf_bootstrap`，不能多套 health 文件夹。官方控制台说明要求打包项目文件本身。[Node.js HTTP 云函数快速开始](https://docs.cloudbase.net/cloud-function/quickstart/httpfunc/nodejs)

## 4. 你操作：上传 HTTP 云函数

1. 选择同一 CloudBase 环境 →「云函数/托管」→「新建云函数」→「通过代码包创建」。
2. 选择 **HTTP 云函数**；本代码监听端口，没有事件函数的 exports.main 入口。
3. 使用用户已确认的名称 **literature-health**。运行时选 **Node.js 20／20.19**。
4. 选择「本地上传／上传代码包」，上传 `cloudfunctions/health.zip`。
5. 核对顶层三个文件，监听端口填9000，关闭自动安装依赖，再点击创建。不需要数据库、AI密钥或环境变量。
6. 进入函数详情，如显示“有未部署的改动”，点击“部署”；等待提示“与已部署代码一致”、状态“正常”，再做公网验证。

界面名称可能变化，以实际 HTTP 云函数入口为准。函数详情的控制台网址不是接口公网地址。

## 5. 你操作：配置 health 公网访问

网关把公网请求送到函数；路径透传让代码收到原始 `/api/health`。

1. 同一环境进入「HTTP 网关」→「域名及路由」，在默认域名这一行点击「添加该域名路由」。
2. 关联资源左侧选择「云函数」，右侧选择用户已创建的literature-health。
3. 域名选择控制台实际提供的测试默认域名；直接复制，不根据环境 ID 拼猜域名。
4. 触发路径填写 **`/api/health`**。
5. **开启路径透传**。关闭时，网关可能剥掉触发前缀，代码收到 `/` 后会返回 404。
6. 此 health 路由的**身份认证关闭**，使浏览器无需登录直接 GET。无需因此开启匿名登录或放开其他资源。
7. 保存，等待配置生效，再验证。今天不配置跨域，不增加 OPTIONS 处理或前端调用。

配置依据：[通过 HTTP 访问云函数](https://docs.cloudbase.net/service/access-cloud-function)、[HTTP 网关概述](https://docs.cloudbase.net/service/introduce)、[网关身份认证](https://docs.cloudbase.net/service/authentication)。

## 6. 你操作：浏览器验证 health

1. 复制路由完整公网地址，末尾应恰好有一次 `/api/health`；只有域名时再补路径。
2. 新标签页打开，例如 `https://你的实际网关域名/api/health`。示例中的域名是占位，不能直接照抄。
3. 测试默认域名第一次可能显示开发测试提示中间页，阅读提示后点击「确定访问」继续。官方通过中间页管理测试访问，不应把默认域名一概认作禁止浏览器打开。[默认域名说明](https://docs.cloudbase.net/service/alias)
4. 应看到精确 JSON：`{"ok":true,"service":"【literature-and-inner-conflict】"}`，不是 HTML、登录页或控制台内容。
5. 可按 F12 → 网络／Network，刷新，核对最终接口请求是 GET、状态 200、JSON 响应。
6. 截图保留 **公网地址栏和返回 JSON**。本地测试不能替代此公网截图。

代码对未知路径返回 404；health 路径使用 POST、OPTIONS 等方法返回 405，响应头含 `Allow: GET`。

## 7. 构建前端 mock 页面

**位置与原因：** 静态托管提供浏览器页面；上传构建完成的文件后，其他设备才能脱离本机开发服务器访问。

在 Windows PowerShell 运行：

```powershell
cd "E:\vibe coding\my-app"
npm run build
Get-ChildItem .\dist
Get-ChildItem .\dist\assets
```

应看到构建成功输出、`dist/index.html` 和 `dist/assets/` 下 JS、CSS。构建重建已有的生成目录 dist。

本机已有依赖，无需重复安装；新电脑无 node_modules 时，由你先运行 npm ci，再构建。本次验证使用本机 Node.js 24.19.0，不能仅按旧 README 推断所有测试依赖的兼容版本。

不修改前端调用 health，不处理跨域。记录与感悟仍保存在浏览器，收藏仍是会话内演示。

## 8. 你操作：上传静态托管

同一环境 →「静态网站托管」。未开通时先核对控制台费用，由你决定并点击开通。

**文件管理方式：**

1. 进入云端根目录 `/`。
2. 上传 **dist 里面的内容**：`index.html` 与整个 `assets`，保留子目录结构。
3. 核对云端根目录直接是 `index.html`、`assets/`，不能是 `/dist/index.html`。
4. 复制静态托管控制台的实际访问域名。页面域名与网关域名分别复制，不假设相同。

**若界面只有「新建部署 → 上传代码包／项目文件夹」：**

1. 上传 dist 文件夹，作为已经构建完成的静态项目。
2. 安装和构建命令留空，构建产物目录填 `.`，部署路径填 `/`。
3. 等部署完成，同样核对根目录 index.html 和 assets。

按控制台实际提供的一种入口操作。官方支持直接上传已构建的静态产物。[纯静态项目部署](https://docs.cloudbase.net/hosting/web-hosting-static)

只上传 dist 前端文件，不上传源码、node_modules、cloudfunctions、部署 ZIP、文档、日志或 .env。本项目是 `#/journal`、`#/books` 的 hash 路由；今天无需新增服务器路由回退或子目录部署配置。

## 9. 你操作：公网前端与虚构示例验证

1. 浏览器打开静态托管公网地址；如有测试中间页，确认后继续。
2. **刷新浏览器看效果**：应看到“文学与内心冲突”、首页虚构示例，以及总结与书单两个入口。
3. 打开 `公网地址/#/journal`、`公网地址/#/books` 并分别刷新，页面应继续打开。
4. 总结页选择新建日精进 → 填写虚构示例 → 保存；刷新并回看，原文与日期应保留。只用虚构文字测试。
5. 书单选择“正在重新思考怎样生活”和“尝试更简朴的生活”，查看两组推荐，打开《瓦尔登湖》。分别保存“【虚构·Day15】第一条：我想减少无意义的比较。”和“【虚构·Day15】第二条：本周安排一次不带手机的散步。”；打开“查看往期备注”，应看到第一条，第二条作为最新感悟。刷新后再核对两条原文均保留。
6. 请同伴用手机打开同一公网地址，最好用移动网络；确认标题、两个入口可见且可点击。不能用本机模拟替代同伴确认。
7. 截图保留 **公网地址栏和页面**。另保留含环境 ID、剩余额度、到期日期的控制台截图。

线上网站地址不同，localhost 的浏览器记录不会自动出现，手机也不会继承电脑记录。收藏刷新重置符合当前会话演示行为。以上操作验证的是原有 mock／本地流程，不能证明未来业务后端可用。

## 10. 报错时停下

| 现象 | 优先核对 | 处理停点 |
| --- | --- | --- |
| 启动文件不存在或启动失败 | ZIP 多套目录、.txt 后缀、LF、执行权限、运行时匹配 | 保留错误原文，说明原因并经你同意后再修 |
| health 返回 NOT_FOUND | 路径是否正好 /api/health、是否开启透传 | 保留地址与返回，确认后再改 |
| 401／403 | 本 health 路由身份认证、是否仍在中间页 | 核对该路由，不放开全部资源 |
| 前端 404、白屏或资源 404 | 根目录 index.html/assets、子目录是否完整 | 保留报错，确认后再修 |
| 前端部署受阻 | 保存完整报错与未完成状态 | 按今日降级先保住 health；由你决定继续，Day 20 前补齐 |

不循环重试同一失败操作，不以说明文件代替实际成功证据。

## 11. 验收与收尾

完成标准：health 公网 GET 返回精确 JSON；同伴手机能打开前端；仓库内有 api-contract.md，并核对契约。

三张截图：① 地址栏 + health JSON；② 地址栏 + 前端页面；③ 环境 ID + 剩余额度 + 到期日期。

未部署、未收到同伴确认与截图时，公网项仍为未验证。本地构建和 HTTP 检查只是本地证据。

你说“今天做完了”后逐项核对，列出文件及 Day 15 归属，等你确认清单后才提交推送。标题格式：`Day 15｜一句话`；说明两行分别为“改了什么 / 加了什么”。

余力加练由你选择：按入口、路由、JSON、监听端口、启动文件逐段解释云函数。

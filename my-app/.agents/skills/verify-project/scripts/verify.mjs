import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 只执行本地检查、公开静态 GET、无凭证 health GET 和 entries OPTIONS；不读取当前 .env。
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '../../../../');
const digest = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const csv = value => String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
const sameSet = (actual, expected) => actual.length === expected.length
  && new Set(actual).size === actual.length && [...actual].sort().join(',') === [...expected].sort().join(',');
const HEADER_NAMES = ['accept', 'authorization', 'content-type', 'x-client-time-zone'];
// 固定项目契约独立于待核对的源码内容，不能被注释中的旧声明反向改变。
const EXPECTED_HEALTH_SERVICE = '【literature-and-inner-conflict】';
const EXPECTED_CORS_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
// IANA IPv6 特殊用途注册表快照（2026-10-20核对）：
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// 按最长前缀优先判定，父段的不可全球到达默认值不能覆盖更具体的全球可达分配。
// 注册表的“全球可达”不保证某个地址当前有路由或 HTTPS 服务；实际连接仍单独验证。
const ipv6SpecialRules = [
  ['::', 128, false], ['::1', 128, false], ['::ffff:0:0', 96, false],
  ['64:ff9b::', 96, true], ['64:ff9b:1::', 48, false],
  ['100::', 64, false], ['100:0:0:1::', 64, false],
  ['2001::', 23, false], ['2001::', 32, false],
  ['2001:1::1', 128, true], ['2001:1::2', 128, true], ['2001:1::3', 128, true],
  ['2001:2::', 48, false], ['2001:3::', 32, true], ['2001:4:112::', 48, true],
  ['2001:10::', 28, false], ['2001:20::', 28, true], ['2001:30::', 28, true],
  ['2001:db8::', 32, false], ['2002::', 16, false],
  ['2620:4f:8000::', 48, true], ['3fff::', 20, false],
  ['5f00::', 16, false], ['fc00::', 7, false], ['fe80::', 10, false],
].map(([network, bits, globallyReachable]) => {
  const range = new net.BlockList();
  range.addSubnet(network, bits, 'ipv6');
  return { bits, globallyReachable, range };
}).sort((left, right) => right.bits - left.bits);
const PRIVATE_MARKERS = ['CLOUDBASE_APIKEY', 'CURSOR_SECRET', 'CLOUDBASE_SECRET_KEY', 'TENCENTCLOUD_SECRET_KEY'];
const DEV_MARKERS = ['/__day20-auth/', '/auth/v1/signin', '复制短期凭证', 'DEV登录'];
// 依据现有测试文件的稳定名称核对 spec 的真实通过行，不固定整个项目的测试总数。
const CRITICAL_TESTS = [
  { id: 'second-page-readback', label: '新增目标在第二页的读回', name: 'Day24 新增目标在第二页时自动读回核对，只读重试不重复 POST' },
  { id: 'post-readback-mismatch', label: 'POST201但GET不一致', name: 'POST201但GET正文不一致时不记成功，仅重新读回且草稿完整保留' },
  { id: 'auth-not-empty', label: '401不能显示空列表', name: '身份401及网络失败明确报错，不能被显示成数据库空列表' },
  { id: 'cancel-delete', label: '取消删除零请求及原文保留', name: 'Day22 虚构闭环：PATCH 保留原文对比，DELETE 取消零请求，确认后 GET 不再返回' },
  { id: 'day23-page-redaction', label: 'Day23页面错误脱敏', name: 'Day23 三类错误均显示中文并保留草稿，服务端原始异常和字段不进入页面' },
  { id: 'day23-api-redaction', label: 'Day23上游错误脱敏', name: 'Day23 客户端错误不透传上游消息、未知代码或字段，已登记字段保留安全中文' },
  { id: 'invalid-utf16-id', label: '非法UTF-16和无效ID保护', name: 'PATCH/DELETE 无效 ID、版本、未登记字段和空修改均不发请求' },
  { id: 'entry-input-types', label: '记录输入类型保护', name: '缺少记录对象、日期或非文字原文返回中文校验且不抛裸异常' },
  { id: 'note-input-types', label: '感悟输入类型及原文保护', name: '非文字感悟返回中文且不把对象或数字改写成原文' },
  { id: 'original-preserved', label: '原文保留及完整虚构流程', name: '虚构首页完整流程：原文保留、刷新跟随、409保草稿、201读回、清除私人数据' },
];
const GLOBAL_LIMITS = [
  '本地单元/流程测试包含虚构数据；通过不代表真实会话、私人数据、云端新增/修改/删除或云数据库权限已经验证。',
  '本轮不取得用户令牌，不读取私人 entries，不执行云端 POST/PATCH/DELETE，不部署、不改云配置。',
  '密钥扫描是既有规则的证据，不等于绝对没有秘密；不验证凭证有效性，不枚举被忽略文件或外部配置。',
  '构建会由 Vite 按既有配置加载本机环境；检查器不读取 .env 内容，不保存子进程原始输出或网络正文。',
  '公网请求禁用重定向、Cookie 和身份凭证；只连接解析为公开地址的 HTTPS 来源。',
];

class CheckFailure extends Error {}
function requireCheck(condition, message) {
  if (!condition) throw new CheckFailure(message);
}
function safeError(error) {
  return error instanceof CheckFailure ? error.message
    : '执行异常（' + (/^[A-Z_0-9]+$/.test(error?.code || '') ? error.code : '内部错误') + '）；未完成验证，未回显原始异常。';
}
function inputLabel(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) return '[输入已隐藏]';
  try {
    const url = new URL(value);
    return url.username || url.password || url.search || url.hash || url.pathname !== '/' ? '[含敏感部分的输入已隐藏]' : url.href;
  } catch { return '[无效输入已隐藏]'; }
}

// 公网来源先做语法校验，随后在每次连接时核对全部 DNS 答案，并固定本次连接地址。
export function isPublicAddress(address) {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(value);
  if (family === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const special = ipv6SpecialRules.find(rule => rule.range.check(value, 'ipv6'));
  if (special) return special.globallyReachable;
  return /^[23][0-9a-f]{0,3}:/.test(value);
}

export function validateOrigin(value) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.includes('*')) {
    return { ok: false, reason: '来源必须是完整、无通配符的 HTTPS 公网来源。' };
  }
  let url;
  try { url = new URL(value); } catch { return { ok: false, reason: '来源不是有效 URL。' }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (value !== url.origin && value !== url.origin + '/')) {
    return { ok: false, reason: '只允许无凭证、路径、查询或片段的 HTTPS 公开来源。' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) return { ok: false, reason: '拒绝回环、内网、链路本地及保留地址；没有向此地址发请求。' };
  } else if (!host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid)$/.test(host)) {
    return { ok: false, reason: '拒绝本机、内网或保留域名；没有向此地址发请求。' };
  }
  return { ok: true, origin: url.origin };
}

export function summarizeTests(output, exitCode) {
  const plain = String(output).replace(/\u001b\[[0-9;]*m/g, '');
  const counts = {};
  for (const label of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const hits = [...plain.matchAll(new RegExp('(?:^|\\n)[^\\n\\d]*\\b' + label + '\\s+(\\d+)\\s*(?=\\n|$)', 'g'))];
    counts[label] = hits.length ? Number(hits.at(-1)[1]) : null;
  }
  const complete = Object.values(counts).every(Number.isSafeInteger);
  const ok = exitCode === 0 && complete && counts.tests > 0 && counts.pass === counts.tests
    && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
  return { ok, counts, reason: ok ? '全部实际测试通过且无跳过/待办。' : '退出码、测试总数、失败/取消/跳过/待办或摘要完整性未满足全部通过条件。' };
}

export function criticalTestCoverage(output) {
  const lines = String(output).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
  return CRITICAL_TESTS.map(item => ({ ...item, passed: lines.some(line => {
    const match = line.match(/^\s*[✔✓]\s+(.+?)(?:\s+\([^)]*\))?\s*$/);
    return match?.[1] === item.name;
  }) }));
}

function removeHtmlComments(html) {
  return String(html).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}
function attributes(tag) {
  const result = {};
  for (const hit of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[hit[1].toLowerCase()] = hit[2] ?? hit[3] ?? hit[4];
  }
  return result;
}
function activeHtmlTags(html) {
  const tags = [];
  let templateDepth = 0;
  let rawTag = null;
  const rawTags = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
  // 忽略注释、template 以及原始文本元素中的伪标签；只处理浏览器会解析为活动元素的标签。
  for (const hit of removeHtmlComments(html).matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag = hit[1].toLowerCase();
    const closing = /^<\//.test(hit[0]);
    if (rawTag) {
      if (closing && tag === rawTag && rawTag !== 'plaintext') rawTag = null;
      continue;
    }
    if (tag === 'template') {
      templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1));
      continue;
    }
    if (closing) continue;
    if (templateDepth === 0) tags.push({ tag, attrs: attributes(hit[0]) });
    if (rawTags.has(tag)) rawTag = tag;
  }
  return tags;
}
export function parseAssetReferences(html) {
  const refs = [];
  for (const { tag, attrs } of activeHtmlTags(html)) {
    if (tag === 'script' && attrs.type?.toLowerCase() === 'module' && attrs.src) {
      refs.push({ kind: 'js', ref: attrs.src });
    }
    if (tag === 'link' && csv(attrs.rel?.replace(/\s+/g, ',')).includes('stylesheet') && attrs.href) {
      refs.push({ kind: 'css', ref: attrs.href });
    }
  }
  return refs;
}

function validateStylesheet(text) {
  let depth = 0;
  let quote = null;
  let comment = false;
  let escaped = false;
  let block = false;
  let declaration = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (comment) {
      if (char === '*' && text[index + 1] === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') { comment = true; index += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '<' && /[A-Za-z!/?]/.test(text[index + 1] || '')) return false;
    if (char === '{') { depth += 1; block = true; }
    if (char === '}' && --depth < 0) return false;
    if (char === ':' && depth > 0) declaration = true;
  }
  const directiveOnly = /^(?:\s*\/\*[\s\S]*?\*\/|\s*@(charset|import|namespace)\b[^{}<>]+;|\s)+$/.test(text)
    && /@(charset|import|namespace)\b/.test(text);
  return !comment && !quote && depth === 0 && ((block && declaration) || directiveOnly);
}

export function validateStaticResponse({ status, contentType, body, kind }) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (status !== 200) return { ok: false, reason: 'HTTP 状态不是 200。' };
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const types = kind === 'html' ? ['text/html', 'application/xhtml+xml']
    : kind === 'css' ? ['text/css'] : ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'];
  if (!types.includes(type)) return { ok: false, reason: 'Content-Type 与请求资源类型不符；200 不能单独作为成功证据。' };
  if (!text.trim()) return { ok: false, reason: '资源正文为空。' };
  const prefix = text.trimStart().replace(/^(?:\/\*[\s\S]*?\*\/\s*)+/, '');
  if (kind !== 'html' && /^<(?:!|\?|\/?[a-z])/i.test(prefix)) {
    return { ok: false, reason: 'JS/CSS 收到 HTML 页面，拒绝把平台提示页或路由兜底页当作资源。' };
  }
  if (kind === 'js') {
    // 只解析 stdin 的模块语法，不执行远程代码、不导入模块、不保存源文或解析错误输出。
    const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], {
      input: text, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
    });
    if (syntax.error || syntax.status !== 0 || !/(?:\b(?:import|export|const|let|var|function|class)\b|[{}();=])/.test(text)) {
      return { ok: false, reason: '入口响应没有通过 JavaScript 模块语法和代码结构检查；未执行响应代码。' };
    }
  }
  if (kind === 'css' && !validateStylesheet(text)) {
    return { ok: false, reason: '样式响应没有通过注释/字符串外的括号和声明结构检查；未作为 CSS 放行。' };
  }
  if (kind === 'html') {
    const visible = removeHtmlComments(text);
    if (/(?:默认域名.{0,50}(?:测试|访问)|测试域名.{0,80}(?:提示|访问|确认)|此域名.{0,40}测试|访问风险提示)/s.test(visible)
      || !activeHtmlTags(visible).some(item => item.attrs.id === 'root') || !parseAssetReferences(visible).some(ref => ref.kind === 'js')) {
      return { ok: false, reason: '未发现当前应用入口，或收到平台默认域名提示页。' };
    }
  }
  return { ok: true, reason: '状态、资源类型和应用入口/资源语法结构检查通过。' };
}

export function validateHealthResponse({ status, contentType, body, headers }, expectedService, siteOrigin) {
  let payload;
  try { payload = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch {
    return { ok: false, reason: 'health 正文不是 JSON。' };
  }
  if (status !== 200 || !/^application\/json(?:\s*;|$)/i.test(contentType || '')
    || !exactKeys(payload, ['ok', 'service']) || payload.ok !== true || payload.service !== expectedService) {
    return { ok: false, reason: 'health 状态/类型/字段或服务名不符合 publicApi.js 的精确 {ok:true,service} 契约。' };
  }
  if (headers['access-control-allow-origin'] !== siteOrigin) return { ok: false, reason: 'health ACAO 不是精确静态来源。' };
  if (!csv(headers['access-control-expose-headers']).includes('x-request-id')
    || !/^[A-Za-z0-9_-]{8,128}$/.test(headers['x-request-id'] || '')) {
    return { ok: false, reason: 'health 缺少有效请求 ID，或浏览器未获准读取 X-Request-Id。' };
  }
  return { ok: true, reason: '精确健康契约、静态来源 ACAO 与请求 ID 暴露均通过。' };
}

export function validateBusinessError(payload) {
  return exactKeys(payload, ['ok', 'data', 'error']) && payload.ok === false && payload.data === null
    && payload.error !== null && typeof payload.error === 'object' && !Array.isArray(payload.error)
    && typeof payload.error.code === 'string' && payload.error.code.length > 0
    && typeof payload.error.message === 'string' && payload.error.message.length > 0
    && typeof payload.error.retryable === 'boolean'
    && (payload.error.fields === undefined || (payload.error.fields !== null && typeof payload.error.fields === 'object'
      && !Array.isArray(payload.error.fields) && Object.values(payload.error.fields).every(value => typeof value === 'string')));
}

export function validatePreflight(response, siteOrigin, methods = EXPECTED_CORS_METHODS) {
  const headers = response.headers;
  if (response.status !== 204 || response.body.length !== 0) return { ok: false, reason: '允许来源的预检必须是无正文的 HTTP 204。' };
  if (headers['access-control-allow-origin'] !== siteOrigin) return { ok: false, reason: '预检 ACAO 不是精确静态来源。' };
  if (!sameSet(csv(headers['access-control-allow-methods']), methods.map(value => value.toLowerCase()))) {
    return { ok: false, reason: '允许方法与固定项目契约不一致，或包含通配符/重复项。' };
  }
  if (!sameSet(csv(headers['access-control-allow-headers']), HEADER_NAMES)) {
    return { ok: false, reason: '允许请求头与当前 CORS 声明不一致，或缺 Authorization/Content-Type/X-Client-Time-Zone。' };
  }
  return { ok: true, reason: 'HTTP 204、精确来源、允许方法与允许请求头均符合固定项目契约。' };
}

export function validateDeniedPreflight(response) {
  return response.status === 403 && response.headers['access-control-allow-origin'] === undefined
    ? { ok: true, reason: '错误来源实际收到 403 且没有 ACAO。' }
    : { ok: false, reason: '错误来源没有被精确拒绝：必须 403 且没有 ACAO。' };
}

export function compareVersions(local, remote) {
  const localKeys = Object.keys(local).sort();
  const remoteKeys = Object.keys(remote).sort();
  const differences = [...new Set([...localKeys, ...remoteKeys])].sort().filter(key => local[key] !== remote[key]);
  return { ok: localKeys.length > 0 && sameSet(localKeys, remoteKeys) && differences.length === 0, differences };
}

export function selfTest() {
  let count = 0;
  const check = (condition, label) => { assert.ok(condition, '检查器内存自测失败：' + label); count += 1; };
  for (const value of ['http://localhost:5173', 'https://localhost', 'https://127.0.0.1', 'https://127.1',
    'https://10.0.0.1', 'https://169.254.169.254', 'https://192.168.1.1', 'https://[::1]', 'https://[::ffff:7f00:1]',
    'https://example.com/path', 'https://example.com?x=1', 'https://example.com/#x', 'https://user@example.com']) {
    check(!validateOrigin(value).ok, '拒绝不安全来源');
  }
  check(validateOrigin('https://example.com').ok && isPublicAddress('8.8.8.8'), '公开来源');
  check(!isPublicAddress('100.64.0.1') && !isPublicAddress('198.18.0.1'), '保留地址');
  for (const value of ['2001::1', '2001:1::4', '2001:2::1', '2001:11::1', '2001:40::1', '2001:db8::1', '2002::1', '3fff::1']) {
    check(!isPublicAddress(value) && !validateOrigin('https://[' + value + ']').ok, 'IPv6特殊用途CIDR不能作为公网来源');
  }
  for (const value of ['2001:1::1', '2001:1::2', '2001:1::3', '2001:3::1', '2001:4:112::1',
    '2001:20::1', '2001:21::1', '2001:30::1', '2001:3f::1']) {
    check(isPublicAddress(value) && validateOrigin('https://[' + value + ']').ok, 'IANA更具体全球可达例外不能被父段误拒绝');
  }
  check(isPublicAddress('2001:4860:4860::8888') && isPublicAddress('2606:4700:4700::1111')
    && isPublicAddress('64:ff9b::808:808'), '正常全球IPv6及注册表明确全球可达前缀正例');
  const trackedSamples = classifyTrackedPaths(['.env.example', '.env.local', 'src/.env.example', 'src/dist/app.js',
    '_logs/probe.log', 'credentials/probe.pem', 'src/app.js', '.environment']);
  check(trackedSamples.total === 6 && trackedSamples.categories['非示例环境配置'] === 3
    && trackedSamples.categories['私钥、证书或日志文件'] === 2, '已跟踪敏感路径只按安全类别汇总');
  check(classifyTrackedPaths(['.env.example', 'src/app.js', 'README.md']).total === 0, '精确公开模板与普通源码放行');
  check(classifyTrackedPaths(['id_rsa', 'ssh/id_dsa', 'ssh/id_ecdsa', 'ssh/id_ed25519', 'cert.jks', 'cert.keystore']).total === 6,
    'SSH私钥名称及Java密钥库均禁止跟踪');
  const virtualGitRoot = path.dirname(projectRoot);
  const ownIgnore = path.relative(virtualGitRoot, path.join(projectRoot, '.gitignore')).split(path.sep).join('/');
  const ownEvidence = parseProjectIgnoreResult({ stdout: [ownIgnore, '5', '*.key', 'probe.key', ''].join('\0'),
    exitCode: 0, probe: 'probe.key', gitRoot: virtualGitRoot });
  check(ownEvidence.valid && ownEvidence.ignored && ownEvidence.projectRule, '项目自身忽略规则证据');
  const externalEvidence = parseProjectIgnoreResult({ stdout: ['external-global-ignore', '1', '*.key', 'probe.key', ''].join('\0'),
    exitCode: 0, probe: 'probe.key', gitRoot: virtualGitRoot });
  check(externalEvidence.valid && externalEvidence.ignored && !externalEvidence.projectRule, '全局忽略不能代替项目规则');
  const infoEvidence = parseProjectIgnoreResult({ stdout: ['.git/info/exclude', '1', '*.key', 'probe.key', ''].join('\0'),
    exitCode: 0, probe: 'probe.key', gitRoot: virtualGitRoot });
  check(infoEvidence.valid && !infoEvidence.projectRule, 'Git私有exclude不能代替项目规则');
  const templateEvidence = parseProjectIgnoreResult({ stdout: [ownIgnore, '17', '!.env.example', '.env.example', ''].join('\0'),
    exitCode: 0, probe: '.env.example', gitRoot: virtualGitRoot });
  check(templateEvidence.valid && !templateEvidence.ignored && templateEvidence.projectRule, '精确模板例外必须来自项目规则');
  const summary = ['tests 2', 'pass 2', 'fail 0', 'cancelled 0', 'skipped 0', 'todo 0'].join('\n');
  check(summarizeTests(summary, 0).ok, '完整测试摘要');
  check(!summarizeTests(summary, 1).ok, '非零退出不能通过');
  check(!summarizeTests(summary.replace('skipped 0', 'skipped 1'), 0).ok, '跳过不能通过');
  check(!summarizeTests('', 0).ok && !summarizeTests(summary.replace(/2/g, '0'), 0).ok, '缺摘要或零测试不能通过');
  const coverageOutput = CRITICAL_TESTS.map(item => '✔ ' + item.name + ' (1ms)').join('\n');
  check(criticalTestCoverage(coverageOutput).every(item => item.passed), '关键用例真实通过行');
  check(criticalTestCoverage('').every(item => !item.passed), '摘要不能代替关键用例执行证据');
  check(!criticalTestCoverage(coverageOutput.replace('✔', '✖')).every(item => item.passed), '关键用例失败不能冒充执行通过');
  const appHtml = '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>';
  check(validateStaticResponse({ status: 200, contentType: 'text/html', body: appHtml, kind: 'html' }).ok, '真实入口');
  check(!validateStaticResponse({ status: 200, contentType: 'text/html', body: '<html>测试域名访问提示</html>', kind: 'html' }).ok, '200平台提示页');
  check(!validateStaticResponse({ status: 200, contentType: 'text/html', body: appHtml, kind: 'js' }).ok, '200 HTML冒充JS');
  check(!validateStaticResponse({ status: 200, contentType: 'application/javascript', body: appHtml, kind: 'js' }).ok, '错误MIME也不能掩盖HTML');
  check(!validateStaticResponse({ status: 200, contentType: 'application/javascript', body: ' '.repeat(1025) + appHtml, kind: 'js' }).ok, '长空白不能掩盖HTML');
  check(!validateStaticResponse({ status: 200, contentType: 'text/css', body: ' '.repeat(1025) + appHtml, kind: 'css' }).ok, 'CSS长空白后HTML');
  check(!validateStaticResponse({ status: 200, contentType: 'application/javascript', body: 'Access denied', kind: 'js' }).ok, '错误页文案不是JS');
  check(validateStaticResponse({ status: 200, contentType: 'application/javascript', body: 'export const fictional = 1;', kind: 'js' }).ok, '模块JS仅语法解析');
  check(validateStaticResponse({ status: 200, contentType: 'text/css', body: 'body { color: red; }', kind: 'css' }).ok, '有效CSS结构');
  check(validateStaticResponse({ status: 200, contentType: 'text/css', body: '@media(width<=600px){body{color:red}}', kind: 'css' }).ok, '现代CSS媒体范围不是HTML');
  check(!validateStaticResponse({ status: 200, contentType: 'text/css', body: 'Access denied', kind: 'css' }).ok, '非CSS文案');
  check(parseAssetReferences('<!-- <script type="module" src="/fake.js"></script> -->').length === 0, '注释入口不参与资源检查');
  check(parseAssetReferences('<template><script type="module" src="/fake.js"></script></template>').length === 0, 'template入口不执行');
  check(parseAssetReferences('<textarea><script type="module" src="/fake.js"></script></textarea>').length === 0, '原始文本中的假标签');
  check(parseAssetReferences('<script>const fictional = "<script type=\\"module\\" src=\\"/fake.js\\">";</script>').length === 0, '脚本文本中的假入口');
  check(!validateStaticResponse({ status: 200, contentType: 'text/html', body: '<div id="root"></div><!-- <script type="module" src="/fake.js"></script> -->', kind: 'html' }).ok, '注释不能制造应用入口');
  const site = 'https://example.com';
  const service = '【虚构健康服务】';
  const headers = { 'access-control-allow-origin': site, 'access-control-expose-headers': 'X-Request-Id', 'x-request-id': 'fictional-request-id' };
  const health = { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, service }), headers };
  check(validateHealthResponse(health, service, site).ok, '健康精确契约');
  check(!validateHealthResponse({ ...health, body: JSON.stringify({ ok: true, service: '【错误服务】' }) }, service, site).ok, '错误服务名');
  check(!validateHealthResponse({ ...health, body: JSON.stringify({ ok: true, data: {}, error: null }) }, service, site).ok, 'health不是业务封套');
  check(!validateHealthResponse({ ...health, headers: { ...headers, 'access-control-allow-origin': '*' } }, service, site).ok, '拒绝通配CORS');
  check(!validateHealthResponse({ ...health, headers: { ...headers, 'access-control-expose-headers': '' } }, service, site).ok, '请求ID不可读');
  const preflight = { status: 204, body: Buffer.alloc(0), headers: { ...headers,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'Accept, Authorization, Content-Type, X-Client-Time-Zone' } };
  check(validatePreflight(preflight, site).ok, '准确预检');
  check(!validatePreflight({ ...preflight, status: 200 }, site).ok, '200不是204');
  check(!validatePreflight({ ...preflight, headers: { ...preflight.headers, 'access-control-allow-headers': '*' } }, site).ok, '通配请求头');
  check(!validatePreflight({ ...preflight, headers: { ...preflight.headers, 'access-control-allow-methods': 'GET, OPTIONS' } }, site).ok, '缺POST方法');
  check(validateDeniedPreflight({ status: 403, headers: {} }).ok, '错误来源403');
  check(!validateDeniedPreflight({ status: 403, headers }).ok, '403仍带ACAO不能通过');
  check(validateBusinessError({ ok: false, data: null, error: { code: 'FICTIONAL', message: '虚构错误', retryable: false } }), '业务错误封套');
  check(!validateBusinessError({ ok: false, data: null, error: { code: 'FICTIONAL', message: '虚构错误' } }), '错误封套缺retryable');
  check(compareVersions({ '/app.js': 'a', '/app.css': 'b' }, { '/app.js': 'a', '/app.css': 'b' }).ok, '版本完全相同');
  check(!compareVersions({ '/app.js': 'a' }, { '/app.js': 'b' }).ok, '相同路径不同内容');
  check(!compareVersions({ '/new.js': 'a' }, { '/old.js': 'a' }).ok, '线上仍是旧资源');
  return count;
}

export function classifyTrackedPaths(names) {
  const categories = { '非示例环境配置': 0, '本地成果、依赖或凭证目录': 0, '私钥、证书或日志文件': 0 };
  let total = 0;
  for (const name of new Set(names)) {
    const base = path.posix.basename(name);
    const environment = /^\.env/i.test(base) && name !== '.env.example';
    const directory = /(?:^|\/)(?:_logs|dist|node_modules|credentials|secrets)(?:\/|$)/i.test(name);
    const extension = /\.(?:log|pem|key|p12|pfx|jks|keystore)$/i.test(base) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(base);
    if (environment || directory || extension) total += 1;
    if (environment) categories['非示例环境配置'] += 1;
    if (directory) categories['本地成果、依赖或凭证目录'] += 1;
    if (extension) categories['私钥、证书或日志文件'] += 1;
  }
  return { total, categories };
}

export function parseProjectIgnoreResult({ stdout, exitCode, probe, gitRoot }) {
  if (exitCode === 1 && stdout === '') return { valid: true, ignored: false, projectRule: false };
  const fields = stdout.split('\0');
  if (exitCode !== 0 || fields.length !== 5 || fields[4] !== '' || !/^\d+$/.test(fields[1])
    || !fields[2] || fields[3] !== probe) return { valid: false };
  const rulePath = path.resolve(gitRoot, fields[0]);
  const expectedPath = path.join(projectRoot, '.gitignore');
  const projectRule = process.platform === 'win32' ? rulePath.toLowerCase() === expectedPath.toLowerCase() : rulePath === expectedPath;
  return { valid: true, ignored: !fields[2].startsWith('!'), projectRule, line: projectRule ? Number(fields[1]) : null };
}

function runCommand(command, args, timeout = 180000, input) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', input,
    timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true, shell: false });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  // 原始输出只在内存解析；证据记录摘要/哈希，避免错误堆栈或构建错误泄露环境值。
  return { exitCode: result.status, signal: result.signal, errorCode: result.error?.code,
    stdout, stderr, bytes: Buffer.byteLength(stdout + stderr), sha256: digest(stdout + stderr) };
}
function commandEvidence(result) {
  return ['退出码：' + (result.exitCode ?? '无') + '；信号：' + (result.signal || '无')
    + '；输出字节：' + result.bytes + '；输出 SHA256：' + result.sha256,
  ...(result.errorCode ? ['进程未完成，错误类别：' + result.errorCode + '（原始异常未回显）'] : [])];
}
function readProjectFile(relative) {
  try { return fs.readFileSync(path.join(projectRoot, relative), 'utf8'); } catch {
    throw new CheckFailure('无法读取所需项目文件 ' + relative + '；未验证。');
  }
}
function assetUrl(origin, ref) {
  let url;
  try { url = new URL(ref, origin + '/'); } catch { throw new CheckFailure('入口资源地址无效。'); }
  requireCheck(url.origin === origin && !url.username && !url.password && !url.search && !url.hash,
    '资源必须来自同一 HTTPS 来源，且无凭证、查询或片段。');
  requireCheck(!decodeURIComponent(url.pathname).split('/').some(part => part === '..' || part.includes('\\')),
    '资源路径不符合当前静态产物边界。');
  return url;
}
async function requestPublic(url, { method = 'GET', headers = {}, limit = 10 * 1024 * 1024 } = {}) {
  requireCheck(['GET', 'OPTIONS'].includes(method), '检查器只允许 GET/OPTIONS。');
  const parsed = new URL(url);
  const validated = validateOrigin(parsed.origin);
  requireCheck(validated.ok, '请求来源未通过公开 HTTPS 校验。');
  let addresses;
  try {
    let timer;
    try {
      addresses = await Promise.race([dns.lookup(parsed.hostname.replace(/^\[|\]$/g, ''), { all: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new CheckFailure('DNS 解析超时，未验证。')), 10000); })]);
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error instanceof CheckFailure) throw error;
    throw new CheckFailure('DNS 解析失败，未验证；没有回显底层网络信息。');
  }
  requireCheck(addresses.length > 0 && addresses.every(item => isPublicAddress(item.address)),
    'DNS 包含非公开地址；未发请求，未验证。');
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(parsed, { method, headers: { ...headers, 'Cache-Control': 'no-cache' },
      agent: false, rejectUnauthorized: true, lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      } }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) request.destroy(new CheckFailure('响应超过检查器大小上限，未验证。'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        contentType: response.headers['content-type'] || '', body: Buffer.concat(chunks),
        sha256: digest(Buffer.concat(chunks)) }));
      response.on('error', () => reject(new CheckFailure('响应读取未完成，未验证。')));
    });
    request.setTimeout(15000, () => request.destroy(new CheckFailure('HTTPS 请求超时，未验证。')));
    request.on('error', error => reject(error instanceof CheckFailure ? error
      : new CheckFailure('HTTPS 请求失败，未验证；未跟随重定向，未回显底层异常。')));
    request.end();
  });
}

function parseArguments(args) {
  const options = { report: 'day25/latest' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--site', '--api', '--report'].includes(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new CheckFailure('参数错误：支持 --site 来源、--api 来源、--report 日志内相对名称，或单独 --self-test。');
    }
    const key = argument.slice(2);
    requireCheck(options[key] === undefined || key === 'report' && options[key] === 'day25/latest', '同一参数不能重复。');
    options[key] = args[++index];
  }
  requireCheck(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(options.report) && options.report.length <= 160,
    '--report 只能是 _logs 内不含扩展名的相对名称，例如 day25/round1；禁止绝对路径、点路径和反斜线。');
  return options;
}
function prepareReportBase(name) {
  let current = projectRoot;
  const components = ['_logs', ...name.split('/')];
  const filename = components.pop();
  for (const component of components) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    requireCheck(fs.lstatSync(current).isDirectory() && !fs.lstatSync(current).isSymbolicLink(), '报告目录不能是符号链接或非目录。');
  }
  const base = path.join(current, filename);
  requireCheck(base.startsWith(projectRoot + path.sep + '_logs' + path.sep), '报告路径越界。');
  for (const suffix of ['json', 'md', 'html']) {
    const destination = base + '.' + suffix;
    requireCheck(!fs.existsSync(destination), '同名报告已存在；为保留前轮证据拒绝覆盖，请换用新的 --report 名称。');
  }
  return base;
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function writeReports(report, base) {
  fs.writeFileSync(base + '.json', JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const markdown = ['# 发布前检查结果', '', '时间：' + report.time, '', '结论：' + report.summary, '',
    ...report.checks.flatMap(item => ['## ' + item.status + '｜' + item.title, '', '- 验证状态：' + item.verification,
      '- 命令：' + item.command, '- 通过标准：' + item.criteria,
      ...item.evidence.map(line => '- 证据：' + line), '- 边界：' + item.boundary, '']),
    '## 未验证范围', '', ...report.boundaries.map(value => '- ' + value), ''].join('\n');
  fs.writeFileSync(base + '.md', markdown, { encoding: 'utf8', flag: 'wx' });
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Day 25 发布前检查结果</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#111;background:white}h1{font-size:28px}h2{font-size:20px}article{border-top:1px solid #bbb;padding:16px 0}.PASS{color:#116b2e}.FAIL{color:#b51616}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}li{margin:5px 0}.meta{color:#444}</style></head><body>'
    + '<h1>Day 25｜发布前检查结果</h1><p class="meta">' + escapeHtml(report.time) + '</p><p><strong>'
    + escapeHtml(report.summary) + '</strong></p><p>本轮静态目标：<code>' + escapeHtml(report.targets.site) + '</code><br>本轮 API 目标：<code>' + escapeHtml(report.targets.api) + '</code></p><ul>' + report.checks.filter(item => item.status === 'FAIL').map(item => '<li class="FAIL"><strong>FAIL｜' + escapeHtml(item.title) + '</strong>：' + escapeHtml(item.evidence.at(-1) || '未完成验证') + '</li>').join('') + '</ul>'
    + report.checks.map(item => '<article><h2 class="' + item.status + '">' + item.status + '｜' + escapeHtml(item.title)
      + '</h2><p>验证状态：' + escapeHtml(item.verification) + '</p><p>执行命令：<code>' + escapeHtml(item.command)
      + '</code></p><p>通过标准：' + escapeHtml(item.criteria) + '</p><ul>'
      + item.evidence.map(line => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul><p class="meta">边界：'
      + escapeHtml(item.boundary) + '</p></article>').join('')
    + '<h2>本轮未验证范围</h2><ul>' + report.boundaries.map(line => '<li>' + escapeHtml(line) + '</li>').join('')
    + '</ul></body></html>';
  fs.writeFileSync(base + '.html', html, { encoding: 'utf8', flag: 'wx' });
}

export async function verifyClientHealthContract() {
  let createPublicApiClient;
  try {
    ({ createPublicApiClient } = await import(pathToFileURL(path.join(projectRoot, 'src/services/publicApi.js')).href));
  } catch { throw new CheckFailure('无法载入当前公网客户端；health契约行为未验证。'); }
  requireCheck(typeof createPublicApiClient === 'function', '当前模块没有可用的createPublicApiClient；未验证。');
  const virtualOrigin = 'https://day25-fictional-api.example';
  const calls = [];
  let expectedAccepted = false;
  let wrongRejected = false;
  async function run(payload) {
    const client = createPublicApiClient({ apiOrigin: virtualOrigin, fetchImpl: async (url, init) => {
      calls.push({ valid: url === virtualOrigin + '/api/health' && init.method === 'GET'
        && init.headers.Accept === 'application/json' && !Object.hasOwn(init.headers, 'Authorization')
        && init.credentials === 'omit' && init.redirect === 'error' });
      return new Response(JSON.stringify(payload), { status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'day25-fictional-health-request' } });
    } });
    return client.getHealth();
  }
  try {
    const response = await run({ ok: true, service: EXPECTED_HEALTH_SERVICE });
    expectedAccepted = response.httpStatus === 200 && exactKeys(response.data, ['ok', 'service'])
      && response.data.ok === true && response.data.service === EXPECTED_HEALTH_SERVICE;
  } catch { /* 契约漂移必须作为失败保留；不回显可能含源代码或内部详情的异常。 */ }
  try { await run({ ok: true, service: '【虚构错误服务】' }); } catch (error) {
    wrongRejected = error?.code === 'INVALID_RESPONSE' && error.httpStatus === 200;
  }
  const requestsSafe = calls.length === 2 && calls.every(item => item.valid);
  return { ok: expectedAccepted && wrongRejected && requestsSafe, evidence: [
    '当前客户端实际接受固定health服务名：' + expectedAccepted + '；固定值：' + EXPECTED_HEALTH_SERVICE,
    '当前客户端实际拒绝错误服务名并返回INVALID_RESPONSE/HTTP200：' + wrongRejected,
    '内存fetch实际调用：' + calls.length + ' 次；方法/地址/无凭证/禁止重定向均符合预期：' + requestsSafe
      + '；未访问网络或读取私人记录。',
  ] };
}

function projectAuditScope() {
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], 15000);
  if (result.errorCode || result.exitCode !== 0) return { ok: false };
  try {
    const gitRoot = fs.realpathSync(path.resolve(result.stdout.trim()));
    const actualProject = fs.realpathSync(projectRoot);
    const relative = path.relative(gitRoot, actualProject);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return { ok: false };
    // 若项目就是仓库根，原无参数范围也恰好等于项目；当前多项目仓库必须传真实相对前缀。
    return { ok: true, prefix: relative ? relative.split(path.sep).join('/') : null, gitRoot };
  } catch { return { ok: false }; }
}

export async function verifyProject(options) {
  const checks = [];
  let internalError = false;
  async function check(id, title, command, criteria, boundary, operation) {
    let evidence = [];
    let ok = false;
    let verification = '已验证';
    try {
      const result = await operation();
      ok = result.ok;
      evidence = result.evidence;
      if (result.unverified) verification = '未验证';
      else if (!ok) verification = '发现问题';
    } catch (error) {
      evidence = [safeError(error)];
      verification = '未验证';
      if (!(error instanceof CheckFailure)) internalError = true;
    }
    const item = { id, title, status: ok ? 'PASS' : 'FAIL', verification, command, criteria, evidence, boundary };
    checks.push(item);
    console.log(item.status + '｜' + title + '｜' + verification);
    for (const line of evidence) console.log('  证据：' + line);
    return item;
  }
  const deploy = readProjectFile('deploy-day20.md');
  const siteInput = options.site ?? deploy.match(/^- 静态站点：([^\s]+)/m)?.[1];
  const apiInput = options.api ?? deploy.match(/^- 公网 API 来源：([^\s]+)/m)?.[1];
  const site = validateOrigin(siteInput);
  const api = validateOrigin(apiInput);
  for (const [key, label, input, value] of [['site', '静态站点', siteInput, site], ['api', '公网 API', apiInput, api]]) {
    await check('origin-' + key, label + '来源配置', '校验 --' + key + ' ' + inputLabel(input),
      '无凭证/路径/查询/片段的 HTTPS 来源，且不是本机、内网或保留地址。',
      'DNS 的公开地址限制还会在每次实际连接时独立执行。', async () => ({
        ok: value.ok, evidence: ['输入：' + inputLabel(input), value.ok ? '已接受精确来源：' + value.origin : value.reason],
      }));
  }
  await check('verifier-self-test', '检查器拒绝虚构错误的内存自测', 'node .agents/skills/verify-project/scripts/verify.mjs --self-test',
    '虚构错误 URL、200 假页、错误 health、错误 CORS、旧版本、跳过测试均被拒绝。',
    '全部在内存执行，不连接虚构来源、不创建秘密样例文件。', async () => {
      const count = selfTest();
      return { ok: true, evidence: [count + ' 项内存断言通过；含 200 HTML 冒充 JS、错误服务名、通配 CORS 与旧版资源。'] };
    });
  await check('client-health-contract', '当前客户端与固定health契约一致',
    '导入当前createPublicApiClient；注入内存fetch，分别返回正确/错误服务名',
    '当前客户端实际接受固定服务名，拒绝错误服务名；两次调用均仅为无凭证GET内存模拟。',
    '只证明当前客户端的契约行为，不代替公网可达、CORS、数据库权限或真实CRUD验收。',
    verifyClientHealthContract);
  await check('tests', '当前项目虚构回归测试', 'node --test --test-reporter=spec',
    '退出码0；tests>0且pass=tests；失败/取消/跳过/待办全0；摘要完整且所有关键回归取得真实spec通过行。',
    '测试中的业务流程是虚构回归证据，不是当前云端真实 CRUD 的证据。', async () => {
      const result = runCommand(process.execPath, ['--test', '--test-reporter=spec']);
      const output = result.stdout + '\n' + result.stderr;
      const summary = summarizeTests(output, result.exitCode);
      const coverage = criticalTestCoverage(output);
      return { ok: summary.ok && coverage.every(item => item.passed) && !result.errorCode, unverified: Boolean(result.errorCode),
        evidence: [...commandEvidence(result), '实际测试计数：' + JSON.stringify(summary.counts), summary.reason,
          ...coverage.map(item => (item.passed ? 'PASS ' : 'FAIL ') + item.label + '：实际 spec 通过行'
            + (item.passed ? '已取得' : '未取得') + '｜' + item.name),
          '关键回归实际通过：' + coverage.filter(item => item.passed).length + '/' + coverage.length
            + '；测试总数不作为固定历史门槛。'] };
    });
  await check('build', '当前生产构建', 'npm run build',
    '真实构建进程退出码为 0，且没有超时/启动错误。',
    '只生成被忽略的 dist；不上传或部署。原始构建输出只在内存处理。', async () => {
      const result = process.platform === 'win32'
        ? runCommand(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'])
        : runCommand('npm', ['run', 'build']);
      return { ok: result.exitCode === 0 && !result.errorCode, unverified: Boolean(result.errorCode),
        evidence: [...commandEvidence(result), '成功构建模块数：' + (result.stdout.match(/(\d+)\s+modules transformed/)?.[1] || '未在输出发现'),
          '未保存构建原始输出；若失败需单独在本机查看受控诊断。'] };
    });
  let localFiles = {};
  let localRefs = [];
  const buildPassed = () => checks.find(item => item.id === 'build')?.status === 'PASS';
  await check('build-content', '生产入口、公开 API 配置及 DEV/服务端标记', '读取 dist/index.html 及其引用的本地 JS/CSS；只输出计数和 SHA256',
    '本轮 build 成功；入口资源存在；JS 实际含预期 API 来源；DEV 登录代理/服务端秘密标记为 0。',
    'VITE_STATIC_ORIGIN 仅被开发代理消费，当前生产代码不包含它；静态来源由公网和 CORS 项核对，避免把未消费变量当故障。',
    async () => {
      requireCheck(buildPassed(), '本轮构建未成功；拒绝把旧 dist 当当前构建，未验证。');
      requireCheck(api.ok, 'API 配置无效；无法对照当前构建，未验证。');
      const html = readProjectFile('dist/index.html');
      localRefs = parseAssetReferences(html);
      requireCheck(localRefs.some(item => item.kind === 'js'), '构建入口没有模块 JS。');
      const evidence = [];
      let mergedJs = '';
      for (const item of localRefs) {
        const url = assetUrl('https://local-build.example.com', item.ref);
        const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
        const absolute = path.resolve(projectRoot, 'dist', relative);
        requireCheck(absolute.startsWith(path.join(projectRoot, 'dist') + path.sep), '构建资源路径越界。');
        const body = fs.readFileSync(absolute);
        requireCheck(body.length > 0, '构建入口资源为空。');
        localFiles[url.pathname] = digest(body);
        if (item.kind === 'js') mergedJs += body.toString('utf8');
        evidence.push(url.pathname + '：' + body.length + ' 字节；SHA256 ' + digest(body));
      }
      const devHits = DEV_MARKERS.filter(marker => mergedJs.includes(marker));
      const privateHits = PRIVATE_MARKERS.filter(marker => mergedJs.includes(marker));
      const apiPresent = mergedJs.includes(api.origin);
      evidence.push('预期 API 来源实际包含：' + apiPresent + '；DEV 代理/登录标记：' + devHits.length
        + '；服务端秘密标记：' + privateHits.length);
      if (devHits.length || privateHits.length) evidence.push('命中标记名称：' + [...devHits, ...privateHits].join('、') + '（未输出对应源码或值）');
      evidence.push('静态来源由开发代理配置消费，生产资源不强制包含该字符串。');
      return { ok: apiPresent && devHits.length === 0 && privateHits.length === 0, evidence };
    });
  const auditScope = projectAuditScope();
  await check('git-ignore', '敏感配置与本地成果的 Git 忽略边界', 'git check-ignore --no-index --verbose -z --stdin（逐个安全探针）；git ls-files -z；git ls-files -ci --exclude-standard -z',
    '每个敏感样例由项目自身.gitignore忽略；精确.env.example由项目规则放行；跟踪文件没有敏感路径或当前应忽略文件。',
    '只检查路径和忽略规则，不读取任何当前环境文件内容；不改变暂存区。', async () => {
      requireCheck(auditScope.ok, '无法取得Git根目录，不能证明忽略规则来自项目本身，未验证。');
      const probes = ['.env', '.env.local', '.env.production', '_logs/day25/probe.txt', 'dist/probe.js',
        'node_modules/probe.txt', 'credentials/probe.txt', 'secrets/probe.txt', 'probe.pem', 'probe.key', 'probe.p12', 'probe.pfx', 'probe.log', 'probe.jks', 'probe.keystore',
        'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];
      let ok = true;
      const evidence = [];
      let missingProjectRuleCount = 0;
      for (const probe of probes) {
        const result = runCommand('git', ['check-ignore', '--no-index', '--verbose', '-z', '--stdin'], 15000, probe + '\0');
        requireCheck(!result.errorCode && [0, 1].includes(result.exitCode), 'Git 忽略规则检查执行失败，未验证。');
        const rule = parseProjectIgnoreResult({ stdout: result.stdout, exitCode: result.exitCode, probe, gitRoot: auditScope.gitRoot });
        requireCheck(rule.valid, 'Git忽略规则来源元数据不完整，未验证。');
        const passed = rule.ignored && rule.projectRule;
        ok &&= passed;
        if (!passed) missingProjectRuleCount += 1;
        evidence.push(probe + '：' + (passed ? 'PASS 项目已忽略' : 'FAIL 缺少项目自身忽略规则')
          + '；来源：' + (rule.projectRule ? 'my-app/.gitignore第' + rule.line + '行'
            : rule.ignored ? '其他来源（不能代替项目规则，隐藏外部路径）' : '无有效忽略规则'));
      }
      const example = runCommand('git', ['check-ignore', '--no-index', '--verbose', '-z', '--stdin'], 15000, '.env.example\0');
      requireCheck(!example.errorCode && [0, 1].includes(example.exitCode), '.env.example 忽略核对执行失败，未验证。');
      const exampleRule = parseProjectIgnoreResult({ stdout: example.stdout, exitCode: example.exitCode, probe: '.env.example', gitRoot: auditScope.gitRoot });
      requireCheck(exampleRule.valid, '示例模板忽略元数据不完整，未验证。');
      const examplePassed = !exampleRule.ignored && exampleRule.projectRule;
      ok &&= examplePassed;
      evidence.push('.env.example：' + (examplePassed ? 'PASS 项目规则放行，可入库' : 'FAIL 未取得项目明确例外放行证据'));
      const tracked = runCommand('git', ['ls-files', '-z'], 15000);
      requireCheck(tracked.exitCode === 0 && !tracked.errorCode, 'Git 跟踪路径核对执行失败，未验证。');
      const forbidden = classifyTrackedPaths(tracked.stdout.split('\0').filter(Boolean));
      ok &&= forbidden.total === 0;
      evidence.push('已跟踪的禁止路径：' + forbidden.total + ' 个；安全类别计数：' + JSON.stringify(forbidden.categories)
        + '（同一文件可计入多个类别；不回显可疑路径或内容）。');
      const ignoredTracked = runCommand('git', ['ls-files', '-ci', '--exclude-standard', '-z'], 15000);
      requireCheck(ignoredTracked.exitCode === 0 && !ignoredTracked.errorCode, '已跟踪但应忽略文件的核对执行失败，未验证。');
      const ignoredCount = new Set(ignoredTracked.stdout.split('\0').filter(Boolean)).size;
      ok &&= ignoredCount === 0;
      evidence.push('已被Git跟踪、但命中当前忽略规则的路径：' + ignoredCount + ' 个（仅报告计数，不回显路径）。');
      evidence.push('忽略边界汇总：敏感探针缺少项目规则 ' + missingProjectRuleCount + ' 项；.env.example 明确放行：'
        + examplePassed + '；已跟踪禁止路径 ' + forbidden.total + ' 个；已跟踪且命中忽略规则 ' + ignoredCount + ' 个。');
      return { ok, evidence };
    });
  const auditArgs = auditScope.ok && auditScope.prefix ? ['--path', auditScope.prefix] : [];
  for (const [id, title, args] of [['security-self-test', '密钥扫描器内存自测', ['scripts/security-audit.mjs', '--self-test']],
    ['security-scan', '本项目工作区、暂存区及可达历史密钥特征扫描', ['scripts/security-audit.mjs', ...auditArgs]]]) {
    await check(id, title, 'node ' + args.join(' '), '审计实际进程退出码为 0；实扫待处理凭证特征为 0。',
      '离线扫描限定本项目的真实仓库相对路径，不读兄弟目录内容；不读取被忽略的当前.env或验证密钥有效性。', async () => {
        if (id === 'security-scan') requireCheck(auditScope.ok, '无法证明项目位于 Git 仓库范围内；拒绝扩大扫描，未验证。');
        const result = runCommand(process.execPath, args, 180000);
        // 安全扫描器的既有输出已隐藏命中值及敏感路径；只保留其约定格式的中文证据行。
        const safeLines = (result.stdout + '\n' + result.stderr).split(/\r?\n/).filter(line =>
          /^(?:扫描范围：|安全扫描内存自测：|工作区：|暂存区：|Git 历史：|历史覆盖：|明确虚构、示例或故意无效值：|本轮规则下待处理凭证特征：|待处理｜|边界：|安全审计未完成：)/.test(line));
        const complete = id === 'security-self-test'
          ? /安全扫描内存自测：\d+ 项通过/.test(result.stdout)
          : /本轮规则下待处理凭证特征：0 条/.test(result.stdout)
            && (auditScope.prefix ? /扫描范围：仓库相对目录 /.test(result.stdout) : /扫描范围：整个 Git 仓库/.test(result.stdout));
        return { ok: result.exitCode === 0 && !result.errorCode && complete, unverified: Boolean(result.errorCode) || result.exitCode === 2,
          evidence: [...commandEvidence(result), ...safeLines, ...(!safeLines.length ? ['未取得扫描器约定格式的证据；不以空输出认定通过。'] : [])] };
      });
  }
  let remoteFiles = {};
  let remoteRefs = [];
  let staticComplete = false;
  await check('public-static', '公网首页及真实入口 JS/CSS', 'HTTPS GET <site>/；逐个 GET 首页引用的模块 JS/样式 CSS；禁止重定向',
    'HTML、至少一个模块 JS 及全部引用 CSS 实际 HTTP 200、MIME 正确、非提示页/HTML冒充资源。',
    '本项仅验证公网可达与类型；当前构建是否已经上线由下一项独立判定。', async () => {
      requireCheck(site.ok, '静态来源无效；没有向该地址发请求，公网静态项未验证。');
      const evidence = [];
      const homepage = await requestPublic(site.origin + '/', { headers: { Accept: 'text/html' } });
      const validation = validateStaticResponse({ ...homepage, kind: 'html' });
      evidence.push('GET ' + site.origin + '/：HTTP ' + homepage.status + '；Content-Type ' + homepage.contentType
        + '；' + homepage.body.length + ' 字节；SHA256 ' + homepage.sha256, validation.reason);
      if (!validation.ok) return { ok: false, evidence };
      remoteRefs = parseAssetReferences(homepage.body.toString('utf8'));
      requireCheck(remoteRefs.some(item => item.kind === 'js'), '公网首页没有模块 JS，未验证入口。');
      let ok = true;
      for (const item of remoteRefs) {
        const url = assetUrl(site.origin, item.ref);
        const response = await requestPublic(url, { headers: { Accept: item.kind === 'js' ? 'application/javascript' : 'text/css' } });
        const result = validateStaticResponse({ ...response, kind: item.kind });
        ok &&= result.ok;
        remoteFiles[url.pathname] = response.sha256;
        evidence.push('GET ' + url.pathname + '：HTTP ' + response.status + '；Content-Type ' + response.contentType
          + '；' + response.body.length + ' 字节；SHA256 ' + response.sha256 + '；' + result.reason);
      }
      evidence.push('实际核对：JS ' + remoteRefs.filter(item => item.kind === 'js').length + ' 个，CSS '
        + remoteRefs.filter(item => item.kind === 'css').length + ' 个。');
      staticComplete = ok;
      return { ok, evidence };
    });
  await check('published-version', '当前构建与公网部署版本一致', '比较本轮 dist 与公网首页的入口 JS/CSS 路径及各文件 SHA256',
    '本轮构建/公网资源均完成验证；入口资源集合相同且每份 SHA256 一致。',
    'Day24 文档记载分页修复尚未发布。版本不同必须 FAIL；不通过自动部署消除真实问题。', async () => {
      requireCheck(buildPassed() && checks.find(item => item.id === 'build-content')?.status === 'PASS' && staticComplete,
        '当前构建或公网资源未完整取得；版本一致性未验证。');
      const result = compareVersions(localFiles, remoteFiles);
      const evidence = ['本地入口：' + Object.keys(localFiles).join('、'), '公网入口：' + Object.keys(remoteFiles).join('、'),
        '路径或 SHA256 不一致项：' + result.differences.length + ' 个。'];
      for (const name of result.differences) evidence.push(name + '｜本地 SHA256 ' + (localFiles[name] || '不存在')
        + '｜公网 SHA256 ' + (remoteFiles[name] || '不存在'));
      if (!result.ok) evidence.push('当前源码构建尚未与公网版本一致；这是实际发布阻塞项，未执行部署。');
      return { ok: result.ok, evidence };
    });
  await check('health-cors', '公网 health 精确契约与可读请求 ID', 'HTTPS GET <api>/api/health；Origin: <site>；无 Authorization',
    'HTTP200 + application/json + publicApi.js 精确健康字段/服务名 + ACAO精确静态来源 + 暴露有效X-Request-Id。',
    '健康服务不读取数据库；通过不证明数据库权限、私人数据或真实写入可用。', async () => {
      requireCheck(api.ok && site.ok, 'API 或静态来源无效；health/CORS 未发请求，未验证。');
      const service = EXPECTED_HEALTH_SERVICE;
      const response = await requestPublic(api.origin + '/api/health', { headers: { Accept: 'application/json', Origin: site.origin }, limit: 1024 * 1024 });
      const result = validateHealthResponse(response, service, site.origin);
      return { ok: result.ok, evidence: ['实际 GET ' + api.origin + '/api/health：HTTP ' + response.status
        + '；Content-Type ' + response.contentType + '；正文 ' + response.body.length + ' 字节；SHA256 ' + response.sha256,
      '预期服务名（固定项目契约）：' + service,
      'ACAO 精确匹配：' + (response.headers['access-control-allow-origin'] === site.origin)
        + '；X-Request-Id 形状有效：' + /^[A-Za-z0-9_-]{8,128}$/.test(response.headers['x-request-id'] || '')
        + '；已暴露请求 ID：' + csv(response.headers['access-control-expose-headers']).includes('x-request-id'), result.reason] };
    });
  await check('allowed-preflight', 'entries 允许来源的写入预检', 'HTTPS OPTIONS <api>/api/entries；Origin:<site>；ACR-Method:POST；ACR-Headers:Authorization,Content-Type,X-Client-Time-Zone',
    '实际204且无正文；ACAO精确；方法和请求头集合与固定项目契约精确一致。',
    '只发 OPTIONS，不发 POST/PATCH/DELETE，不认证、不读私人记录。', async () => {
      requireCheck(api.ok && site.ok, 'API 或静态来源无效；允许来源预检未发请求，未验证。');
      const methods = EXPECTED_CORS_METHODS;
      const response = await requestPublic(api.origin + '/api/entries', { method: 'OPTIONS', headers: {
        Origin: site.origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Client-Time-Zone' }, limit: 1024 * 1024 });
      const result = validatePreflight(response, site.origin, methods);
      return { ok: result.ok, evidence: ['实际 OPTIONS /api/entries：HTTP ' + response.status + '；正文 ' + response.body.length + ' 字节。',
        '预期允许方法（固定项目契约）：' + methods.join(', ') + '；实际方法集合一致：'
          + sameSet(csv(response.headers['access-control-allow-methods']), methods.map(value => value.toLowerCase())),
        'ACAO 精确匹配：' + (response.headers['access-control-allow-origin'] === site.origin)
          + '；实际允许请求头集合一致：' + sameSet(csv(response.headers['access-control-allow-headers']), HEADER_NAMES), result.reason] };
    });
  await check('denied-preflight', 'entries 错误来源必须被拒绝', 'HTTPS OPTIONS <api>/api/entries；Origin:https://day25-denied.invalid；ACR-Method:POST',
    '实际 HTTP403，响应没有 Access-Control-Allow-Origin。',
    '虚构错误来源仅是请求头字符串，不解析或访问 .invalid 域名；不执行真实业务写入。', async () => {
      requireCheck(api.ok, 'API 来源无效；错误来源预检未发请求，未验证。');
      const response = await requestPublic(api.origin + '/api/entries', { method: 'OPTIONS', headers: {
        Origin: 'https://day25-denied.invalid', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Client-Time-Zone' }, limit: 1024 * 1024 });
      const result = validateDeniedPreflight(response);
      return { ok: result.ok, evidence: ['实际 OPTIONS /api/entries：HTTP ' + response.status
        + '；ACAO 是否存在：' + (response.headers['access-control-allow-origin'] !== undefined), result.reason] };
    });
  const failed = checks.filter(item => item.status === 'FAIL').length;
  const unverified = checks.filter(item => item.verification === '未验证').length;
  return { time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' Asia/Shanghai',
    targets: { site: inputLabel(siteInput), api: inputLabel(apiInput) },
    summary: 'PASS ' + (checks.length - failed) + ' / FAIL ' + failed + '；检查项中未验证 ' + unverified + '；另有固定未验证边界 ' + GLOBAL_LIMITS.length + ' 项（见报告）'
      + '；' + (failed ? '发布检查未通过。' : '本轮检查范围内通过；未验证范围仍须单独验收。'),
    exitCode: internalError ? 2 : failed ? 1 : 0, checks, boundaries: GLOBAL_LIMITS };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    const count = selfTest();
    const clientContract = await verifyClientHealthContract();
    requireCheck(clientContract.ok, '当前客户端health契约行为自测未通过。');
    console.log('检查器内存自测：' + count + ' 项通过；当前客户端health正确/错误服务名2类行为均通过；未发送网络请求、未创建秘密样例文件。');
    for (const line of clientContract.evidence) console.log('  证据：' + line);
    return;
  }
  requireCheck(path.resolve(process.cwd()).toLowerCase() === projectRoot.toLowerCase(), '请在 my-app 根目录运行检查器。');
  const options = parseArguments(args);
  const base = prepareReportBase(options.report);
  const report = await verifyProject(options);
  writeReports(report, base);
  console.log('\n' + report.summary);
  console.log('报告：' + path.relative(projectRoot, base) + '.{json,md,html}');
  console.log('未验证范围：私人数据、真实会话、真实云端 CRUD、云数据库权限；详见报告。');
  process.exitCode = report.exitCode;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error('FAIL｜检查器未完成｜' + safeError(error));
    process.exitCode = 2;
  });
}

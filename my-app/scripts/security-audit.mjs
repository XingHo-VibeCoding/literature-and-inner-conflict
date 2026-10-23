import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// 全程只读、离线；不运行 fetch，不读取当前真实 .env，不输出匹配值或源代码。
const rules = [
  { id: '腾讯云访问标识', structural: true, pattern: /\bAKID[A-Za-z0-9]{16,40}\b/g },
  { id: 'AWS访问标识', structural: true, pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: '提供商令牌', structural: true, pattern: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{30,})\b/g },
  { id: '私钥结构', structural: true, pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { id: 'JWT结构', structural: true, pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: '数据库URI含密码', pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s/@:]+:[^\s/@]+@/gi },
  { id: 'URL中凭证参数', pattern: /[?&](?:access_token|token|api_key|secret|password)=[A-Za-z0-9._%-]{12,}/gi },
  { id: 'Bearer字面量', pattern: /\bBearer\s+[A-Za-z0-9._-]{12,}/gi },
];
const assignment = /\b((?:[A-Za-z_]*(?:secret|password|passwd|api_?key|access_?token|private_?key|access_?key|secret_?id|admin_?key|service_?role_?key)[A-Za-z_]*|token))\b["']?\s*[:=]\s*(["'`])([^\r\n"'`]{1,500})\2/gi;
const envName = (name) => /^\.env(?:\..+)?$/i.test(path.posix.basename(name))
  && !/^\.env(?:\.[\w-]+)*\.(?:example|sample|template)$/i.test(path.posix.basename(name));
const sensitiveName = (name) => envName(name)
  || /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key|jks|keystore))$/i.test(name);
const isTest = (name) => /(?:\.test\.[cm]?[jt]sx?$|(?:^|\/)tests?\/)/i.test(name);
const digest = (value) => createHash('sha256').update(value).digest('hex');
// 仅登记已人工核实的注册模拟夹具；文件任何变化都必须重新审阅，不能沿用豁免。
const reviewedRegistrationFixtures = [{
  sourceDigest: 'efd7ff9bea568e8189ee8010957534d62cf3fed4eff321ecfeef4a6486be3b0c',
  valueDigest: '35614a8758a2e3bf5258a759c9f325377f077539a85c4f39abc12bb7e38cc3b5',
}];
// 这三个短小会话样例已核实分别含空格、换行和NUL；未知字面值仍须告警。
const reviewedInvalidSessionDigests = new Set([
  '3331faf3e1312b4c2f265077d3025e0091f97d52316e8f4cf359d7ab17d35101',
  '09e99017cf182695d02a5310032b4ed8882ced33adb7efde81873ca7eda6874f',
  '9017a16f4fc1f0b9c1915ef34f41cdb9b123441b99e85b6943deacaac6881483',
]);

function enclosingTest(text, offset) {
  const starts = [...text.matchAll(/(?:^|\n)\s*test\s*\(/g)].map(hit => hit.index);
  const start = starts.findLast(index => index <= offset);
  return start === undefined ? '' : text.slice(start, starts.find(index => index > offset) ?? text.length);
}

function decodeLiteral(value) {
  // 只解码转义字符，不执行源码；双重转义的反斜线不会被误当换行。
  const simple = { '0': '\0', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '`': '`' };
  return value.replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([0bfnrtv\\'"`]))/g,
    (_match, unicode, hex, escape) => unicode || hex ? String.fromCharCode(parseInt(unicode || hex, 16)) : simple[escape]);
}

function contextualReason(text, hit, names, reviewedFixtures, reviewedSessions) {
  const key = hit[1].toLowerCase();
  if (key === 'password' && hit[3] === 'current-password') {
    // 旧正则会从 new-password 的中间开始匹配，再把三元分支误作密码赋值。
    for (const attribute of text.matchAll(/\bautoComplete\s*=\s*\{\s*[A-Za-z_$][\w.$]*\s*\?\s*(['"])new-password\1\s*:\s*(['"])current-password\2\s*\}/g)) {
      if (hit.index === attribute.index + attribute[0].indexOf('new-password') + 4) {
        return '密码输入框自动填充属性的固定语法，不是凭证赋值';
      }
    }
  }
  if (!names.length || !names.every(isTest)) return null;
  const block = enclosingTest(text, hit.index);
  if (key === 'access_token' && /for\s*\(\s*const\s+session\s+of\s*\[/.test(block)
      && /setup\s*\(\s*\{\s*session\s*\}\s*\)/.test(block)
      && /assert\.rejects\s*\(\s*run\s*\(\s*\)/.test(block)) {
    const value = decodeLiteral(hit[3]);
    const repeat = /^\s*\.repeat\(\s*(\d{1,8})\s*\)/.exec(text.slice(hit.index + hit[0].length));
    if ((reviewedSessions.has(digest(hit[3])) && /[\s\u0000-\u001f\u007f]/.test(value))
        || (value.length === 1 && repeat && Number(repeat[1]) > 8192)) {
      return '拒绝会话的模拟测试中，已核实的禁止字符样例或单字符重复超过接口上限';
    }
  }
  if (key !== 'password' || !reviewedFixtures.some(item => item.valueDigest === digest(hit[3])
      && item.sourceDigest === digest(text.replace(/\r\n/g, '\n')))) return null;
  const line = text.slice(text.lastIndexOf('\n', hit.index) + 1, text.indexOf('\n', hit.index) < 0 ? text.length : text.indexOf('\n', hit.index));
  const fixtureDefinition = /^\s*const\s+INPUT\s*=\s*\{\s*username\s*:\s*(['"])[^'"\r\n]+\1\s*,\s*password\s*:/.test(line);
  const rejectedJson = /\bJSON\.parse\s*\(/.test(line)
    && /for\s*\(\s*const\s+input\s+of\s*\[/.test(block)
    && /assert\.throws\s*\(\s*\(\s*\)\s*=>\s*validateInput\s*\(\s*input\s*\)/.test(block);
  if ((fixtureDefinition || rejectedJson) && /\bcreateUser\s*:\s*async\s*\(\s*\)\s*=>\s*success\s*\(\s*\)/.test(text)) {
    return '源码与值的摘要均匹配已人工核实的固定注册夹具，且账号创建被显式模拟';
  }
  return null;
}

function fakeReason(value, key, context, names) {
  // 只按明确的字面值标记分类；测试目录本身不会获得豁免。
  if (/(?:^|[\s:/_<>{}-])(?:fictional|fake|dummy|mock|example|sample|placeholder)(?:$|[\s:/_<>{}-])/i.test(value)
      || /(?:test-only|only-for-(?:unit-)?tests?|your[_ -](?:api[_ -]?key|secret|password|token)|请填|请替换|填入你的|占位|示例值)/i.test(value)) {
    return '字面值明确标注为虚构、测试专用或待替换示例';
  }
  if (/^\s*(?:\$\{|\{\{|<[^>]+>)/.test(value)) return '字面值为模板变量或尖括号占位';
  if (key.toLowerCase() === 'cursorsecret' && value === 'short'
      && names.every(isTest) && /assert\.throws\s*\(/.test(context)) {
    return '测试断言显式验证过短游标签名密钥被拒绝';
  }
  return null;
}
function inspect(text, names, reviewedFixtures = reviewedRegistrationFixtures, reviewedSessions = reviewedInvalidSessionDigests) {
  const findings = [];
  const add = (offset, rule, reason) => findings.push({
    line: text.slice(0, offset).split('\n').length, rule, reason,
  });
  for (const rule of rules) {
    for (const hit of text.matchAll(rule.pattern)) {
      add(hit.index, rule.id, rule.structural ? null : fakeReason(hit[0], '', '', names));
    }
  }
  for (const hit of text.matchAll(assignment)) {
    // URL 字符串拼接不是赋值；实际 URL 内的凭证由独立规则检查。
    if (/[?&]/.test(text.slice(hit.index - 1, hit.index))) continue;
    // 通用 token 名也用于解析器中的单字符语法符号。
    if (hit[1].toLowerCase() === 'token' && /^[^\w\s]$/.test(hit[3])) continue;
    const context = text.slice(Math.max(0, hit.index - 180), hit.index + hit[0].length + 180);
    add(hit.index, '凭证字符串赋值', fakeReason(hit[3], hit[1], context, names)
      || contextualReason(text, hit, names, reviewedFixtures, reviewedSessions));
  }
  return findings;
}

function safePath(name) {
  // 敏感文件名、凭证赋值和 URL 用户信息只显示稳定摘要，连文件名原文也不回显。
  if (sensitiveName(name) || inspect(name, [name]).length
      || /(?:secret|password|passwd|api_?key|access_?token|token)\s*["']?\s*[:=]/i.test(name)
      || /[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(name)) {
    return JSON.stringify(`[敏感路径 SHA256:${createHash('sha256').update(name).digest('hex').slice(0, 16)}]`);
  }
  return JSON.stringify(name); // 转义换行和控制字符，避免路径伪造输出。
}

function validScopePrefix(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !path.posix.isAbsolute(value)
    && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'
      && part.trim() === part && !/[\u0000-\u001f\u007f:*?[\]{}!]/.test(part));
}
function withinScope(name, prefix) {
  return prefix === undefined || name === prefix || name.startsWith(prefix + '/');
}
function parseIndex(buffer, prefix) {
  const aliases = new Map();
  for (const entry of buffer.toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    if (!withinScope(name, prefix)) continue;
    if (tab < 0 || !/^[0-7]{6}$/.test(mode) || !/^[a-f0-9]{40,64}$/.test(oid ?? '')
        || !/^[0-3]$/.test(stage ?? '') || !name) throw new Error('Git 索引记录格式异常');
    if (mode === '160000') throw new Error('Git 索引含子模块，需额外审计，不能宣称已完整扫描');
    if (/^0+$/.test(oid)) throw new Error('Git 索引存在尚无 blob 的意向添加记录');
    if (!aliases.has(oid)) aliases.set(oid, new Set());
    aliases.get(oid).add(name);
  }
  return aliases;
}

function selfTest() {
  let count = 0;
  const source = (name, value) => `const ${name} = ${JSON.stringify(value)};`;
  const field = ['api', 'Key'].join('');
  const check = (condition) => { assert.ok(condition, '内存安全扫描自测失败'); count += 1; };
  const unknown = inspect(source(field, 'a'.repeat(40)), ['src/示例.js']);
  check(unknown.some(item => !item.reason));
  const structured = ['AK', 'ID', 'A'.repeat(32)].join('');
  check(inspect(source(field, structured), ['src/fictional.test.js']).some(item => !item.reason));
  const privateHeader = ['-----BEGIN ', 'PRIVATE KEY', '-----'].join('');
  check(inspect(privateHeader, ['tests/示例.test.js']).some(item => !item.reason));
  const token = ['eyJ', 'a'.repeat(12), '.', 'b'.repeat(12), '.', 'c'.repeat(12)].join('');
  check(inspect(token, ['tests/example.test.js']).some(item => !item.reason));
  const fake = inspect(source(field, ['fictional', 'key', 'for', 'tests'].join('-')), ['src/示例.js']);
  check(fake.length > 0 && fake.every(item => item.reason));
  const shortField = ['cursor', 'Secret'].join('');
  const invalid = `assert.throws(() => reader({${shortField}: ${JSON.stringify('short')}}));`;
  check(inspect(invalid, ['tests/示例.test.js']).every(item => item.reason));
  check(inspect(invalid, ['src/示例.js']).some(item => !item.reason));
  const bearer = ['Bear', 'er ', 'z'.repeat(30)].join('');
  check(inspect(bearer, ['src/示例.js']).some(item => !item.reason));
  const uri = ['post', 'gres://', 'user:', 'z'.repeat(25), '@'].join('');
  check(inspect(uri, ['说明.md']).some(item => !item.reason));
  const query = ['?to', 'ken=', 'z'.repeat(30)].join('');
  check(inspect(query, ['src/示例.js']).some(item => !item.reason));
  check(inspect(source(['to', 'ken'].join(''), '*'), ['src/parser.js']).length === 0);
  check(envName('.env.local') && !envName('.env.example') && !envName('.env.production.example'));
  const output = safePath(`目录/${structured}\n伪造行.js`);
  check(output.includes('SHA256:') && !output.includes(structured) && !output.includes('\n'));
  check(safePath('目录/安全文件.js').includes('目录'));
  check(!JSON.stringify(unknown).includes('a'.repeat(40)));
  const hidden = 'z'.repeat(25);
  const assignmentPath = `credentials/${field}=${JSON.stringify(hidden)}.key`;
  check(safePath(assignmentPath).includes('SHA256:') && !safePath(assignmentPath).includes(hidden));
  const userInfoPath = ['https', '://user:', hidden, '@example.invalid/file'].join('');
  check(safePath(userInfoPath).includes('SHA256:') && !safePath(userInfoPath).includes(hidden));
  // 模拟先暂存高危内容、随后清空工作文件；暂存区独有 blob 仍必须被发现。
  const stagedId = '1'.repeat(40);
  const index = parseIndex(Buffer.from(`100644 ${stagedId} 0\t虚构/示例.js\0`));
  const stagedBlobs = new Map([[stagedId, source(field, hidden)]]);
  const stagedFindings = [...index].flatMap(([oid, names]) => inspect(stagedBlobs.get(oid), [...names]));
  check(inspect(source(field, ''), ['虚构/示例.js']).length === 0 && stagedFindings.some(item => !item.reason));
  check(parseIndex(Buffer.from(`100644 ${stagedId} 0\t甲.js\0` + `100644 ${stagedId} 0\t乙.js\0`)).size === 1);
  for (const invalidPrefix of ['', '.', '..', '../my-app', '/my-app', 'my-app/', 'my-app//src', 'my-app/../src',
    'C:/my-app', 'my-app\\src', 'my-app/*', 'my-app/[a]', 'my-app:src']) check(!validScopePrefix(invalidPrefix));
  check(validScopePrefix('my-app') && validScopePrefix('my-app/中文目录'));
  check(withinScope('my-app/src/a.js', 'my-app') && !withinScope('my-app2/a.js', 'my-app')
    && !withinScope('other/my-app/a.js', 'my-app'));
  const scopedIndex = parseIndex(Buffer.from('100644 ' + stagedId + ' 0\tmy-app/a.js\0'
    + '100644 ' + stagedId + ' 0\tother/a.js\0'), 'my-app');
  check(scopedIndex.size === 1 && [...scopedIndex.values()][0].size === 1
    && [...scopedIndex.values()][0].has('my-app/a.js'));
  const allClassified = (text, names = ['tests/示例.test.js'], fixtures, sessions) => {
    const items = inspect(text, names, fixtures, sessions);
    return items.length > 0 && items.every(item => item.reason);
  };
  const pending = (text, names = ['tests/示例.test.js'], fixtures, sessions) => inspect(text, names, fixtures, sessions).some(item => !item.reason);
  const autocomplete = '<input value={password} autoComplete={isRegister ? \'new-password\' : \'current-password\'} />';
  check(allClassified(autocomplete, ['src/AccountPanel.jsx']));
  check(pending(source('password', ['current', 'password'].join('-')), ['src/示例.js']));
  check(pending(autocomplete.replace('current-password', 'z'.repeat(25)), ['src/AccountPanel.jsx']));
  const rejectedSession = value => `test('拒绝无效会话', async () => {\nfor (const session of [{access_token: ${value}}]) {\nconst {run} = setup({session});\nawait assert.rejects(run());\n}\n});`;
  for (const value of ['has space', 'bad\nvalue', 'bad\0value']) {
    const sessions = new Set([digest(JSON.stringify(value).slice(1, -1))]);
    check(allClassified(rejectedSession(JSON.stringify(value)), undefined, undefined, sessions));
    check(pending(rejectedSession(JSON.stringify(value)), ['src/示例.js'], undefined, sessions));
  }
  check(allClassified(rejectedSession(JSON.stringify('x') + '.repeat(8193)')));
  check(pending(rejectedSession(JSON.stringify('x') + '.repeat(8192)')));
  check(pending(rejectedSession(JSON.stringify('z'.repeat(30)))));
  check(pending(rejectedSession(JSON.stringify('z'.repeat(30) + ' '))));
  const doubleEscaped = JSON.stringify('bad\\nvalue');
  check(pending(rejectedSession(doubleEscaped), undefined, undefined, new Set([digest(doubleEscaped.slice(1, -1))])));
  check(pending(source('access_token', 'bad value')));
  const structuredSession = JSON.stringify(token + '\n');
  check(pending(rejectedSession(structuredSession), undefined, undefined, new Set([digest(structuredSession.slice(1, -1))])));
  const fixtureValue = ['Abc', '@', '123456'].join('');
  const fixtureSource = `const INPUT = {username: 'fictional-user', password: ${JSON.stringify(fixtureValue)}};\nconst fixture = () => createRegistrar({createUser: async () => success()});\n`;
  const reviewed = [{ sourceDigest: digest(fixtureSource), valueDigest: digest(fixtureValue) }];
  check(allClassified(fixtureSource, undefined, reviewed));
  check(pending(fixtureSource, ['src/示例.js'], reviewed));
  check(pending(fixtureSource, ['tests/示例.test.js', 'src/示例.js'], reviewed));
  check(pending(fixtureSource, undefined, []));
  check(pending(fixtureSource.replace(fixtureValue, 'z'.repeat(25)), undefined, reviewed));
  check(pending(fixtureSource + '\nfetch(endpoint, {body: JSON.stringify(INPUT)});', undefined, reviewed));
  check(pending(fixtureSource.replace('createUser: async () => success()', 'createUser: createActualUser'), undefined, reviewed));
  const jsonInput = JSON.stringify({ username: 'valid', password: fixtureValue });
  const rejectedSource = fixtureSource + `test('拒绝非法输入', () => {\nfor (const input of [JSON.parse('${jsonInput}')]) {\nassert.throws(() => validateInput(input));\n}\n});`;
  const reviewedJson = [{ sourceDigest: digest(rejectedSource), valueDigest: digest(fixtureValue) }];
  check(allClassified(rejectedSource, undefined, reviewedJson));
  check(pending(rejectedSource.replace('assert.throws(() => validateInput(input))', 'sendActual(input)'), undefined, reviewedJson));
  check(pending(source('password', fixtureValue)));
  for (const dangerous of [structured, token, privateHeader]) {
    const dangerousSource = fixtureSource.replace(fixtureValue, dangerous);
    const claimedReview = [{ sourceDigest: digest(dangerousSource), valueDigest: digest(dangerous) }];
    check(pending(dangerousSource, undefined, claimedReview));
  }
  console.log(`安全扫描内存自测：${count} 项通过；仅使用运行时拼接的虚构数据。`);
}

function runAudit(prefix) {
  const initial = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  if (initial.error || initial.status !== 0) throw new Error('无法从当前目录读取 Git 仓库根目录');
  const root = path.resolve(initial.stdout.trim());
  if (prefix !== undefined && !validScopePrefix(prefix)) throw new Error('参数无效：--path 必须是规范的仓库相对目录，禁止点路径、绝对路径、反斜线和路径通配符');
  const scopeRoot = prefix === undefined ? root : path.resolve(root, ...prefix.split('/'));
  if (prefix !== undefined) {
    let current = root;
    for (const component of prefix.split('/')) {
      current = path.join(current, component);
      let stat;
      try { stat = fs.lstatSync(current); } catch { throw new Error('参数无效：--path 必须指向仓库内现有目录'); }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('参数无效：--path 不允许符号链接、目录联接或非目录');
    }
  }
  const scopeArgs = prefix === undefined ? [] : ['--', prefix + '/'];
  console.log(prefix === undefined ? '扫描范围：整个 Git 仓库（沿用无参数行为）。'
    : '扫描范围：仓库相对目录 ' + safePath(prefix + '/') + '；工作区、暂存区及所有可达引用/reflog 历史内容均限定于此。');
  function git(args, input, optional = false) {
    const result = spawnSync('git', ['-C', root, ...args], { input, maxBuffer: 128 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      if (optional && !result.error && result.status === 1) return null;
      // 不回显 stderr，以免 Git 错误中包含远程地址或其他敏感信息。
      throw new Error(`Git 只读操作失败：${args[0]}（退出码 ${result.status ?? '未知'}）`);
    }
    return result.stdout;
  }
  const lines = (buffer) => buffer.toString('utf8').trim().split('\n').filter(Boolean);
  const zeroNames = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);
  const tracked = new Set(zeroNames(git(['ls-files', '--cached', '-z', ...scopeArgs])));
  const working = new Set(zeroNames(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', ...scopeArgs])));
  const stats = { workingRead: 0, currentEnvSkipped: 0, deletedWorking: 0, indexBlobs: 0, indexBytes: 0, historyBlobs: 0, historyBytes: 0, knownFake: 0, pending: 0 };
  const report = (scope, name, finding, oid) => {
    if (finding.reason) { stats.knownFake += 1; return; }
    stats.pending += 1;
    console.log(`待处理｜${scope}｜${safePath(name)}｜行 ${finding.line ?? '不适用'}｜${finding.rule}${oid ? `｜对象 ${oid.slice(0, 12)}` : ''}`);
  };
  const indexAliases = parseIndex(git(['ls-files', '--stage', '-z', ...scopeArgs]), prefix);
  for (const names of indexAliases.values()) {
    for (const name of names) if (sensitiveName(name)) report('暂存区', name, { rule: '暂存区包含敏感文件名' });
  }
  for (const name of [...working].sort()) {
    if (envName(name)) {
      stats.currentEnvSkipped += 1;
      if (tracked.has(name)) report('工作区', name, { rule: '真实环境配置被 Git 跟踪' });
      continue;
    }
    const absolute = path.resolve(root, name);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error('工作文件路径超出仓库边界');
    let status;
    try { status = fs.lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') { stats.deletedWorking += 1; continue; }
      throw new Error('工作文件元数据读取失败');
    }
    if (!status.isFile()) { report('工作区', name, { rule: '非普通文件未读取，需人工核验' }); continue; }
    if (prefix !== undefined) {
      let physicalParent;
      try { physicalParent = fs.realpathSync(path.dirname(absolute)); } catch { throw new Error('工作文件元数据读取失败'); }
      if (physicalParent !== scopeRoot && !physicalParent.startsWith(scopeRoot + path.sep)) throw new Error('工作文件路径超出扫描范围');
    }
    if (sensitiveName(name)) report('工作区', name, { rule: '敏感文件名需人工核验' });
    const text = fs.readFileSync(absolute).toString('utf8');
    stats.workingRead += 1;
    for (const finding of inspect(text, [name])) report('工作区', name, finding);
  }

  const commitIds = lines(git(['rev-list', '--all', '--reflog']));
  const roots = new Set(commitIds);
  const refs = lines(git(['for-each-ref', '--format=%(objectname) %(objecttype)']));
  for (const row of refs) {
    const [oid, type] = row.split(' ');
    if (type === 'commit' || type === 'tree') roots.add(oid);
    if (type === 'tag') roots.add(git(['rev-parse', `${oid}^{}`]).toString('utf8').trim());
  }
  const objectRows = prefix === undefined ? lines(git(['rev-list', '--objects', '--all', '--reflog'])) : [];
  const objectIds = new Set(objectRows.map(row => row.split(' ', 1)[0]));
  const aliases = new Map();
  const sensitiveHistory = new Set();
  for (const oid of roots) {
    for (const entry of zeroNames(git(['ls-tree', '-r', '-z', '--full-tree', oid, ...scopeArgs]))) {
      const tab = entry.indexOf('\t');
      const [, type, blob] = entry.slice(0, tab).split(' ');
      const name = entry.slice(tab + 1);
      if (type !== 'blob' || !withinScope(name, prefix)) continue;
      if (!aliases.has(blob)) aliases.set(blob, new Set());
      aliases.get(blob).add(name);
      if (sensitiveName(name)) sensitiveHistory.add(`${blob}\t${name}`);
    }
  }
  // 限定模式只读取该目录历史树收集的 blob，不枚举或读取兄弟目录对象内容。
  if (prefix !== undefined) for (const oid of aliases.keys()) objectIds.add(oid);
  for (const item of sensitiveHistory) {
    const [oid, name] = item.split('\t');
    report('Git历史', name, { rule: '历史中存在敏感文件名' }, oid);
  }
  if (objectIds.size || indexAliases.size) {
    const metadata = lines(git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], [...objectIds].join('\n') + '\n'));
    const historyBlobIds = new Set(metadata.filter(row => row.split(' ')[1] === 'blob').map(row => row.split(' ')[0]));
    const blobs = [...new Set([...historyBlobIds, ...indexAliases.keys()])];
    const data = git(['cat-file', '--batch'], blobs.join('\n') + '\n');
    let offset = 0;
    for (const expected of blobs) {
      const end = data.indexOf(10, offset);
      if (end < 0) throw new Error('Git blob 批量响应不完整');
      const [oid, type, rawSize] = data.subarray(offset, end).toString('ascii').split(' ');
      const size = Number(rawSize);
      if (oid !== expected || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + 1 + size >= data.length) throw new Error('Git blob 批量响应格式异常');
      const text = data.subarray(end + 1, end + 1 + size).toString('utf8');
      offset = end + 1 + size + 1;
      // 同一 blob 在历史与索引之间只读取一次，但分别统计和检查其路径归属。
      if (historyBlobIds.has(oid)) {
        const names = [...(aliases.get(oid) ?? [])].sort();
        if (!names.length) throw new Error('存在无法确定路径的历史 blob，扫描未完整完成');
        stats.historyBlobs += 1;
        stats.historyBytes += size;
        for (const finding of inspect(text, names)) report('Git历史', names[0], finding, oid);
      }
      if (indexAliases.has(oid)) {
        const names = [...indexAliases.get(oid)].sort();
        stats.indexBlobs += 1;
        stats.indexBytes += size;
        for (const finding of inspect(text, names)) report('暂存区', names[0], finding, oid);
      }
    }
  }
  function countCommits(ref) {
    if (git(['rev-parse', '--verify', '--quiet', ref], undefined, true) === null) return '无此引用';
    return git(['rev-list', '--count', ref, ...scopeArgs]).toString('utf8').trim();
  }
  console.log(`工作区：${tracked.size} 个跟踪路径；读取 ${stats.workingRead} 个跟踪或未忽略文件；跳过当前真实环境文件 ${stats.currentEnvSkipped} 个、已删除工作文件 ${stats.deletedWorking} 个。`);
  console.log(`暂存区：${stats.indexBlobs} 个唯一 blob；${stats.indexBytes} 字节；包含尚未进入可达历史的暂存内容。`);
  console.log(`Git 历史：${refs.length} 个引用；main ${countCommits('main')} 次提交；本地 origin/main ${countCommits('origin/main')} 次提交；全引用 ${lines(git(['rev-list', '--all', ...scopeArgs])).length} 次提交；含 reflog ${commitIds.length} 次提交。`);
  console.log(`历史覆盖：${roots.size} 个唯一提交或树根；${stats.historyBlobs} 个唯一 blob；${stats.historyBytes} 字节；敏感历史文件名 ${sensitiveHistory.size} 个。`);
  console.log(`明确虚构、示例或故意无效值：${stats.knownFake} 处（工作区、暂存区与历史分别计数；测试目录无整文件豁免）。`);
  console.log(`本轮规则下待处理凭证特征：${stats.pending} 条。`);
  console.log('当前被 Git 忽略的文件不枚举，包括依赖、构建、日志和已忽略的真实环境配置。');
  console.log('边界：未读取当前真实 .env 内容；索引与历史 blob 全部在内存检查。未验证凭证有效性，未扫描已不可达对象或外部配置；未知格式、编码、拆分或加密凭证可能漏检。');
  console.log('此结果不表示密钥相关变量名或单词为零；没有待处理特征也不等于绝对不存在密钥。');
  process.exitCode = stats.pending ? 1 : 0;
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') selfTest();
  else if (args.length === 0) runAudit();
  else if (args.length === 2 && args[0] === '--path') runAudit(args[1]);
  else throw new Error('参数无效：只支持无参数全仓扫描、--self-test 内存自测或 --path 规范仓库相对目录');
} catch (error) {
  // 只输出受控错误说明，不输出异常堆栈、源文本或 Git 返回内容。
  console.error(`安全审计未完成：${error instanceof assert.AssertionError ? '内存自测未通过' : error.message?.startsWith('Git ') || /^(无法从|工作文件路径|工作文件元数据|Git blob|存在无法|参数无效)/.test(error.message ?? '') ? error.message : '文件或进程读取失败，请检查权限和仓库完整性'}。`);
  process.exitCode = 2;
}

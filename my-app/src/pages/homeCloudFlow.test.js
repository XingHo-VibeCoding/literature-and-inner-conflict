import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

let dom;
let server;
let HomePage;
let createRoot;
let root;
let rows;
let sent;
let readMode;
let writeMode;
let pendingRead;
let mutationMode;
let pendingMutation;
let accountMode;
let pendingAccountLogin;
const accountOrigin = 'https://fictional-day27-auth.invalid';
const accountUsername = 'fictional-day27-trial';
const accountPassword = 'Fictional-Day27!27';
const originalGlobals = new Map();
const fictionalToken = 'fictional-day20-token';

function setGlobal(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function fictionalEntry() {
  return {
    id: 'day20-fictional-existing', entryDate: '2026-10-13',
    text: '  【虚构】保留原始空格。\n第二行。  ', textVersion: 2, revision: 2,
    createdAt: '2026-10-13T01:00:00.000Z', updatedAt: '2026-10-14T01:00:00.000Z',
    adoptedAnalysis: null, origin: null,
  };
}

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'day20-fictional-request' },
  });
}

function listReply(items = rows, { total = items.length, ...page } = {}) {
  return reply(200, {
    ok: true, data: { items: structuredClone(items), total,
      page: { limit: 20, nextCursor: null, hasMore: false, ...page } }, error: null,
  });
}

async function mockedFetch(url, options) {
  // 全部请求在内存中回答；从不转发公网，也不使用真实用户数据或凭证。
  if (url.startsWith(accountOrigin) || url === '/api/register') {
    sent.push({ url, method: options.method });
    if (url === '/api/register') {
      assert.deepEqual(JSON.parse(options.body), { username: accountUsername, password: accountPassword });
      if (accountMode === 'duplicate') return reply(409, { ok: false, data: null, error: { code: 'USERNAME_TAKEN', message: '内部响应不能透传' } });
      rows = [];
      if (accountMode === 'pending-register') return new Promise(resolve => { pendingAccountLogin = () => resolve(reply(201, { ok: true, data: { registered: true }, error: null })); });
      return reply(201, { ok: true, data: { registered: true }, error: null });
    }
    if (url.endsWith('/auth/v1/signin')) {
      assert.deepEqual(JSON.parse(options.body), { username: accountUsername, password: accountPassword });
      if (accountMode === 'login-reject' || accountMode === 'registered-login-failed') return reply(400, { error: 'invalid_username_or_password', error_description: accountPassword });
      if (accountMode === 'pending') return new Promise(resolve => { pendingAccountLogin = () => resolve(reply(200, { access_token: fictionalToken })); });
      return reply(200, { access_token: fictionalToken });
    }
    assert.equal(url, accountOrigin + '/auth/v1/user/me');
    assert.equal(options.headers.Authorization, 'Bearer ' + fictionalToken);
    return reply(200, { sub: 'fictional-day27-new-person', status: 'ACTIVE' });
  }
  assert.ok(url.startsWith('/api/'), '本地测试只接收开发代理路径');
  sent.push({ url, method: options.method, body: options.body, token: options.headers.Authorization });
  if (url.endsWith('/api/health')) {
    return reply(200, { ok: true, service: '【literature-and-inner-conflict】' });
  }
  assert.equal(options.headers.Authorization, `Bearer ${fictionalToken}`);
  if (options.method === 'PATCH' || options.method === 'DELETE') {
    if (mutationMode === 'network-error') throw new Error('【虚构内部详情】TypeError: fetch failed at private-path');
    if (mutationMode === 'server-error' || mutationMode === 'invalid-input') return reply(mutationMode === 'server-error' ? 503 : 400, {
      ok: false, data: null, error: { code: mutationMode === 'server-error' ? 'WRITE_FAILED' : 'INVALID_INPUT',
        message: '【虚构内部详情】SQL failed at private-path', retryable: false,
        fields: { text: '【虚构内部详情】invalid column text', '【虚构内部详情】unknown field': 'private-path' } },
    });
    if (mutationMode === 'conflict' || mutationMode === 'missing') return reply(mutationMode === 'conflict' ? 409 : 404, {
      ok: false, data: null, error: { code: mutationMode === 'conflict' ? 'VERSION_CONFLICT' : 'ENTRY_NOT_FOUND',
        message: mutationMode === 'conflict' ? '记录已变化，请重新读取。' : '找不到这条记录。', retryable: false },
    });
    const apply = () => {
      const entryId = decodeURIComponent(new URL(url, 'https://虚构.invalid').pathname.split('/').at(-1));
      const before = rows.find(entry => entry.id === entryId);
      assert.ok(before, '虚构写入的目标存在');
      if (options.method === 'PATCH') {
        const input = JSON.parse(options.body);
        assert.equal(input.expectedRevision, before.revision);
        const saved = { ...before, entryDate: input.entryDate, text: input.text,
          revision: before.revision + 1, textVersion: before.textVersion + (before.text === input.text ? 0 : 1), adoptedAnalysis: before.text === input.text ? before.adoptedAnalysis : null };
        rows = rows.map(entry => entry.id === entryId ? saved : entry);
        return reply(200, { ok: true, data: saved, error: null });
      }
      assert.equal(options.body, undefined, 'DELETE 没有 body');
      assert.equal(new URL(url, 'https://虚构.invalid').searchParams.get('expectedRevision'), String(before.revision));
      if (mutationMode !== 'delete-noop') rows = rows.filter(entry => entry.id !== entryId);
      return reply(200, { ok: true, data: { deleted: true, entryId }, error: null });
    };
    if (mutationMode === 'pending') return new Promise(resolve => { pendingMutation = () => resolve(apply()); });
    return apply();
  }
  if (options.method === 'POST') {
    if (writeMode === 'duplicate') {
      return reply(409, { ok: false, data: null,
        error: { code: 'DUPLICATE_ENTRY', message: '相同记录已经存在。', retryable: false } });
    }
    const input = JSON.parse(options.body);
    const saved = { ...fictionalEntry(), ...input, id: 'day20-fictional-written', textVersion: 1, revision: 1 };
    if (writeMode === 'concurrent-after-create') {
      // 模拟本次 POST 成功后，另一会话又写入20条同日记录，再开始 GET。
      const createdAt = Date.now() - 21000;
      saved.createdAt = new Date(createdAt).toISOString();
      saved.updatedAt = saved.createdAt;
      const concurrent = Array.from({ length: 20 }, (_, index) => {
        const timestamp = new Date(createdAt + (20 - index) * 1000).toISOString();
        return { ...saved, id: `day24-fictional-concurrent-${index}`,
          text: `【虚构·Day24并发写入】另一会话的第${index + 1}条记录。`,
          createdAt: timestamp, updatedAt: timestamp };
      });
      rows = [...concurrent, saved, ...rows];
      readMode = 'paged';
      return reply(201, { ok: true, data: saved, error: null });
    }
    rows = [saved, ...rows];
    return reply(201, { ok: true, data: saved, error: null });
  }
  if (readMode === 'unauthorized') {
    return reply(401, { ok: false, data: null,
      error: { code: 'UNAUTHENTICATED', message: '虚构凭证已过期。', retryable: false } });
  }
  if (readMode === 'network-error') throw new Error('虚构的网络层错误详情，不应透传');
  if (readMode === 'paged') {
    const offset = Number(new URL(url, 'https://虚构.invalid').searchParams.get('cursor') || 0);
    return listReply(rows.slice(offset, offset + 20), { total: rows.length,
      nextCursor: offset + 20 < rows.length ? String(offset + 20) : null, hasMore: offset + 20 < rows.length });
  }
  if (readMode === 'mutation-mismatch') return listReply(rows.map(entry => ({ ...entry, text: '【虚构】与 PATCH 结果不一致。' })));
  if (readMode === 'pending') return new Promise((resolve) => { pendingRead = () => resolve(listReply()); });
  if (readMode === 'mismatch' && rows.some((entry) => entry.id === 'day20-fictional-written')) {
    return listReply(rows.map((entry) => entry.id === 'day20-fictional-written'
      ? { ...entry, text: '【虚构】与本次提交不一致的读回内容。' } : entry));
  }
  return listReply();
}

before(async () => {
  dom = new JSDOM('<div id="root"></div>', {
    url: 'https://day20.test.invalid/#/', pretendToBeVisual: true,
  });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('fetch', mockedFetch);
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  // JSDOM 只补弹窗开关；确认和取消仍由真实 DOM 事件驱动。
  const dialog = dom.window.HTMLDialogElement.prototype;
  if (!dialog.showModal) dialog.showModal = function () { this.open = true; };
  if (!dialog.close) dialog.close = function () { this.open = false; };
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({
    configFile: false, plugins: [react()],
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_API_ORIGIN': JSON.stringify('https://day20-api.test.invalid'),
      'import.meta.env.VITE_AUTH_ORIGIN': JSON.stringify(accountOrigin) },
  });
  ({ default: HomePage } = await server.ssrLoadModule('/src/pages/HomePage.jsx'));
});

beforeEach(async () => {
  rows = [fictionalEntry()];
  sent = [];
  readMode = 'success';
  writeMode = 'success';
  pendingRead = null;
  mutationMode = 'success';
  pendingMutation = null;
  accountMode = 'success';
  pendingAccountLogin = null;
  window.history.replaceState(null, '', '#/');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(HomePage)));
  await settleUntil(() => document.body.textContent.includes('尚未读取你的云端记录')
    && document.body.textContent.includes('健康接口正常'), '首页健康与凭证准备状态');
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
});

after(async () => {
  if (server) await server.close();
  dom?.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function settleUntil(check, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  assert.fail(`等待超时：${label}`);
}

function button(label, scope = document) {
  const found = [...scope.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  assert.ok(found, `找到按钮：${label}`);
  return found;
}

async function click(element) {
  assert.ok(element, '操作目标存在');
  assert.notEqual(element.disabled, true, '操作目标可用');
  await act(async () => element.click());
}

async function prepareCredential() {
  const box = document.getElementById('cloud-access-token');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(box, fictionalToken);
    box.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => box.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(box.value, '', '提交凭证立即清空密码框');
}

function privateOriginal() { return document.querySelector('.home-cloud-original > p:last-child'); }
function posts() { return sent.filter((request) => request.method === 'POST'); }

test('虚构首页完整流程：原文保留、刷新跟随、409保草稿、201读回、清除私人数据', async () => {
  assert.equal(sent.length, 1, '无凭证仅请求健康接口');
  assert.equal(privateOriginal(), null);
  const guidance = document.querySelector('.home-guidance');
  assert.ok(guidance.textContent.includes('把此刻写下来'), '未读取时仍有文学引导');
  assert.ok(guidance.textContent.includes('本站原创寄语'), '引导不冒充用户记录或AI分析');
  assert.equal(document.querySelector('.home-cloud-analysis'), null);
  const recordTools = document.getElementById('home-record-tools');
  assert.equal(recordTools.open, false, '说明和刷新默认收在卡片按钮里');
  assert.equal(button('刷新状态与云端记录').closest('details'), recordTools);
  const requestsBeforeOpen = sent.length;
  await click(recordTools.querySelector('summary'));
  assert.equal(recordTools.open, true);
  assert.equal(sent.length, requestsBeforeOpen, '展开说明本身不发请求');
  const details = document.getElementById('home-cloud-check');
  const summary = details.querySelector('summary');
  assert.equal(details.open, false, '首页默认不展开技术检查内容');
  assert.equal(document.querySelector('.home-page').lastElementChild, details, '检查入口位于首页内容最下方');
  assert.doesNotMatch(document.querySelector('.home-state-card').textContent, /access_token|凭证|检查台/, '近况不再引导用户进入开发检查');
  await click(summary);
  assert.equal(details.open, true, '底部入口可展开');
  await click(summary);
  assert.equal(details.open, false, '同一入口可收起');
  await click(summary);
  assert.equal(window.location.hash, '#/', '展开检查台不占用首页 hash 路由');

  await prepareCredential();
  await settleUntil(() => privateOriginal(), '显示虚构数据库记录');
  assert.equal(privateOriginal().textContent, rows[0].text, '空格和换行逐字保留');
  assert.equal(document.querySelector('.home-cloud-original time').textContent, rows[0].entryDate);
  assert.ok(document.body.textContent.includes('暂无已采纳的 AI 分析'));
  assert.equal(document.querySelector('.home-cloud-analysis'), null, '没有生成假分析');
  assert.ok(document.body.textContent.includes('HTTP：200'));

  const originalBeforeAnalysis = rows[0].text;
  const dateBeforeAnalysis = rows[0].entryDate;
  rows = [{ ...rows[0], adoptedAnalysis: {
    source: 'ai', summary: '【虚构AI】从写下一句话，开始理解此刻。',
    questions: ['【虚构AI】你愿意先记下哪一件小事？'], sourceTextVersion: 2,
    generationRequestId: 'day27-fictional-analysis', adoptedAt: '2026-10-20T01:00:00.000Z',
  } }];
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => document.querySelector('.home-cloud-analysis .home-summary'), '显示虚构已采纳分析');
  const analysisBlock = document.querySelector('.home-cloud-analysis');
  const originalBlock = document.querySelector('.home-cloud-original');
  assert.ok(analysisBlock.textContent.includes('【虚构AI】从写下一句话'));
  assert.ok(analysisBlock.compareDocumentPosition(originalBlock) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, '已采纳摘要在原文前');
  assert.equal(document.querySelector('.home-guidance'), null, '已有真实采纳分析时不混入本站引导');
  assert.equal(privateOriginal().textContent, originalBeforeAnalysis, '原文不因摘要展示而改写');
  assert.equal(document.querySelector('.home-cloud-original time').textContent, dateBeforeAnalysis);

  rows = [{ ...rows[0], text: '【虚构】数据库改行后刷新跟随。', revision: 3, textVersion: 3, adoptedAnalysis: null }];
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => privateOriginal()?.textContent === rows[0].text, '刷新跟随改行');
  assert.ok(document.querySelector('.home-guidance'), '没有采纳分析时恢复本站引导');
  assert.equal(document.querySelector('.home-cloud-analysis'), null);

  writeMode = 'duplicate';
  const draft = document.getElementById('cloud-test-text').value;
  await click(button('写入虚构记录并读回核对'));
  await settleUntil(() => document.body.textContent.includes('重复提交已被接口拒绝（409）'), '409提示');
  assert.equal(document.getElementById('cloud-test-text').value, draft);
  assert.equal(rows.length, 1, '重复没有新增');
  assert.equal(document.querySelector('.home-cloud-write-success'), null);

  writeMode = 'success';
  await click(button('写入虚构记录并读回核对'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '201与GET完全一致核验');
  assert.equal(JSON.parse(posts()[0].body).text, JSON.parse(posts()[1].body).text, '手动重试仍使用同一草稿');
  assert.equal(privateOriginal().textContent, draft);
  assert.equal(rows.length, 2);
  assert.equal(button('已取得写入结果').disabled, true, '201后不能再次创建');
  const postCount = posts().length;
  await click(button('只读核对这次写入'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '只读重新核验');
  assert.equal(posts().length, postCount, '只读核验没有POST');

  await click(button('清除凭证与私人数据'));
  await settleUntil(() => document.body.textContent.includes('尚未读取你的云端记录'), '凭证清除');
  assert.equal(privateOriginal(), null);
  assert.equal(document.querySelector('.home-cloud-entry-list'), null);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
  assert.ok(!document.body.textContent.includes(fictionalToken));
});

test('身份401及网络失败明确报错，不能被显示成数据库空列表', async () => {
  readMode = 'unauthorized';
  await prepareCredential();
  await settleUntil(() => document.body.textContent.includes('登录凭证无效或已过期，请重新登录。'), '401错误');
  assert.ok(document.body.textContent.includes('尚未读取你的云端记录'));
  assert.ok(document.body.textContent.includes('HTTP：401'));
  assert.equal(privateOriginal(), null);
  assert.ok(!document.body.textContent.includes('当前身份的记录总数为 0'));

  readMode = 'network-error';
  await prepareCredential(); // 401已清除无效会话，重新准备后单独验证网络失败。
  await settleUntil(() => document.body.textContent.includes('云端记录暂时没有读到'), '网络错误');
  assert.ok(document.body.textContent.includes('网络请求失败'));
  assert.ok(!document.body.textContent.includes('虚构的网络层错误详情'));
  assert.equal(privateOriginal(), null);
  assert.ok(!document.body.textContent.includes('当前身份的记录总数为 0'));
});

test('清除凭证会作废正在读取的私人请求，迟到结果不能重新显示原文', async () => {
  readMode = 'pending';
  await prepareCredential();
  await settleUntil(() => pendingRead, '虚构的慢读取已发出');
  await click(button('清除凭证与私人数据'));
  await settleUntil(() => document.body.textContent.includes('尚未读取你的云端记录'), '清除后的准备状态');
  await act(async () => pendingRead());
  assert.equal(privateOriginal(), null);
  assert.equal(document.querySelector('.home-cloud-entry-list'), null);
  assert.ok(document.body.textContent.includes('本页未保存凭证'));
});

test('POST201但GET正文不一致时不记成功，仅重新读回且草稿完整保留', async () => {
  await prepareCredential();
  await settleUntil(() => privateOriginal(), '原有记录读取');
  readMode = 'mismatch';
  const draft = document.getElementById('cloud-test-text').value;
  await click(button('写入虚构记录并读回核对'));
  await settleUntil(() => document.body.textContent.includes('写入尚未核验'), '读回内容不一致');
  assert.equal(posts().length, 1);
  assert.equal(document.querySelector('.home-cloud-write-success'), null);
  assert.equal(document.getElementById('cloud-test-text').value, draft);
  assert.equal(button('已取得写入结果').disabled, true);

  readMode = 'success';
  await click(button('只读核对这次写入'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '只读核验取得一致正文');
  assert.equal(posts().length, 1, '没有重复写入');
  assert.equal(privateOriginal().textContent, draft);
});

test('Day24 新增目标在第二页时自动读回核对，只读重试不重复 POST', async () => {
  await prepareCredential();
  await settleUntil(() => privateOriginal(), '原有虚构记录读取');
  writeMode = 'concurrent-after-create';
  const draft = document.getElementById('cloud-test-text').value;
  await click(button('写入虚构记录并读回核对'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201')
    || document.body.textContent.includes('写入尚未核验'), '取得本次新增的读回结果');

  assert.equal(posts().length, 1, '整个新增核对只发送一次 POST');
  assert.equal(rows[20].id, 'day20-fictional-written', '20条更新记录使本次目标位于第二页');
  assert.equal(rows[20].text, draft, '第二页仍保留本次提交的原文');
  const secondPageReads = () => sent.filter(request => request.method === 'GET' && request.url.includes('cursor=20')).length;
  assert.ok(secondPageReads() > 0, '新增读回必须请求第二页，不能仅检查第一页就报告未读到');
  assert.ok(document.body.textContent.includes('写入验证通过：POST 201'), '已存在的第二页目标应核对成功');
  assert.ok([...document.querySelectorAll('.home-cloud-entry-list li')]
    .some(item => item.textContent.includes('day20-fictional-written') && item.textContent.includes(draft)), '页面展示同一ID及原文供人工核对');

  const previousSecondPageReads = secondPageReads();
  await click(button('只读核对这次写入'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '只读重试仍读回第二页目标');
  assert.equal(posts().length, 1, '只读重试不再发送 POST');
  assert.ok(secondPageReads() > previousSecondPageReads, '只读重试也实际请求第二页');
});


function mutations(method) { return sent.filter(request => request.method === method); }
function deleteDialog() { return document.querySelector('dialog[aria-labelledby="cloud-delete-confirm-title"]'); }
async function openDeleteConfirmation() {
  const deleteCount = mutations('DELETE').length;
  await click(button('删除这条云端记录'));
  await settleUntil(() => deleteDialog()?.open, '页内删除确认弹窗已打开');
  const dialog = deleteDialog();
  assert.equal(dialog.querySelector('#cloud-delete-confirm-title').textContent.trim(), '确认删除这条云端记录？');
  assert.equal(mutations('DELETE').length, deleteCount, '打开二次确认不能发送 DELETE');
  return dialog;
}
async function confirmDelete() {
  const dialog = await openDeleteConfirmation();
  await click(button('确认永久删除', dialog));
}
async function selectFirstEntry() {
  await prepareCredential();
  await settleUntil(() => document.querySelector('.home-cloud-entry-list'), '读取可编辑的虚构记录');
  const entries = document.querySelector('.home-cloud-returned');
  entries.open = true;
  await click(button('选择此记录进行修改或删除'));
}
async function changeEditText(text) {
  const box = document.getElementById('cloud-edit-text');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(box, text); box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
}

test('Day22 虚构闭环：PATCH 保留原文对比，DELETE 取消零请求，确认后 GET 不再返回', async () => {
  await selectFirstEntry();
  const before = structuredClone(rows[0]);
  const draft = '  【虚构·Day22】修改后记下另一个问题。\n空格与换行仍保留。  ';
  await changeEditText(draft);
  await click(button('保存修改并读回核对'));
  await settleUntil(() => document.body.textContent.includes('修改已核对：PATCH 200'), 'PATCH 后实际 GET 相同记录');
  assert.equal(mutations('PATCH').length, 1);
  assert.deepEqual(JSON.parse(mutations('PATCH')[0].body), { entryDate: before.entryDate, text: draft, expectedRevision: before.revision });
  assert.equal(rows[0].revision, before.revision + 1);
  const evidence = document.querySelector('[data-testid="patch-evidence"]');
  assert.ok(evidence.textContent.includes(before.text));
  assert.ok(evidence.textContent.includes(draft));
  assert.ok(evidence.textContent.includes('已经实际 GET 核对'));
  const dialog = await openDeleteConfirmation();
  assert.ok(dialog.textContent.includes(before.id));
  assert.ok(dialog.textContent.includes(before.entryDate));
  assert.ok(dialog.textContent.includes(draft));
  assert.equal(document.activeElement, button('取消删除', dialog), '删除确认默认聚焦取消');
  await click(button('取消删除', dialog));
  assert.ok(!deleteDialog()?.open, '取消后关闭弹窗');
  assert.equal(mutations('DELETE').length, 0, '取消后完全没有 DELETE 请求');
  assert.equal(rows.length, 1);
  assert.ok(document.body.textContent.includes('已取消删除，没有发送 DELETE 请求。'));
  await confirmDelete();
  await settleUntil(() => document.body.textContent.includes('删除已核对：DELETE 200'), '确认删除并 GET 全部分页核对');
  assert.equal(mutations('DELETE').length, 1);
  assert.equal(rows.length, 0);
  assert.equal(privateOriginal(), null);
  assert.ok(document.querySelector('[data-testid="delete-evidence"]').textContent.includes('GET 共 0 条，已读 0 条；全部返回中目标 ID 已消失'));
  assert.ok(document.querySelector('[data-testid="patch-evidence"]'), '删除后仍保留本次 PATCH 前后截图证据');
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test('Day22 修改 409/404 均保留草稿与中文错误，不能自动重试或标为成功', async () => {
  await selectFirstEntry();
  const draft = '【虚构·Day22】冲突时也要保留的修改草稿。';
  await changeEditText(draft);
  mutationMode = 'conflict';
  await click(button('保存修改并读回核对'));
  await settleUntil(() => document.body.textContent.includes('版本或数据冲突（409）'), '版本冲突可见');
  assert.equal(document.getElementById('cloud-edit-text').value, draft);
  assert.ok(document.body.textContent.includes('请先刷新云端记录核对'));
  assert.equal(mutations('PATCH').length, 1);
  mutationMode = 'missing';
  await click(button('保存修改并读回核对'));
  await settleUntil(() => document.body.textContent.includes('记录不存在或不属于当前用户。'), '不存在中文错误可见');
  assert.equal(document.getElementById('cloud-edit-text').value, draft);
  assert.equal(mutations('PATCH').length, 2);
  assert.equal(document.querySelector('[data-testid="patch-evidence"]'), null);
});

test('Day23 三类错误均显示中文并保留草稿，服务端原始异常和字段不进入页面', async () => {
  await selectFirstEntry();
  const before = structuredClone(rows[0]);
  const draft = '  【虚构·Day23】错误出现时仍要保留的原文。\n第二行不丢失。  ';
  await changeEditText(draft);
  for (const [mode, message] of [
    ['network-error', '网络请求失败，请核对网络连接与跨域配置后再手动重试。'],
    ['server-error', '服务暂时不可用，请稍后重试。'],
    ['invalid-input', '请检查必填字段和输入内容。'],
  ]) {
    mutationMode = mode;
    const beforeCount = mutations('PATCH').length;
    await click(button('保存修改并读回核对'));
    await settleUntil(() => document.body.textContent.includes(message), mode + '中文提示可见');
    assert.equal(document.getElementById('cloud-edit-text').value, draft, '三类失败均保留原始空格和换行');
    assert.equal(mutations('PATCH').length, beforeCount + 1, '仅发送本次人工触发的请求');
    assert.deepEqual(rows, [before], '失败未改变原记录');
    assert.equal(document.querySelector('[data-testid="patch-evidence"]'), null);
    assert.ok(!document.body.textContent.includes('【虚构内部详情】'));
    assert.ok(!document.body.textContent.includes('private-path'));
  }
  assert.ok(document.body.textContent.includes('请填写 1 至 5000 个有效字符的原文'));
});

test('Day22 PATCH200 但 GET 不一致只记尚未核对，手动只读核对不重复 PATCH', async () => {
  await selectFirstEntry();
  await changeEditText('【虚构·Day22】等待 GET 核对。');
  readMode = 'mutation-mismatch';
  await click(button('保存修改并读回核对'));
  await settleUntil(() => document.body.textContent.includes('PATCH 已返回 200，但读回尚未核对'), '读回不一致保留响应');
  assert.equal(document.querySelector('[data-testid="patch-evidence"]'), null);
  assert.equal(button('保存修改并读回核对').disabled, true);
  readMode = 'success';
  await click(button('只读核对这次修改或删除'));
  await settleUntil(() => document.body.textContent.includes('修改已核对：PATCH 200'), '只读核验通过');
  assert.equal(mutations('PATCH').length, 1);
});

test('Day22 DELETE 遍历全部页，目标藏在第二页不能误报已经删除', async () => {
  await selectFirstEntry();
  const target = rows[0];
  rows = [...Array.from({ length: 20 }, (_, i) => ({ ...fictionalEntry(), id: 'day22-fictional-page-' + i })), target];
  readMode = 'paged';
  mutationMode = 'delete-noop';
  await confirmDelete();
  await settleUntil(() => document.body.textContent.includes('GET 全部分页仍返回目标 ID'), '第二页中发现目标');
  assert.ok(sent.some(request => request.method === 'GET' && request.url.includes('cursor=20')), '实际请求第二页');
  assert.equal(document.querySelector('[data-testid="delete-evidence"]'), null);
  rows = rows.filter(entry => entry.id !== target.id);
  await click(button('只读核对这次修改或删除'));
  await settleUntil(() => document.body.textContent.includes('删除已核对：DELETE 200'), '全量只读核对通过');
  assert.equal(mutations('DELETE').length, 1);
  assert.ok(document.querySelector('[data-testid="delete-evidence"]').textContent.includes('GET 共 20 条，已读 20 条'));
});

test('Day22 慢 PATCH 防止连点，清除凭证作废迟到写响应和私人证据', async () => {
  await selectFirstEntry();
  mutationMode = 'pending';
  await changeEditText('【虚构·Day22】迟到写响应不能恢复私人数据。');
  await click(button('保存修改并读回核对'));
  await settleUntil(() => pendingMutation, '慢 PATCH 已发送');
  assert.equal(button('保存修改并读回核对').disabled, true);
  assert.equal(button('删除这条云端记录').disabled, true);
  await act(async () => button('删除这条云端记录').click());
  assert.ok(!deleteDialog()?.open, '慢 PATCH 期间禁用删除入口，不能打开确认');
  assert.equal(mutations('DELETE').length, 0, '慢 PATCH 期间没有 DELETE 请求');
  await act(async () => button('保存修改并读回核对').click());
  assert.equal(mutations('PATCH').length, 1);
  await click(button('清除凭证与私人数据'));
  await act(async () => pendingMutation());
  assert.equal(privateOriginal(), null);
  assert.equal(document.getElementById('cloud-edit-text'), null);
  assert.equal(document.querySelector('[data-testid="patch-evidence"]'), null);
  assert.equal(document.querySelector('[data-testid="delete-evidence"]'), null);
  assert.ok(document.body.textContent.includes('本页未保存凭证'));
  assert.ok(!document.body.textContent.includes('修改已核对：PATCH 200'));
});


test('Day22 DELETE 的 409/404 保留选中原文并显示中文错误，未删除也未标成功', async () => {
  await selectFirstEntry();
  mutationMode = 'conflict';
  await confirmDelete();
  await settleUntil(() => document.body.textContent.includes('版本或数据冲突（409）'), '删除冲突提示');
  assert.equal(rows.length, 1);
  assert.equal(document.getElementById('cloud-edit-text').value, rows[0].text);
  assert.equal(mutations('DELETE').length, 1);
  mutationMode = 'missing';
  await confirmDelete();
  await settleUntil(() => document.body.textContent.includes('记录不存在或不属于当前用户。'), '删除不存在中文提示');
  assert.equal(mutations('DELETE').length, 2);
  assert.equal(document.querySelector('[data-testid="delete-evidence"]'), null);
});

test('Day22 删除成功后确实读完多页，末页与 total 一致才给出删除证据', async () => {
  await selectFirstEntry();
  rows = [...rows, ...Array.from({ length: 25 }, (_, i) => ({ ...fictionalEntry(), id: 'day22-fictional-remaining-' + i }))];
  readMode = 'paged';
  await confirmDelete();
  await settleUntil(() => document.body.textContent.includes('删除已核对：DELETE 200'), '多页全部核对');
  const evidence = document.querySelector('[data-testid="delete-evidence"]');
  assert.ok(evidence.textContent.includes('已核对全部 2 页'));
  assert.ok(evidence.textContent.includes('GET 共 25 条，已读 25 条'));
  assert.ok(sent.some(request => request.method === 'GET' && request.url.includes('cursor=20')));
  assert.equal(rows.length, 25);
  assert.equal(mutations('DELETE').length, 1);
});
test('Day22 删除确认 Escape 取消保留目标和草稿，不发送 DELETE', async () => {
  await selectFirstEntry();
  const before = structuredClone(rows[0]);
  const draft = '【虚构·Day22】尚未保存的修改草稿。';
  await changeEditText(draft);
  const dialog = await openDeleteConfirmation();
  const staleConfirm = button('确认永久删除', dialog);
  // 浏览器按 Escape 会派发 cancel；JSDOM 在这里直接派发同一事件。
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.ok(!deleteDialog()?.open, 'Escape 关闭确认弹窗');
  assert.ok(document.body.textContent.includes('已取消删除，没有发送 DELETE 请求。'));
  assert.equal(document.getElementById('cloud-edit-text').value, draft);
  assert.deepEqual(rows, [before]);
  await act(async () => staleConfirm.click());
  assert.equal(mutations('DELETE').length, 0, 'Escape 后陈旧确认不能删除');
});

test('Day22 切换目标或刷新会作废旧删除确认，必须重新核对当前目标', async () => {
  const second = { ...fictionalEntry(), id: 'day22-fictional-second', text: '【虚构】第二条独立验证原文。', revision: 4 };
  rows.push(second);
  await selectFirstEntry();
  const firstDialog = await openDeleteConfirmation();
  const firstConfirm = button('确认永久删除', firstDialog);
  const selectors = [...document.querySelectorAll('button')]
    .filter(item => item.textContent.trim() === '选择此记录进行修改或删除');
  assert.equal(selectors.length, 2);
  // 在同一事件轮次调用旧按钮，验证同步防护而不只依赖重新渲染。
  await act(async () => { selectors[1].click(); firstConfirm.click(); });
  assert.ok(!deleteDialog()?.open, '切换记录立即关闭旧确认');
  assert.equal(mutations('DELETE').length, 0);
  assert.equal(document.getElementById('cloud-edit-text').value, second.text);

  const secondDialog = await openDeleteConfirmation();
  assert.ok(secondDialog.textContent.includes(second.id));
  assert.ok(secondDialog.textContent.includes(second.text));
  assert.ok(!secondDialog.textContent.includes(rows[0].id), '重新打开只展示当前目标');
  const secondConfirm = button('确认永久删除', secondDialog);
  readMode = 'pending';
  await act(async () => { button('刷新状态与云端记录').click(); secondConfirm.click(); });
  await settleUntil(() => pendingRead, '刷新触发慢读取');
  assert.ok(!deleteDialog()?.open, '刷新期间关闭待确认');
  assert.equal(mutations('DELETE').length, 0, '旧确认不能在读取期间删除');
  rows = rows.map(entry => entry.id === second.id ? { ...entry, revision: 5 } : entry);
  readMode = 'success';
  await act(async () => pendingRead());
  await settleUntil(() => document.querySelector('.home-cloud-entry-list'), '刷新读回完成');
  await act(async () => secondConfirm.click());
  assert.equal(mutations('DELETE').length, 0, '刷新结束也不能重新激活旧确认');
  assert.equal(rows.length, 2);
});

test('Day22 清凭证和离开页面都清除删除确认预览，旧按钮不能发请求', async () => {
  for (const action of ['clear', 'pagehide']) {
    await selectFirstEntry();
    const before = structuredClone(rows[0]);
    const dialog = await openDeleteConfirmation();
    const staleConfirm = button('确认永久删除', dialog);
    await act(async () => {
      if (action === 'clear') button('清除凭证与私人数据').click();
      else window.dispatchEvent(new dom.window.Event('pagehide'));
      staleConfirm.click();
    });
    assert.ok(!deleteDialog()?.open, '会话清理关闭弹窗');
    assert.ok(!deleteDialog()?.textContent.includes(before.text), '关闭后不保留私人原文预览');
    assert.ok(!deleteDialog()?.textContent.includes(before.id), '关闭后不保留私人目标 ID');
    assert.equal(document.getElementById('cloud-edit-text'), null);
    assert.equal(privateOriginal(), null);
    assert.equal(mutations('DELETE').length, 0, '会话清理后旧确认没有 DELETE 请求');
    assert.deepEqual(rows, [before]);
  }
});

test('Day22 其他写入及只读核对都会关闭待确认，不把陈旧确认当授权', async () => {
  await selectFirstEntry();
  let dialog = await openDeleteConfirmation();
  let staleConfirm = button('确认永久删除', dialog);
  await act(async () => { button('写入虚构记录并读回核对').click(); staleConfirm.click(); });
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '虚构新建及读回完成');
  assert.ok(!deleteDialog()?.open, '新建写入关闭旧确认');
  assert.equal(mutations('DELETE').length, 0);

  dialog = await openDeleteConfirmation();
  staleConfirm = button('确认永久删除', dialog);
  await act(async () => { button('只读核对这次写入').click(); staleConfirm.click(); });
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '只读核对完成');
  assert.ok(!deleteDialog()?.open, '只读核对关闭旧确认');
  assert.equal(mutations('DELETE').length, 0);
  assert.equal(posts().length, 1);
  assert.equal(rows.length, 2);
});

test('Day22 慢 DELETE 只发送一次，清凭证后迟到响应不能恢复私人证据', async () => {
  await selectFirstEntry();
  const dialog = await openDeleteConfirmation();
  const confirm = button('确认永久删除', dialog);
  mutationMode = 'pending';
  await act(async () => { confirm.click(); confirm.click(); });
  await settleUntil(() => pendingMutation, '慢 DELETE 已发送');
  assert.equal(mutations('DELETE').length, 1, '连续确认只发送一次 DELETE');
  assert.ok(!deleteDialog()?.open, '请求发出后确认弹窗立即关闭');
  assert.equal(button('删除这条云端记录').disabled, true);
  await act(async () => { confirm.click(); button('删除这条云端记录').click(); });
  assert.equal(mutations('DELETE').length, 1, '慢请求期间不能重复删除');

  await click(button('清除凭证与私人数据'));
  await act(async () => pendingMutation());
  assert.equal(mutations('DELETE').length, 1);
  assert.ok(!deleteDialog()?.open);
  assert.equal(privateOriginal(), null);
  assert.equal(document.getElementById('cloud-edit-text'), null);
  assert.equal(document.querySelector('[data-testid="delete-evidence"]'), null);
  assert.ok(!document.body.textContent.includes('删除已核对：DELETE 200'));
  assert.ok(document.body.textContent.includes('本页未保存凭证'));
  // 已发出的请求可能已在服务端删除；这里只保证迟到响应不恢复私人界面。
});


async function fillAccountField(name, value) {
  const input = document.querySelector('.home-account [name="' + name + '"]');
  assert.ok(input, '账号字段存在：' + name);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function useAccount(mode = 'login', { twice = false } = {}) {
  if (!document.querySelector('.home-account-form')) await click(button('登录 / 注册'));
  if (mode === 'register') await click(button('注册', document.querySelector('.home-account-modes')));
  await fillAccountField('username', accountUsername);
  await fillAccountField('password', accountPassword);
  if (mode === 'register') await fillAccountField('password-confirmation', accountPassword);
  await act(async () => {
    const form = document.querySelector('.home-account-form');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    if (twice) form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  for (const input of document.querySelectorAll('.home-account input[type="password"]')) assert.equal(input.value, '', '提交立即清空密码');
}

function assertAccountSecretsAbsent() {
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.ok(!document.body.textContent.includes(accountPassword));
  assert.ok(!document.body.textContent.includes(fictionalToken));
}

test('Day27 普通账号登录读取任意真实身份对应的虚构记录，退出清空私人内容', async () => {
  await useAccount();
  await settleUntil(() => document.querySelector('.home-account-signed-in') && document.querySelector('.home-cloud-original'), '普通登录读取');
  assert.equal(document.querySelector('.home-cloud-original').textContent.includes(rows[0].text), true);
  assert.deepEqual(sent.filter(request => request.url.startsWith(accountOrigin)).map(request => request.url), [accountOrigin + '/auth/v1/signin', accountOrigin + '/auth/v1/user/me']);
  assert.equal(document.getElementById('home-cloud-check').open, false, '登录不自动展开检查台');
  assertAccountSecretsAbsent();
  const draftBox = document.getElementById('cloud-test-text');
  const draftSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { draftSetter.call(draftBox, '【虚构私人草稿】退出后必须清除'); draftBox.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(button('退出登录'));
  assert.ok(!draftBox.value.includes('【虚构私人草稿】'));
  assert.equal(Boolean(document.querySelector('.home-cloud-original')), false);
  assert.equal(Boolean(document.querySelector('.home-account-signed-in')), false);
  assertAccountSecretsAbsent();
});

test('Day27 注册后以新身份完成虚构云端新增刷新修改删除，原文日期和版本可核对', async () => {
  await useAccount('register');
  await settleUntil(() => document.querySelector('.home-account-signed-in') && document.body.textContent.includes('当前身份的记录总数为 0'), '注册后空列表');
  assert.equal(sent.filter(request => request.url === '/api/register').length, 1);
  assert.equal(Boolean(document.querySelector('.home-cloud-original')), false, '新账号不显示别人的虚构原文');
  await click(document.querySelector('#home-cloud-check > summary'));
  await click(button('写入虚构记录并读回核对'));
  await settleUntil(() => document.body.textContent.includes('写入验证通过：POST 201'), '注册后写入');
  const before = structuredClone(rows[0]);
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => document.querySelector('.home-cloud-original')?.textContent.includes(before.text), '刷新保留原文');
  await click(button('选择此记录进行修改或删除'));
  const original = before.text + '\n【虚构·Day27复验】修改后仍保留日期。';
  const textarea = document.getElementById('cloud-edit-text');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(textarea, original); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => textarea.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await settleUntil(() => document.querySelector('[data-testid="patch-evidence"]'), '注册后修改');
  assert.equal(rows[0].entryDate, before.entryDate);
  assert.equal(rows[0].text, original);
  await click(button('删除这条云端记录'));
  await click(button('确认永久删除'));
  await settleUntil(() => document.querySelector('[data-testid="delete-evidence"]'), '注册后删除');
  assert.equal(rows.length, 0);
  assertAccountSecretsAbsent();
});

test('Day27 登录失败显示固定中文，注册重名不继续登录或覆盖账号', async () => {
  accountMode = 'login-reject';
  await useAccount();
  await settleUntil(() => document.body.textContent.includes('用户名或密码不正确'), '密码错误');
  assert.equal(sent.filter(request => request.url.endsWith('/auth/v1/user/me')).length, 0);
  assertAccountSecretsAbsent();
  accountMode = 'duplicate';
  await useAccount('register');
  await settleUntil(() => document.body.textContent.includes('这个用户名已被使用'), '账号重名');
  assert.equal(sent.filter(request => request.url.endsWith('/auth/v1/signin')).length, 1, '重复注册不发送登录或重试');
  assertAccountSecretsAbsent();
});

test('Day27 取消待定普通登录及pagehide作废迟到身份，不能恢复私人内容', async () => {
  accountMode = 'pending';
  await useAccount('login', { twice: true });
  await settleUntil(() => pendingAccountLogin, '待定登录');
  assert.equal(sent.filter(request => request.url.endsWith('/auth/v1/signin')).length, 1);
  await click(button('取消', document.querySelector('.home-account')));
  await act(async () => { pendingAccountLogin(); });
  assert.equal(sent.filter(request => request.url.endsWith('/auth/v1/user/me')).length, 0);
  assert.equal(Boolean(document.querySelector('.home-cloud-original')), false);
  accountMode = 'success';
  await useAccount();
  await settleUntil(() => document.querySelector('.home-cloud-original'), '取消后重新登录');
  await act(async () => window.dispatchEvent(new dom.window.Event('pagehide')));
  assert.equal(Boolean(document.querySelector('.home-cloud-original')), false);
  assert.equal(Boolean(document.querySelector('.home-account-signed-in')), false);
  assertAccountSecretsAbsent();
});

test('Day27 普通会话401清空私人内容并在收起面板外提示重新登录', async () => {
  await useAccount();
  await settleUntil(() => document.querySelector('.home-cloud-original'), '先登录');
  readMode = 'unauthorized';
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => document.body.textContent.includes('登录状态已失效，请重新登录。'), '过期提示');
  assert.equal(Boolean(document.querySelector('.home-cloud-original')), false);
  assert.equal(Boolean(document.querySelector('.home-account-signed-in')), false);
  assert.equal(Boolean(document.querySelector('.home-account-form')), false, '面板仍收起而提示可见');
  assert.equal(button('写入虚构记录并读回核对').disabled, true);
  readMode = 'success';
  await useAccount();
  await settleUntil(() => document.querySelector('.home-cloud-original'), '过期后可重新登录');
  assertAccountSecretsAbsent();
});

test('Day27 账号已创建但自动登录失败时切换登录，不诱导再次注册', async () => {
  accountMode = 'registered-login-failed';
  await useAccount('register');
  await settleUntil(() => document.body.textContent.includes('账号已创建，自动登录未完成'), '已创建但登录失败');
  assert.equal(document.querySelector('.home-account-modes button[aria-pressed="true"]').textContent, '登录');
  assert.equal(Boolean(document.querySelector('.home-account [name="password-confirmation"]')), false);
  assert.equal(sent.filter(request => request.url === '/api/register').length, 1);
  assertAccountSecretsAbsent();
});


test('Day27 取消在途注册保留结果未知提示并切登录，迟到201不能恢复会话', async () => {
  accountMode = 'pending-register';
  await useAccount('register');
  await settleUntil(() => pendingAccountLogin, '注册请求已发出');
  await click(button('取消', document.querySelector('.home-account')));
  assert.ok(document.body.textContent.includes('结果尚未确认。请先尝试登录'));
  await act(async () => { pendingAccountLogin(); });
  assert.equal(sent.filter(request => request.url.endsWith('/auth/v1/signin')).length, 0);
  await click(button('登录 / 注册'));
  assert.equal(document.querySelector('.home-account-modes button[aria-pressed="true"]').textContent, '登录');
  assert.equal(Boolean(document.querySelector('.home-account-signed-in')), false);
  assertAccountSecretsAbsent();
});

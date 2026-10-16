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
let confirmations;
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
  assert.ok(url.startsWith('/api/'), '本地测试只接收开发代理路径');
  sent.push({ url, method: options.method, body: options.body, token: options.headers.Authorization });
  if (url.endsWith('/api/health')) {
    return reply(200, { ok: true, service: '【literature-and-inner-conflict】' });
  }
  assert.equal(options.headers.Authorization, `Bearer ${fictionalToken}`);
  if (options.method === 'PATCH' || options.method === 'DELETE') {
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
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({
    configFile: false, plugins: [react()],
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_API_ORIGIN': JSON.stringify('https://day20-api.test.invalid') },
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
  confirmations = [];
  window.confirm = message => { confirmations.push(message); return true; };
  window.history.replaceState(null, '', '#/');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(HomePage)));
  await settleUntil(() => document.body.textContent.includes('先准备云端读取凭证')
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

function button(label) {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
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
  await click(button('展开下方检查台 ↓'));
  const details = document.getElementById('home-cloud-check');
  assert.equal(details.open, true);
  assert.equal(window.location.hash, '#/', '展开检查台不占用首页 hash 路由');
  assert.equal(document.activeElement, details.querySelector('summary'));

  await prepareCredential();
  await settleUntil(() => privateOriginal(), '显示虚构数据库记录');
  assert.equal(privateOriginal().textContent, rows[0].text, '空格和换行逐字保留');
  assert.equal(document.querySelector('.home-cloud-original time').textContent, rows[0].entryDate);
  assert.ok(document.body.textContent.includes('暂无已采纳的 AI 分析'));
  assert.equal(document.querySelector('.home-cloud-analysis'), null, '没有生成假分析');
  assert.ok(document.body.textContent.includes('HTTP：200'));

  rows = [{ ...rows[0], text: '【虚构】数据库改行后刷新跟随。', revision: 3, textVersion: 3 }];
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => privateOriginal()?.textContent === rows[0].text, '刷新跟随改行');

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
  await settleUntil(() => document.body.textContent.includes('先准备云端读取凭证'), '凭证清除');
  assert.equal(privateOriginal(), null);
  assert.equal(document.querySelector('.home-cloud-entry-list'), null);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
  assert.ok(!document.body.textContent.includes(fictionalToken));
});

test('身份401及网络失败明确报错，不能被显示成数据库空列表', async () => {
  readMode = 'unauthorized';
  await prepareCredential();
  await settleUntil(() => document.body.textContent.includes('虚构凭证已过期。'), '401错误');
  assert.ok(document.body.textContent.includes('先准备云端读取凭证'));
  assert.ok(document.body.textContent.includes('HTTP：401'));
  assert.equal(privateOriginal(), null);
  assert.ok(!document.body.textContent.includes('当前身份的记录总数为 0'));

  readMode = 'network-error';
  await click(button('刷新状态与云端记录'));
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
  await settleUntil(() => document.body.textContent.includes('先准备云端读取凭证'), '清除后的准备状态');
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


function mutations(method) { return sent.filter(request => request.method === method); }
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
  window.confirm = message => { confirmations.push(message); return false; };
  await click(button('删除这条云端记录'));
  assert.equal(mutations('DELETE').length, 0, '取消后完全没有 DELETE 请求');
  assert.equal(rows.length, 1);
  assert.ok(confirmations[0].includes(before.id));
  assert.ok(confirmations[0].includes(before.entryDate));
  assert.ok(confirmations[0].includes(draft));
  assert.ok(document.body.textContent.includes('已取消删除'));
  window.confirm = message => { confirmations.push(message); return true; };
  await click(button('删除这条云端记录'));
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
  await settleUntil(() => document.body.textContent.includes('找不到这条记录。'), '不存在中文错误可见');
  assert.equal(document.getElementById('cloud-edit-text').value, draft);
  assert.equal(mutations('PATCH').length, 2);
  assert.equal(document.querySelector('[data-testid="patch-evidence"]'), null);
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
  await click(button('删除这条云端记录'));
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
  await click(button('删除这条云端记录'));
  await settleUntil(() => document.body.textContent.includes('版本或数据冲突（409）'), '删除冲突提示');
  assert.equal(rows.length, 1);
  assert.equal(document.getElementById('cloud-edit-text').value, rows[0].text);
  assert.equal(mutations('DELETE').length, 1);
  mutationMode = 'missing';
  await click(button('删除这条云端记录'));
  await settleUntil(() => document.body.textContent.includes('找不到这条记录。'), '删除不存在中文提示');
  assert.equal(mutations('DELETE').length, 2);
  assert.equal(document.querySelector('[data-testid="delete-evidence"]'), null);
});

test('Day22 删除成功后确实读完多页，末页与 total 一致才给出删除证据', async () => {
  await selectFirstEntry();
  rows = [...rows, ...Array.from({ length: 25 }, (_, i) => ({ ...fictionalEntry(), id: 'day22-fictional-remaining-' + i }))];
  readMode = 'paged';
  await click(button('删除这条云端记录'));
  await settleUntil(() => document.body.textContent.includes('删除已核对：DELETE 200'), '多页全部核对');
  const evidence = document.querySelector('[data-testid="delete-evidence"]');
  assert.ok(evidence.textContent.includes('已核对全部 2 页'));
  assert.ok(evidence.textContent.includes('GET 共 25 条，已读 25 条'));
  assert.ok(sent.some(request => request.method === 'GET' && request.url.includes('cursor=20')));
  assert.equal(rows.length, 25);
  assert.equal(mutations('DELETE').length, 1);
});

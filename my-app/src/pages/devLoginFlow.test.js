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
let mode;
let sent;
let pendingLogin;
let loginSignal;
let clipboardWrites;
let clipboardReject;
const originalGlobals = new Map();
const fakeUsername = 'fictional-day20-login';
const fakePassword = 'fictional-day20-password';
const fakeToken = 'fictional-day20-access-token';
const fakeUserId = 'fictional-day20-user';
const fakeEntry = {
  id: 'fictional-day20-entry', entryDate: '2026-10-14',
  text: '【虚构】本地登录核验后才能读取的云端原文。', textVersion: 1, revision: 1,
  createdAt: '2026-10-14T01:00:00.000Z', updatedAt: '2026-10-14T01:00:00.000Z',
  adoptedAnalysis: null, origin: null,
};

function setGlobal(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'fictional-day20-request' },
  });
}

async function mockedFetch(url, options) {
  // 使用独立虚构身份和内存响应；不请求公网、不使用本机账号或私人数据库。
  sent.push({ url, method: options.method });
  if (url === '/api/health') return reply(200, { ok: true, service: '【literature-and-inner-conflict】' });
  if (url === '/__day20-auth/signin') {
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { username: fakeUsername, password: fakePassword });
    loginSignal = options.signal;
    if (mode === 'login-401') return reply(401, { message: fakePassword });
    if (mode === 'pending-login') return new Promise((resolve) => {
      pendingLogin = () => resolve(reply(200, { access_token: fakeToken }));
    });
    return reply(200, { access_token: fakeToken });
  }
  if (url === '/__day20-auth/user/me') {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer ${fakeToken}`);
    return reply(200, { sub: mode === 'wrong-identity' ? 'fictional-another-user' : fakeUserId, status: 'ACTIVE' });
  }
  assert.equal(url, '/api/entries?limit=20');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, `Bearer ${fakeToken}`);
  if (mode === 'entries-401') return reply(401, { ok: false, data: null,
    error: { code: 'UNAUTHENTICATED', message: '虚构的 entries 凭证已过期。', retryable: false } });
  return reply(200, { ok: true, data: { items: [fakeEntry], total: 1,
    page: { limit: 20, nextCursor: null, hasMore: false } }, error: null });
}

before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://day20-dev.test.invalid/#/', pretendToBeVisual: true });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: {
    async writeText(value) {
      // 只模拟剪贴板，绝不访问操作系统剪贴板。
      if (clipboardReject) throw new Error(`${fakePassword} ${fakeToken}`);
      clipboardWrites.push(value);
    },
  } });
  setGlobal('fetch', mockedFetch);
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({ configFile: false, plugins: [react()],
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: {
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify('https://day20-api.test.invalid'),
      'import.meta.env.VITE_TEST_USER_ID': JSON.stringify(fakeUserId),
    },
  });
  ({ default: HomePage } = await server.ssrLoadModule('/src/pages/HomePage.jsx'));
});

beforeEach(async () => {
  mode = 'success';
  sent = [];
  pendingLogin = null;
  loginSignal = null;
  clipboardWrites = [];
  clipboardReject = false;
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(HomePage)));
  await settleUntil(() => document.body.textContent.includes('健康接口正常')
    && document.body.textContent.includes('先准备云端读取凭证'), '初始准备状态');
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
  const found = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
  assert.ok(found, `找到按钮：${label}`);
  return found;
}

async function fill(element, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function submitLogin({ twice = false } = {}) {
  const username = document.getElementById('cloud-test-username');
  const password = document.getElementById('cloud-test-password');
  assert.equal(password.type, 'password');
  assert.equal(password.autocomplete, 'off');
  await fill(username, fakeUsername);
  await fill(password, fakePassword);
  await act(async () => {
    const form = password.closest('form');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    if (twice) form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(password.value, '', '提交后立即清空密码框');
}

function requests(path) { return sent.filter((request) => request.url === path); }
function privateOriginal() { return document.querySelector('.home-cloud-original'); }
function assertNoSavedSecrets() {
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(document.getElementById('cloud-access-token').value, '');
  assert.ok(!document.body.textContent.includes(fakePassword));
  assert.ok(!document.body.textContent.includes(fakeToken));
}

test('DEV登录正常两步后才读取entries，密码即清空且凭证仅页内使用', async () => {
  await submitLogin();
  await settleUntil(() => privateOriginal(), '身份核验后显示云端原文');
  assert.deepEqual(sent.map((request) => request.url), [
    '/api/health', '/__day20-auth/signin', '/__day20-auth/user/me', '/api/entries?limit=20',
  ]);
  assert.ok(document.body.textContent.includes('登录 HTTP：200'));
  assert.ok(document.body.textContent.includes('身份核验 HTTP：200'));
  assert.ok(document.body.textContent.includes('测试 UID 一致：true'));
  assert.equal(privateOriginal().querySelector('p:last-child').textContent, fakeEntry.text);
  assert.equal(sent.filter((request) => request.method === 'POST').length, 1, '只有登录POST，没有业务写入');
  assertNoSavedSecrets();
});

test('登录401立即停止，不核验身份或读库，失败提示不泄露密码', async () => {
  mode = 'login-401';
  await submitLogin();
  await settleUntil(() => document.body.textContent.includes('测试账号登录未成功'), '登录失败提示');
  assert.equal(requests('/__day20-auth/signin').length, 1);
  assert.equal(requests('/__day20-auth/user/me').length, 0);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.ok(document.body.textContent.includes('登录 HTTP：401'));
  assert.ok(document.body.textContent.includes('测试 UID 一致：尚未核验'));
  assert.equal(document.getElementById('cloud-test-username').value, fakeUsername, '失败可保留用户名供核对');
  assert.equal(privateOriginal(), null);
  assertNoSavedSecrets();
});

test('登录成功但UID不一致时停止，不把令牌交给私人接口', async () => {
  mode = 'wrong-identity';
  await submitLogin();
  await settleUntil(() => document.body.textContent.includes('登录用户与已配置的测试账号不一致'), '身份不符提示');
  assert.equal(requests('/__day20-auth/signin').length, 1);
  assert.equal(requests('/__day20-auth/user/me').length, 1);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.ok(document.body.textContent.includes('测试 UID 一致：false'));
  assert.equal(privateOriginal(), null);
  assertNoSavedSecrets();
});

test('清除凭证取消待定登录，重复提交被拦截且迟到响应不能恢复凭证', async () => {
  mode = 'pending-login';
  await submitLogin({ twice: true });
  await settleUntil(() => pendingLogin, '待定登录已发出');
  assert.equal(requests('/__day20-auth/signin').length, 1, '并发登录提交只发一次');
  assert.equal(button('正在登录并核验…').disabled, true);
  assert.equal(document.getElementById('cloud-access-token').disabled, true);
  assert.equal(button('写入虚构记录并读回核对').disabled, true);
  await act(async () => button('清除凭证与私人数据').click());
  assert.equal(loginSignal.aborted, true, '清除会取消登录请求');
  await act(async () => pendingLogin());
  assert.equal(requests('/__day20-auth/user/me').length, 0);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.equal(privateOriginal(), null);
  assert.ok(document.body.textContent.includes('本页未保存凭证'));
  assert.ok(!document.body.textContent.includes('测试 UID 一致：true'));
  assertNoSavedSecrets();
});

test('离开首页取消登录，重新进入后迟到响应不能恢复上一页凭证', async () => {
  mode = 'pending-login';
  await submitLogin();
  await settleUntil(() => pendingLogin, '离页前待定登录');
  const finishOldLogin = pendingLogin;
  await act(async () => root.unmount());
  root = null;
  assert.equal(loginSignal.aborted, true);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(HomePage)));
  await act(async () => finishOldLogin());
  await settleUntil(() => document.body.textContent.includes('本页未保存凭证'), '新页面未保留旧凭证');
  assert.equal(requests('/__day20-auth/user/me').length, 0);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.equal(privateOriginal(), null);
  assertNoSavedSecrets();
});

test('pagehide清除已读数据与登录输入，迟到登录不能恢复且同组件可重新登录', async () => {
  await submitLogin();
  await settleUntil(() => privateOriginal(), 'pagehide前已读取私人数据');
  await fill(document.getElementById('cloud-test-password'), fakePassword);
  await fill(document.getElementById('cloud-access-token'), fakeToken);
  const firstReadCount = requests('/api/entries?limit=20').length;
  await act(async () => window.dispatchEvent(new dom.window.Event('pagehide')));
  await settleUntil(() => document.body.textContent.includes('本页未保存凭证'), 'pagehide后凭证为空');
  assert.equal(privateOriginal(), null);
  assert.equal(document.querySelector('.home-cloud-entry-list'), null);
  assert.equal(document.getElementById('cloud-test-username').value, '');
  assert.equal(document.getElementById('cloud-test-password').value, '');
  assert.equal(document.getElementById('cloud-access-token').value, '');
  assert.ok(!document.body.textContent.includes('测试 UID 一致：true'));
  await act(async () => button('刷新状态与云端记录').click());
  await settleUntil(() => document.body.textContent.includes('先准备云端读取凭证'), '返回页面刷新仍无凭证');
  assert.equal(requests('/api/entries?limit=20').length, firstReadCount, 'pagehide清token后不再带凭证读库');

  mode = 'pending-login';
  await submitLogin();
  await settleUntil(() => pendingLogin, '第二次待定登录已发出');
  const beforeLateProfiles = requests('/__day20-auth/user/me').length;
  const finishOldLogin = pendingLogin;
  await act(async () => window.dispatchEvent(new dom.window.Event('pagehide')));
  assert.equal(loginSignal.aborted, true);
  await act(async () => finishOldLogin());
  assert.equal(requests('/__day20-auth/user/me').length, beforeLateProfiles);
  assert.equal(requests('/api/entries?limit=20').length, firstReadCount);
  assert.equal(privateOriginal(), null);
  assert.ok(document.body.textContent.includes('本页未保存凭证'));
  assertNoSavedSecrets();

  // 往返缓存保留当前组件；清理后由用户重新登录仍可正常走完身份与读取。
  mode = 'success';
  await submitLogin();
  await settleUntil(() => privateOriginal(), '同组件重新登录读取成功');
  assert.equal(requests('/api/entries?limit=20').length, firstReadCount + 1);
  assert.ok(document.body.textContent.includes('测试 UID 一致：true'));
  assertNoSavedSecrets();
});


test('复制仅限显式点击且读取200后可用，401/清除禁用，剪贴板拒绝提示不泄漏', async () => {
  const copyButton = () => button('复制短期凭证供公网验收');
  assert.equal(copyButton().disabled, true);
  await act(async () => copyButton().click());
  assert.deepEqual(clipboardWrites, [], '未准备凭证不能复制');
  await submitLogin();
  await settleUntil(() => privateOriginal(), '复制前已认证读取200');
  assert.equal(copyButton().disabled, false);
  assert.deepEqual(clipboardWrites, [], '登录与读取不会自动复制');

  await act(async () => copyButton().click());
  await settleUntil(() => document.body.textContent.includes('短期凭证已复制。'), '显式复制提示');
  assert.deepEqual(clipboardWrites, [fakeToken], '复制的值为当前页内虚构短期令牌');
  assert.ok(document.body.textContent.includes('使用后覆盖或清空剪贴板'));
  assertNoSavedSecrets();

  clipboardReject = true;
  await act(async () => copyButton().click());
  await settleUntil(() => document.body.textContent.includes('复制失败，请检查浏览器剪贴板权限后手动重试。'), '剪贴板拒绝固定提示');
  assert.deepEqual(clipboardWrites, [fakeToken]);
  assertNoSavedSecrets();

  await act(async () => window.dispatchEvent(new dom.window.Event('pagehide')));
  assert.equal(copyButton().disabled, true, 'pagehide后禁用复制');
  mode = 'entries-401';
  await submitLogin();
  await settleUntil(() => document.body.textContent.includes('虚构的 entries 凭证已过期。'), '401后禁用复制');
  assert.equal(copyButton().disabled, true);
  await act(async () => copyButton().click());
  assert.deepEqual(clipboardWrites, [fakeToken], '401不能再复制');

  await act(async () => button('清除凭证与私人数据').click());
  assert.equal(copyButton().disabled, true);
  await act(async () => copyButton().click());
  assert.deepEqual(clipboardWrites, [fakeToken], '清凭证后不能复制');
  assertNoSavedSecrets();
});
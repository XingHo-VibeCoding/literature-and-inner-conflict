import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const AUTH_ORIGIN = 'https://fictional-day30-auth.invalid';
const API_ORIGIN = 'https://fictional-day30-api.invalid';
const USERNAME = 'fictional.day30.reader';
const PASSWORD = 'Fictional-Day30!30';
const TOKEN = 'fictional-day30-short-access-token';
const REFRESH_TOKEN = 'fictional-day30-unused-refresh-token';
const USER_ID = 'fictional-day30-ordinary-person';
const STORAGE_KEY = 'literature.account-session.v1:' + AUTH_ORIGIN;
const originalGlobals = new Map();
const fictionalEntry = {
  id: 'fictional-day30-entry', entryDate: '2026-10-26',
  text: '  【虚构·Day30】这段原文只存在模拟接口中。\n保留空格与换行。  ',
  textVersion: 1, revision: 1, adoptedAnalysis: null, origin: null,
  createdAt: '2026-10-26T01:00:00.000Z', updatedAt: '2026-10-26T01:00:00.000Z',
};

let dom;
let server;
let App;
let createRoot;
let root;
let sent;
let unexpected;
let loginMode;
let profileMode;
let entriesMode;
let pendingLogin;
let pendingProfile;

function setGlobal(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'fictional-day30-request' },
  });
}

function profileReply() {
  return reply(200, { sub: USER_ID, status: 'ACTIVE', internal_user_type: 'generalUser' });
}

function loginReply() {
  return reply(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600,
    refresh_token: REFRESH_TOKEN });
}

async function mockedFetch(url, options = {}) {
  // 所有请求均由内存回答；未知地址也绝不转发网络，不保存请求密码。
  sent.push({ url, method: options.method, token: options.headers?.Authorization, signal: options.signal });
  if (url === AUTH_ORIGIN + '/auth/v1/signin') {
    assert.deepEqual(JSON.parse(options.body), { username: USERNAME, password: PASSWORD });
    if (loginMode === 'pending') return new Promise(resolve => { pendingLogin = () => resolve(loginReply()); });
    return loginReply();
  }
  if (url === AUTH_ORIGIN + '/auth/v1/user/me') {
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    if (profileMode === 'pending') return new Promise(resolve => { pendingProfile = () => resolve(profileReply()); });
    if (profileMode === 'unauthorized') return reply(401, { message: '虚构失效响应，不可透传。' });
    if (profileMode === 'network-error') throw new Error(PASSWORD + ' ' + TOKEN + ' 虚构网络细节');
    return profileReply();
  }
  if (url === '/api/health') return reply(200, { ok: true, service: '【literature-and-inner-conflict】' });
  if (url.startsWith('/api/entries?') && options.method === 'GET') {
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    if (entriesMode === 'unauthorized') return reply(401, { ok: false, data: null,
      error: { code: 'UNAUTHENTICATED', message: '虚构过期。', retryable: false } });
    return reply(200, { ok: true, data: { items: [structuredClone(fictionalEntry)], total: 1,
      page: { limit: Number(new URL(url, API_ORIGIN).searchParams.get('limit')), nextCursor: null, hasMore: false } }, error: null });
  }
  if (options.method === 'GET' && (url.startsWith('/api/favorites?') || /^\/api\/books\/[^/]+\/notes\?/.test(url))) {
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    const parsed = new URL(url, API_ORIGIN);
    const bookMatch = /^\/api\/books\/([^/]+)\/notes$/.exec(parsed.pathname);
    return reply(200, { ok: true, data: { ...(bookMatch ? { bookId: decodeURIComponent(bookMatch[1]), latestNoteId: null } : {}),
      items: [], total: 0, page: { limit: Number(parsed.searchParams.get('limit')), nextCursor: null, hasMore: false } }, error: null });
  }
  unexpected.push({ url, method: options.method });
  throw new Error('测试禁止访问未列出的虚构接口。');
}

before(async () => {
  // 不加载真实浏览器、不读本机数据库；Vite 禁止读取项目配置及环境文件。
  dom = new JSDOM('<div id="root"></div>', { url: 'https://fictional-day30-app.invalid/#/', pretendToBeVisual: true });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('crypto', webcrypto);
  setGlobal('fetch', mockedFetch);
  setGlobal('indexedDB', new IDBFactory());
  setGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  setGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const dialog = dom.window.HTMLDialogElement.prototype;
  if (!dialog.showModal) dialog.showModal = function () { this.open = true; };
  if (!dialog.close) dialog.close = function () { this.open = false; };
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({ configFile: false, envDir: false, plugins: [react()],
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_AUTH_ORIGIN': JSON.stringify(AUTH_ORIGIN),
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify(API_ORIGIN),
      'import.meta.env.VITE_TEST_USER_ID': JSON.stringify(USER_ID) },
  });
  ({ default: App } = await server.ssrLoadModule('/src/App.jsx'));
});

beforeEach(() => {
  sent = [];
  unexpected = [];
  loginMode = profileMode = entriesMode = 'success';
  pendingLogin = pendingProfile = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '#/');
  globalThis.indexedDB = new IDBFactory();
  dom.window.indexedDB = globalThis.indexedDB;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  assert.deepEqual(unexpected, [], '未产生范围外接口请求');
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  assert.fail('等待超时：' + label);
}

async function mountApp() {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App)));
  await settleUntil(() => document.querySelector('.home-account'), '全站账户入口');
}

function button(text, scope = document) {
  const found = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  assert.ok(found, '找到按钮：' + text);
  return found;
}

async function click(element) {
  assert.ok(element, '操作目标存在');
  assert.equal(element.disabled, false, '按钮可操作');
  await act(async () => element.click());
}

async function fill(element, value) {
  assert.ok(element, '输入框存在');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function signIn() {
  await click(button('登录 / 注册'));
  await fill(document.querySelector('.home-account [name="username"]'), USERNAME);
  await fill(document.querySelector('.home-account [name="password"]'), PASSWORD);
  await act(async () => document.querySelector('.home-account-form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

async function signedInWithRecord() {
  await signIn();
  await settleUntil(() => document.querySelector('.home-account-signed-in')
    && document.querySelector('.home-cloud-original'), '登录后读取虚构原文');
}

function requests(path, method = 'GET') {
  return sent.filter(item => item.url === path && item.method === method);
}

function saveFictionalSession() {
  const value = { version: 1, authOrigin: AUTH_ORIGIN, accessToken: TOKEN, expiresAt: Date.now() + 3600000 };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

function assertNoVisibleSecrets() {
  for (const value of [PASSWORD, TOKEN, REFRESH_TOKEN, USER_ID]) {
    assert.ok(!document.body.textContent.includes(value), '敏感字段不显示在页面');
  }
  assert.equal(window.sessionStorage.length, 0);
}

async function navigate(path) {
  const link = document.querySelector('.site-nav a[href="#' + path + '"]');
  assert.ok(link, '导航入口存在');
  await act(async () => link.click());
  await settleUntil(() => document.querySelector('.site-nav a[aria-current="page"]')?.getAttribute('href') === '#' + path,
    '切换页面：' + path);
}

test('Day30 真实 App 在首页、总结与书单共享同一账户，只持久保存必要登录字段', async () => {
  await mountApp();
  await signedInWithRecord();
  const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['accessToken', 'authOrigin', 'expiresAt', 'version']);
  assert.equal(saved.accessToken, TOKEN);
  assert.ok(saved.expiresAt > Date.now());
  assert.equal(window.localStorage.length, 1);
  assert.ok(!JSON.stringify(saved).includes(PASSWORD));
  assert.ok(!JSON.stringify(saved).includes(REFRESH_TOKEN));
  assert.ok(!JSON.stringify(saved).includes(fictionalEntry.text));
  await navigate('/journal');
  assert.ok(document.querySelector('.home-account-signed-in'));
  await navigate('/books');
  assert.ok(document.querySelector('.home-account-signed-in'));
  await navigate('/');
  await settleUntil(() => document.querySelector('.home-cloud-original'), '返回首页按同一账户读取');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST').length, 1, '切页无需重复登录');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/user/me').length, 1);
  assertNoVisibleSecrets();
});

test('Day30 根卸载再挂载先核验持久凭据，核验完成前不显示登录或私人原文', async () => {
  await mountApp();
  await signedInWithRecord();
  await act(async () => root.unmount());
  root = null;
  assert.ok(window.localStorage.getItem(STORAGE_KEY), '页面卸载保留有效登录凭据');
  profileMode = 'pending';
  const readsBefore = requests('/api/entries?limit=20').length;
  await mountApp();
  await settleUntil(() => pendingProfile, '发出恢复核验');
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.equal(requests('/api/entries?limit=20').length, readsBefore);
  await act(async () => pendingProfile());
  await settleUntil(() => document.querySelector('.home-account-signed-in')
    && document.querySelector('.home-cloud-original'), '核验后恢复账户');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST').length, 1, '恢复不重发密码登录');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/user/me').length, 2);
});

test('Day30 总结页退出清除持久键，返回首页与重新挂载均不会恢复旧账户', async () => {
  await mountApp();
  await signedInWithRecord();
  await navigate('/journal');
  await click(button('退出登录'));
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  await navigate('/');
  assert.equal(document.querySelector('.home-cloud-original'), null);
  await act(async () => root.unmount());
  root = null;
  const profilesBefore = requests(AUTH_ORIGIN + '/auth/v1/user/me').length;
  await mountApp();
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/user/me').length, profilesBefore);
  assertNoVisibleSecrets();
});

test('Day30 恢复核验401清持久键，不将失败显示为已登录或空账户', async () => {
  saveFictionalSession();
  profileMode = 'unauthorized';
  await mountApp();
  await settleUntil(() => document.body.textContent.includes('登录凭证无效或已过期，请重新登录。'), '恢复401提示');
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.equal(document.querySelector('.account-restore'), null);
});

test('Day30 恢复核验网络失败保留凭据但不登录，用户手动只读重试可恢复', async () => {
  const saved = saveFictionalSession();
  profileMode = 'network-error';
  await mountApp();
  await settleUntil(() => document.querySelector('.account-restore'), '核验网络失败后可手动重试');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(STORAGE_KEY)), saved);
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assertNoVisibleSecrets();
  profileMode = 'success';
  await click(button('重新核验已保存的登录'));
  await settleUntil(() => document.querySelector('.home-account-signed-in')
    && document.querySelector('.home-cloud-original'), '只读重试恢复成功');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST').length, 0);
});

test('Day30 私人接口401立即退出并清持久键，失败不能显示成空记录', async () => {
  await mountApp();
  await signedInWithRecord();
  entriesMode = 'unauthorized';
  await click(button('刷新状态与云端记录'));
  await settleUntil(() => document.body.textContent.includes('登录状态已失效，请重新登录。'), '私人接口401退出提示');
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.ok(!document.body.textContent.includes('当前身份的记录总数为 0'));
});

test('Day30 跨标签退出清界面，恢复请求的迟到结果不能复活账户', async () => {
  saveFictionalSession();
  profileMode = 'pending';
  await mountApp();
  await settleUntil(() => pendingProfile, '跨标签退出前正在恢复');
  const oldProfileRequest = requests(AUTH_ORIGIN + '/auth/v1/user/me')[0];
  await act(async () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new dom.window.StorageEvent('storage', { key: STORAGE_KEY, newValue: null }));
  });
  assert.equal(oldProfileRequest.signal.aborted, true);
  await act(async () => pendingProfile());
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.equal(requests('/api/entries?limit=20').length, 0);
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
});

test('Day30 取消在途登录后迟到响应不核验身份、不存凭据、不显示私人数据', async () => {
  loginMode = 'pending';
  await mountApp();
  await signIn();
  await settleUntil(() => pendingLogin, '待定普通登录');
  const oldLogin = requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST')[0];
  await click(button('取消', document.querySelector('.home-account')));
  assert.equal(oldLogin.signal.aborted, true);
  await act(async () => pendingLogin());
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/user/me').length, 0);
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  assert.equal(document.querySelector('.home-account-signed-in'), null);
  assert.equal(document.querySelector('.home-cloud-original'), null);
});

test('Day30 同一事件先退出再触发旧删除确认，旧按钮不能发送DELETE', async () => {
  await mountApp();
  await signedInWithRecord();
  await click(button('选择此记录进行修改或删除'));
  await click(button('删除这条云端记录'));
  const oldDelete = button('确认永久删除');
  const oldLogout = button('退出登录');
  assert.equal(oldDelete.disabled, false);
  await act(async () => {
    oldLogout.click();
    oldDelete.click();
  });
  assert.equal(sent.filter(item => item.method === 'DELETE').length, 0);
  assert.equal(document.querySelector('.home-cloud-original'), null);
  assert.equal(document.querySelector('dialog[open]'), null);
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
});

test('Day30 正式账户下临时凭据与DEV登录被禁用，直接提交表单也不能切身份', async () => {
  await mountApp();
  await signedInWithRecord();
  const tokenInput = document.getElementById('cloud-access-token');
  const devUsername = document.getElementById('cloud-test-username');
  const devPassword = document.getElementById('cloud-test-password');
  for (const input of [tokenInput, devUsername, devPassword]) assert.equal(input.disabled, true);
  const readsBefore = requests('/api/entries?limit=20').length;
  // 直接派发表单事件验证处理函数的保护，不只检查按钮样式。
  await fill(tokenInput, 'fictional-day30-other-token');
  await fill(devUsername, USERNAME);
  await fill(devPassword, PASSWORD);
  await act(async () => {
    tokenInput.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    devPassword.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(requests('/api/entries?limit=20').length, readsBefore);
  assert.equal(requests('/__day20-auth/signin', 'POST').length, 0);
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST').length, 1);
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).accessToken, TOKEN);
  assert.ok(document.querySelector('.home-account-signed-in'));
});

test('Day30 pagehide 清除尚未提交的账户密码，旧输入DOM也立即清空', async () => {
  await mountApp();
  await click(button('登录 / 注册'));
  await fill(document.querySelector('.home-account [name="username"]'), USERNAME);
  const password = document.querySelector('.home-account [name="password"]');
  await fill(password, PASSWORD);
  assert.equal(password.value, PASSWORD);
  await act(async () => window.dispatchEvent(new dom.window.Event('pagehide')));
  assert.equal(password.value, '', '浏览器往返缓存中的旧输入节点也不能保留密码');
  for (const input of document.querySelectorAll('.home-account input[type="password"]')) assert.equal(input.value, '');
  assert.equal(requests(AUTH_ORIGIN + '/auth/v1/signin', 'POST').length, 0);
  assert.equal(window.localStorage.length, 0);
  assertNoVisibleSecrets();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSession } from './accountSession.js';

const ORIGIN = 'https://fictional-session.example';
const TOKEN = 'fictional-account-access-token';
const OTHER_TOKEN = 'fictional-other-account-token';
const PASSWORD = 'Fictional-only-password';
const INPUT = { username: 'fictional.reader', password: PASSWORD };
const START = 1800000000000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function authError(code, message = '虚构的账户核验失败。', extra = {}) {
  return Object.assign(new Error(message), { name: 'AccountAuthError', code, ...extra });
}

function fixture(overrides = {}) {
  let clock = START;
  let timerId = 0;
  const values = new Map();
  const timers = new Map();
  const calls = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const target = new EventTarget();
  const result = { token: TOKEN, expiresAt: START + 7200000, loginStatus: 200, profileStatus: 200 };
  const authClient = {
    signIn: async input => { calls.push(['signIn', input]); return result; },
    signUp: async input => { calls.push(['signUp', input]); return { ...result, registered: true }; },
    verifySession: async input => { calls.push(['verifySession', input]); return { token: input.token, profileStatus: 200 }; },
    ...overrides,
  };
  const create = (options = {}) => createAccountSession({ authClient, authOrigin: ORIGIN,
    storage, eventTarget: target, now: () => clock,
    setTimeoutImpl: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeoutImpl: id => timers.delete(id), ...options });
  const store = create();
  return { store, create, values, storage, calls, timers, result, authClient, target,
    setNow: value => { clock = value; },
    saved: (token = TOKEN, expiresAt = START + 7200000) => JSON.stringify({ version: 1,
      authOrigin: ORIGIN, accessToken: token, expiresAt }),
    emit(type, detail) {
      const event = new Event(type);
      for (const [key, value] of Object.entries(detail)) Object.defineProperty(event, key, { value });
      target.dispatchEvent(event);
    },
  };
}

test('登录后只持久保存允许字段，不保存密码、刷新令牌、资料或业务数据', async () => {
  const f = fixture();
  Object.assign(f.result, { password: PASSWORD, refresh_token: 'fictional-refresh', user: { name: '虚构用户' } });
  const events = [];
  const unsubscribe = f.store.subscribe(() => events.push(f.store.getSnapshot().status));
  await f.store.signIn(INPUT);
  assert.equal(f.store.getToken(), TOKEN);
  assert.equal(f.store.getSnapshot().persistent, true);
  assert.equal(f.store.getSnapshot().status, 'signedIn');
  assert.deepEqual(JSON.parse(f.values.get(f.store.storageKey)), {
    version: 1, authOrigin: ORIGIN, accessToken: TOKEN, expiresAt: START + 7200000,
  });
  assert.equal([...f.values.values()].join().includes(PASSWORD), false);
  assert.equal([...f.values.values()].join().includes('fictional-refresh'), false);
  assert.ok(events.includes('authenticating'));
  assert.equal(f.timers.size, 1);
  unsubscribe();
  f.store.dispose();
});

test('缺少官方有效期只在本页登录，不写持久凭据，不设假定到期时间', async () => {
  const f = fixture();
  delete f.result.expiresAt;
  await f.store.signIn(INPUT);
  assert.equal(f.store.getToken(), TOKEN);
  assert.equal(f.store.getSnapshot().expiresAt, null);
  assert.equal(f.store.getSnapshot().persistent, false);
  assert.match(f.store.getSnapshot().message, /仅在本页有效/);
  assert.equal(f.values.size, 0);
  assert.equal(f.timers.size, 0);
});

test('刷新恢复前无可用凭据，必须等待远端普通用户核验完成', async () => {
  const remote = deferred();
  const f = fixture({ verifySession: () => remote.promise });
  f.values.set(f.store.storageKey, f.saved());
  const restoring = f.store.restore();
  assert.equal(f.store.getSnapshot().status, 'restoring');
  assert.equal(f.store.getToken(), '');
  remote.resolve({ token: TOKEN, profileStatus: 200 });
  await restoring;
  assert.equal(f.store.getSnapshot().status, 'signedIn');
  assert.equal(f.store.getToken(), TOKEN);
  assert.equal(f.store.getSnapshot().persistent, true);
  f.store.dispose();
});

test('损坏、混入用户资料、跨认证环境及过期的缓存均不能恢复', async () => {
  for (const raw of ['not-json', 'null', '[]', '{}',
    JSON.stringify({ version: 1, authOrigin: ORIGIN, accessToken: TOKEN, expiresAt: START + 1000, userId: '虚构' }),
    JSON.stringify({ version: 1, authOrigin: 'https://fictional-other.example', accessToken: TOKEN, expiresAt: START + 1000 }),
    JSON.stringify({ version: 1, authOrigin: ORIGIN, accessToken: TOKEN, expiresAt: START }),
  ]) {
    const f = fixture();
    f.values.set(f.store.storageKey, raw);
    await assert.rejects(f.store.restore(), error => ['INVALID_SESSION', 'SESSION_EXPIRED'].includes(error.code));
    assert.equal(f.store.getToken(), '');
    assert.equal(f.values.size, 0);
    assert.equal(f.calls.length, 0);
    f.store.dispose();
  }
});

test('认证拒绝和非法身份清凭据，网络或服务故障保留凭据供手动重试且不假装已登录', async () => {
  for (const [code, cleared] of [['UNAUTHENTICATED', true], ['INVALID_PROFILE', true],
    ['NETWORK_ERROR', false], ['PROFILE_UNAVAILABLE', false], ['TIMEOUT', false]]) {
    const f = fixture({ verifySession: async () => { throw authError(code); } });
    f.values.set(f.store.storageKey, f.saved());
    await assert.rejects(f.store.restore(), error => error.code === code);
    assert.equal(f.store.getSnapshot().status, 'error');
    assert.equal(f.store.getToken(), '');
    assert.equal(f.values.has(f.store.storageKey), !cleared);
    assert.equal(f.store.getSnapshot().canRestore, !cleared);
    f.store.dispose();
  }
});

test('运行期间到期和延迟定时器场景都立即停止提供令牌并清除缓存', async () => {
  for (const useTimer of [true, false]) {
    const f = fixture();
    await f.store.signIn(INPUT);
    f.setNow(START + 7200000);
    if (useTimer) [...f.timers.values()][0]();
    assert.equal(f.store.getToken(), '');
    assert.equal(f.store.getSnapshot().status, 'signedOut');
    assert.equal(f.values.size, 0);
    assert.match(f.store.getSnapshot().message, /过期/);
    f.store.dispose();
  }
});

test('核验期间到期不能恢复成成功登录', async () => {
  const remote = deferred();
  const f = fixture({ verifySession: () => remote.promise });
  f.values.set(f.store.storageKey, f.saved());
  const restoring = f.store.restore();
  f.setNow(START + 7200000);
  remote.resolve({ token: TOKEN, profileStatus: 200 });
  await assert.rejects(restoring, error => error.code === 'SESSION_EXPIRED');
  assert.equal(f.store.getToken(), '');
  assert.equal(f.values.size, 0);
  f.store.dispose();
});

test('退出取消在途登录，迟到的登录结果不能重新保存或恢复旧账户', async () => {
  const remote = deferred();
  const f = fixture({ signIn: () => remote.promise });
  const pending = f.store.signIn(INPUT);
  const rejected = assert.rejects(pending, error => error.code === 'ABORTED');
  f.store.signOut();
  remote.resolve(f.result);
  await rejected;
  assert.equal(f.store.getSnapshot().status, 'signedOut');
  assert.equal(f.store.getToken(), '');
  assert.equal(f.values.size, 0);
  f.store.dispose();
});

test('跨标签退出立即清本页会话，其他存储键不影响账户', async () => {
  const f = fixture();
  await f.store.signIn(INPUT);
  f.emit('storage', { key: 'fictional-business-records', newValue: null });
  assert.equal(f.store.getToken(), TOKEN);
  f.values.delete(f.store.storageKey);
  f.emit('storage', { key: f.store.storageKey, newValue: null });
  assert.equal(f.store.getToken(), '');
  assert.match(f.store.getSnapshot().message, /其他标签/);
  f.store.dispose();
});

test('跨标签更换账户先停止使用旧令牌，再核验新令牌', async () => {
  const remote = deferred();
  const f = fixture({ verifySession: () => remote.promise });
  await f.store.signIn(INPUT);
  f.values.set(f.store.storageKey, f.saved(OTHER_TOKEN));
  f.emit('storage', { key: f.store.storageKey, newValue: f.saved(OTHER_TOKEN) });
  assert.equal(f.store.getSnapshot().status, 'restoring');
  assert.equal(f.store.getToken(), '');
  remote.resolve({ token: OTHER_TOKEN, profileStatus: 200 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.getToken(), OTHER_TOKEN);
  f.store.dispose();
});

test('核验完成前存储已被其他标签清除，即使事件延迟也不能恢复', async () => {
  const remote = deferred();
  const f = fixture({ verifySession: () => remote.promise });
  f.values.set(f.store.storageKey, f.saved());
  const restoring = f.store.restore();
  f.values.delete(f.store.storageKey);
  remote.resolve({ token: TOKEN, profileStatus: 200 });
  await restoring;
  assert.equal(f.store.getToken(), '');
  assert.equal(f.store.getSnapshot().status, 'signedOut');
  f.store.dispose();
});

test('页面隐藏清掉内存会话，往返缓存返回后重新核验，持久凭据仍保留', async () => {
  const remote = deferred();
  const f = fixture({ verifySession: () => remote.promise });
  await f.store.signIn(INPUT);
  f.emit('pagehide', {});
  assert.equal(f.store.getToken(), '');
  assert.equal(f.values.size, 1);
  f.emit('pageshow', { persisted: true });
  assert.equal(f.store.getSnapshot().status, 'restoring');
  assert.equal(f.store.getToken(), '');
  remote.resolve({ token: TOKEN, profileStatus: 200 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.getToken(), TOKEN);
  f.store.dispose();
});

test('取消或离开注册页面提示结果未确认，迟到成功不进入会话', async () => {
  for (const leave of ['cancel', 'pagehide']) {
    const remote = deferred();
    const f = fixture({ signUp: () => remote.promise });
    const pending = f.store.signUp(INPUT);
    const rejected = assert.rejects(pending, error => error.code === 'ABORTED');
    assert.equal(f.store.getSnapshot().mode, 'register');
    if (leave === 'cancel') f.store.cancel();
    else f.emit('pagehide', {});
    remote.resolve({ ...f.result, registered: true });
    await rejected;
    assert.match(f.store.getSnapshot().message, /结果尚未确认/);
    if (leave === 'cancel') assert.equal(f.store.getSnapshot().suggestLogin, true);
    assert.equal(f.store.getToken(), '');
    assert.equal(f.values.size, 0);
    f.store.dispose();
  }
});

test('注册已确认而自动登录失败时保留切换登录提示，不假报注册失败', async () => {
  const f = fixture({ signUp: async () => { throw authError('REGISTERED_LOGIN_FAILED',
    '账号已创建，自动登录未完成，请切换登录后重试。', { registered: true }); } });
  await assert.rejects(f.store.signUp(INPUT), error => error.registered === true);
  assert.equal(f.store.getSnapshot().registered, true);
  assert.equal(f.store.getSnapshot().suggestLogin, true);
  assert.equal(f.store.getToken(), '');
  f.store.dispose();
});

test('dispose后可重新订阅恢复，满足严格模式的挂载清理再挂载', async () => {
  const f = fixture();
  await f.store.signIn(INPUT);
  f.store.dispose();
  let changes = 0;
  const unsubscribe = f.store.subscribe(() => { changes += 1; });
  await f.store.restore();
  assert.equal(f.store.getToken(), TOKEN);
  assert.ok(changes > 0);
  assert.equal(f.calls.filter(([type]) => type === 'verifySession').length, 1);
  f.values.delete(f.store.storageKey);
  f.emit('storage', { key: f.store.storageKey, newValue: null });
  assert.equal(f.store.getToken(), '');
  unsubscribe();
  f.store.dispose();
});

test('存储写入失败只报告页内登录，退出清理失败明确保留风险，读取失败不当作成功', async () => {
  const f = fixture();
  f.storage.setItem = () => { throw new Error(PASSWORD); };
  await f.store.signIn(INPUT);
  assert.equal(f.store.getToken(), TOKEN);
  assert.equal(f.store.getSnapshot().persistent, false);
  assert.match(f.store.getSnapshot().message, /未能保存/);
  f.storage.removeItem = () => { throw new Error(PASSWORD); };
  f.store.signOut();
  assert.equal(f.store.getToken(), '');
  assert.equal(f.store.getSnapshot().status, 'error');
  assert.match(f.store.getSnapshot().message, /本页已退出.*未能清除/);
  assert.equal(f.store.getSnapshot().message.includes(PASSWORD), false);
  f.storage.getItem = () => { throw new Error(PASSWORD); };
  await assert.rejects(f.store.restore(), error => error.code === 'STORAGE_READ_FAILED' && !error.message.includes(PASSWORD));
  assert.equal(f.store.getToken(), '');
  f.store.dispose();
});

test('未知底层异常采用固定提示，不把密码或凭据带入界面', async () => {
  const f = fixture({ signIn: async () => { throw new Error(PASSWORD + TOKEN); } });
  await assert.rejects(f.store.signIn(INPUT), error => error.code === 'SESSION_REQUEST_FAILED'
    && !error.message.includes(PASSWORD) && !error.message.includes(TOKEN));
  assert.equal(f.store.getSnapshot().message.includes(PASSWORD), false);
  assert.equal(f.store.getToken(), '');
  f.store.dispose();
});

test('预先取消不发认证请求，重复恢复时旧请求不能覆盖新请求', async () => {
  const f = fixture();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.store.signIn({ ...INPUT, signal: aborted.signal }), error => error.code === 'ABORTED');
  assert.equal(f.calls.length, 0);
  const first = deferred();
  let count = 0;
  f.authClient.verifySession = async input => ++count === 1 ? first.promise : { token: input.token, profileStatus: 200 };
  f.values.set(f.store.storageKey, f.saved());
  const previous = f.store.restore();
  const rejected = assert.rejects(previous, error => error.code === 'ABORTED');
  await f.store.restore();
  first.resolve({ token: OTHER_TOKEN, profileStatus: 200 });
  await rejected;
  assert.equal(f.store.getToken(), TOKEN);
  f.store.dispose();
});

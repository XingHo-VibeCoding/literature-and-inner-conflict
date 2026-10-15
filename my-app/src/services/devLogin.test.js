import test from 'node:test';
import assert from 'node:assert/strict';
import { loginTestSession } from './devLogin.js';

const USERNAME = '虚构-Day20测试账号';
const PASSWORD = 'fictional-day20-password';
const TOKEN = 'fictional-day20-user-token';
const EXPECTED_ID = 'fictional-day20-registered-user';
const INPUT = { username: USERNAME, password: PASSWORD, expectedUserId: EXPECTED_ID };
const makeResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
function setup({ loginStatus = 200, profileStatus = 200, session = { access_token: TOKEN },
  profile = { sub: EXPECTED_ID, status: 'ACTIVE' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? makeResponse(session, loginStatus) : makeResponse(profile, profileStatus);
  };
  return { calls, run: (overrides = {}) => loginTestSession({ ...INPUT, fetchImpl, ...overrides }) };
}
function safeError(error) {
  const visible = JSON.stringify({ message: error.message, ...error });
  return ![USERNAME, PASSWORD, TOKEN, EXPECTED_ID].some(value => visible.includes(value));
}

test('登录与可信用户核验均为200才返回页内凭证', async () => {
  const { run, calls } = setup();
  assert.deepEqual(await run(), { token: TOKEN, loginStatus: 200, profileStatus: 200, matched: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/__day20-auth/signin');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: USERNAME, password: PASSWORD });
  assert.equal(calls[1].url, '/__day20-auth/user/me');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[1].init.body, undefined);
  for (const { url, init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal([PASSWORD, TOKEN, USERNAME].some(value => url.includes(value)), false);
  }
});

test('身份资料不带可选status时仍按可信UID核验', async () => {
  const { run } = setup({ profile: { sub: EXPECTED_ID } });
  assert.equal((await run()).matched, true);
});

test('登录401只返回安全状态，不继续身份请求或自动重试', async () => {
  const { run, calls } = setup({ loginStatus: 401, session: { message: PASSWORD, access_token: TOKEN } });
  await assert.rejects(run(), error => error.code === 'LOGIN_FAILED' && error.httpStatus === 401
    && error.loginStatus === 401 && error.profileStatus === null && safeError(error));
  assert.equal(calls.length, 1);
});

test('登录201不能被当作约定200', async () => {
  const { run, calls } = setup({ loginStatus: 201 });
  await assert.rejects(run(), error => error.code === 'LOGIN_FAILED' && error.loginStatus === 201);
  assert.equal(calls.length, 1);
});

test('登录响应不是JSON时停止，不展示正文', async () => {
  let calls = 0;
  await assert.rejects(loginTestSession({
    ...INPUT, fetchImpl: async () => { calls += 1; return new Response('<html>' + PASSWORD + '</html>'); },
  }), error => error.code === 'INVALID_RESPONSE' && error.loginStatus === 200 && error.profileStatus === null && safeError(error));
  assert.equal(calls, 1);
});

test('无效或不安全令牌不会进入第二次请求', async () => {
  for (const access_token of [undefined, '', 123, 'invalid token', 'invalid\nline', 'invalid\u0000token', 'x'.repeat(8193)]) {
    const { run, calls } = setup({ session: { access_token } });
    await assert.rejects(run(), error => error.code === 'INVALID_SESSION' && error.loginStatus === 200 && safeError(error));
    assert.equal(calls.length, 1);
  }
});

test('身份接口401保留两步状态，并拒绝返回令牌', async () => {
  const { run, calls } = setup({ profileStatus: 401, profile: { message: TOKEN, sub: EXPECTED_ID } });
  await assert.rejects(run(), error => error.code === 'PROFILE_FAILED' && error.httpStatus === 401
    && error.loginStatus === 200 && error.profileStatus === 401 && safeError(error) && !Object.hasOwn(error, 'token'));
  assert.equal(calls.length, 2);
});

test('UID不一致不会返回matched或泄露两个UID', async () => {
  const wrongId = 'fictional-day20-other-user';
  const { run } = setup({ profile: { sub: wrongId, status: 'ACTIVE' } });
  await assert.rejects(run(), error => error.code === 'TEST_USER_MISMATCH' && error.httpStatus === 200
    && error.profileStatus === 200 && safeError(error) && !JSON.stringify(error).includes(wrongId)
    && !error.message.includes(wrongId) && !Object.hasOwn(error, 'matched'));
});

test('拒绝匿名、管理账号、停用账号及无可信sub资料', async () => {
  for (const profile of [
    { sub: 'anon' }, { sub: EXPECTED_ID, is_anonymous: true },
    { sub: EXPECTED_ID, is_system_admin: true }, { sub: EXPECTED_ID, is_admin: true },
    { sub: EXPECTED_ID, role: 'service_role' }, { sub: EXPECTED_ID, role: 'anon' },
    { sub: EXPECTED_ID, role: 'admin' }, { sub: EXPECTED_ID, status: 'DISABLED' },
    { sub: '' }, { sub: 123 }, [], null,
  ]) {
    const { run } = setup({ profile });
    await assert.rejects(run(), error => error.code === 'INVALID_PROFILE' && error.profileStatus === 200 && safeError(error));
  }
});

test('输入或公开测试UID配置缺失时不发送请求', async () => {
  const { run, calls } = setup();
  await assert.rejects(run({ expectedUserId: '' }), error => error.code === 'INVALID_CONFIGURATION' && safeError(error));
  await assert.rejects(run({ expectedUserId: ' 带空白 ' }), error => error.code === 'INVALID_CONFIGURATION');
  await assert.rejects(run({ username: '', password: PASSWORD }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(run({ password: '' }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('身份响应不是JSON时不展示身份正文', async () => {
  let calls = 0;
  await assert.rejects(loginTestSession({
    ...INPUT, fetchImpl: async () => ++calls === 1 ? makeResponse({ access_token: TOKEN })
      : new Response('<html>' + EXPECTED_ID + TOKEN + '</html>'),
  }), error => error.code === 'INVALID_RESPONSE' && error.loginStatus === 200
    && error.profileStatus === 200 && safeError(error));
  assert.equal(calls, 2);
});

test('两阶段网络错误均不透传底层凭证或自动重试', async () => {
  for (const failingStep of [1, 2]) {
    let calls = 0;
    await assert.rejects(loginTestSession({
      ...INPUT, fetchImpl: async () => {
        calls += 1;
        if (calls === failingStep) throw new Error(USERNAME + PASSWORD + TOKEN);
        return makeResponse({ access_token: TOKEN });
      },
    }), error => error.code === 'NETWORK_ERROR' && safeError(error)
      && error.loginStatus === (failingStep === 1 ? null : 200) && error.profileStatus === null);
    assert.equal(calls, failingStep);
  }
});

test('预先取消与进行中取消都不会进入身份请求', async () => {
  const already = new AbortController();
  already.abort();
  const { run, calls } = setup();
  await assert.rejects(run({ signal: already.signal }), error => error.code === 'ABORTED');
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  let count = 0;
  const pending = loginTestSession({
    ...INPUT, signal: controller.signal,
    fetchImpl: (url, { signal }) => {
      count += 1;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () =>
        reject(new DOMException('已取消', 'AbortError')), { once: true }));
    },
  });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED' && safeError(error));
  assert.equal(count, 1);
});

test('读取登录JSON期间取消，迟到的成功令牌不再用于身份请求', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(loginTestSession({
    ...INPUT, signal: controller.signal, fetchImpl: async () => {
      calls += 1;
      return { status: 200, json: async () => { controller.abort(); return { access_token: TOKEN }; } };
    },
  }), error => error.code === 'ABORTED' && error.loginStatus === 200 && safeError(error));
  assert.equal(calls, 1);
});

test('30秒覆盖两步身份核验，超时不返回成功或自动重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let beganProfile;
  const profileStarted = new Promise(resolve => { beganProfile = resolve; });
  const pending = loginTestSession({
    ...INPUT, fetchImpl: async (url, { signal }) => {
      calls += 1;
      if (calls === 1) return makeResponse({ access_token: TOKEN });
      beganProfile();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () =>
        reject(new DOMException('超时', 'AbortError')), { once: true }));
    },
  });
  await profileStarted;
  t.mock.timers.tick(30000);
  await assert.rejects(pending, error => error.code === 'TIMEOUT' && error.loginStatus === 200
    && error.profileStatus === null && safeError(error));
  assert.equal(calls, 2);
});

test('开发登录服务不接触持久存储或打印任何认证资料', async t => {
  const originals = new Map();
  let accesses = 0;
  const output = [];
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { accesses += 1; throw new Error('禁止访问存储'); } });
  }
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => output.push(args));
  try {
    const { run } = setup();
    await run();
    const failed = setup({ profileStatus: 401 });
    await assert.rejects(failed.run(), error => safeError(error));
    assert.equal(accesses, 0);
    assert.deepEqual(output, []);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
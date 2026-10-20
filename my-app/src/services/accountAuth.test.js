import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAuthClient } from './accountAuth.js';

const ORIGIN = 'https://fictional-auth.example';
const USERNAME = 'fictional.reader';
const PASSWORD = 'Fictional-password-only';
const TOKEN = 'fictional-short-access-token';
const REFRESH_TOKEN = 'fictional-refresh-must-not-return';
const USER_ID = 'fictional-ordinary-user-279';
const INPUT = { username: USERNAME, password: PASSWORD };
const makeResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
function setup({ loginStatus = 200, profileStatus = 200,
  session = { access_token: TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer' },
  profile = { sub: USER_ID, status: 'ACTIVE', internal_user_type: 'generalUser' } } = {}) {
  const calls = [];
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? makeResponse(session, loginStatus) : makeResponse(profile, profileStatus);
  } });
  return { calls, client, run: (overrides = {}) => client.signIn({ ...INPUT, ...overrides }) };
}
function safeError(error) {
  const visible = JSON.stringify({ message: error.message, ...error });
  return ![USERNAME, PASSWORD, TOKEN, REFRESH_TOKEN, USER_ID].some(value => visible.includes(value));
}

test('任意已激活普通用户均可登录，不限制预设测试UID，不返回资料或刷新令牌', async () => {
  for (const sub of [USER_ID, 'another-ordinary-fictional-user']) {
    const { run, calls } = setup({ profile: { sub, status: 'ACTIVE', groups: [{ id: 'user' }] } });
    assert.deepEqual(await run(), { token: TOKEN, loginStatus: 200, profileStatus: 200 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, ORIGIN + '/auth/v1/signin');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), INPUT);
    assert.equal(calls[1].url, ORIGIN + '/auth/v1/user/me');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(calls[1].init.body, undefined);
    for (const { url, init } of calls) {
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      assert.equal([PASSWORD, TOKEN, USERNAME].some(value => url.includes(value)), false);
      assert.ok(init.signal instanceof AbortSignal);
    }
  }
});

test('非法HTTPS来源在创建客户端时拒绝，包含路径和凭证的地址不进入请求', () => {
  let count = 0;
  const fetchImpl = () => { count += 1; };
  for (const authOrigin of [undefined, '', ' https://fictional.example', 'http://fictional.example',
    'https://*.example', 'https://fictional.example/path', 'https://fictional.example/?x=1',
    'https://fictional.example/#x', 'https://user:secret@fictional.example', 'not-a-url']) {
    assert.throws(() => createAccountAuthClient({ authOrigin, fetchImpl }), error =>
      error.code === 'INVALID_CONFIGURATION' && error.loginStatus === null && error.profileStatus === null
      && !error.message.includes('secret') && safeError(error));
  }
  assert.throws(() => createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: null }),
    error => error.code === 'INVALID_CONFIGURATION');
  assert.equal(count, 0);
});

test('来源末尾单斜杠被规范化，不产生双斜杠请求', async () => {
  const urls = [];
  const client = createAccountAuthClient({ authOrigin: ORIGIN + '/', fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? makeResponse({ access_token: TOKEN }) : makeResponse({ sub: USER_ID, status: 'ACTIVE' });
  } });
  await client.signIn(INPUT);
  assert.deepEqual(urls, [ORIGIN + '/auth/v1/signin', ORIGIN + '/auth/v1/user/me']);
});

test('输入不完整或用户名不合约时不发送认证请求', async () => {
  const { run, calls } = setup();
  for (const overrides of [{ username: '' }, { username: 'a' }, { username: 'a'.repeat(49) },
    { username: '中文账号' }, { username: '-reader' }, { username: 'reader\n' }, { password: '' }, { password: null }]) {
    await assert.rejects(run(overrides), error => error.code === 'INVALID_INPUT' && safeError(error));
  }
  assert.equal(calls.length, 0);
});

test('官方已知失败只映射固定中文提示，不透传响应资料、不核验身份、不重试', async () => {
  for (const [failure, code] of [
    ['invalid_username_or_password', 'INVALID_CREDENTIALS'], ['invalid_password', 'INVALID_CREDENTIALS'],
    ['not_found', 'INVALID_CREDENTIALS'], ['invalid_status', 'ACCOUNT_LOCKED'],
    ['captcha_required', 'CAPTCHA_REQUIRED'], ['password_not_set', 'PASSWORD_NOT_SET'],
    ['user_pending', 'ACCOUNT_INACTIVE'], ['user_blocked', 'ACCOUNT_INACTIVE'],
    ['unimplemented', 'LOGIN_DISABLED'], ['login_type_disabled', 'LOGIN_DISABLED'],
    ['unauthorized_client', 'LOGIN_DISABLED'], ['permission_denied', 'LOGIN_UNAVAILABLE'],
    ['resource_exhausted', 'RATE_LIMITED'],
  ]) {
    const { run, calls } = setup({ loginStatus: failure === 'unimplemented' ? 501 : 400,
      session: { error: failure, error_description: USERNAME + PASSWORD + TOKEN, refresh_token: REFRESH_TOKEN } });
    await assert.rejects(run(), error => error.code === code && error.profileStatus === null && safeError(error));
    assert.equal(calls.length, 1);
  }
});

test('未知失败和非JSON正文保持脱敏，状态码可供界面展示', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIALS'], [429, 'RATE_LIMITED'], [503, 'LOGIN_UNAVAILABLE'], [400, 'LOGIN_FAILED']]) {
    const { run, calls } = setup({ loginStatus: status, session: { error: PASSWORD, error_description: TOKEN } });
    await assert.rejects(run(), error => error.code === code && error.loginStatus === status
      && error.httpStatus === status && error.profileStatus === null && safeError(error));
    assert.equal(calls.length, 1);
  }
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () =>
    new Response('<html>' + PASSWORD + TOKEN + '</html>', { status: 500 }) });
  await assert.rejects(client.signIn(INPUT), error => error.code === 'LOGIN_UNAVAILABLE' && safeError(error));
});

test('登录响应非JSON或不含有效Bearer令牌时停止，不请求身份', async () => {
  for (const session of [null, [], {}, { access_token: '' }, { access_token: 1 }, { access_token: 'bad token' },
    { access_token: 'bad\nline' }, { access_token: 'bad\u0000token' }, { access_token: 'x'.repeat(8193) },
    { access_token: TOKEN, token_type: 'Basic' }]) {
    const { run, calls } = setup({ session });
    await assert.rejects(run(), error => error.code === 'INVALID_SESSION' && error.loginStatus === 200 && safeError(error));
    assert.equal(calls.length, 1);
  }
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () => new Response(PASSWORD) });
  await assert.rejects(client.signIn(INPUT), error => error.code === 'INVALID_RESPONSE' && safeError(error));
});

test('登录201不能冒充约定的成功响应', async () => {
  const { run, calls } = setup({ loginStatus: 201 });
  await assert.rejects(run(), error => error.code === 'LOGIN_FAILED' && error.loginStatus === 201);
  assert.equal(calls.length, 1);
});

test('身份核验必须200且ACTIVE，拒绝匿名、管理、服务身份和无效资料', async () => {
  for (const profile of [null, [], { sub: '' }, { sub: 12 }, { sub: USER_ID },
    { sub: USER_ID, status: 'DISABLED' }, { sub: 'anon', status: 'ACTIVE' },
    { sub: USER_ID, status: 'ACTIVE', is_anonymous: true },
    { sub: USER_ID, status: 'ACTIVE', is_admin: true },
    { sub: USER_ID, status: 'ACTIVE', is_system_admin: true },
    { sub: USER_ID, status: 'ACTIVE', role: 'service_role' },
    { sub: USER_ID, status: 'ACTIVE', role: 'ADMIN' },
    { sub: USER_ID, status: 'ACTIVE', roles: ['system_admin'] },
    { sub: USER_ID, status: 'ACTIVE', groups: [{ id: 'admin' }] },
    { sub: USER_ID, status: 'ACTIVE', internal_user_type: 'systemAdmin' },
    { sub: USER_ID, status: 'ACTIVE', type: 'service_role' },
    { sub: USER_ID, status: 'ACTIVE', providers: [{ id: 'anonymous' }] },
  ]) {
    const { run } = setup({ profile });
    await assert.rejects(run(), error => error.code === 'INVALID_PROFILE' && error.loginStatus === 200
      && error.profileStatus === 200 && safeError(error) && !Object.hasOwn(error, 'token'));
  }
  const { run } = setup({ profileStatus: 401, profile: { sub: USER_ID, message: TOKEN } });
  await assert.rejects(run(), error => error.code === 'PROFILE_FAILED' && error.httpStatus === 401
    && error.loginStatus === 200 && error.profileStatus === 401 && safeError(error));
});

test('身份正文异常不泄露资料，核验失败不返回可用凭证', async () => {
  let count = 0;
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () => ++count === 1
    ? makeResponse({ access_token: TOKEN }) : new Response(USER_ID + TOKEN) });
  await assert.rejects(client.signIn(INPUT), error => error.code === 'INVALID_RESPONSE'
    && error.loginStatus === 200 && error.profileStatus === 200 && safeError(error));
  assert.equal(count, 2);
});

test('任一网络阶段失败均不泄露底层错误，也不自动重试', async () => {
  for (const failingStep of [1, 2]) {
    let count = 0;
    const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () => {
      count += 1;
      if (count === failingStep) throw new Error(USERNAME + PASSWORD + TOKEN);
      return makeResponse({ access_token: TOKEN });
    } });
    await assert.rejects(client.signIn(INPUT), error => error.code === 'NETWORK_ERROR' && safeError(error)
      && error.loginStatus === (failingStep === 1 ? null : 200) && error.profileStatus === null);
    assert.equal(count, failingStep);
  }
});

test('预先取消不发请求，进行中取消立即结束，即使网络模拟不响应AbortSignal', async () => {
  const already = new AbortController();
  already.abort();
  const { run, calls } = setup();
  await assert.rejects(run({ signal: already.signal }), error => error.code === 'ABORTED');
  assert.equal(calls.length, 0);
  let count = 0;
  const controller = new AbortController();
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: () => { count += 1; return new Promise(() => {}); } });
  const pending = client.signIn({ ...INPUT, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED' && safeError(error));
  assert.equal(count, 1);
});

test('读取JSON时取消，迟到的token不能继续发身份请求', async () => {
  const controller = new AbortController();
  let count = 0;
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () => {
    count += 1;
    return { status: 200, json: async () => { controller.abort(); return { access_token: TOKEN }; } };
  } });
  await assert.rejects(client.signIn({ ...INPUT, signal: controller.signal }), error => error.code === 'ABORTED' && safeError(error));
  assert.equal(count, 1);
});

test('30秒总超时覆盖两步请求，不按阶段重置，不重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  let beganProfile;
  const profileStarted = new Promise(resolve => { beganProfile = resolve; });
  const client = createAccountAuthClient({ authOrigin: ORIGIN, fetchImpl: async () => {
    count += 1;
    if (count === 1) return makeResponse({ access_token: TOKEN });
    beganProfile();
    return new Promise(() => {});
  } });
  const pending = client.signIn(INPUT);
  await profileStarted;
  t.mock.timers.tick(30000);
  await assert.rejects(pending, error => error.code === 'TIMEOUT' && error.loginStatus === 200
    && error.profileStatus === null && safeError(error));
  assert.equal(count, 2);
});

test('服务不读取浏览器存储或打印认证资料，refresh_token不进入后续请求', async t => {
  const originals = new Map();
  let accesses = 0;
  const output = [];
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { accesses += 1; throw new Error('禁止读取存储'); } });
  }
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => output.push(args));
  try {
    const { run, calls } = setup();
    await run();
    const failed = setup({ profileStatus: 401 });
    await assert.rejects(failed.run(), error => safeError(error));
    assert.equal(accesses, 0);
    assert.deepEqual(output, []);
    assert.equal(JSON.stringify(calls).includes(REFRESH_TOKEN), false);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

const REGISTRATION_ORIGIN = 'https://fictional-registration.example';
const REGISTERED = { ok: true, data: { registered: true }, error: null };
function setupRegistration({ registrationStatus = 201, registrationBody = REGISTERED, loginStatus = 200,
  profileStatus = 200, session = { access_token: TOKEN, refresh_token: REFRESH_TOKEN },
  profile = { sub: USER_ID, status: 'ACTIVE' } } = {}) {
  const calls = [];
  const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return makeResponse(registrationBody, registrationStatus);
      return calls.length === 2 ? makeResponse(session, loginStatus) : makeResponse(profile, profileStatus);
    } });
  return { client, calls, run: (overrides = {}) => client.signUp({ ...INPUT, ...overrides }) };
}

test('用户名密码注册201后自动登录并核验普通用户，注册请求不返回或使用UID', async () => {
  const { run, calls } = setupRegistration();
  assert.deepEqual(await run(), { token: TOKEN, loginStatus: 200, profileStatus: 200, registered: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.url), [REGISTRATION_ORIGIN + '/api/register',
    ORIGIN + '/auth/v1/signin', ORIGIN + '/auth/v1/user/me']);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), INPUT);
  assert.deepEqual(JSON.parse(calls[1].init.body), INPUT);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(JSON.stringify(calls).includes(REFRESH_TOKEN), false);
});

test('没有注册配置或注册配置错误不会阻断原有登录，注册本身不发送请求', async () => {
  for (const registrationOrigin of [undefined, '', 'http://registration.example', 'https://registration.example/path']) {
    const calls = [];
    const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin, fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1 ? makeResponse({ access_token: TOKEN }) : makeResponse({ sub: USER_ID, status: 'ACTIVE' });
    } });
    await assert.rejects(client.signUp(INPUT), error => ['REGISTRATION_NOT_CONFIGURED', 'INVALID_CONFIGURATION'].includes(error.code)
      && error.registrationStatus === null && safeError(error));
    assert.equal(calls.length, 0);
    assert.equal((await client.signIn(INPUT)).token, TOKEN);
    assert.equal(calls.length, 2);
  }
});

test('开发同源代理只改变注册请求地址，公开注册来源仍必须是合法HTTPS域名', async () => {
  const urls = [];
  const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
    registrationRequestOrigin: '', fetchImpl: async url => {
      urls.push(url);
      return urls.length === 1 ? makeResponse(REGISTERED, 201)
        : urls.length === 2 ? makeResponse({ access_token: TOKEN }) : makeResponse({ sub: USER_ID, status: 'ACTIVE' });
    } });
  await client.signUp(INPUT);
  assert.equal(urls[0], '/api/register');
  assert.equal(urls[1], ORIGIN + '/auth/v1/signin');
  const bad = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: 'https://bad.example/path',
    registrationRequestOrigin: '', fetchImpl: () => assert.fail('非法配置不得发送请求') });
  await assert.rejects(bad.signUp(INPUT), error => error.code === 'INVALID_CONFIGURATION');
});

test('注册独立校验严格用户名及密码字符、长度、首位和至少三类字符', async () => {
  const { run, calls } = setupRegistration();
  for (const username of ['a', 'a'.repeat(49), '_reader', '-reader', '.reader', 'reader name', 'reader:name',
    'reader+name', 'reader@name', '读者', 'reader\n']) {
    await assert.rejects(run({ username }), error => error.code === 'INVALID_INPUT' && safeError(error));
  }
  for (const password of ['Aa1!aaa', 'Aa1!' + 'a'.repeat(29), '!Aa12345', 'aa123456', 'AA123456',
    'Aaabcdef', 'Aa1!space ', 'Aa1!中文aaa', 'Aa1!period.', 'Aa1!slash/', 'Aa1!colon:', 'Aa1!\nnewline']) {
    await assert.rejects(run({ password }), error => error.code === 'INVALID_INPUT' && safeError(error));
  }
  assert.equal(calls.length, 0);
  for (const password of ['Aa123456', 'Aa!bcdef', 'A1!23456', 'a1!23456', 'Aa1()!@#$%^&*|?><_-']) {
    const valid = setupRegistration();
    assert.equal((await valid.run({ username: 'reader_27-test.name', password })).registered, true);
  }
});

test('用户名已用409明确引导登录，不重复注册或继续认证，不泄露服务端资料', async () => {
  const { run, calls } = setupRegistration({ registrationStatus: 409,
    registrationBody: { ok: false, data: null, error: { code: 'USERNAME_TAKEN', message: USERNAME + PASSWORD + TOKEN } } });
  await assert.rejects(run(), error => error.code === 'USERNAME_TAKEN' && error.registrationStatus === 409
    && error.httpStatus === 409 && error.loginStatus === null && !error.registered && safeError(error));
  assert.equal(calls.length, 1);
});

test('注册400、429、503按安全提示停止；结果未知时先尝试登录，不自动重试', async () => {
  for (const [status, serverCode, expectedCode] of [
    [400, 'INVALID_INPUT', 'INVALID_INPUT'], [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [503, 'REGISTRATION_NOT_CONFIGURED', 'REGISTRATION_UNAVAILABLE'],
    [503, 'REGISTRATION_RESULT_UNKNOWN', 'REGISTRATION_UNKNOWN'], [500, PASSWORD, 'REGISTRATION_UNKNOWN'],
  ]) {
    const { run, calls } = setupRegistration({ registrationStatus: status,
      registrationBody: { ok: false, data: null, error: { code: serverCode, message: USERNAME + PASSWORD + TOKEN } } });
    await assert.rejects(run(), error => error.code === expectedCode && error.registrationStatus === status
      && error.loginStatus === null && safeError(error));
    assert.equal(calls.length, 1);
  }
});

test('201必须严格匹配确认封套，含多余资料、伪成功或不完整结果都不自动登录', async () => {
  for (const registrationBody of [null, [], {}, { ok: true },
    { ok: true, data: { registered: false }, error: null },
    { ok: true, data: { registered: true, uid: USER_ID }, error: null },
    { ok: true, data: { registered: true }, error: { message: PASSWORD } },
    { ...REGISTERED, uid: USER_ID },
  ]) {
    const { run, calls } = setupRegistration({ registrationBody });
    await assert.rejects(run(), error => error.code === 'REGISTRATION_UNKNOWN'
      && error.registrationStatus === 201 && !error.registered && safeError(error));
    assert.equal(calls.length, 1);
  }
});

test('注册已确认但登录或身份核验失败，标记账号已创建且固定提示切换登录', async () => {
  for (const options of [{ loginStatus: 400, session: { error: 'invalid_username_or_password', message: PASSWORD } },
    { profileStatus: 401 }, { profile: { sub: 'anon', status: 'ACTIVE' } }]) {
    const { run, calls } = setupRegistration(options);
    await assert.rejects(run(), error => error.code === 'REGISTERED_LOGIN_FAILED' && error.registered === true
      && error.registrationStatus === 201 && error.message === '账号已创建，自动登录未完成，请切换登录后重试。'
      && safeError(error));
    assert.equal(calls.length, options.loginStatus ? 2 : 3);
    assert.equal(calls.filter(call => call.url.endsWith('/api/register')).length, 1);
  }
});

test('注册网络失败、非JSON201结果均提示先尝试登录，无重试或凭证泄露', async () => {
  for (const fetchImpl of [async () => { throw new Error(USERNAME + PASSWORD + TOKEN); },
    async () => new Response(PASSWORD + TOKEN, { status: 201 })]) {
    let count = 0;
    const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
      fetchImpl: (...args) => { count += 1; return fetchImpl(...args); } });
    await assert.rejects(client.signUp(INPUT), error => ['REGISTRATION_NETWORK_ERROR', 'REGISTRATION_UNKNOWN'].includes(error.code)
      && error.message.includes('先尝试登录') && safeError(error));
    assert.equal(count, 1);
  }
});

test('注册前取消不发送请求，注册请求中取消明确结果未确认，不自动重试', async () => {
  const already = new AbortController();
  already.abort();
  const { run, calls } = setupRegistration();
  await assert.rejects(run({ signal: already.signal }), error => error.code === 'ABORTED');
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  let count = 0;
  const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
    fetchImpl: () => { count += 1; return new Promise(() => {}); } });
  const pending = client.signUp({ ...INPUT, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED' && error.message.includes('先尝试登录')
    && !error.registered && safeError(error));
  assert.equal(count, 1);
});

test('注册请求及响应体共享15秒超时，结果不明不进入登录且不重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  let beganBody;
  const bodyStarted = new Promise(resolve => { beganBody = resolve; });
  const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
    fetchImpl: async () => {
      count += 1;
      return { status: 201, json: () => { beganBody(); return new Promise(() => {}); } };
    } });
  const pending = client.signUp(INPUT);
  await bodyStarted;
  t.mock.timers.tick(15000);
  await assert.rejects(pending, error => error.code === 'REGISTRATION_TIMEOUT' && error.registrationStatus === 201
    && error.message.includes('先尝试登录') && !error.registered && safeError(error));
  assert.equal(count, 1);
});

test('确认注册后取消自动登录保留已创建标记，不重复注册', async () => {
  const controller = new AbortController();
  let count = 0;
  let beganLogin;
  const loginStarted = new Promise(resolve => { beganLogin = resolve; });
  const client = createAccountAuthClient({ authOrigin: ORIGIN, registrationOrigin: REGISTRATION_ORIGIN,
    fetchImpl: async () => {
      count += 1;
      if (count === 1) return makeResponse(REGISTERED, 201);
      beganLogin();
      return new Promise(() => {});
    } });
  const pending = client.signUp({ ...INPUT, signal: controller.signal });
  await loginStarted;
  controller.abort();
  await assert.rejects(pending, error => error.registered === true && error.code === 'REGISTERED_LOGIN_FAILED'
    && error.message === '账号已创建，自动登录未完成，请切换登录后重试。' && safeError(error));
  assert.equal(count, 2);
});

test('注册与自动登录不接触持久存储、不打印凭证或保存刷新令牌', async t => {
  const originals = new Map();
  let accesses = 0;
  const output = [];
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { accesses += 1; throw new Error('禁止读取存储'); } });
  }
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => output.push(args));
  try {
    const { run, calls } = setupRegistration();
    const result = await run();
    assert.equal(Object.hasOwn(result, 'refresh_token'), false);
    assert.equal(JSON.stringify(calls).includes(REFRESH_TOKEN), false);
    const failed = setupRegistration({ profileStatus: 401 });
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

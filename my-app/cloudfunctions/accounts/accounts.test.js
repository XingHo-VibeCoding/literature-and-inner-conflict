const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer, productionRegistrar, validateAllowedOrigin } = require('./index');
const { createRegistrar, validateInput } = require('./register');

const ORIGIN = 'https://fictional-day27.tcloudbaseapp.com';
const ENV_ID = 'fictional-day27-env';
const INPUT = { username: 'fictional-user', password: 'Abc@123456' };
const PRIVATE = 'fictional-private-uid';
const success = () => ({ Data: { Uid: PRIVATE } });
const fixture = (overrides = {}) => createRegistrar({
  envId: ENV_ID, enabled: true, createUser: async () => success(), ...overrides,
});

async function withServer(t, { register = fixture(), logEvent } = {}) {
  const server = createServer({ allowedOrigin: ORIGIN, register, logEvent });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return async function call({ method = 'POST', path = '/api/register', origin = ORIGIN,
    contentType = 'application/json', input = INPUT, raw, headers = {}, chunks } = {}) {
    const body = raw !== undefined ? raw : Buffer.from(JSON.stringify(input));
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: server.address().port,
        method, path, headers: {
          ...(origin !== null ? { Origin: origin } : {}),
          ...(contentType !== undefined ? { 'Content-Type': contentType } : {}),
          ...headers,
        } }, (response) => {
        const received = [];
        response.on('data', (chunk) => received.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(received).toString('utf8');
          resolve({ status: response.statusCode, headers: response.headers, text,
            body: text ? JSON.parse(text) : null });
        });
      });
      request.on('error', reject);
      if (chunks) {
        for (const chunk of chunks) request.write(chunk);
        request.end();
      } else request.end(method === 'OPTIONS' ? undefined : body);
    });
  };
}

test('用户名和密码采用创建接口与登录接口的规则交集', () => {
  assert.deepEqual(validateInput(INPUT), INPUT);
  for (const username of ['a1', '9a._-', 'a'.repeat(48)]) {
    assert.equal(validateInput({ ...INPUT, username }).username, username);
  }
  for (const username of ['a', '', 'a'.repeat(49), '.abc', ' abc', 'abc ', 'a+b', 'abc@x', 'abc\n', 'abc\r', 'abc\u2028', '中文', null, 123]) {
    assert.throws(() => validateInput({ ...INPUT, username }), (error) => error.status === 400 && error.code === 'INVALID_INPUT');
  }
  for (const password of ['Abc12345', 'abc@1234', 'ABC@1234', 'Abcdefg!', 'A1a' + '_'.repeat(29)]) {
    assert.equal(validateInput({ ...INPUT, password }).password, password);
  }
  for (const password of ['', 'Abc@123', 'Aa1' + '_'.repeat(30), '!Abc1234', 'abcdefgh',
    'Abcdefgh', '12345678', 'Abc1234 ', 'Abc1234:', 'Abc1234+', 'Abc@1234\n', 'Abc@1234\r', 'Abc@1234\u2028', 'Abc中文1234', null]) {
    assert.throws(() => validateInput({ ...INPUT, password }), (error) => error.code === 'INVALID_INPUT');
  }
});

test('未知字段、UID、角色、嵌套对象及非对象均拒绝', () => {
  for (const input of [null, [], '文本', {}, { username: 'x' },
    { ...INPUT, uid: 'fictional-injected' }, { ...INPUT, role: 'admin' },
    { ...INPUT, Type: 'internalUser' }, { ...INPUT, password: { value: INPUT.password } },
    JSON.parse('{"username":"valid","password":"Abc@123456","__proto__":{"role":"admin"}}')]) {
    assert.throws(() => validateInput(input), (error) => error.code === 'INVALID_INPUT');
  }
});

test('管理创建只提交固定普通用户字段，不传UID且不返回身份与密码', async () => {
  const calls = [];
  const register = fixture({ createUser: async (input) => { calls.push(input); return success(); } });
  assert.deepEqual(await register(INPUT), { registered: true });
  assert.deepEqual(calls, [{
    EnvId: ENV_ID, Name: INPUT.username, Password: INPUT.password, Type: 'externalUser', UserStatus: 'ACTIVE',
  }]);
});

test('缺配置及默认关闭时不调用任何管理创建', async () => {
  let calls = 0;
  for (const options of [
    { enabled: false }, { enabled: undefined }, { envId: '' }, { envId: 'https://invalid.example' }, { createUser: undefined },
  ]) {
    const register = createRegistrar({ envId: ENV_ID, createUser: async () => { calls += 1; return success(); }, ...options });
    await assert.rejects(register(INPUT), (error) => error.status === 503 && error.code === 'REGISTRATION_UNAVAILABLE');
  }
  assert.equal(calls, 0);
  for (const env of [
    {}, { CLOUDBASE_ENV_ID: ENV_ID, REGISTRATION_ENABLED: 'true' },
    { CLOUDBASE_ENV_ID: ENV_ID, REGISTRATION_ENABLED: 'TRUE', REGISTRATION_SECRET_ID: 'fictional', REGISTRATION_SECRET_KEY: 'fictional' },
    { CLOUDBASE_ENV_ID: ENV_ID, REGISTRATION_ENABLED: 'true', CLOUDBASE_APIKEY: 'fictional-api-key' },
  ]) {
    await assert.rejects(productionRegistrar(env)(INPUT), (error) => error.code === 'REGISTRATION_UNAVAILABLE');
  }
});

test('重复用户名409且仅创建一次，绝不覆盖原账号', async () => {
  let calls = 0;
  const register = fixture({ createUser: async () => {
    calls += 1;
    throw Object.assign(new Error(INPUT.password + PRIVATE), { code: 'FailedOperation.DuplicatedData' });
  } });
  await assert.rejects(register(INPUT), (error) => error.status === 409 && error.code === 'USERNAME_TAKEN'
    && !error.message.includes(INPUT.password) && !error.message.includes(PRIVATE));
  assert.equal(calls, 1);
});

test('未知管理错误与异常响应固定503，隐藏所有内部资料，不自动重试', async () => {
  for (const result of [
    new Error(INPUT.password + PRIVATE),
    Object.assign(new Error(INPUT.password), { code: 'InternalError.' + PRIVATE }),
    null, {}, { Data: { Uid: '' } }, { Data: { Uid: 123 } },
  ]) {
    let calls = 0;
    const register = fixture({ createUser: async () => {
      calls += 1;
      if (result instanceof Error) throw result;
      return result;
    } });
    await assert.rejects(register(INPUT), (error) => error.status === 503
      && error.code === 'REGISTRATION_RESULT_UNKNOWN'
      && error.message.includes('先尝试登录')
      && !error.message.includes(INPUT.password) && !error.message.includes(PRIVATE));
    assert.equal(calls, 1);
  }
});

test('10秒超时后结果不明、不重试，迟到结果前不释放并发位', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  let calls = 0;
  const register = fixture({ createUser: () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = register(INPUT);
  await Promise.resolve();
  t.mock.timers.tick(10000);
  await assert.rejects(pending, (error) => error.status === 504
    && error.code === 'REGISTRATION_RESULT_UNKNOWN' && error.message.includes('勿重复注册'));
  await assert.rejects(register(INPUT), (error) => error.status === 429 && error.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
  finish(success());
  await Promise.resolve();
  await Promise.resolve();
});

test('单实例同时最多一笔注册，其他请求不会到管理接口', async () => {
  let finish;
  let calls = 0;
  const register = fixture({ createUser: () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = register(INPUT);
  await Promise.resolve();
  await assert.rejects(register(INPUT), (error) => error.status === 429 && error.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
  finish(success());
  assert.deepEqual(await pending, { registered: true });
});

test('单实例所有用户名合计每分钟最多五次，窗口到期恢复', async () => {
  let current = 1000;
  let calls = 0;
  const register = fixture({ now: () => current, createUser: async () => { calls += 1; return success(); } });
  for (let index = 0; index < 5; index += 1) await register({ ...INPUT, username: 'user-' + index });
  await assert.rejects(register(INPUT), (error) => error.status === 429 && error.retryAfter === 60);
  assert.equal(calls, 5);
  current += 60000;
  await register(INPUT);
  assert.equal(calls, 6);
});

test('非法来源配置不能启动服务', () => {
  assert.equal(validateAllowedOrigin(ORIGIN), ORIGIN);
  for (const value of [undefined, '', '*', 'http://example.com', ORIGIN + '/', ORIGIN + '/path',
    ORIGIN + '?x=1', 'https://user:password@example.com', 'https://*.example.com']) {
    assert.throws(() => validateAllowedOrigin(value));
  }
});

test('精确本站Origin才允许注册，缺来源/null/其他来源均拒绝且不调用管理', async (t) => {
  let calls = 0;
  const logs = [];
  const call = await withServer(t, { register: fixture({ createUser: async () => { calls += 1; return success(); } }),
    logEvent: (event) => logs.push(event) });
  for (const origin of [null, '', 'null', 'https://other.example', ORIGIN + '/', ORIGIN + ', ' + ORIGIN]) {
    const result = await call({ origin });
    assert.equal(result.status, 403);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  const result = await call();
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { ok: true, data: { registered: true }, error: null });
  assert.equal(result.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(result.headers['x-request-id']);
  assert.equal(calls, 1);
  for (const event of logs) assert.deepEqual(Object.keys(event).sort(), ['code', 'requestId', 'status']);
  assert.ok(!JSON.stringify(logs).includes(INPUT.password));
});

test('OPTIONS只放行POST和必要请求头，不执行创建', async (t) => {
  let calls = 0;
  const call = await withServer(t, { register: async () => { calls += 1; } });
  const accepted = await call({ method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, Accept',
  } });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.text, '');
  assert.equal(accepted.headers['access-control-allow-methods'], 'POST, OPTIONS');
  assert.equal(accepted.headers['access-control-allow-credentials'], undefined);
  for (const headers of [
    { 'Access-Control-Request-Method': 'DELETE' },
    { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' },
    { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-User-Id' }, {},
  ]) {
    assert.equal((await call({ method: 'OPTIONS', headers })).status, 403);
  }
  assert.equal(calls, 0);
});

test('未知路径、查询参数及方法均不能触发创建', async (t) => {
  let calls = 0;
  const call = await withServer(t, { register: async () => { calls += 1; } });
  for (const path of ['/api/register/', '/api/register?role=admin', '/api/entries', '/']) {
    assert.equal((await call({ path })).status, 404);
  }
  const result = await call({ method: 'GET', raw: Buffer.alloc(0) });
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'POST, OPTIONS');
  assert.equal(calls, 0);
});

test('只接受UTF8 JSON，拒绝其他编码、畸形JSON和非法字段', async (t) => {
  let calls = 0;
  const call = await withServer(t, { register: fixture({ createUser: async () => { calls += 1; return success(); } }) });
  for (const contentType of ['text/plain', 'application/json;charset=gbk', 'application/json;foo=bar', '']) {
    assert.equal((await call({ contentType })).status, 415);
  }
  assert.equal((await call({ headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await call({ raw: Buffer.from([0xc3, 0x28]) })).status, 400);
  assert.equal((await call({ raw: Buffer.from('{') })).status, 400);
  assert.equal((await call({ input: { ...INPUT, uid: PRIVATE } })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await call({ contentType: 'application/json; charset=UTF-8' })).status, 201);
  assert.equal(calls, 1);
});

test('显式长度和分块超过4KB都拒绝，不向管理端发送', async (t) => {
  let calls = 0;
  const call = await withServer(t, { register: async () => { calls += 1; } });
  const oversized = Buffer.from(JSON.stringify({ ...INPUT, extra: 'a'.repeat(5000) }));
  assert.equal((await call({ raw: oversized, headers: { 'Content-Length': String(oversized.length) } })).status, 413);
  assert.equal((await call({ chunks: [oversized.subarray(0, 2500), oversized.subarray(2500)] })).status, 413);
  assert.equal(calls, 0);
});

test('HTTP错误和安全日志不包含密码、UID或管理响应正文', async (t) => {
  const logs = [];
  const call = await withServer(t, { register: fixture({ createUser: async () => {
    throw new Error(INPUT.password + PRIVATE);
  } }), logEvent: (event) => logs.push(event) });
  const result = await call();
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'REGISTRATION_RESULT_UNKNOWN');
  assert.equal(result.body.data, null);
  assert.ok(!JSON.stringify({ result, logs }).includes(INPUT.password));
  assert.ok(!JSON.stringify({ result, logs }).includes(PRIVATE));
});

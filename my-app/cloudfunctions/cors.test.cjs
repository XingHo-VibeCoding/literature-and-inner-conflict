const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createCors, validateAllowedOrigin } = require('./cors.cjs');
const { createServer: createReadsServer } = require('./reads/index.js');
const { createServer: createHealthServer } = require('./health/index.js');
const { ApiError } = require('./reads/service.js');

// 全部使用虚构域名、身份、凭证与数据库结果；不连接真实数据库。
const origin = 'https://fictional-literature.example.test';
const token = 'Bearer day20-fictional-access-token';
const item = {
  id: 'day20-fictional-entry', entryDate: '2026-10-14',
  text: '  【虚构·Day20跨域验证】第一行。\n第二行。  ',
};
async function localServer(create, callback) {
  const server = create();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback('http://127.0.0.1:' + server.address().port); }
  finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}
function readsFixture(overrides = {}) {
  const calls = { authenticate: 0, read: 0, write: 0 };
  const create = () => createReadsServer({
    allowedOrigin: origin,
    authenticate: async (header) => {
      calls.authenticate++;
      assert.equal(header, token);
      return 'day20-fictional-user';
    },
    read: async () => { calls.read++; return { items: [item], total: 1 }; },
    write: async ({ body }) => { calls.write++; return { ...item, text: body.text }; },
    ...overrides,
  });
  return { create, calls };
}
function assertCors(response) {
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('access-control-expose-headers'), 'X-Request-Id');
}
function assertDeniedCors(response) {
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-methods'), null);
  assert.equal(response.headers.get('access-control-allow-headers'), null);
  assert.equal(response.headers.get('vary'), 'Origin');
}
function assertUntouched(calls) {
  assert.deepEqual(calls, { authenticate: 0, read: 0, write: 0 });
}

test('环境变量只能是精确 HTTPS Origin；拒绝缺失、通配符、路径和凭证等非法值', () => {
  assert.equal(validateAllowedOrigin(origin), origin);
  assert.equal(validateAllowedOrigin(origin + ':8443'), origin + ':8443');
  for (const invalid of [
    undefined, null, '', '*', 'https://*.example.test', 'http://fictional-literature.example.test',
    origin + '/', origin + '/page', origin + '?a=1', origin + '#part',
    'https://name:password@fictional-literature.example.test', ' ' + origin, origin + '\n',
    'https://fictional-literature.example.test:443',
  ]) assert.throws(() => validateAllowedOrigin(invalid), /ALLOWED_ORIGIN/);
});

test('两个生产入口缺少或配置非法来源时启动失败，提示不泄露配置值', () => {
  for (const folder of ['health', 'reads']) {
    for (const invalid of [undefined, '*', origin + '/page']) {
      const env = { ...process.env };
      if (invalid === undefined) delete env.ALLOWED_ORIGIN;
      else env.ALLOWED_ORIGIN = invalid;
      const result = spawnSync(process.execPath, [path.join(__dirname, folder, 'index.js')], {
        env, encoding: 'utf8', timeout: 2000,
      });
      assert.equal(result.status, 1);
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /启动失败/);
      assert.equal(result.stderr.includes(origin), false);
      assert.equal(result.stdout, '');
    }
  }
});

test('Vary 合并已有头且不重复 Origin；无 Origin 不返回 ACAO', () => {
  const headers = new Map([['Vary', 'Accept-Encoding, origin']]);
  const response = { getHeader: (name) => headers.get(name), setHeader: (name, value) => headers.set(name, value) };
  const cors = createCors({ allowedOrigin: origin, methods: ['GET'] });
  assert.deepEqual(cors({ method: 'GET', headers: {} }, response), { kind: 'continue' });
  assert.equal(headers.get('Vary'), 'Accept-Encoding, origin');
  assert.equal(headers.has('Access-Control-Allow-Origin'), false);
});

test('允许域名的 GET 返回业务数据、精确 ACAO 和可读请求号', async () => {
  const fixture = readsFixture();
  await localServer(fixture.create, async (base) => {
    const response = await fetch(base + '/api/entries', { headers: { Origin: origin, Authorization: token } });
    assert.equal(response.status, 200);
    assertCors(response);
    assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
    assert.deepEqual(await response.json(), { ok: true, data: { items: [item], total: 1 }, error: null });
    assert.deepEqual(fixture.calls, { authenticate: 1, read: 1, write: 0 });
  });
});

test('允许域名的 POST 保留原文和原写入状态码', async () => {
  const fixture = readsFixture();
  await localServer(fixture.create, async (base) => {
    const response = await fetch(base + '/api/entries', {
      method: 'POST', headers: { Origin: origin, Authorization: token, 'Content-Type': 'application/json',
        'X-Client-Time-Zone': 'Asia/Shanghai' },
      body: JSON.stringify({ entryDate: item.entryDate, text: item.text }),
    });
    assert.equal(response.status, 201);
    assertCors(response);
    assert.deepEqual(await response.json(), { ok: true, data: item, error: null });
    assert.deepEqual(fixture.calls, { authenticate: 1, read: 0, write: 1 });
  });
});

test('无 Origin 的请求继续原认证业务；未注入来源时拒绝带 Origin 的请求', async () => {
  const fixture = readsFixture({ allowedOrigin: undefined });
  await localServer(fixture.create, async (base) => {
    const response = await fetch(base + '/api/entries', { headers: { Authorization: token } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), { ok: true, data: { items: [item], total: 1 }, error: null });
    const denied = await fetch(base + '/api/entries', { headers: { Origin: origin, Authorization: token } });
    assertDeniedCors(denied);
    assert.deepEqual(fixture.calls, { authenticate: 1, read: 1, write: 0 });
  });
});

test('禁止 localhost、预览域名、伪造子域名与 null；GET/POST 均不触发认证数据库', async () => {
  const fixture = readsFixture();
  const denied = [
    'http://localhost:5173', 'https://localhost:5173', 'https://fictional.preview.example.test',
    origin + '.evil.test', origin + '/', 'null', origin + ', https://other.example.test',
  ];
  await localServer(fixture.create, async (base) => {
    for (const requestOrigin of denied) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(base + '/api/entries', {
          method, headers: { Origin: requestOrigin, Authorization: token,
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
          ...(method === 'POST' ? { body: JSON.stringify(item) } : {}),
        });
        assertDeniedCors(response);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['data', 'error', 'ok']);
        assert.equal(body.data, null);
        assert.equal(body.error.code, 'CORS_ORIGIN_DENIED');
        assert.equal(body.error.retryable, false);
        assert.match(body.error.message, /[\u4e00-\u9fff]/);
        assert.ok(response.headers.get('x-request-id'));
      }
    }
    assertUntouched(fixture.calls);
  });
});

test('有效 GET/POST 预检返回 204 与限定的方法和请求头，不鉴权或访问数据库', async () => {
  const fixture = readsFixture();
  await localServer(fixture.create, async (base) => {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base + '/api/entries', {
        method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'authorization, CONTENT-TYPE, accept, X-Client-Time-Zone' },
      });
      assert.equal(response.status, 204);
      assertCors(response);
      assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
      assert.equal(response.headers.get('access-control-allow-headers'),
        'Accept, Authorization, Content-Type, X-Client-Time-Zone');
      assert.equal(await response.text(), '');
    }
    const noCustomHeaders = await fetch(base + '/api/entries', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(noCustomHeaders.status, 204);
    assertUntouched(fixture.calls);
  });
});

test('预检拒绝缺失或非法方法、未知请求头、无效列表或禁止来源，且无 ACAO', async () => {
  const fixture = readsFixture();
  await localServer(fixture.create, async (base) => {
    for (const extraHeaders of [
      {}, { 'Access-Control-Request-Method': 'DELETE' }, { 'Access-Control-Request-Method': 'get' },
      { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Unknown' },
      { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization,,Accept' },
      { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    ]) {
      const response = await fetch(base + '/api/entries', {
        method: 'OPTIONS', headers: { Origin: origin, ...extraHeaders },
      });
      assertDeniedCors(response);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['data', 'error', 'ok']);
      assert.match(body.error.code, /^CORS_(ORIGIN|METHOD|HEADERS)_DENIED$/);
      assert.ok(response.headers.get('x-request-id'));
    }
    assertUntouched(fixture.calls);
  });
});

test('允许域名的认证错误保留 ACAO、三键封套与请求号，不进入数据库', async () => {
  const fixture = readsFixture({ authenticate: async () => {
    throw new ApiError(401, 'UNAUTHENTICATED', '请使用有效的登录凭证。');
  } });
  await localServer(fixture.create, async (base) => {
    const response = await fetch(base + '/api/entries', { headers: { Origin: origin } });
    assert.equal(response.status, 401);
    assertCors(response);
    assert.ok(response.headers.get('x-request-id'));
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.deepEqual(await response.json(), {
      ok: false, data: null,
      error: { code: 'UNAUTHENTICATED', message: '请使用有效的登录凭证。', retryable: false },
    });
    assertUntouched(fixture.calls);
  });
});

test('允许域名的数据库错误和不存在路径带 ACAO，维持原封套', async () => {
  const fixture = readsFixture({ read: async () => { throw new Error('虚构上游内部信息'); } });
  await localServer(fixture.create, async (base) => {
    const response = await fetch(base + '/api/entries', { headers: { Origin: origin, Authorization: token } });
    assert.equal(response.status, 500);
    assertCors(response);
    assert.deepEqual(await response.json(), {
      ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: '读取失败，请稍后重试。', retryable: true },
    });
    const missing = await fetch(base + '/api/missing', { headers: { Origin: origin } });
    assert.equal(missing.status, 404);
    assertCors(missing);
    assert.deepEqual(Object.keys(await missing.json()).sort(), ['data', 'error', 'ok']);
  });
});

test('health 无 Origin 和允许 Origin 都返回原来的指定完整 JSON', async () => {
  await localServer(() => createHealthServer({ allowedOrigin: origin }), async (base) => {
    for (const headers of [{}, { Origin: origin }]) {
      const response = await fetch(base + '/api/health?ignored=1', { headers });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '{"ok":true,"service":"【literature-and-inner-conflict】"}');
      if (headers.Origin) assertCors(response);
      else assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  });
});

test('health 只接受 GET 预检；拒绝 POST、未知头与非法来源且无 ACAO', async () => {
  await localServer(() => createHealthServer({ allowedOrigin: origin }), async (base) => {
    const good = await fetch(base + '/api/health', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(good.status, 204);
    assertCors(good);
    assert.equal(good.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(await good.text(), '');
    for (const headers of [
      { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Unknown' },
      { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    ]) {
      const response = await fetch(base + '/api/health', { method: 'OPTIONS', headers });
      assertDeniedCors(response);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['error', 'ok']);
      assert.equal(body.ok, false);
      assert.match(body.error.message, /[\u4e00-\u9fff]/);
    }
    const actualDenied = await fetch(base + '/api/health', { headers: { Origin: 'null' } });
    assertDeniedCors(actualDenied);
  });
});

test('health 原有 404、405、Allow 与无 Origin OPTIONS 处理保持，允许来源错误有 ACAO', async () => {
  await localServer(() => createHealthServer({ allowedOrigin: origin }), async (base) => {
    const missing = await fetch(base + '/api/missing', { headers: { Origin: origin } });
    assert.equal(missing.status, 404);
    assertCors(missing);
    assert.deepEqual(await missing.json(), { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    const wrongMethod = await fetch(base + '/api/health', { method: 'POST', headers: { Origin: origin } });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    assertCors(wrongMethod);
    assert.deepEqual(await wrongMethod.json(), {
      ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 GET 请求。' },
    });
    const noOriginOptions = await fetch(base + '/api/health', { method: 'OPTIONS' });
    assert.equal(noOriginOptions.status, 405);
    assert.equal(noOriginOptions.headers.get('access-control-allow-origin'), null);
  });
});

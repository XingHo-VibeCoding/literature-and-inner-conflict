const test = require('node:test');
const assert = require('node:assert/strict');
const { createReader, ApiError, ENTRIES_SQL, NOTES_SQL, FAVORITES_SQL } = require('./service');
const { createCloudBaseAuth } = require('./auth');
const { createServer } = require('./index');
const { createCloudBaseQuery } = require('./db');

// 全部为虚构数据及模拟上游；不连接真实数据库，不使用真实登录凭证。
const owner = 'day17-fictional-user-A';
const stamp = '2026-10-13T01:00:00.000Z';
const secret = 'day17-fictional-cursor-secret-for-tests-only';
const entryRow = (id = 'fictional-entry-001') => ({
  id, entry_date: '2026-10-13', entry_date_text: '2026-10-13',
  text: '  【虚构·Day17接口验证】第一行。\n第二行。  ', text_version: 1, revision: 1,
  created_at: '2026-10-13T09:00:00.000+08:00', updated_at: stamp,
  adopted_analysis: null, origin: null,
});
const noteRow = (id = 'fictional-note-002', order = 2) => ({
  id, book_id: 'walden', body: '【虚构·Day17接口验证】感悟原文。\n', revision: 1,
  created_at: stamp, updated_at: stamp, saved_at: stamp, save_order: order,
  summary_entry_id: null, summary_active: null, summary_linked_at: null,
  summary_entry_revision_at_link: null, summary_preserve_on_cancel: null,
});
const favoriteRow = (id = 'walden', type = 'book') => ({
  target_type: type, target_id: id, favorited_at: stamp,
});
function fixture(responses) {
  const calls = [];
  const read = createReader({
    cursorSecret: secret, bookIds: new Set(['walden', 'analects']),
    query: async (sql, values) => {
      calls.push({ sql, values });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, '模拟结果不足。');
      return { rows: [next] };
    },
  });
  const request = (kind, query = '', user = owner, bookId = kind === 'notes' ? 'walden' : undefined) =>
    read({ kind, ownerId: user, bookId, params: new URLSearchParams(query) });
  return { read, calls, request };
}
function upstream(status = 200, profile = { sub: owner, status: 'ACTIVE' }) {
  return { status, ok: status >= 200 && status < 300, json: async () => profile };
}
async function localServer(callback, overrides = {}) {
  const db = fixture([{ total: '1', rows: [entryRow()] }]);
  const authenticate = createCloudBaseAuth('day17-test-env', async () => upstream());
  const logs = [];
  const server = createServer({ authenticate, read: db.read, logError: (value) => logs.push(value), ...overrides });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, db, logs); }
  finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}
const authorized = { Authorization: 'Bearer day17-fictional-token' };

test('日精进读取保留原文和日历日，时间输出UTC，SQL动态值参数化', async () => {
  const f = fixture([{ total: '1', rows: [entryRow()] }]);
  const data = await f.request('entries');
  assert.equal(data.items[0].text, entryRow().text);
  assert.equal(data.items[0].entryDate, '2026-10-13');
  assert.equal(data.items[0].createdAt, stamp);
  assert.equal(data.items[0].adoptedAnalysis, null);
  assert.equal(data.items[0].origin, null);
  assert.equal('ownerId' in data.items[0], false);
  assert.equal('entry_date' in data.items[0], false);
  assert.deepEqual(data.page, { limit: 20, nextCursor: null, hasMore: false });
  assert.deepEqual(f.calls[0].values, [owner, null, null, null, 21]);
  assert.equal(f.calls[0].sql, ENTRIES_SQL);
  assert.equal(f.calls[0].sql.includes(owner), false);
});

test('日精进分页正确绑定降序日期、降序时间和升序ID，total不随翻页变小', async () => {
  const f = fixture([
    { total: '2', rows: [entryRow('fictional-001'), entryRow('fictional-002')] },
    { total: '2', rows: [entryRow('fictional-002')] },
  ]);
  const first = await f.request('entries', 'limit=1');
  assert.equal(first.items.length, 1);
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.nextCursor.includes(owner), false);
  const second = await f.request('entries', `limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`);
  assert.deepEqual(f.calls[1].values, [owner, '2026-10-13', stamp, 'fictional-001', 2]);
  assert.equal(second.total, 2);
  assert.deepEqual(second.page, { limit: 1, nextCursor: null, hasMore: false });
});

test('读取无记录的新用户返回成功空列表', async () => {
  for (const kind of ['entries', 'notes', 'favorites']) {
    const f = fixture([{ total: '0', rows: [], latest_note_id: null }]);
    const data = await f.request(kind);
    assert.deepEqual(data.items, []);
    assert.equal(data.total, 0);
    assert.equal(data.page.nextCursor, null);
    if (kind === 'notes') assert.equal(data.latestNoteId, null);
  }
});

test('感悟五个关联字段组回对象，已取消关联与原始时间保留', async () => {
  const row = { ...noteRow(), revision: 2, summary_entry_id: 'fictional-linked-entry',
    summary_active: false, summary_linked_at: stamp, summary_entry_revision_at_link: 1,
    summary_preserve_on_cancel: true };
  const f = fixture([{ total: '1', rows: [row], latest_note_id: row.id }]);
  const data = await f.request('notes');
  assert.equal(data.items[0].body, row.body);
  assert.deepEqual(data.items[0].summaryLink, {
    entryId: row.summary_entry_id, active: false, linkedAt: stamp,
    entryRevisionAtLink: 1, preserveOnCancel: true,
  });
  assert.equal(f.calls[0].sql, NOTES_SQL);
  assert.deepEqual(f.calls[0].values, [owner, 'walden', null, null, null, 21]);
});

test('感悟第二页仍返回全量最新ID，不误把该页第一条当最新', async () => {
  const f = fixture([
    { total: '2', rows: [noteRow(), noteRow('fictional-note-001', 1)], latest_note_id: 'fictional-note-002' },
    { total: '2', rows: [noteRow('fictional-note-001', 1)], latest_note_id: 'fictional-note-002' },
  ]);
  const first = await f.request('notes', 'limit=1');
  assert.equal(first.items[0].summaryLink, null);
  const second = await f.request('notes', `limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`);
  assert.equal(second.latestNoteId, 'fictional-note-002');
  assert.equal(second.items[0].id, 'fictional-note-001');
  assert.deepEqual(f.calls[1].values, [owner, 'walden', stamp, 2, 'fictional-note-002', 2]);
});

test('收藏筛选以占位符传入，只返回契约关联字段', async () => {
  const f = fixture([{ total: '1', rows: [favoriteRow()] }]);
  const data = await f.request('favorites', 'targetType=book&limit=100');
  assert.deepEqual(data.items[0], { targetType: 'book', targetId: 'walden', favoritedAt: stamp });
  assert.deepEqual(f.calls[0].values, [owner, 'book', null, null, null, 101]);
  assert.equal(f.calls[0].sql, FAVORITES_SQL);
});

test('收藏分页使用降序时间及升序类型和目标ID', async () => {
  const f = fixture([
    { total: '2', rows: [favoriteRow(), favoriteRow('fictional-entry', 'entry')] },
    { total: '2', rows: [favoriteRow('fictional-entry', 'entry')] },
  ]);
  const first = await f.request('favorites', 'limit=1');
  await f.request('favorites', `limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`);
  assert.deepEqual(f.calls[1].values, [owner, null, stamp, 'book', 'walden', 2]);
});

test('篡改、跨用户、跨作品和跨收藏筛选游标均在读库前拒绝', async () => {
  const cases = [
    ['entries', '', (token) => `limit=1&cursor=${token.slice(0, -1)}!`, owner, undefined],
    ['entries', '', (token) => `limit=1&cursor=${token}`, 'day17-fictional-user-B', undefined],
    ['notes', '', (token) => `limit=1&cursor=${token}`, owner, 'analects'],
    ['favorites', 'targetType=book&', (token) => `limit=1&cursor=${token}`, owner, undefined],
  ];
  for (const [kind, prefix, nextQuery, user, book] of cases) {
    const rows = kind === 'entries' ? [entryRow(), entryRow('fictional-002')]
      : kind === 'notes' ? [noteRow(), noteRow('fictional-001', 1)]
        : [favoriteRow(), favoriteRow('analects')];
    const f = fixture([{ total: '2', rows, latest_note_id: 'fictional-note-002' }]);
    const first = await f.request(kind, `${prefix}limit=1`);
    await assert.rejects(f.request(kind, nextQuery(first.page.nextCursor), user, book),
      (error) => error instanceof ApiError && error.status === 400);
    assert.equal(f.calls.length, 1);
  }
});

test('未登记参数、重复参数、无效limit和空游标拒绝，不让ownerId由客户端指定', async () => {
  for (const query of ['ownerId=other', 'limit=0', 'limit=101', 'limit=1.5', 'limit=', 'limit=01',
    'limit=1&limit=2', 'cursor=', 'targetType=book']) {
    const f = fixture([]);
    await assert.rejects(f.request('entries', query), (error) => error.status === 400);
    assert.equal(f.calls.length, 0);
  }
});

test('未知作品与错误收藏类型拒绝，不把输入拼入SQL', async () => {
  const f = fixture([]);
  await assert.rejects(f.request('notes', '', owner, "walden'; SELECT 1; --"), (error) => error.status === 404);
  await assert.rejects(f.request('favorites', 'targetType=invalid'), (error) => error.status === 400);
  assert.equal(f.calls.length, 0);
});

test('CloudBase核验使用当前环境、真实Bearer和可信sub', async () => {
  const auth = createCloudBaseAuth('day17-test-env', async (url, options) => {
    assert.equal(url, 'https://day17-test-env.api.tcloudbasegateway.com/auth/v1/user/me');
    assert.equal(options.headers.Authorization, authorized.Authorization);
    assert.equal(options.redirect, 'error');
    return upstream();
  });
  assert.equal(await auth(authorized.Authorization), owner);
});

test('缺失、失效、非用户令牌及停用用户不能取得身份', async () => {
  const auth = createCloudBaseAuth('day17-test-env', async () => upstream(401));
  for (const header of [undefined, 'Basic fictional', 'Bearer invalid', 'Bearer x y']) {
    await assert.rejects(auth(header), (error) => error.status === 401);
  }
  const token = `fictional.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fictional`;
  const never = createCloudBaseAuth('day17-test-env', async () => { throw new Error('不应访问上游。'); });
  await assert.rejects(never(`Bearer ${token}`), (error) => error.status === 401);
  const disabled = createCloudBaseAuth('day17-test-env', async () => upstream(200, { sub: owner, status: 'DISABLED' }));
  await assert.rejects(disabled(authorized.Authorization), (error) => error.status === 401);
});

test('认证服务故障返回可重试500，不伪装成用户没登录', async () => {
  const auth = createCloudBaseAuth('day17-test-env', async () => upstream(503));
  await assert.rejects(auth(authorized.Authorization), (error) => error.status === 500 && error.retryable);
  const offline = createCloudBaseAuth('day17-test-env', async () => { throw new Error('【虚构】连接故障。'); });
  await assert.rejects(offline(authorized.Authorization), (error) => error.status === 500);
});

test('HTTP成功仅有ok/data/error三键，请求ID放响应头', async () => {
  await localServer(async (base) => {
    const response = await fetch(`${base}/api/entries`, { headers: authorized });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body), ['ok', 'data', 'error']);
    assert.equal(body.ok, true);
    assert.equal(body.error, null);
    assert.equal(body.data.items[0].text, entryRow().text);
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('HTTP无令牌返回统一401，伪造用户头无法越过认证', async () => {
  await localServer(async (base, db) => {
    const response = await fetch(`${base}/api/entries`, { headers: { 'X-User-Id': owner, 'X-Cloudbase-Uid': owner } });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.deepEqual(Object.keys(body), ['ok', 'data', 'error']);
    assert.equal(body.data, null);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(db.calls.length, 0);
  });
});

test('HTTP拒绝未知路径和未登记写入方法，收藏Allow头标明GET与PATCH', async () => {
  await localServer(async (base, db) => {
    assert.equal((await fetch(`${base}/api/health`)).status, 404);
    const post = await fetch(`${base}/api/favorites`, { method: 'POST', headers: authorized });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, PATCH');
    assert.equal(db.calls.length, 0);
  });
});

test('HTTP读库失败不返回空列表，也不泄露内部错误正文', async () => {
  const fictionalError = '【虚构】数据库内部信息，不应返回浏览器。';
  await localServer(async (base, db, logs) => {
    const response = await fetch(`${base}/api/entries`, { headers: authorized });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.data, null);
    assert.deepEqual(body.error, {
      code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。', retryable: true,
    });
    assert.deepEqual(logs, [{ requestId: response.headers.get('x-request-id'), code: 'INTERNAL_ERROR' }]);
    assert.equal(JSON.stringify(body).includes(fictionalError), false);
    assert.equal(JSON.stringify(logs).includes(fictionalError), false);
  }, { read: async () => { throw new Error(fictionalError); } });
});

test('Day23 已知5xx只返回固定中文，不透传原始消息和fields，保留状态与请求号', async () => {
  const internal = '【虚构·Day23】仅供服务端诊断的读取详情。';
  const privateField = '【虚构·Day23】不得返回客户端的字段内容。';
  for (const [status, retryable] of [[500, false], [503, true]]) {
    const failure = new ApiError(status, 'INTERNAL_ERROR', internal, retryable);
    failure.fields = { text: privateField };
    await localServer(async (base, db, logs) => {
      const response = await fetch(`${base}/api/entries`, { headers: authorized });
      const body = await response.json();
      assert.equal(response.status, status);
      assert.deepEqual(body, {
        ok: false, data: null,
        error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。', retryable },
      });
      assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
      assert.deepEqual(logs, [{ requestId: response.headers.get('x-request-id'), code: 'INTERNAL_ERROR' }]);
      assert.equal(db.calls.length, 0);
      for (const value of [internal, privateField]) {
        assert.equal(JSON.stringify(body).includes(value), false);
        assert.equal(JSON.stringify(logs).includes(value), false);
      }
    }, { read: async () => { throw failure; } });
  }
});

test('每次HTTP请求重新查询，上游虚构结果改变后返回跟随改变', async () => {
  let text = '【虚构·Day17接口验证】修改前。';
  let count = 0;
  const read = createReader({ cursorSecret: secret, bookIds: new Set(['walden']), query: async () => {
    count += 1;
    return { rows: [{ total: '1', rows: [{ ...entryRow(), text }] }] };
  } });
  await localServer(async (base) => {
    const first = await (await fetch(`${base}/api/entries`, { headers: authorized })).json();
    text = '【虚构·Day17接口验证】修改后。';
    const second = await (await fetch(`${base}/api/entries`, { headers: authorized })).json();
    assert.equal(first.data.items[0].text, '【虚构·Day17接口验证】修改前。');
    assert.equal(second.data.items[0].text, text);
    assert.equal(count, 2);
  }, { read });
});

test('HTTPS连接配置拒绝无效环境和缺失管理员凭证，保留身份与游标配置校验', () => {
  assert.throws(() => createCloudBaseQuery('https://fictional.invalid', 'fictional'));
  for (const key of [undefined, '', 'fictional key', '\nfictional']) {
    assert.throws(() => createCloudBaseQuery('day17-test-env', key));
  }
  assert.throws(() => createCloudBaseAuth('https://fictional.invalid'));
  assert.throws(() => createReader({ query: () => {}, bookIds: new Set(), cursorSecret: 'short' }));
});

const fictionalAdminKey = 'day17-fictional-admin-key-only-for-tests';

test('HTTPS SQL使用固定官方地址与只读角色，三个查询参数原样传递', async () => {
  let calls = 0;
  const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://day17-test-env.api.tcloudbasegateway.com/v1/rdb/exec-pgsql');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${fictionalAdminKey}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body), ['sql', 'parameters', 'role']);
    assert.equal(body.role, 'cloudbase_read_only_user');
    assert.equal(body.sql.includes('fictional-injection'), false);
    assert.equal(body.parameters[0], "fictional-injection'; DROP TABLE entries; --");
    assert.equal(body.sql.includes(fictionalAdminKey), false);
    return upstream(200, [{ total: '0', rows: [] }]);
  });
  const cases = [
    [ENTRIES_SQL, ["fictional-injection'; DROP TABLE entries; --", null, null, null, 21]],
    [NOTES_SQL, ["fictional-injection'; DROP TABLE entries; --", 'walden', stamp, 2, 'fictional-note', 2]],
    [FAVORITES_SQL, ["fictional-injection'; DROP TABLE entries; --", 'book', stamp, 'book', 'walden', 2]],
  ];
  for (const [sql, parameters] of cases) {
    assert.deepEqual(await query(sql, parameters), { rows: [{ total: '0', rows: [] }] });
    assert.equal(parameters[0], "fictional-injection'; DROP TABLE entries; --");
  }
  assert.equal(calls, 3);
});

test('HTTPS适配层只接受三个固定读取语句，不提供任意SQL代理', async () => {
  let calls = 0;
  const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => { calls += 1; return upstream(200, []); });
  for (const [sql, values] of [
    ['SELECT * FROM public.entries', []],
    ['DELETE FROM public.entries', []],
    [ENTRIES_SQL, { ownerId: owner }],
    [ENTRIES_SQL, [owner, { role: 'cloudbase_postgres' }]],
  ]) {
    await assert.rejects(query(sql, values), (error) => error instanceof ApiError && error.status === 500);
  }
  assert.equal(calls, 0);
});

test('SQL服务权限或服务错误不透传细节、不改角色、不自动重试', async () => {
  for (const status of [400, 401, 403, 429, 503]) {
    let calls = 0;
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async (url, options) => {
      calls += 1;
      assert.equal(JSON.parse(options.body).role, 'cloudbase_read_only_user');
      return { status, ok: false, json: async () => { throw new Error('【虚构】非JSON错误包含内部信息，不应透传。'); } };
    });
    await assert.rejects(query(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.code, 'INTERNAL_ERROR');
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.equal(error.message.includes(fictionalAdminKey), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('SQL服务非JSON或非数组返回不被转换为成功空列表', async () => {
  for (const value of [{ rows: [] }, null, '[]', [null], [[]], [1]]) {
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => upstream(200, value));
    await assert.rejects(query(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => error.status === 500);
  }
  const invalidJson = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => ({
    status: 200, ok: true, json: async () => { throw new Error('【虚构】HTML返回。'); },
  }));
  await assert.rejects(invalidJson(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => error.status === 500);
});

test('SQL服务网络和超时异常返回统一错误，不泄露凭证', async () => {
  for (const failure of [new Error(fictionalAdminKey), new DOMException('【虚构】请求超时。', 'TimeoutError')]) {
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => { throw failure; });
    await assert.rejects(query(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes(fictionalAdminKey), false);
      return true;
    });
  }
});

test('三个HTTP读取贯通HTTPS适配：用户令牌和管理员凭证分开，归属与三键响应一致', async () => {
  let authCalls = 0;
  const authenticate = createCloudBaseAuth('day17-test-env', async (url, options) => {
    authCalls += 1;
    assert.equal(options.headers.Authorization, authorized.Authorization);
    assert.equal(options.headers.Authorization.includes(fictionalAdminKey), false);
    return upstream();
  });
  const sqlCalls = [];
  const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${fictionalAdminKey}`);
    assert.notEqual(options.headers.Authorization, authorized.Authorization);
    const body = JSON.parse(options.body);
    sqlCalls.push(body);
    assert.equal(body.parameters[0], owner);
    assert.equal(body.role, 'cloudbase_read_only_user');
    const rows = body.sql === ENTRIES_SQL ? [entryRow()]
      : body.sql === NOTES_SQL ? [noteRow()] : [favoriteRow()];
    return upstream(200, [{ total: '1', rows, latest_note_id: 'fictional-note-002' }]);
  });
  const read = createReader({ query, cursorSecret: secret, bookIds: new Set(['walden']) });
  await localServer(async (base) => {
    const routes = ['/api/entries?limit=1', '/api/books/walden/notes?limit=1', '/api/favorites?targetType=book&limit=1'];
    const results = [];
    for (const route of routes) {
      const response = await fetch(base + route, { headers: { ...authorized, 'X-User-Id': 'fictional-attacker' } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ['ok', 'data', 'error']);
      assert.equal(body.ok, true);
      assert.equal(body.error, null);
      assert.equal(body.data.items.length, 1);
      assert.equal(JSON.stringify(body).includes(fictionalAdminKey), false);
      assert.equal(JSON.stringify(body).includes(owner), false);
      results.push(body.data);
    }
    assert.equal(results[0].items[0].text, entryRow().text);
    assert.equal(results[1].latestNoteId, 'fictional-note-002');
    assert.equal(results[1].items[0].summaryLink, null);
    assert.equal(results[2].items[0].targetId, 'walden');
  }, { authenticate, read });
  assert.equal(authCalls, 3);
  assert.equal(sqlCalls.length, 3);
});

test('HTTPS响应嵌套rows异常或权限失败时，HTTP失败不返回虚构成功、不泄露内部内容', async () => {
  for (const result of [
    upstream(200, [{ total: '0', rows: '[]' }]),
    { status: 403, ok: false, json: async () => ({ message: fictionalAdminKey }) },
  ]) {
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => result);
    const read = createReader({ query, cursorSecret: secret, bookIds: new Set(['walden']) });
    await localServer(async (base, db, logs) => {
      const response = await fetch(`${base}/api/entries`, { headers: authorized });
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.data, null);
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      assert.equal(JSON.stringify(body).includes(fictionalAdminKey), false);
      assert.equal(JSON.stringify(logs).includes(fictionalAdminKey), false);
    }, { read });
  }
});


test('SQL诊断只保留安全状态和固定错误代码，不泄露消息、SQL或参数', async () => {
  for (const [status, code] of [[400, 'DATABASE_42704'], [400, 'DATABASE_42703'],
    [400, 'DATABASE_42501'], [401, 'UNAUTHORIZED'], [403, 'ACTION_FORBIDDEN'],
    [503, 'INTERNAL_ERROR']]) {
    let calls = 0;
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async (url, options) => {
      calls += 1;
      assert.equal(JSON.parse(options.body).role, 'cloudbase_read_only_user');
      return upstream(status, { code, message: fictionalAdminKey,
        details: ENTRIES_SQL + owner, parameters: [owner], requestId: fictionalAdminKey });
    });
    await assert.rejects(query(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.code, 'INTERNAL_ERROR');
      assert.equal(error.retryable, status >= 500);
      assert.equal(error.message,
        `读取失败（SQL 服务 HTTP ${status}，错误代码：${code}），请核对服务端配置。`);
      for (const value of [fictionalAdminKey, ENTRIES_SQL, owner]) {
        assert.equal(error.message.includes(value), false);
      }
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('未知、嵌套、非对象及非JSON错误代码不会直接反射到诊断提示', async () => {
  for (const problem of [null, [], fictionalAdminKey, {},
    { code: fictionalAdminKey }, { code: 'DATABASE_42501 ' },
    { code: 42501 }, { code: { value: 'DATABASE_42501' } },
    { error: { code: 'DATABASE_42501', message: fictionalAdminKey } }]) {
    const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey,
      async () => upstream(400, problem));
    await assert.rejects(query(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
      assert.equal(error.message,
        '读取失败（SQL 服务 HTTP 400，错误代码：UNCLASSIFIED），请核对服务端配置。');
      assert.equal(error.retryable, false);
      return true;
    });
  }
  const nonJson = createCloudBaseQuery('day17-test-env', fictionalAdminKey, async () => ({
    status: 429, ok: false, json: async () => { throw new Error(fictionalAdminKey); },
  }));
  await assert.rejects(nonJson(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
    assert.equal(error.retryable, true);
    assert.match(error.message, /HTTP 429.*UNCLASSIFIED/);
    assert.equal(error.message.includes(fictionalAdminKey), false);
    return true;
  });
  const badStatus = createCloudBaseQuery('day17-test-env', fictionalAdminKey,
    async () => ({ status: fictionalAdminKey, ok: false, json: async () => ({ code: 'UNAUTHORIZED' }) }));
  await assert.rejects(badStatus(ENTRIES_SQL, [owner, null, null, null, 21]), (error) => {
    assert.match(error.message, /HTTP UNKNOWN.*UNAUTHORIZED/);
    assert.equal(error.message.includes(fictionalAdminKey), false);
    return true;
  });
});

test('Day23 HTTP隐藏SQL诊断并保留三键、错误码、重试标记与安全日志', async () => {
  const query = createCloudBaseQuery('day17-test-env', fictionalAdminKey,
    async () => upstream(400, { code: 'DATABASE_42704',
      message: fictionalAdminKey, details: ENTRIES_SQL + owner }));
  const read = createReader({ query, cursorSecret: secret, bookIds: new Set(['walden']) });
  await localServer(async (base, db, logs) => {
    const response = await fetch(`${base}/api/entries?limit=20`, { headers: authorized });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(Object.keys(body), ['ok', 'data', 'error']);
    assert.deepEqual(Object.keys(body.error), ['code', 'message', 'retryable']);
    assert.equal(body.ok, false);
    assert.equal(body.data, null);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.retryable, false);
    assert.equal(body.error.message, '服务暂时不可用，请稍后重试。');
    for (const value of [fictionalAdminKey, ENTRIES_SQL, owner]) {
      assert.equal(JSON.stringify(body).includes(value), false);
      assert.equal(JSON.stringify(logs).includes(value), false);
    }
  }, { read });
});

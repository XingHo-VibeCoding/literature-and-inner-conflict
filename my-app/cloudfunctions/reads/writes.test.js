const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiError, createReader, ENTRIES_SQL, FAVORITES_SQL } = require('./service');
const { createWriter, INSERT_ENTRY_SQL } = require('./writer');
const { createCloudBaseQuery } = require('./db');
const { createServer } = require('./index');

// 仅使用虚构身份、虚构凭证和模拟数据库；不证明真实数据库并发或部署成功。
const owner = 'day18-fictional-user-A';
const otherOwner = 'day18-fictional-user-B';
const token = 'day18-fictional-access-token';
const apiKey = 'day18-fictional-service-key-for-tests';
const stamp = '2026-10-13T16:05:00.000Z';
const now = () => new Date(stamp);
const validBody = (text = '  【虚构·Day18接口验证】第一行。\n第二行。  ') =>
  ({ entryDate: '2026-10-14', text });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const row = (id = 'day18-fictional-entry', entryDate = '2026-10-14', text = validBody().text) => ({
  id, entry_date_text: entryDate, text, text_version: 1, revision: 1,
  created_at: '2026-10-14T00:05:00.000+08:00', updated_at: stamp,
  adopted_analysis: null, origin: null,
});
const upstream = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

function writerFixture(respond = (sql, values) => ({ rows: [row(values[0], values[2], values[3])] })) {
  const calls = [];
  const write = createWriter({
    now,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return respond(sql, values);
    },
  });
  const request = (body = validBody(), timeZone, ownerId = owner) => write({ ownerId, body, timeZone });
  return { calls, write, request };
}

function fieldError(field) {
  return (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.equal(error.retryable, false);
    assert.match(error.fields[field], /[\u4e00-\u9fff]/);
    return true;
  };
}

function memoryDatabase() {
  const records = new Map();
  const calls = [];
  const favorites = [{ target_type: 'book', target_id: 'walden', favorited_at: stamp }];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql === INSERT_ENTRY_SQL) {
      const [id, ownerId, entryDate, text] = values;
      if (records.has(id)) return { rows: [] };
      const inserted = row(id, entryDate, text);
      records.set(id, { ownerId, inserted });
      return { rows: [inserted] };
    }
    if (sql === ENTRIES_SQL) {
      const selected = [...records.values()].filter((item) => item.ownerId === values[0])
        .map((item) => item.inserted);
      return { rows: [{ total: String(selected.length), rows: selected }] };
    }
    if (sql === FAVORITES_SQL) return { rows: [{ total: String(favorites.length), rows: favorites }] };
    throw new Error('测试遇到未登记的 SQL。');
  };
  return { query, records, calls };
}

async function localServer(callback, options = {}) {
  const db = memoryDatabase();
  const logs = [];
  const read = createReader({
    query: db.query, bookIds: new Set(['walden']),
    cursorSecret: 'day18-fictional-cursor-secret-at-least-32-bytes',
  });
  const write = createWriter({ query: db.query, now });
  const authenticate = async (header) => {
    if (header !== `Bearer ${token}`) throw new ApiError(401, 'UNAUTHENTICATED', '请使用有效的登录凭证。');
    return owner;
  };
  const server = createServer({
    authenticate, read, write,
    logError: (event) => logs.push(event), logEvent: (event) => logs.push(event),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, db, logs); }
  finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}

async function post(base, body = validBody(), path = '/api/entries', extraHeaders = {}) {
  const response = await fetch(base + path, {
    method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('写入保留原始空格换行和日期，返回契约完整字段，动态值只通过参数传入', async () => {
  const input = validBody();
  const original = { ...input };
  const f = writerFixture();
  const data = await f.request(input);
  assert.deepEqual(input, original);
  assert.equal(data.text, original.text);
  assert.equal(data.entryDate, original.entryDate);
  assert.equal(data.textVersion, 1);
  assert.equal(data.revision, 1);
  assert.equal(data.createdAt, stamp);
  assert.equal(data.updatedAt, stamp);
  assert.equal(data.adoptedAnalysis, null);
  assert.equal(data.origin, null);
  assert.deepEqual(Object.keys(data), ['id', 'entryDate', 'text', 'textVersion', 'revision',
    'createdAt', 'updatedAt', 'adoptedAnalysis', 'origin']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].sql, INSERT_ENTRY_SQL);
  assert.deepEqual(f.calls[0].values.slice(1), [owner, input.entryDate, input.text]);
  for (const value of [owner, input.entryDate, input.text]) assert.equal(INSERT_ENTRY_SQL.includes(value), false);
});

test('缺少必填字段和错误类型在写库前拒绝，中文字段错误准确指出日期与原文', async () => {
  const cases = [
    [{ text: '【虚构】正文' }, 'entryDate'], [{ entryDate: '2026-10-14' }, 'text'],
    [{}, 'entryDate'], [{ entryDate: null, text: '【虚构】正文' }, 'entryDate'],
    [{ entryDate: 20261014, text: '【虚构】正文' }, 'entryDate'],
    [validBody(null), 'text'], [validBody(1), 'text'], [validBody(true), 'text'],
    [validBody({ text: '【虚构】正文' }), 'text'], [validBody([]), 'text'],
  ];
  for (const [body, field] of cases) {
    const f = writerFixture();
    await assert.rejects(f.request(body), fieldError(field));
    assert.equal(f.calls.length, 0);
  }
});

test('请求体必须为对象，拒绝未登记及客户端可伪造的归属、版本、ID和来源字段', async () => {
  const invalidBodies = [null, [], '正文', 1, true];
  for (const body of invalidBodies) {
    const f = writerFixture();
    await assert.rejects(f.request(body), (error) => error.status === 400 && error.code === 'INVALID_INPUT');
    assert.equal(f.calls.length, 0);
  }
  for (const key of ['ownerId', 'id', 'revision', 'textVersion', 'createdAt', 'origin', 'adoptedAnalysis', 'unknown']) {
    const f = writerFixture();
    await assert.rejects(f.request({ ...validBody(), [key]: '【虚构】客户端输入' }),
      (error) => error.status === 400 && error.code === 'INVALID_INPUT');
    assert.equal(f.calls.length, 0);
  }
});

test('日期格式、真实日历日期及未来日期拒绝，合法闰日保留原始日历日', async () => {
  for (const entryDate of ['', '2026-2-01', '2026-02-29', '2026-04-31', '2026-13-01',
    '0000-01-01', '2026-10-15', '2026-10-14T00:00:00Z']) {
    const f = writerFixture();
    await assert.rejects(f.request({ ...validBody(), entryDate }), fieldError('entryDate'));
    assert.equal(f.calls.length, 0);
  }
  const data = await writerFixture().request({ ...validBody(), entryDate: '2024-02-29' });
  assert.equal(data.entryDate, '2024-02-29');
});

test('字数按去首尾空白后的Unicode码点校验，1和5000接受，空白和5001拒绝', async () => {
  for (const text of ['字', '😀'.repeat(5000), '  😀\n  ']) {
    const f = writerFixture();
    assert.equal((await f.request(validBody(text))).text, text);
  }
  for (const text of ['', ' \n\t ', '😀'.repeat(5001)]) {
    const f = writerFixture();
    await assert.rejects(f.request(validBody(text)), fieldError('text'));
    assert.equal(f.calls.length, 0);
  }
});

test('数据库不能保存的空字符及无效Unicode字符在写库前拒绝', async () => {
  for (const text of ['【虚构】\u0000正文', '【虚构】\ud800正文', '【虚构】\udfff正文']) {
    const f = writerFixture();
    await assert.rejects(f.request(validBody(text)), fieldError('text'));
    assert.equal(f.calls.length, 0);
  }
});

test('UTC跨日时按客户端时区日历校验，缺省上海且有效时区不改变所存日期', async () => {
  assert.equal((await writerFixture().request()).entryDate, '2026-10-14');
  assert.equal((await writerFixture().request(validBody(), 'Asia/Shanghai')).entryDate, '2026-10-14');
  const western = writerFixture();
  await assert.rejects(western.request(validBody(), 'America/New_York'), fieldError('entryDate'));
  assert.equal(western.calls.length, 0);
  const past = { ...validBody(), entryDate: '2026-10-13' };
  assert.equal((await writerFixture().request(past, 'America/New_York')).entryDate, '2026-10-13');
});

test('无效IANA时区被拒绝且字段提示为中文，不回退到主机时区', async () => {
  for (const zone of ['', 'day18-fictional-invalid-zone', '+08:00', 8, null]) {
    const f = writerFixture();
    await assert.rejects(f.request(validBody(), zone), fieldError('X-Client-Time-Zone'));
    assert.equal(f.calls.length, 0);
  }
});

test('同用户同日期完全相同原文重发得到稳定服务端ID与409，不增加模拟数据库行', async () => {
  const db = memoryDatabase();
  const write = createWriter({ query: db.query, now });
  const input = { ownerId: owner, body: validBody() };
  await write(input);
  await assert.rejects(write(input), (error) => error.status === 409
    && error.code === 'DUPLICATE_ENTRY' && error.retryable === false && /重复/.test(error.message));
  assert.equal(db.records.size, 1);
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[0].values[0], db.calls[1].values[0]);
});

test('不同用户、日期、原文及原始空白分别取得不同ID，不把同日多条原文误拒', async () => {
  const db = memoryDatabase();
  const write = createWriter({ query: db.query, now });
  const inputs = [
    { ownerId: owner, body: validBody() },
    { ownerId: otherOwner, body: validBody() },
    { ownerId: owner, body: { ...validBody(), entryDate: '2026-10-13' } },
    { ownerId: owner, body: validBody('【虚构】另一段正文。') },
    { ownerId: owner, body: validBody(validBody().text.trim()) },
  ];
  const ids = [];
  for (const input of inputs) ids.push((await write(input)).id);
  assert.equal(new Set(ids).size, inputs.length);
  assert.equal(db.records.size, inputs.length);
});

test('未知写库异常统一WRITE_FAILED，原内部错误不作为正文泄露', async () => {
  const internal = 'day18-fictional-private-database-message';
  const f = writerFixture(() => { throw new Error(internal); });
  await assert.rejects(f.request(), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.code, 'WRITE_FAILED');
    assert.equal(error.message.includes(internal), false);
    return true;
  });
});

test('已知数据库故障保留安全中文提示和retryable，统一为WRITE_FAILED', async () => {
  const f = writerFixture(() => { throw new ApiError(500, 'INTERNAL_ERROR', '数据库服务暂时不可用。', true); });
  await assert.rejects(f.request(), (error) => error.status === 500 && error.code === 'WRITE_FAILED'
    && error.message === '数据库服务暂时不可用。' && error.retryable === true);
});

test('数据库返回异常或多行不能被包装为写入成功，只有明确空行数组表示重复', async () => {
  for (const result of [null, {}, { rows: null }, { rows: [null] },
    { rows: [row(), row()] }, { rows: [{ ...row(), created_at: null }] }]) {
    const f = writerFixture(() => result);
    await assert.rejects(f.request(), (error) => error.status === 500 && error.code === 'WRITE_FAILED');
  }
  await assert.rejects(writerFixture(() => ({ rows: [] })).request(),
    (error) => error.status === 409 && error.code === 'DUPLICATE_ENTRY');
});

test('HTTP正常POST返回201和三键封套，关联ID仅在响应头，安全日志不含用户内容或凭证', async () => {
  await localServer(async (base, db, logs) => {
    const result = await post(base);
    assert.equal(result.response.status, 201);
    assert.deepEqual(Object.keys(result.body), ['ok', 'data', 'error']);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.error, null);
    assert.equal(result.body.data.text, validBody().text);
    assert.match(result.response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.equal(db.records.size, 1);
    assert.equal(logs.length, 1);
    for (const privateValue of [owner, token, apiKey, validBody().text, validBody().entryDate]) {
      assert.equal(JSON.stringify(logs).includes(privateValue), false);
    }
  });
});

test('HTTP重复POST返回409并保留一行，缺字段返回400中文fields且不新增行', async () => {
  await localServer(async (base, db) => {
    assert.equal((await post(base)).response.status, 201);
    const duplicate = await post(base);
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.ok, false);
    assert.equal(duplicate.body.data, null);
    assert.equal(duplicate.body.error.code, 'DUPLICATE_ENTRY');
    const missing = await post(base, { entryDate: '2026-10-14' });
    assert.equal(missing.response.status, 400);
    assert.equal(missing.body.error.code, 'INVALID_INPUT');
    assert.match(missing.body.error.fields.text, /[\u4e00-\u9fff]/);
    assert.equal(db.records.size, 1);
    assert.equal(db.calls.length, 2);
  });
});

test('HTTP拒绝非法JSON及非对象JSON，不执行写库', async () => {
  await localServer(async (base, db) => {
    for (const body of ['{', '', 'null', '[]', '1', '"正文"']) {
      const response = await fetch(base + '/api/entries', { method: 'POST', headers, body });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_INPUT');
    }
    assert.equal(db.calls.length, 0);
  });
});

test('HTTP拒绝非JSON媒体类型及未登记压缩编码，charset=utf-8正常接受', async () => {
  await localServer(async (base, db) => {
    for (const extraHeaders of [
      { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json; charset=gbk' },
      { 'Content-Type': '' }, { 'Content-Encoding': 'gzip' },
    ]) {
      const result = await post(base, validBody(), '/api/entries', extraHeaders);
      assert.equal(result.response.status, 415);
      assert.equal(result.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    }
    assert.equal(db.calls.length, 0);
    const accepted = await post(base, validBody(), '/api/entries',
      { 'Content-Type': 'application/json; charset=utf-8' });
    assert.equal(accepted.response.status, 201);
  });
});

test('HTTP请求体64KiB边界按字节处理，恰好上限接受，超一字节拒绝', async () => {
  await localServer(async (base, db) => {
    const json = JSON.stringify(validBody('【虚构】请求体边界验证。'));
    const padded = json + ' '.repeat(64 * 1024 - Buffer.byteLength(json, 'utf8'));
    assert.equal(Buffer.byteLength(padded, 'utf8'), 64 * 1024);
    const accepted = await fetch(base + '/api/entries', { method: 'POST', headers, body: padded });
    assert.equal(accepted.status, 201);
    await accepted.json();
    const rejected = await fetch(base + '/api/entries', { method: 'POST', headers, body: padded + ' ' });
    assert.equal(rejected.status, 413);
    assert.equal((await rejected.json()).error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(db.records.size, 1);
    assert.equal(db.calls.length, 1);
  });
});

test('HTTP客户端时区传给写入校验，无效时区及纽约尚未到次日均在写库前拒绝', async () => {
  await localServer(async (base, db) => {
    const invalid = await post(base, validBody(), '/api/entries',
      { 'X-Client-Time-Zone': 'day18-fictional-invalid-zone' });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.body.error.fields['X-Client-Time-Zone'], /[\u4e00-\u9fff]/);
    const future = await post(base, validBody(), '/api/entries',
      { 'X-Client-Time-Zone': 'America/New_York' });
    assert.equal(future.response.status, 400);
    assert.ok(future.body.error.fields.entryDate);
    assert.equal(db.calls.length, 0);
  });
});

test('HTTP未登记query及PATCH、DELETE、其他资源POST拒绝，不执行读写', async () => {
  await localServer(async (base, db) => {
    for (const query of ['?ownerId=other', '?limit=1', '?entryDate=2026-10-14']) {
      const result = await post(base, validBody(), '/api/entries' + query);
      assert.equal(result.response.status, 400);
    }
    for (const method of ['PATCH', 'DELETE']) {
      const response = await fetch(base + '/api/entries', { method, headers });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, POST');
      await response.json();
    }
    const favorites = await post(base, validBody(), '/api/favorites');
    assert.equal(favorites.response.status, 405);
    assert.equal(favorites.response.headers.get('allow'), 'GET');
    assert.equal(db.calls.length, 0);
  });
});

test('HTTP没有有效身份时返回401，伪造用户头不能写入', async () => {
  await localServer(async (base, db) => {
    const response = await fetch(base + '/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': owner, 'X-Cloudbase-Uid': owner },
      body: JSON.stringify(validBody()),
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.deepEqual(Object.keys(body), ['ok', 'data', 'error']);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(db.calls.length, 0);
  });
});

test('模拟HTTP贯通POST后GET entries读回，GET favorites保持原收藏而不擅自新增关联', async () => {
  await localServer(async (base) => {
    const created = await post(base);
    assert.equal(created.response.status, 201);
    const entryResponse = await fetch(base + '/api/entries', { headers });
    assert.equal(entryResponse.status, 200);
    const entries = await entryResponse.json();
    assert.equal(entries.data.total, 1);
    assert.deepEqual(entries.data.items[0], created.body.data);
    const favoriteResponse = await fetch(base + '/api/favorites', { headers });
    assert.equal(favoriteResponse.status, 200);
    const favorites = await favoriteResponse.json();
    assert.deepEqual(favorites.data.items, [{ targetType: 'book', targetId: 'walden', favoritedAt: stamp }]);
    assert.equal(favorites.data.items.some((item) => item.targetId === created.body.data.id), false);
  });
});

test('HTTP写入失败返回WRITE_FAILED，错误响应与日志不含内部错误、原文或凭证', async () => {
  const internal = 'day18-fictional-private-database-message';
  await localServer(async (base, db, logs) => {
    const result = await post(base);
    assert.equal(result.response.status, 500);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.data, null);
    assert.equal(result.body.error.code, 'WRITE_FAILED');
    assert.equal(logs.length, 1);
    for (const value of [internal, validBody().text, owner, token, apiKey]) {
      assert.equal(JSON.stringify(result.body).includes(value), false);
      assert.equal(JSON.stringify(logs).includes(value), false);
    }
  }, { write: async () => { throw new Error(internal); } });
});

test('HTTPS只有固定INSERT用写角色，既有SELECT继续只读，SQL参数和后台凭证分开传递', async () => {
  const calls = [];
  const query = createCloudBaseQuery('day18-fictional-env', apiKey, async (url, options) => {
    assert.equal(url, 'https://day18-fictional-env.api.tcloudbasegateway.com/v1/rdb/exec-pgsql');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    const body = JSON.parse(options.body);
    calls.push(body);
    return upstream(200, body.sql === INSERT_ENTRY_SQL ? [row()] : [{ total: '0', rows: [] }]);
  });
  const text = "【虚构】'); DROP TABLE entries; --";
  await query(INSERT_ENTRY_SQL, ['day18-fictional-id', owner, '2026-10-14', text]);
  await query(ENTRIES_SQL, [owner, null, null, null, 21]);
  assert.equal(calls[0].role, 'cloudbase_postgres');
  assert.equal(calls[1].role, 'cloudbase_read_only_user');
  assert.equal(calls[0].sql.includes(text), false);
  assert.equal(calls[0].parameters[3], text);
  assert.equal(calls[0].sql.includes(apiKey), false);
});

test('HTTPS写库权限与供应商失败安全映射WRITE_FAILED，不改角色、不自动重试', async () => {
  for (const status of [400, 401, 403, 429, 503]) {
    let count = 0;
    const query = createCloudBaseQuery('day18-fictional-env', apiKey, async (url, options) => {
      count += 1;
      assert.equal(JSON.parse(options.body).role, 'cloudbase_postgres');
      return upstream(status, { code: 'DATABASE_42501', message: apiKey,
        details: INSERT_ENTRY_SQL + owner + validBody().text });
    });
    await assert.rejects(query(INSERT_ENTRY_SQL, ['day18-fictional-id', owner, '2026-10-14', validBody().text]),
      (error) => {
        assert.equal(error.status, 500);
        assert.equal(error.code, 'WRITE_FAILED');
        assert.equal(error.retryable, status === 429 || status >= 500);
        for (const value of [apiKey, INSERT_ENTRY_SQL, owner, validBody().text]) {
          assert.equal(error.message.includes(value), false);
        }
        return true;
      });
    assert.equal(count, 1);
  }
});

test('HTTPS写库网络、非JSON及非数组返回均失败，不转换成成功或重复', async () => {
  const adapters = [
    async () => { throw new Error(apiKey); },
    async () => ({ status: 200, ok: true, json: async () => { throw new Error(apiKey); } }),
    async () => upstream(200, { rows: [] }),
    async () => upstream(200, [null]),
  ];
  for (const adapter of adapters) {
    const query = createCloudBaseQuery('day18-fictional-env', apiKey, adapter);
    await assert.rejects(query(INSERT_ENTRY_SQL, ['day18-fictional-id', owner, '2026-10-14', validBody().text]),
      (error) => error.status === 500 && error.code === 'WRITE_FAILED' && !error.message.includes(apiKey));
  }
});

test('HTTPS写层仍拒绝未登记SQL及复杂参数，不形成任意SQL或角色代理', async () => {
  let count = 0;
  const query = createCloudBaseQuery('day18-fictional-env', apiKey, async () => {
    count += 1;
    return upstream(200, []);
  });
  for (const [sql, values] of [
    ['INSERT INTO public.entries DEFAULT VALUES', []],
    ['DELETE FROM public.entries', []],
    [INSERT_ENTRY_SQL, ['day18-fictional-id', { ownerId: owner }]],
  ]) {
    await assert.rejects(query(sql, values), (error) => error.status === 500);
  }
  assert.equal(count, 0);
});

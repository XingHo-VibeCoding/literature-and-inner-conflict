import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicApiClient } from './publicApi.js';

const ORIGIN = 'https://fictional-day20-api.example';
const TOKEN = 'fictional-day20-user-token';
const REQUEST_ID = '12345678-1234-1234-1234-123456789abc';
const ENTRY = {
  id: 'fictional-day20-entry',
  entryDate: '2026-10-14',
  text: '  【虚构·Day20前端验证】我记下一个问题。\n原文保留。  ',
  textVersion: 1,
  revision: 1,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  adoptedAnalysis: null,
  origin: null,
};
const list = (items = [ENTRY], page = {}) => ({
  items, total: items.length, page: { limit: 20, nextCursor: null, hasMore: false, ...page },
});
const success = data => ({ ok: true, data, error: null });
const failure = (code, message, fields) => ({
  ok: false, data: null, error: { code, message, retryable: false, ...(fields ? { fields } : {}) },
});
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST_ID },
});
function setup(body, status = 200, options = {}) {
  const calls = [];
  const client = createPublicApiClient({
    apiOrigin: ORIGIN,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response(body, status); },
    ...options,
  });
  return { client, calls };
}

test('公网配置仅接受 HTTPS 纯域名，拒绝路径、秘密、查询和片段', () => {
  for (const apiOrigin of [
    'http://fictional-day20-api.example', '/api', ORIGIN + '/api', 'https://*.example.com', 'https://api*.example.com',
    'https://user:password@fictional-day20-api.example', ORIGIN + '?key=secret',
    ORIGIN + '#secret', ORIGIN + '?', ORIGIN + '#', ' ' + ORIGIN,
  ]) {
    assert.throws(() => createPublicApiClient({ apiOrigin }), error => error.code === 'INVALID_CONFIGURATION');
  }
  assert.equal(createPublicApiClient({ apiOrigin: ORIGIN + '/' }).apiOrigin, ORIGIN);
  assert.throws(() => createPublicApiClient({ apiOrigin: ORIGIN, requestOrigin: 'https://*.example.com' }),
    error => error.code === 'INVALID_CONFIGURATION');
});

test('健康接口核对精确形状，并返回实际地址和 HTTP 状态', async () => {
  const health = { ok: true, service: '【literature-and-inner-conflict】' };
  const { client, calls } = setup(health);
  assert.deepEqual(await client.getHealth(), { data: health, httpStatus: 200, requestId: REQUEST_ID, url: ORIGIN + '/api/health' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.redirect, 'error');
});

test('健康服务名或额外字段变化均不误报健康成功', async () => {
  for (const health of [
    { ok: true, service: '其他服务' },
    { ok: true, service: '【literature-and-inner-conflict】', data: [] },
  ]) {
    const { client } = setup(health);
    await assert.rejects(client.getHealth(), error => error.code === 'INVALID_RESPONSE' && error.httpStatus === 200);
  }
});

test('日精进读取保留原文、日期和九字段，只把凭证放 Authorization', async () => {
  const data = list();
  const { client, calls } = setup(success(data));
  const result = await client.getEntries({ token: TOKEN });
  assert.deepEqual(result.data, data);
  assert.equal(result.data.items[0].text, ENTRY.text);
  assert.equal(result.data.items[0].entryDate, ENTRY.entryDate);
  assert.equal(result.url, ORIGIN + '/api/entries?limit=20');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].url.includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('分页游标安全编码，开发代理仍返回实际 fetch 路径', async () => {
  const cursor = 'fictional+/cursor=中文';
  const data = { ...list(), total: 3, page: { limit: 1, nextCursor: 'next-page', hasMore: true } };
  const { client, calls } = setup(success(data), 200, { requestOrigin: '' });
  const result = await client.getEntries({ token: TOKEN, limit: 1, cursor });
  assert.equal(result.url, calls[0].url);
  assert.equal(result.url.startsWith('/api/entries?'), true);
  const query = new URL(result.url, 'https://fictional-local.example').searchParams;
  assert.equal(query.get('cursor'), cursor);
  assert.equal(query.get('limit'), '1');
  assert.deepEqual(result.data, data);
});

test('合法空列表才返回空数据', async () => {
  const data = list([]);
  const { client } = setup(success(data));
  assert.deepEqual((await client.getEntries({ token: TOKEN })).data, data);
});

test('异常列表、无效日期和封套不伪装成空数据', async () => {
  for (const payload of [
    success({ ...list([]), page: { limit: 20, nextCursor: '不该有游标', hasMore: false } }),
    success(list([{ ...ENTRY, entryDate: '2026-02-30' }])),
    success({ ...list(), total: 0 }),
    { ok: true, data: list(), error: null, mock: true },
    { ok: false, data: [], error: null },
  ]) {
    const { client } = setup(payload);
    await assert.rejects(client.getEntries({ token: TOKEN }), error => error.code === 'INVALID_RESPONSE');
  }
});

test('新增必须 HTTP201，发送契约字段并原样保留空格换行', async () => {
  const input = { entryDate: ENTRY.entryDate, text: ENTRY.text, ownerId: '不应传输', id: '不应传输' };
  const { client, calls } = setup(success(ENTRY), 201);
  const result = await client.createEntry({ token: TOKEN, input });
  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.data, ENTRY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ORIGIN + '/api/entries');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { entryDate: ENTRY.entryDate, text: ENTRY.text });
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['X-Client-Time-Zone'], 'Asia/Shanghai');
  assert.equal(calls[0].init.body.includes(TOKEN), false);
  const unexpected = setup(success(ENTRY), 200).client;
  await assert.rejects(unexpected.createEntry({ token: TOKEN, input }), error => error.code === 'INVALID_RESPONSE');
});

test('无效凭证、日期及分页参数在发送请求前停止', async () => {
  const { client, calls } = setup(success(list()));
  for (const token of [undefined, '', 'fictional\ninvalid', 'fictional\u0000invalid', 'fictional\u007finvalid']) {
    await assert.rejects(client.getEntries({ token }), error => error.code === 'UNAUTHENTICATED');
  }
  await assert.rejects(client.getEntries({ token: TOKEN, limit: 0 }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(client.getEntries({ token: TOKEN, cursor: '' }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(client.createEntry({ token: TOKEN, input: { entryDate: '2026-02-30', text: ' ' } }),
    error => error.code === 'INVALID_INPUT' && Boolean(error.fields.entryDate) && Boolean(error.fields.text));
  assert.equal(calls.length, 0);
});

test('HTTP401 保留身份错误与中文说明，不返回任何假记录', async () => {
  const message = '登录凭证无效或已过期，请重新登录。';
  const { client, calls } = setup(failure('UNAUTHENTICATED', message), 401);
  await assert.rejects(client.getEntries({ token: TOKEN }), error =>
    error.code === 'UNAUTHENTICATED' && error.httpStatus === 401 && error.message === message && error.requestId === REQUEST_ID);
  assert.equal(calls.length, 1);
});

test('重复写入 HTTP409 保留错误，不自动重试或新增', async () => {
  const message = '这一天已经保存过完全相同的原文，请勿重复提交。';
  const { client, calls } = setup(failure('DUPLICATE_ENTRY', message), 409);
  await assert.rejects(client.createEntry({ token: TOKEN, input: ENTRY }), error =>
    error.code === 'DUPLICATE_ENTRY' && error.httpStatus === 409 && error.message === message);
  assert.equal(calls.length, 1);
});

test('服务端字段错误通过 fields 传给页面', async () => {
  const fields = { text: '请填写原文。' };
  const { client } = setup(failure('INVALID_INPUT', '请检查必填字段和输入内容。', fields), 400);
  await assert.rejects(client.createEntry({ token: TOKEN, input: ENTRY }), error =>
    error.code === 'INVALID_INPUT' && error.httpStatus === 400 && error.fields.text === fields.text);
});

test('Day23 服务故障统一中文，JSON、HTML 与正文读取失败均保留 HTTP 和关联 ID', async () => {
  const detail = '【虚构内部详情】Error: database connection failed at private-path';
  for (const [status, code] of [[500, 'INTERNAL_ERROR'], [503, 'WRITE_FAILED'], [502, detail]]) {
    const { client, calls } = setup(failure(code, detail, { text: detail }), status);
    await assert.rejects(client.getEntries({ token: TOKEN }), error => {
      assert.equal(error.message, '服务暂时不可用，请稍后重试。');
      assert.equal(error.code, status === 502 ? 'SERVER_ERROR' : code);
      assert.equal(error.httpStatus, status);
      assert.equal(error.requestId, REQUEST_ID);
      assert.equal(error.fields, undefined);
      assert.ok(!JSON.stringify({ message: error.message, ...error }).includes(detail));
      return true;
    });
    assert.equal(calls.length, 1, '服务故障不会自动重试');
  }
  for (const fetchImpl of [
    async () => new Response('<html>' + detail + '</html>', { status: 503, headers: { 'X-Request-Id': REQUEST_ID } }),
    async () => ({ status: 502, headers: new Headers({ 'X-Request-Id': REQUEST_ID }), json: async () => { throw new Error(detail); } }),
  ]) {
    const client = createPublicApiClient({ apiOrigin: ORIGIN, fetchImpl });
    await assert.rejects(client.getHealth(), error => error.code === 'SERVER_ERROR'
      && error.httpStatus >= 500 && error.requestId === REQUEST_ID && error.message === '服务暂时不可用，请稍后重试。');
  }
});

test('Day23 客户端错误不透传上游消息、未知代码或字段，已登记字段保留安全中文', async () => {
  const detail = '【虚构内部详情】SQL failed: private-path';
  const fields = { text: detail, entryDate: '请选择记录日期。', expectedRevision: detail,
    'X-Client-Time-Zone': detail, [detail]: detail };
  const { client } = setup(failure('INVALID_INPUT', detail, fields), 400);
  await assert.rejects(client.createEntry({ token: TOKEN, input: ENTRY }), error => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.equal(error.httpStatus, 400);
    assert.equal(error.requestId, REQUEST_ID);
    assert.equal(error.message, '请检查必填字段和输入内容。');
    assert.deepEqual(error.fields, {
      entryDate: '请选择记录日期。',
      text: '请填写 1 至 5000 个有效字符的原文，并检查是否含有无法保存的字符。',
      expectedRevision: '记录版本无效，请重新读取后再操作。',
      'X-Client-Time-Zone': '记录时区无效，请刷新页面后重试。',
    });
    assert.ok(!JSON.stringify({ message: error.message, ...error }).includes(detail));
    return true;
  });
  for (const [status, code, expectedCode, message] of [
    [401, 'UNAUTHENTICATED', 'UNAUTHENTICATED', '登录凭证无效或已过期，请重新登录。'],
    [404, 'ENTRY_NOT_FOUND', 'ENTRY_NOT_FOUND', '记录不存在或不属于当前用户。'],
    [409, 'VERSION_CONFLICT', 'VERSION_CONFLICT', '记录已发生变化，请先重新读取，再核对修改或删除。'],
    [418, detail, 'REQUEST_FAILED', '请求未能完成，请核对输入和登录状态后重试。'],
    [400, 'UNAUTHENTICATED', 'REQUEST_FAILED', '请检查必填字段和输入内容。'],
  ]) {
    const rejected = setup(failure(code, detail, fields), status).client;
    await assert.rejects(rejected.getEntries({ token: TOKEN }), error => error.code === expectedCode
      && error.httpStatus === status && error.message === message && error.fields === undefined);
  }
});

test('非 JSON 返回明确格式错误，网络错误不会泄露底层详情', async () => {
  const htmlClient = createPublicApiClient({ apiOrigin: ORIGIN, fetchImpl: async () => new Response('<html>中间页</html>') });
  await assert.rejects(htmlClient.getHealth(), error => error.code === 'INVALID_RESPONSE');
  let count = 0;
  const networkClient = createPublicApiClient({
    apiOrigin: ORIGIN, fetchImpl: async () => { count += 1; throw new Error('底层包含 ' + TOKEN); },
  });
  await assert.rejects(networkClient.getEntries({ token: TOKEN }), error =>
    error.code === 'NETWORK_ERROR' && /跨域/.test(error.message) && !error.message.includes(TOKEN));
  assert.equal(count, 1);
});

test('外部取消和已经取消的请求均停止，不报告网络错误', async () => {
  let count = 0;
  const client = createPublicApiClient({
    apiOrigin: ORIGIN,
    fetchImpl: (url, { signal }) => {
      count += 1;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () =>
        reject(new DOMException('已取消', 'AbortError')), { once: true }));
    },
  });
  const controller = new AbortController();
  const pending = client.getEntries({ token: TOKEN, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED');
  await assert.rejects(client.getEntries({ token: TOKEN, signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(count, 1);
});

test('30秒超时取消真实等待，不循环请求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const client = createPublicApiClient({
    apiOrigin: ORIGIN,
    fetchImpl: (url, { signal }) => {
      count += 1;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () =>
        reject(new DOMException('超时取消', 'AbortError')), { once: true }));
    },
  });
  const pending = client.getHealth();
  t.mock.timers.tick(30000);
  await assert.rejects(pending, error => error.code === 'TIMEOUT' && /30 秒/.test(error.message));
  assert.equal(count, 1);
});

test('服务不接触浏览器持久存储，也不打印用户凭证', async t => {
  const descriptors = new Map();
  let storageAccesses = 0;
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { storageAccesses += 1; throw new Error('禁止使用存储'); } });
  }
  const output = [];
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => output.push(args));
  try {
    const { client } = setup(success(list()));
    await client.getEntries({ token: TOKEN });
    assert.equal(storageAccesses, 0);
    assert.deepEqual(output, []);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('PATCH 发送预期版本和部分字段，保留原文且编码目标 ID', async () => {
  const entryId = '虚构/Day22?目标';
  const input = { text: '  【虚构·Day22修改】保留空格。\n下一行。  ', expectedRevision: 2 };
  const saved = { ...ENTRY, id: entryId, text: input.text, revision: 3, textVersion: 3 };
  const { client, calls } = setup(success(saved));
  assert.deepEqual((await client.updateEntry({ token: TOKEN, entryId, input })).data, saved);
  assert.equal(calls[0].url, ORIGIN + '/api/entries/' + encodeURIComponent(entryId));
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
  assert.equal(calls[0].init.headers['X-Client-Time-Zone'], 'Asia/Shanghai');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0].init.body.includes(TOKEN), false);
});

test('DELETE 的预期版本仅在 query，严格无 body 并核对删除目标', async () => {
  const { client, calls } = setup(success({ deleted: true, entryId: ENTRY.id }));
  const result = await client.deleteEntry({ token: TOKEN, entryId: ENTRY.id, expectedRevision: 2 });
  assert.equal(result.httpStatus, 200);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].url, ORIGIN + '/api/entries/' + ENTRY.id + '?expectedRevision=2');
  assert.equal(Object.hasOwn(calls[0].init, 'body'), false);
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
  for (const data of [{ deleted: false, entryId: ENTRY.id }, { deleted: true, entryId: '另一条' }, { deleted: true, entryId: ENTRY.id, extra: true }]) {
    await assert.rejects(setup(success(data)).client.deleteEntry({ token: TOKEN, entryId: ENTRY.id, expectedRevision: 2 }), error => error.code === 'INVALID_RESPONSE');
  }
});

test('PATCH/DELETE 无效 ID、版本、未登记字段和空修改均不发请求', async () => {
  const { client, calls } = setup(success(ENTRY));
  for (const input of [{ expectedRevision: 2 }, { text: '正文', expectedRevision: 0 }, { text: null, expectedRevision: 2 }, { entryDate: '2026-02-30', expectedRevision: 2 }, { text: '正文', expectedRevision: 2, ownerId: '不允许' }]) {
    await assert.rejects(client.updateEntry({ token: TOKEN, entryId: ENTRY.id, input }), error => error.code === 'INVALID_INPUT');
  }
  for (const entryId of ['', undefined, '含\n换行', '\ud800', '\udfff']) {
    await assert.rejects(client.deleteEntry({ token: TOKEN, entryId, expectedRevision: 2 }), error => error.code === 'INVALID_INPUT');
    await assert.rejects(client.updateEntry({ token: TOKEN, entryId, input: { text: ENTRY.text, expectedRevision: 2 } }),
      error => error.code === 'INVALID_INPUT' && error.message === '记录 ID 无效，请重新读取记录。');
  }
  await assert.rejects(client.deleteEntry({ token: TOKEN, entryId: ENTRY.id, expectedRevision: '2' }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('PATCH/DELETE 的不存在及版本冲突统一中文错误，不自动重试', async () => {
  for (const [status, code, message] of [[404, 'ENTRY_NOT_FOUND', '记录不存在或不属于当前用户。'], [409, 'VERSION_CONFLICT', '记录已发生变化，请先重新读取，再核对修改或删除。']]) {
    const { client, calls } = setup(failure(code, message), status);
    await assert.rejects(client.updateEntry({ token: TOKEN, entryId: ENTRY.id, input: { text: '【虚构】修改', expectedRevision: 2 } }), error => error.httpStatus === status && error.message === message);
    await assert.rejects(client.deleteEntry({ token: TOKEN, entryId: ENTRY.id, expectedRevision: 2 }), error => error.httpStatus === status && error.message === message);
    assert.equal(calls.length, 2);
  }
});

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
  for (const token of [undefined, '', 'fictional\ninvalid']) {
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
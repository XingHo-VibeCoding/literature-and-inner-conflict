// Day 18：固定虚构请求，凭证仅从当前进程环境读取，不写文件、不输出。
import assert from 'node:assert/strict';
const origin = 'https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com';
const fixture = { entryDate: '2026-10-14', text: '【虚构·Day18接口验证】正常写入并读回。' };
const mode = process.argv[2];
const modes = new Set(['normal', 'duplicate', 'missing', 'read', 'favorites']);
if (!modes.has(mode)) { console.error('请选择 normal、duplicate、missing、read 或 favorites。'); process.exit(1); }
const token = process.env.DAY18_ACCESS_TOKEN;
if (!token || /\s/.test(token)) { console.error('请先在本机安全准备 DAY18_ACCESS_TOKEN；不要把凭证发到聊天。'); process.exit(1); }
try {
  const writing = ['normal', 'duplicate', 'missing'].includes(mode);
  const endpoint = writing ? '/api/entries' : mode === 'read' ? '/api/entries?limit=100' : '/api/favorites';
  const response = await fetch(origin + endpoint, {
    method: writing ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
      ...(writing ? { 'Content-Type': 'application/json', 'X-Client-Time-Zone': 'Asia/Shanghai' } : {}) },
    ...(writing ? { body: JSON.stringify(mode === 'missing' ? { entryDate: fixture.entryDate } : fixture) } : {}),
  });
  const body = await response.json();
  console.log(mode + '：HTTP ' + response.status);
  console.log('X-Request-Id：' + (response.headers.get('x-request-id') || '响应头未公开'));
  console.log(JSON.stringify(body, null, 2));
  assert.deepEqual(Object.keys(body).sort(), ['data', 'error', 'ok']);
  const expected = { normal: 201, duplicate: 409, missing: 400, read: 200, favorites: 200 }[mode];
  assert.equal(response.status, expected, '实际 HTTP 状态与本项预期不同。');
  if (mode === 'duplicate' || mode === 'missing') {
    assert.equal(body.ok, false); assert.equal(body.data, null);
    assert.equal(body.error.code, mode === 'duplicate' ? 'DUPLICATE_ENTRY' : 'INVALID_INPUT');
    assert.match(body.error.message, /[\u3400-\u9fff]/);
    if (mode === 'missing') assert.match(body.error.fields?.text || '', /原文/);
  } else {
    assert.equal(body.ok, true); assert.equal(body.error, null);
    if (mode === 'normal') {
      assert.equal(typeof body.data.id, 'string'); assert.ok(body.data.id.trim());
      for (const key of ['createdAt', 'updatedAt']) {
        assert.equal(typeof body.data[key], 'string');
        assert.match(body.data[key], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.equal(new Date(body.data[key]).toISOString(), body.data[key]);
      }
      assert.equal(body.data.text, fixture.text); assert.equal(body.data.entryDate, fixture.entryDate);
      assert.equal(body.data.textVersion, 1); assert.equal(body.data.revision, 1);
      assert.equal(body.data.origin, null); assert.equal(body.data.adoptedAnalysis, null);
      assert.deepEqual(Object.keys(body.data).sort(), ['id','entryDate','text','textVersion','revision','createdAt','updatedAt','origin','adoptedAnalysis'].sort());
    } else {
      assert.ok(Array.isArray(body.data.items));
      if (mode === 'read') {
        const found = body.data.items.filter(item => item.entryDate === fixture.entryDate && item.text === fixture.text);
        assert.equal(found.length, 1, '本页应读回恰好一条指定虚构记录；超出第一页时需另行核对分页。');
        console.log('读回匹配 ID：' + found[0].id);
      }
    }
  }
  console.log('本项响应检查通过；数据库行数仍需用 SELECT 独立核对。');
} catch { console.error('本项验证未通过，请核对上面的实际响应或网络、凭证、部署状态；不要自动重试正常写入。'); process.exitCode = 1; }

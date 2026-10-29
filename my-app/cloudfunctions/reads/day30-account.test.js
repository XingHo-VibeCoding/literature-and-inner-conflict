const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('./service');
const { createWriter } = require('./writer');
const { DEMO_ENTRY_TEXT } = require('./accountWriter');
const { createServer } = require('./index');
const { createCloudBaseQuery } = require('./db');
const { INSERT_NOTE_SQL, DELETE_NOTE_SQL, SET_NOTE_SUMMARY_SQL, SET_FAVORITE_SQL, ADOPT_DEMO_ANALYSIS_SQL } = require('./accountWritesRepository');

// 只使用虚构身份、内容与模拟数据库；这些测试不证明真库事务或并发行为。
const OWNER = 'day30-fictional-owner-A';
const OTHER = 'day30-fictional-owner-B';
const TOKEN = 'day30-fictional-token';
const STAMP = '2026-10-26T01:02:03.000Z';
const books = new Map([['walden', { title: '瓦尔登湖' }]]);
const noteRow = (overrides = {}) => ({ id: 'fictional-note', book_id: 'walden', body: '  【虚构】读后一页。\n仍保留空格。  ',
  revision: 2, created_at: STAMP, updated_at: STAMP, saved_at: '2026-10-25T16:05:00.000Z', save_order: 3,
  summary_entry_id: null, summary_active: null, summary_linked_at: null,
  summary_entry_revision_at_link: null, summary_preserve_on_cancel: null, ...overrides });
const entryRow = (overrides = {}) => ({ id: 'fictional-entry', entry_date_text: '2026-10-26', text: '【虚构】独立总结原文',
  revision: 3, text_version: 2, created_at: STAMP, updated_at: STAMP, adopted_analysis: null,
  origin: { type: 'reading-note', noteId: 'fictional-note', bookId: 'walden', bookTitle: '瓦尔登湖', noteSavedAt: '2026-10-25T16:05:00.000Z' }, ...overrides });
function fixture(row) {
  const calls = [];
  const write = createWriter({ books, now: () => new Date(STAMP), query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [typeof row === 'function' ? row(sql, values) : row] };
  } });
  return { calls, write };
}
const request = (kind, body, extra = {}) => ({ ownerId: OWNER, kind, operation: 'PATCH', body, ...extra });

// 检查校验发生在任何写库前，不能通过请求字段指定归属、来源或服务端版本。
test('Day30 各类账户写入拒绝伪造归属与来源、损坏字符、无效版本和不存在作品', async () => {
  const f = fixture(noteRow());
  const cases = [
    request('notes', { body: '【虚构】', ownerId: OTHER }, { operation: 'POST', bookId: 'walden' }),
    request('notes', { body: '【虚构】\u0000' }, { operation: 'POST', bookId: 'walden' }),
    request('notes', { body: '【虚构】\ud800' }, { operation: 'POST', bookId: 'walden' }),
    request('notes', { body: ' '.repeat(6) }, { operation: 'POST', bookId: 'walden' }),
    request('notes', { body: '书'.repeat(1001) }, { operation: 'POST', bookId: 'walden' }),
    request('notes', { body: '【虚构】' }, { operation: 'POST', bookId: '不存在作品' }),
    request('noteSummary', { enabled: true, expectedRevision: 0 }, { noteId: 'fictional-note' }),
    request('noteSummary', { enabled: 'true', expectedRevision: 1 }, { noteId: 'fictional-note' }),
    request('favorites', { targetType: 'user', targetId: 'fictional-entry', favorite: true }),
    request('favorites', { targetType: 'entry', targetId: 'fictional-entry', favorite: true, ownerId: OTHER }),
    request('favorites', { targetType: 'book', targetId: '不存在作品', favorite: false }),
    request('entryAnalysis', { expectedRevision: 1, sourceTextVersion: 1, summary: '【虚构】', questions: ['问题'], source: 'ai' }, { entryId: 'fictional-entry' }),
    request('entryAnalysis', { expectedRevision: 1, sourceTextVersion: 1, summary: '【虚构】', questions: ['问题'.repeat(101)] }, { entryId: 'fictional-entry' }),
    request('note', undefined, { operation: 'DELETE', noteId: 'fictional-note', expectedRevision: 0 }),
  ];
  for (const input of cases) await assert.rejects(f.write(input), error => error instanceof ApiError && [400, 404].includes(error.status));
  assert.equal(f.calls.length, 0);
});

test('Day30 新增感悟逐字传递原文，只由可信身份和服务端随机ID建立归属', async () => {
  const f = fixture(noteRow());
  const body = noteRow().body;
  const saved = await f.write(request('notes', { body }, { operation: 'POST', bookId: 'walden' }));
  assert.equal(saved.body, body);
  assert.equal(saved.savedAt, '2026-10-25T16:05:00.000Z');
  assert.equal(saved.summaryLink, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].sql, INSERT_NOTE_SQL);
  assert.match(f.calls[0].values[0], /^note-[0-9a-f-]+$/);
  assert.deepEqual(f.calls[0].values.slice(1), [OWNER, 'walden', body]);
  assert.equal(INSERT_NOTE_SQL.includes(body), false);
});

test('Day30 关联写入保留数据库返回的独立副本、原文日期与来源，不改写感悟历史时间', async () => {
  const linked = noteRow({ revision: 3, summary_entry_id: 'fictional-entry', summary_active: false,
    summary_linked_at: STAMP, summary_entry_revision_at_link: 1, summary_preserve_on_cancel: true });
  const edited = entryRow({ text: '  【虚构】我后来修改的副本。\n  ', entry_date_text: '2026-10-20' });
  const f = fixture({ outcome: 'preserved-edited', note_record: linked, entry_record: edited });
  const result = await f.write(request('noteSummary', { enabled: false, expectedRevision: 2 }, { noteId: linked.id }));
  assert.equal(result.outcome, 'preserved-edited');
  assert.equal(result.note.body, linked.body);
  assert.equal(result.note.savedAt, linked.saved_at);
  assert.equal(result.note.updatedAt, linked.updated_at);
  assert.equal(result.note.summaryLink.preserveOnCancel, true);
  assert.equal(result.entry.text, edited.text);
  assert.equal(result.entry.entryDate, edited.entry_date_text);
  assert.deepEqual(result.entry.origin, edited.origin);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].sql, SET_NOTE_SUMMARY_SQL);
  assert.deepEqual(f.calls[0].values.slice(0, 4), [OWNER, linked.id, 2, false]);
  assert.deepEqual(JSON.parse(f.calls[0].values[5]), [{ id: 'walden', title: '瓦尔登湖' }]);
  for (const outcome of ['added', 'reused', 'unchanged', 'removed']) {
    const g = fixture({ outcome, note_record: outcome === 'removed' ? noteRow() : linked,
      entry_record: outcome === 'removed' ? null : edited });
    const response = await g.write(request('noteSummary', { enabled: outcome !== 'removed', expectedRevision: 2 }, { noteId: linked.id }));
    assert.equal(response.outcome, outcome);
    if (outcome === 'removed') assert.equal(response.entry, null);
  }
});

test('Day30 数据库拒绝外人目标、陈旧版本、非最新感悟、错配来源和失效演示上下文时保留明确错误', async () => {
  const cases = [
    ['note', 'not_found', 404, 'NOTE_NOT_FOUND'], ['note', 'not_latest', 409, 'NOTE_NOT_LATEST'],
    ['noteSummary', 'version_conflict', 409, 'VERSION_CONFLICT'], ['noteSummary', 'link_conflict', 409, 'NOTE_LINK_CONFLICT'],
    ['noteSummary', 'duplicate', 409, 'DUPLICATE_ENTRY'], ['entryAnalysis', 'context_mismatch', 409, 'ANALYSIS_CONTEXT_MISMATCH'],
    ['favorites', 'not_found', 404, 'ENTRY_NOT_FOUND'],
  ];
  for (const [kind, outcome, status, code] of cases) {
    const f = fixture({ outcome });
    const body = kind === 'noteSummary' ? { enabled: true, expectedRevision: 2 }
      : kind === 'favorites' ? { targetType: 'entry', targetId: 'fictional-entry', favorite: true }
        : { expectedRevision: 2, sourceTextVersion: 1, summary: '【虚构】演示总结', questions: ['问题？'] };
    await assert.rejects(f.write(request(kind, body, { operation: kind === 'note' ? 'DELETE' : 'PATCH',
      noteId: 'fictional-note', entryId: 'fictional-entry', expectedRevision: 2 })), error => error.status === status && error.code === code);
    assert.equal(f.calls.length, 1, '不通过额外请求模拟事务或自动重试');
  }
});

test('Day30 收藏保留服务端首次时间，取消时才返回null；删除感悟返回最小确认', async () => {
  const f = fixture({ outcome: 'saved', favorited_at: STAMP });
  const saved = await f.write(request('favorites', { targetType: 'entry', targetId: 'fictional-entry', favorite: true }));
  assert.deepEqual(saved, { targetType: 'entry', targetId: 'fictional-entry', favorite: true, favoritedAt: STAMP });
  const removed = await f.write(request('favorites', { targetType: 'book', targetId: 'walden', favorite: false }));
  assert.equal(removed.favoritedAt, null);
  assert.deepEqual(f.calls.map(call => call.sql), [SET_FAVORITE_SQL, SET_FAVORITE_SQL]);
  const g = fixture({ outcome: 'deleted' });
  assert.deepEqual(await g.write(request('note', undefined, { operation: 'DELETE', noteId: 'fictional-note', expectedRevision: 2 })),
    { deleted: true, noteId: 'fictional-note' });
  assert.equal(g.calls[0].sql, DELETE_NOTE_SQL);
});

test('Day30 演示采纳只传编辑后的草稿，服务端另提供固定原文与来源约束', async () => {
  const analysis = { source: 'demo', demoId: 'discussion-v1', sourceTextVersion: 2,
    summary: '  【虚构】演示总结  ', questions: ['我下一步如何试？'], adoptedAt: STAMP };
  const f = fixture({ outcome: 'updated', record: entryRow({ adopted_analysis: analysis }) });
  const result = await f.write(request('entryAnalysis', { expectedRevision: 2, sourceTextVersion: 2,
    summary: analysis.summary, questions: analysis.questions }, { entryId: 'fictional-entry' }));
  assert.deepEqual(result.adoptedAnalysis, analysis);
  assert.equal(f.calls[0].sql, ADOPT_DEMO_ANALYSIS_SQL);
  assert.deepEqual(f.calls[0].values, [OWNER, 'fictional-entry', 2, 2, DEMO_ENTRY_TEXT,
    analysis.summary, JSON.stringify(analysis.questions), STAMP]);
  const frontend = fs.readFileSync(path.join(__dirname, '../../src/services/analysisModel.js'), 'utf8');
  const literal = frontend.match(/DEMO_ENTRY_TEXT = '([^']+)'/)[1].replaceAll('\\n', '\n');
  assert.equal(DEMO_ENTRY_TEXT, literal, '前后端固定虚构原文必须一致，不能把任意原文冒充演示');
});

test('Day30 新路由经可信认证注入owner，拒绝客户端归属和未约定查询，不在日志输出内容', async () => {
  const calls = [];
  const logs = [];
  const server = createServer({ authenticate: async header => {
    if (header !== `Bearer ${TOKEN}`) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录。');
    return OWNER;
  }, read: async () => ({}), write: async input => { calls.push(input); return { fictional: true }; },
  logEvent: event => logs.push(event), logError: event => logs.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [
      ['POST', '/api/books/walden/notes', { body: '【虚构】原文' }, 'notes', 201],
      ['DELETE', '/api/notes/fictional-note?expectedRevision=2', undefined, 'note', 200],
      ['PATCH', '/api/notes/fictional-note/summary', { enabled: true, expectedRevision: 2 }, 'noteSummary', 200],
      ['PATCH', '/api/favorites', { targetType: 'book', targetId: 'walden', favorite: true }, 'favorites', 200],
      ['PATCH', '/api/entries/fictional-entry/analysis', { expectedRevision: 2, sourceTextVersion: 1, summary: '【虚构】', questions: ['问题？'] }, 'entryAnalysis', 200],
    ];
    for (const [method, route, body, kind, status] of cases) {
      const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-User-Id': OTHER },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.status, status);
      assert.equal(calls.at(-1).ownerId, OWNER);
      assert.equal(calls.at(-1).kind, kind);
    }
    const count = calls.length;
    for (const route of ['/api/favorites?ownerId=' + OTHER, '/api/notes/fictional-note/summary?extra=1']) {
      const response = await fetch(base + route, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const unauthorized = await fetch(base + '/api/books/walden/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, count);
    const logText = JSON.stringify(logs);
    for (const sensitive of [OWNER, OTHER, TOKEN, '【虚构】原文', 'fictional-note', 'fictional-entry']) assert.equal(logText.includes(sensitive), false);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});

test('Day30 SQL网关仅放行固定新增语句，选择写角色并转换并发冲突，不泄露供应商正文', async () => {
  const sqls = [INSERT_NOTE_SQL, DELETE_NOTE_SQL, SET_NOTE_SUMMARY_SQL, SET_FAVORITE_SQL, ADOPT_DEMO_ANALYSIS_SQL];
  for (const sql of sqls) {
    const query = createCloudBaseQuery('fictional-env', 'fictional-api-key', async (url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.role, 'cloudbase_postgres');
      assert.equal(payload.sql, sql);
      return { ok: true, json: async () => [{ outcome: 'fictional' }] };
    });
    assert.deepEqual(await query(sql, [OWNER]), { rows: [{ outcome: 'fictional' }] });
    await assert.rejects(query(sql + ' ', [OWNER]), error => error.status === 500);
  }
  for (const [sql, upstream, expected] of [[INSERT_NOTE_SQL, '23505', 'VERSION_CONFLICT'],
    [SET_NOTE_SUMMARY_SQL, 'DATABASE_23505', 'DUPLICATE_ENTRY'], [DELETE_NOTE_SQL, 'DATABASE_40P01', 'VERSION_CONFLICT']]) {
    const query = createCloudBaseQuery('fictional-env', 'fictional-api-key', async () => ({ ok: false, status: 409,
      json: async () => ({ code: upstream, message: '【虚构】供应商私密正文' }) }));
    await assert.rejects(query(sql, [OWNER]), error => error.status === 409 && error.code === expected && !error.message.includes('供应商'));
  }
});

test('Day30 部署源码清单包含账户模块；迁移保留AI与demo不同标记且无业务删除', () => {
  const packaging = fs.readFileSync(path.join(__dirname, 'package.py'), 'utf8');
  for (const file of ['accountWriter.js', 'accountWritesRepository.js']) {
    assert.ok(packaging.includes('"' + file + '"'));
    assert.ok(fs.existsSync(path.join(__dirname, file)));
  }
  const migration = fs.readFileSync(path.join(__dirname, '../../db/day30-account-data.sql'), 'utf8');
  assert.match(migration, /source' = 'ai'/);
  assert.match(migration, /generationRequestId/);
  assert.match(migration, /source' = 'demo'/);
  assert.match(migration, /discussion-v1/);
  assert.match(migration, /VALIDATE CONSTRAINT entries_analysis_check/);
  assert.equal(/\b(?:DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.)/i.test(migration), false);
});

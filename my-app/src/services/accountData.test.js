import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountData } from './accountData.js';

const TOKEN = 'fictional-cloud-account-a';
const OTHER_TOKEN = 'fictional-cloud-account-b';
const DATE = '2026-10-14T01:00:00.000Z';
const ENTRY = { id: 'fictional-cloud-entry', entryDate: '2026-10-14', text: '  【虚构】账户中的日精进。\n原文不裁剪。  ',
  textVersion: 1, revision: 1, createdAt: DATE, updatedAt: DATE, adoptedAnalysis: null, origin: null };
const NOTE = { id: 'fictional-cloud-note', bookId: 'walden', body: '  【虚构】第一次阅读感悟。\n保留原文。  ',
  revision: 1, createdAt: DATE, updatedAt: DATE, savedAt: DATE, saveOrder: 1, summaryLink: null };
const BOOKS = ['walden', 'book-2', 'book-3', 'book-4', 'book-5', 'book-6'];

function page(items, total = items.length, { hasMore = false, nextCursor = null } = {}) {
  return { items, total, page: { limit: 20, hasMore, nextCursor } };
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  let snapshot = { status: 'signedIn', token: TOKEN, version: 1 };
  const subscribers = new Set();
  const calls = [];
  let invalidations = 0;
  const session = {
    getSnapshot: () => snapshot,
    getToken: () => snapshot.status === 'signedIn' ? snapshot.token : '',
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    invalidate() {
      invalidations += 1;
      snapshot = { status: 'signedOut', token: '', version: snapshot.version + 1 };
      for (const listener of subscribers) listener();
    },
  };
  const favorites = [{ targetType: 'book', targetId: NOTE.bookId, favoritedAt: DATE },
    { targetType: 'entry', targetId: ENTRY.id, favoritedAt: DATE }];
  const handlers = {
    getEntries: () => ({ data: page([ENTRY]) }),
    getFavorites: () => ({ data: page(favorites) }),
    getBookNotes: ({ bookId }) => ({ data: { ...page(bookId === NOTE.bookId ? [NOTE] : []),
      bookId, latestNoteId: bookId === NOTE.bookId ? NOTE.id : null } }),
    createEntry: ({ input }) => ({ data: { ...ENTRY, ...input } }),
    updateEntry: ({ entryId, input }) => ({ data: { ...ENTRY, ...input, id: entryId, revision: input.expectedRevision + 1 } }),
    deleteEntry: ({ entryId }) => ({ data: { deleted: true, entryId } }),
    createNote: ({ bookId, body }) => ({ data: { ...NOTE, bookId, body } }),
    deleteNote: ({ noteId }) => ({ data: { deleted: true, noteId } }),
    setNoteInSummary: () => ({ data: { note: NOTE, entry: null, outcome: 'removed' } }),
    setFavorite: ({ targetType, targetId, favorite }) => ({ data: {
      targetType, targetId, favorite, favoritedAt: favorite ? DATE : null,
    } }),
    saveAdoptedDemo: ({ input }) => ({ data: { ...ENTRY, revision: input.expectedRevision + 1,
      adoptedAnalysis: { ...input, source: 'demo', demoId: 'discussion-v1', adoptedAt: DATE } } }),
    ...overrides,
  };
  const apiClient = Object.fromEntries(Object.entries(handlers).map(([method, handler]) => [method, input => {
    calls.push({ method, input });
    return Promise.resolve(handler(input));
  }]));
  const data = createAccountData({ apiClient, session, bookIds: BOOKS });
  return { data, calls, session, subscribers, get invalidations() { return invalidations; },
    change(token = OTHER_TOKEN, status = 'signedIn') {
      snapshot = { status, token, version: snapshot.version + 1 };
      for (const listener of subscribers) listener();
    },
  };
}

test('云端日精进全部分页后排序，按ID读回保留原文日期，找不到返回undefined', async () => {
  const second = { ...ENTRY, id: 'fictional-newer-entry', entryDate: '2026-10-15' };
  const f = fixture({ getEntries: ({ cursor }) => ({ data: cursor ? page([second], 2)
    : page([ENTRY], 2, { hasMore: true, nextCursor: 'fictional-next' }) }) });
  assert.deepEqual(await f.data.readEntries(), [second, ENTRY]);
  assert.deepEqual(await f.data.readEntry(ENTRY.id), ENTRY);
  assert.equal(await f.data.readEntry('fictional-missing'), undefined);
  assert.equal(f.calls.filter(call => call.method === 'getEntries').length, 6);
  assert.ok(f.calls.every(call => call.input.token === TOKEN && call.input.signal instanceof AbortSignal));
  f.data.dispose();
});

test('完整分页拒绝重复ID、重复游标、总数变化与末页缺项，不把失败当空记录', async () => {
  for (const mode of ['duplicate-id', 'duplicate-cursor', 'changed-total', 'missing-final']) {
    let reads = 0;
    const f = fixture({ getEntries: () => {
      reads += 1;
      if (mode === 'missing-final') return { data: page([ENTRY], 2) };
      if (reads === 1) return { data: page([ENTRY], 3, { hasMore: true, nextCursor: 'fictional-next' }) };
      const item = { ...ENTRY, id: mode === 'duplicate-id' ? ENTRY.id : 'fictional-second' };
      return { data: page([item], mode === 'changed-total' ? 2 : 3,
        mode === 'duplicate-cursor' ? { hasMore: true, nextCursor: 'fictional-next' } : {}) };
    } });
    await assert.rejects(f.data.readEntries(), error => ['INVALID_RESPONSE', 'DATA_CHANGED'].includes(error.code));
    assert.ok(reads <= 2, '坏分页立即停止，不循环重试');
    f.data.dispose();
  }
});

test('阅读数据并行读取六本书全部历史，最新指针与书本收藏兼容原页面', async () => {
  const latest = { ...NOTE, id: 'fictional-latest-note', body: '【虚构】第二次感悟。', savedAt: '2026-10-15T01:00:00.000Z', saveOrder: 2 };
  const f = fixture({ getBookNotes: ({ bookId, cursor }) => ({ data: { bookId,
    latestNoteId: bookId === NOTE.bookId ? latest.id : null,
    ...(bookId !== NOTE.bookId ? page([]) : cursor ? page([NOTE], 2)
      : page([latest], 2, { hasMore: true, nextCursor: 'fictional-note-next' })),
  } }) });
  const reading = await f.data.readReadingData();
  assert.deepEqual(reading.favorites, [{ bookId: NOTE.bookId, favoritedAt: DATE }]);
  assert.deepEqual(reading.notes, [{ ...latest, historyId: latest.id }]);
  assert.deepEqual(reading.noteHistory, [latest, NOTE]);
  assert.equal(reading.noteHistory[1].body, NOTE.body);
  assert.equal(reading.noteHistory[1].savedAt, NOTE.savedAt);
  assert.equal(new Set(f.calls.filter(call => call.method === 'getBookNotes').map(call => call.input.bookId)).size, 6);
  assert.equal(f.calls.filter(call => call.method === 'getBookNotes').length, 7);
  const favorites = await f.data.readFavorites();
  assert.equal(favorites.length, 2);
  assert.equal(favorites[1].targetType, 'entry');
  f.data.dispose();
});

test('感悟最新指针缺失或跨分页发生变化时停止，整组读取失败不交付残缺阅读数据', async () => {
  for (const changed of [false, true]) {
    const f = fixture({ getBookNotes: ({ bookId, cursor }) => {
      if (bookId !== NOTE.bookId) return { data: { ...page([]), bookId, latestNoteId: null } };
      if (!changed) return { data: { ...page([NOTE]), bookId, latestNoteId: 'fictional-missing-latest' } };
      return { data: { ...page([{ ...NOTE, id: cursor ? 'fictional-second' : NOTE.id }], 2,
        cursor ? {} : { hasMore: true, nextCursor: 'fictional-next' }), bookId,
      latestNoteId: cursor ? 'fictional-second' : NOTE.id } };
    } });
    await assert.rejects(f.data.readReadingData(), error => ['INVALID_RESPONSE', 'DATA_CHANGED'].includes(error.code));
    f.data.dispose();
  }
});

test('新增修改删除映射原接口语义，版本与原文不丢失，删除返回目标ID', async () => {
  const f = fixture();
  const input = { entryDate: ENTRY.entryDate, text: ENTRY.text };
  assert.equal((await f.data.createEntry(input)).text, ENTRY.text);
  const updated = await f.data.updateEntry(ENTRY.id, { text: ENTRY.text + '\n【虚构】新增一行' }, 1);
  assert.equal(updated.revision, 2);
  assert.equal(await f.data.deleteEntry(ENTRY.id, 2), ENTRY.id);
  const writes = f.calls.filter(call => ['createEntry', 'updateEntry', 'deleteEntry'].includes(call.method));
  assert.deepEqual(writes[0].input.input, input);
  assert.deepEqual(writes[1].input.input, { text: ENTRY.text + '\n【虚构】新增一行', expectedRevision: 1 });
  assert.equal(writes[2].input.expectedRevision, 2);
  f.data.dispose();
});

test('书本收藏与记录收藏使用明确目标状态，感悟追加删除和入库保留各自ID及版本', async () => {
  const f = fixture();
  assert.deepEqual(await f.data.setFavorite(NOTE.bookId, true), { bookId: NOTE.bookId, favoritedAt: DATE });
  assert.equal(await f.data.setFavorite(NOTE.bookId, false), null);
  assert.deepEqual(await f.data.setEntryFavorite(ENTRY.id, true), { targetType: 'entry', targetId: ENTRY.id,
    favorite: true, favoritedAt: DATE });
  const appended = await f.data.appendNote(NOTE.bookId, NOTE.body);
  assert.equal(appended.body, NOTE.body);
  assert.equal(await f.data.deleteHistoryNote(NOTE.id, 1), NOTE.id);
  assert.deepEqual(await f.data.setNoteInSummary(NOTE.id, false, 2), { note: NOTE, entry: null, outcome: 'removed' });
  assert.equal(f.calls.find(call => call.method === 'deleteNote').input.expectedRevision, 1);
  assert.equal(f.calls.find(call => call.method === 'setNoteInSummary').input.enabled, false);
  await assert.rejects(f.data.appendNote('fictional-unknown-book', NOTE.body), error => error.code === 'INVALID_INPUT');
  f.data.dispose();
});

test('采纳演示仅映射用户核对的草稿，发送服务器要求的版本及文本，不把source变成AI', async () => {
  const f = fixture();
  const draft = { source: 'demo', demoId: 'discussion-v1', entryId: ENTRY.id, baseRevision: 1,
    sourceTextVersion: 1, summary: '  【虚构】用户编辑过的演示总结。  ', questions: ['【虚构】下一步是什么？'] };
  const saved = await f.data.saveAdoptedDemo(draft);
  assert.equal(saved.adoptedAnalysis.source, 'demo');
  assert.equal(saved.adoptedAnalysis.summary, draft.summary);
  const call = f.calls.find(value => value.method === 'saveAdoptedDemo');
  assert.deepEqual(call.input.input, { expectedRevision: 1, sourceTextVersion: 1,
    summary: draft.summary, questions: draft.questions });
  await assert.rejects(f.data.saveAdoptedDemo({ ...draft, source: 'ai' }), error => error.code === 'INVALID_INPUT');
  assert.equal(f.calls.filter(value => value.method === 'saveAdoptedDemo').length, 1);
  f.data.dispose();
});

test('未登录拒绝读取或保存，不发送云端请求，不读旧本地记录', async () => {
  const f = fixture();
  f.change('', 'signedOut');
  for (const request of [() => f.data.readEntries(), () => f.data.readReadingData(), () => f.data.createEntry(ENTRY)]) {
    await assert.rejects(request(), error => error.code === 'UNAUTHENTICATED');
  }
  assert.equal(f.calls.length, 0);
  f.data.dispose();
});

test('账户切换同步中止所有读写，忽略取消的迟到响应不能交付或自动重试', async () => {
  const reading = deferred();
  const writing = deferred();
  const f = fixture({ getEntries: () => reading.promise, createEntry: () => writing.promise });
  const pendingRead = f.data.readEntries();
  const pendingWrite = f.data.createEntry(ENTRY);
  const rejected = Promise.all([assert.rejects(pendingRead, error => error.code === 'SESSION_CHANGED'),
    assert.rejects(pendingWrite, error => error.code === 'SESSION_CHANGED')]);
  const signals = f.calls.map(call => call.input.signal);
  f.change();
  assert.ok(signals.every(signal => signal.aborted));
  reading.resolve({ data: page([ENTRY]) });
  writing.resolve({ data: ENTRY });
  await rejected;
  assert.equal(f.calls.length, 2);
  assert.equal(f.invalidations, 0);
  f.data.dispose();
});

test('云端401作废当前会话，旧账户迟到401不能退出新账户，其他故障不回退或重试', async () => {
  const unauthenticated = Object.assign(new Error('fictional-private-detail'), { httpStatus: 401, code: 'UNAUTHENTICATED' });
  const f = fixture({ getEntries: () => { throw unauthenticated; } });
  await assert.rejects(f.data.readEntries(), error => error.code === 'UNAUTHENTICATED'
    && !error.message.includes('fictional-private-detail'));
  assert.equal(f.invalidations, 1);
  assert.equal(f.calls.length, 1);
  f.data.dispose();
  const delayed = deferred();
  const stale = fixture({ getEntries: () => delayed.promise });
  const previous = stale.data.readEntries();
  const rejected = assert.rejects(previous, error => error.code === 'SESSION_CHANGED');
  stale.change();
  delayed.resolve(Promise.reject(unauthenticated));
  await rejected;
  assert.equal(stale.session.getToken(), OTHER_TOKEN);
  assert.equal(stale.invalidations, 0);
  stale.data.dispose();
  const failed = fixture({ createEntry: () => { throw new Error(TOKEN + ENTRY.text); } });
  await assert.rejects(failed.data.createEntry(ENTRY), error => error.code === 'CLOUD_REQUEST_FAILED'
    && !error.message.includes(TOKEN) && !error.message.includes(ENTRY.text));
  assert.equal(failed.calls.length, 1);
  failed.data.dispose();
});

test('dispose终止旧请求，之后可重新挂订阅读取，兼容严格模式重挂', async () => {
  const remote = deferred();
  let first = true;
  const f = fixture({ getEntries: () => first ? (first = false, remote.promise) : { data: page([ENTRY]) } });
  const pending = f.data.readEntries();
  const rejected = assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
  f.data.dispose();
  assert.equal(f.subscribers.size, 0);
  remote.resolve({ data: page([ENTRY]) });
  await rejected;
  assert.deepEqual(await f.data.readEntries(), [ENTRY]);
  assert.equal(f.subscribers.size, 1);
  f.data.dispose();
});

test('四类账户数据流程不接触本地存储、不输出原文、账户凭据或资料', async t => {
  const originals = new Map();
  let accesses = 0;
  const output = [];
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { accesses += 1; throw new Error('禁止本地存储'); } });
  }
  for (const name of ['log', 'info', 'warn', 'error']) t.mock.method(console, name, (...args) => output.push(args));
  const f = fixture();
  try {
    await f.data.readEntries();
    await f.data.readReadingData();
    await f.data.setFavorite(NOTE.bookId, true);
    await f.data.appendNote(NOTE.bookId, NOTE.body);
    await f.data.saveAdoptedDemo({ source: 'demo', demoId: 'discussion-v1', entryId: ENTRY.id,
      baseRevision: 1, sourceTextVersion: 1, summary: '【虚构】总结', questions: ['【虚构】问题？'] });
    assert.equal(accesses, 0);
    assert.deepEqual(output, []);
  } finally {
    f.data.dispose();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

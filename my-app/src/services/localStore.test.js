import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  appendNote, saveNote, deleteNote, readNoteHistory, readReadingData,
  deleteHistoryNote, setNoteInSummary, readEntries, readEntry,
  updateEntry, deleteEntry, createEntry, saveAdoptedDemo,
} from './localStore.js';
import { createDemoDraft, DEMO_ENTRY_TEXT } from './analysisModel.js';

// 每项测试均使用独立的虚构内存数据库，不接触浏览器的真实记录。
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

function openRaw(version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = version ? indexedDB.open('literature-inner-conflict', version)
      : indexedDB.open('literature-inner-conflict');
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRaw(storeName) {
  const database = await openRaw();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

async function putRaw(storeName, value) {
  const database = await openRaw();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

const legacy = {
  bookId: 'walden', body: '  【虚构】旧备注\n保留原来的空白  ', revision: 2,
  createdAt: '2026-09-23T01:00:00.000Z', updatedAt: '2026-09-24T02:00:00.000Z',
};

async function seedVersionTwo() {
  const database = await openRaw(2, (db) => {
    db.createObjectStore('entries', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    db.createObjectStore('favorites', { keyPath: 'bookId' });
    db.createObjectStore('notes', { keyPath: 'bookId' });
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes', 'entries'], 'readwrite');
      transaction.objectStore('notes').add(legacy);
      transaction.objectStore('entries').add({ id: 'unrelated', text: '【虚构】独立总结', entryDate: '2026-09-23', createdAt: legacy.createdAt });
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

async function failStoreWrite(method, storeName, action, after = 0) {
  const original = IDBObjectStore.prototype[method];
  let writes = 0;
  IDBObjectStore.prototype[method] = function (...args) {
    if (this.name === storeName && writes++ >= after) throw new DOMException('虚构的存储失败', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try { await action(); }
  finally { IDBObjectStore.prototype[method] = original; }
}

test('v2 升级为 v3：旧备注、空白、日期和独立总结均保留', async () => {
  await seedVersionTwo();
  const reading = await readReadingData();
  const note = reading.noteHistory[0];
  for (const key of ['bookId', 'body', 'revision', 'createdAt', 'updatedAt']) assert.equal(note[key], legacy[key]);
  assert.equal(note.id, 'legacy:walden');
  assert.equal(note.savedAt, legacy.updatedAt);
  assert.equal(note.summaryLink, null);
  assert.equal(reading.notes[0].historyId, note.id);
  assert.equal((await readRaw('notes'))[0].body, legacy.body);
  assert.equal((await readEntries())[0].text, '【虚构】独立总结');
  const database = await openRaw();
  assert.equal(database.version, 3);
  assert.ok(database.objectStoreNames.contains('notes'));
  database.close();
});

test('迁移写入失败会回滚版本和数据，之后可以重新升级', async () => {
  await seedVersionTwo();
  const another = { ...legacy, bookId: 'analects', body: '【虚构】已先迁移的备注' };
  await putRaw('notes', another);
  await failStoreWrite('add', 'noteHistory', async () => {
    await assert.rejects(readReadingData(), /升级失败/);
  }, 1);
  const database = await openRaw();
  assert.equal(database.version, 2);
  assert.equal(database.objectStoreNames.contains('noteHistory'), false);
  database.close();
  assert.deepEqual(await readRaw('notes'), [another, legacy]);
  assert.equal((await readNoteHistory('walden'))[0].body, legacy.body);
});

test('连续保存三条均留存；删除最新只删该条并回到上一条', async () => {
  const saved = [];
  for (const text of ['【虚构】第一条', '【虚构】第二条', '【虚构】第三条']) {
    saved.push(await appendNote('walden', text));
  }
  let history = await readNoteHistory('walden');
  assert.deepEqual(history.map((note) => note.body), ['【虚构】第三条', '【虚构】第二条', '【虚构】第一条']);
  assert.equal(new Set(history.map((note) => note.id)).size, 3);
  await deleteHistoryNote(saved[2].id, saved[2].revision);
  history = await readNoteHistory('walden');
  assert.deepEqual(history.map((note) => note.body), ['【虚构】第二条', '【虚构】第一条']);
  assert.equal((await readReadingData()).notes[0].historyId, saved[1].id);
});

test('不同页面并发追加三条备注时不会互相覆盖', async () => {
  const saved = await Promise.all(['甲', '乙', '丙'].map((text) => appendNote('walden', `【虚构】${text}`)));
  const history = await readNoteHistory('walden');
  assert.equal(history.length, 3);
  assert.deepEqual(new Set(history.map((note) => note.id)), new Set(saved.map((note) => note.id)));
  assert.deepEqual(history.map((note) => note.saveOrder), [3, 2, 1]);
});

test('陈旧页面不能把已经变成往期的备注当作最新项删除', async () => {
  await appendNote('walden', '【虚构】第一条');
  const previouslyLatest = await appendNote('walden', '【虚构】另一页看到的最新项');
  const latest = await appendNote('walden', '【虚构】刚刚保存的新项');
  await assert.rejects(deleteHistoryNote(previouslyLatest.id, previouslyLatest.revision), {
    code: 'LOCAL_VERSION_CONFLICT',
  });
  const history = await readNoteHistory('walden');
  assert.equal(history.length, 3);
  assert.equal(history[0].id, latest.id);
  assert.ok(history.some((note) => note.id === previouslyLatest.id));
});

test('当前页面的保存与删除也同步历史，不让已删除备注重新出现', async () => {
  const first = await saveNote('walden', '【虚构】旧页面第一条', null);
  const second = await saveNote('walden', '【虚构】旧页面第二条', first);
  assert.equal((await readNoteHistory('walden')).length, 2);
  await deleteNote('walden', second);
  const reading = await readReadingData();
  assert.equal(reading.noteHistory.length, 1);
  assert.equal(reading.notes[0].body, first.body);
  await assert.rejects(saveNote('walden', '过期页面', second), { code: 'LOCAL_VERSION_CONFLICT' });
  const staleHead = { ...reading.notes[0], historyId: '已经删除的头记录' };
  await assert.rejects(deleteNote('walden', staleHead), { code: 'LOCAL_VERSION_CONFLICT' });
  const next = await saveNote('walden', '【虚构】删除后新写的一条', null);
  assert.deepEqual((await readNoteHistory('walden')).map((note) => note.body), [next.body, first.body]);
});

test('双写最新备注失败时，新历史也不会留下半成品', async () => {
  await readReadingData();
  await failStoreWrite('put', 'notes', async () => {
    await assert.rejects(appendNote('walden', '【虚构】失败的保存'));
  });
  assert.deepEqual(await readNoteHistory('walden'), []);
  assert.deepEqual((await readReadingData()).notes, []);
});

test('加入总结原样保留正文、日期来源，重新读取后状态仍在', async () => {
  const note = await appendNote('walden', '  【虚构】一次感悟\n一个行动  ');
  const joined = await setNoteInSummary(note.id, true, note.revision);
  assert.equal(joined.outcome, 'added');
  assert.equal(joined.entry.text, note.body);
  assert.equal(joined.entry.origin.bookTitle, '瓦尔登湖');
  assert.equal(joined.entry.origin.noteSavedAt, note.savedAt);
  assert.equal(joined.note.createdAt, note.createdAt);
  assert.equal(joined.note.savedAt, note.savedAt);
  const reread = (await readNoteHistory('walden'))[0];
  assert.equal(reread.summaryLink.active, true);
  assert.equal(reread.summaryLink.entryId, joined.entry.id);
  assert.equal((await readReadingData()).notes[0].summaryLink.active, true);
  assert.equal((await readEntry(joined.entry.id)).text, note.body);
});

test('并发重复加入只创建一份；再次取消撤回总结但保留备注', async () => {
  const note = await appendNote('walden', '【虚构】避免重复入库');
  const results = await Promise.all([
    setNoteInSummary(note.id, true, note.revision),
    setNoteInSummary(note.id, true, note.revision),
  ]);
  assert.deepEqual(results.map((result) => result.outcome).sort(), ['added', 'unchanged']);
  assert.equal((await readEntries()).length, 1);
  const current = (await readNoteHistory('walden'))[0];
  const cancelled = await setNoteInSummary(note.id, false, current.revision);
  assert.equal(cancelled.outcome, 'removed');
  assert.equal(cancelled.note.summaryLink, null);
  assert.equal((await readEntries()).length, 0);
  assert.equal((await readNoteHistory('walden'))[0].body, note.body);
});

test('改原文、改日期、采纳分析后取消均保留总结，重复加入也不误删', async () => {
  for (const kind of ['text', 'date', 'analysis']) {
    const note = await appendNote('walden', kind === 'analysis' ? DEMO_ENTRY_TEXT : '【虚构】保护独立编辑');
    let linked = await setNoteInSummary(note.id, true, note.revision);
    const entry = linked.entry;
    const changed = kind === 'analysis' ? await saveAdoptedDemo(createDemoDraft(entry))
      : await updateEntry(entry.id, {
        entryDate: kind === 'date' ? '1900-01-01' : entry.entryDate,
        text: kind === 'text' ? entry.text + '\n【虚构】后来修改' : entry.text,
      }, entry.revision);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const cancelled = await setNoteInSummary(note.id, false, linked.note.revision);
      assert.equal(cancelled.outcome, 'preserved-edited');
      assert.equal(cancelled.note.summaryLink.active, false);
      assert.equal(cancelled.note.summaryLink.preserveOnCancel, true);
      assert.deepEqual(await readEntry(entry.id), changed);
      linked = await setNoteInSummary(note.id, true, cancelled.note.revision);
      assert.equal(linked.outcome, 'reused');
      assert.equal(linked.entry.id, entry.id);
      assert.equal(linked.note.summaryLink.entryRevisionAtLink, entry.revision);
      assert.equal(linked.note.summaryLink.preserveOnCancel, true);
    }
  }
  assert.equal((await readEntries()).length, 3);
});

test('从总结库手动删除会清除对应备注关联，其他总结不受影响', async () => {
  const ordinary = await createEntry({ entryDate: '1900-01-01', text: '【虚构】独立日精进' });
  const note = await appendNote('walden', '【虚构】双向关联');
  const joined = await setNoteInSummary(note.id, true, note.revision);
  await deleteEntry(joined.entry.id, joined.entry.revision);
  assert.equal((await readNoteHistory('walden'))[0].summaryLink, null);
  assert.equal((await readReadingData()).notes[0].summaryLink, null);
  assert.equal((await readEntry(ordinary.id)).text, ordinary.text);
});

test('入库或取消的关联写入失败，会同时回滚总结与按钮状态', async () => {
  const note = await appendNote('walden', '【虚构】原子事务');
  await failStoreWrite('put', 'noteHistory', async () => {
    await assert.rejects(setNoteInSummary(note.id, true, note.revision));
  });
  assert.equal((await readEntries()).length, 0);
  assert.equal((await readNoteHistory('walden'))[0].summaryLink, null);
  const joined = await setNoteInSummary(note.id, true, note.revision);
  await failStoreWrite('put', 'noteHistory', async () => {
    await assert.rejects(setNoteInSummary(note.id, false, joined.note.revision));
  });
  assert.equal((await readEntries()).length, 1);
  assert.equal((await readNoteHistory('walden'))[0].summaryLink.active, true);
});

test('来源不匹配或跨页过期操作不能改动其他总结', async () => {
  const note = await appendNote('walden', '【虚构】来源核对');
  const joined = await setNoteInSummary(note.id, true, note.revision);
  await assert.rejects(setNoteInSummary(note.id, false, note.revision), { code: 'LOCAL_VERSION_CONFLICT' });
  const unrelated = { ...joined.entry, origin: { ...joined.entry.origin, bookId: 'analects' } };
  await putRaw('entries', unrelated);
  await assert.rejects(setNoteInSummary(note.id, false, joined.note.revision), { code: 'LOCAL_NOTE_LINK_CONFLICT' });
  assert.deepEqual(await readEntry(unrelated.id), unrelated);
  assert.equal((await readNoteHistory('walden'))[0].summaryLink.active, true);
});

test('删除单条历史不会删除已经加入总结库的独立原文', async () => {
  const note = await appendNote('walden', '【虚构】原文保留');
  const joined = await setNoteInSummary(note.id, true, note.revision);
  await deleteHistoryNote(note.id, joined.note.revision);
  assert.equal((await readNoteHistory('walden')).length, 0);
  assert.equal((await readReadingData()).notes.length, 0);
  assert.equal((await readEntry(joined.entry.id)).text, note.body);
});

test('公网 HTTP 缺少 randomUUID 时仍可保存历史并加入总结', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: (array) => webcrypto.getRandomValues(array),
  } });
  try {
    const note = await appendNote('walden', '【虚构】公网环境');
    const joined = await setNoteInSummary(note.id, true, note.revision);
    assert.equal(joined.outcome, 'added');
    assert.ok(joined.entry.id);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

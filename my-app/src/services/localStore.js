import { validateEntry, validateNote } from '../../shared/validation.js';
import { requireCurrentEntry, reviseEntry, sortEntries } from './entryModel.js';
import {
  requireCurrentNote, migrateLegacyNote, createHistoryNote, sortNoteHistory,
  requireCurrentHistoryNote, ownsNoteSummary, canRemoveNoteSummary, createNoteSummary,
} from './readingModel.js';
import { adoptDemoAnalysis } from './analysisModel.js';
import { getBook } from './catalog.js';

function createLocalId() {
  return crypto.getRandomValues(new Uint32Array(4)).join('-');
}

function latestHistoryId(note) {
  return note.historyId || note.id || `legacy:${note.bookId}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('此浏览器暂时无法使用本地存储。'));
      return;
    }

    const request = indexedDB.open('literature-inner-conflict', 3);
    let blocked = false;
    let upgradeError;
    request.onupgradeneeded = () => {
      const database = request.result;
      // 只添加缺少的存储区，保留已有日精进及索引。
      if (!database.objectStoreNames.contains('entries')) {
        const entries = database.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('createdAt', 'createdAt');
      }
      if (!database.objectStoreNames.contains('favorites')) database.createObjectStore('favorites', { keyPath: 'bookId' });
      if (!database.objectStoreNames.contains('notes')) database.createObjectStore('notes', { keyPath: 'bookId' });
      if (!database.objectStoreNames.contains('noteHistory')) {
        const history = database.createObjectStore('noteHistory', { keyPath: 'id' });
        history.createIndex('bookId', 'bookId');
        history.createIndex('bookSavedAt', ['bookId', 'savedAt']);
        // 升级事务内复制原文，保留旧库；任一写入失败都会回滚整个升级。
        const legacy = request.transaction.objectStore('notes').openCursor();
        legacy.onsuccess = () => {
          const cursor = legacy.result;
          if (!cursor) return;
          try {
            const migrated = migrateLegacyNote(cursor.value);
            const copy = history.add(migrated);
            cursor.update({ ...cursor.value, historyId: migrated.id, saveOrder: migrated.saveOrder });
            copy.onsuccess = () => cursor.continue();
          } catch (error) {
            upgradeError = new Error('备注历史升级失败，旧数据仍保留，请重试。', { cause: error });
            request.transaction.abort();
          }
        };
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('请关闭其他旧版项目页面，再重试本地存储操作。'));
    };
    request.onerror = () => reject(upgradeError || (request.error?.name === 'VersionError'
      ? new Error('本地数据已由新版页面更新，请刷新此页后重试。') : request.error));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
  });
}

async function runTransaction(storeNames, mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeNames, mode);
      let result;
      let operationError;
      const fail = (error) => {
        operationError = error;
        transaction.abort();
      };
      // 单个请求成功不代表写入完成，只有整笔事务完成才报告成功。
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(operationError || transaction.error || new Error('本地存储操作未完成。'));
      transaction.onerror = () => reject(operationError || transaction.error || new Error('本地存储操作失败。'));
      try {
        operation(transaction, (value) => { result = value; }, fail);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

export function readEntries() {
  return runTransaction('entries', 'readonly', (transaction, setResult) => {
    const store = transaction.objectStore('entries');
    const request = store.getAll();
    request.onsuccess = () => setResult(sortEntries(request.result));
  });
}

export function readEntry(id) {
  return runTransaction('entries', 'readonly', (transaction, setResult) => {
    const request = transaction.objectStore('entries').get(id);
    request.onsuccess = () => setResult(request.result);
  });
}

export function saveAdoptedDemo(draft) {
  return runTransaction('entries', 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('entries');
    const request = store.get(draft.entryId);
    request.onsuccess = () => {
      try {
        const saved = adoptDemoAnalysis(request.result, draft);
        store.put(saved);
        setResult(saved);
      } catch (error) { fail(error); }
    };
  });
}

export function updateEntry(id, input, expectedRevision) {
  const errors = validateEntry(input);
  if (Object.keys(errors).length) return Promise.reject(new Error(Object.values(errors)[0]));
  return runTransaction('entries', 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('entries');
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const entry = reviseEntry(request.result, input, expectedRevision);
        store.put(entry);
        setResult(entry);
      } catch (error) { fail(error); }
    };
  });
}

export function deleteEntry(id, expectedRevision) {
  return runTransaction(['entries', 'noteHistory', 'notes'], 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('entries');
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        requireCurrentEntry(request.result, expectedRevision);
        store.delete(id);
        setResult(id);
        if (request.result.origin?.type === 'reading-note') {
          const noteRequest = transaction.objectStore('noteHistory').get(request.result.origin.noteId);
          noteRequest.onsuccess = () => {
            try {
              const note = noteRequest.result;
              if (note && ownsNoteSummary(note, request.result) && note.summaryLink?.entryId === id) {
                writeSummaryLink(transaction, note, null, fail);
              }
            } catch (error) { fail(error); }
          };
        }
      } catch (error) { fail(error); }
    };
  });
}

export function createEntry(input) {
  const errors = validateEntry(input);
  if (Object.keys(errors).length) return Promise.reject(new Error(Object.values(errors)[0]));
  const now = new Date().toISOString();
  const entry = {
    id: createLocalId(),
    entryDate: input.entryDate,
    // 字数校验忽略首尾空白，但保存时保留用户实际输入的原文。
    text: input.text,
    textVersion: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    adoptedAnalysis: null,
  };
  return runTransaction('entries', 'readwrite', (transaction, setResult) => {
    const store = transaction.objectStore('entries');
    store.add(entry);
    setResult(entry);
  });
}

export function readReadingData() {
  return runTransaction(['favorites', 'notes', 'noteHistory'], 'readonly', (transaction, setResult) => {
    const result = { favorites: [], notes: [], noteHistory: [] };
    for (const name of ['favorites', 'notes', 'noteHistory']) {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => { result[name] = name === 'noteHistory' ? sortNoteHistory(request.result) : request.result; };
    }
    setResult(result);
  });
}

export function setFavorite(bookId, favorite) {
  return runTransaction('favorites', 'readwrite', (transaction, setResult) => {
    const store = transaction.objectStore('favorites');
    const request = store.get(bookId);
    request.onsuccess = () => {
      if (favorite) {
        const value = request.result || { bookId, favoritedAt: new Date().toISOString() };
        store.put(value);
        setResult(value);
      } else {
        store.delete(bookId);
        setResult(null);
      }
    };
  });
}

export function saveNote(bookId, body, expected) {
  return appendNoteRecord(bookId, body, expected, true);
}

export function appendNote(bookId, body) {
  return appendNoteRecord(bookId, body, null, false);
}

function appendNoteRecord(bookId, body, expected, checkLatest) {
  const error = validateNote(body);
  if (error) return Promise.reject(new Error(error));
  return runTransaction(['notes', 'noteHistory'], 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('notes');
    const request = store.get(bookId);
    request.onsuccess = () => {
      try {
        // 空基线表示新增感悟；有基线的旧页面仍需核对版本，但不会覆盖历史原文。
        if (checkLatest && expected) requireCurrentNote(request.result, expected);
        const note = {
          ...createHistoryNote(bookId, body, createLocalId()),
          saveOrder: (request.result?.saveOrder || request.result?.revision || 0) + 1,
        };
        const latest = { ...note, historyId: note.id, revision: (request.result?.revision || 0) + 1 };
        transaction.objectStore('noteHistory').add(note);
        store.put(latest);
        setResult(checkLatest ? latest : note);
      } catch (error) { fail(error); }
    };
  });
}

export function deleteNote(bookId, expected) {
  return runTransaction(['notes', 'noteHistory'], 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('notes');
    const request = store.get(bookId);
    request.onsuccess = () => {
      try {
        requireCurrentNote(request.result, expected);
        const historyId = latestHistoryId(request.result);
        transaction.objectStore('noteHistory').delete(historyId);
        restoreLatestNote(transaction, bookId, request.result.revision, fail);
        setResult(bookId);
      } catch (error) { fail(error); }
    };
  });
}

export function readNoteHistory(bookId) {
  return runTransaction('noteHistory', 'readonly', (transaction, setResult) => {
    const store = transaction.objectStore('noteHistory');
    const request = bookId ? store.index('bookId').getAll(bookId) : store.getAll();
    request.onsuccess = () => setResult(sortNoteHistory(request.result));
  });
}

function restoreLatestNote(transaction, bookId, previousRevision, fail) {
  const request = transaction.objectStore('noteHistory').index('bookId').getAll(bookId);
  request.onsuccess = () => {
    try {
      const latest = sortNoteHistory(request.result)[0];
      const cache = transaction.objectStore('notes');
      if (latest) cache.put({ ...latest, historyId: latest.id, revision: previousRevision + 1 });
      else cache.delete(bookId);
    } catch (error) { fail(error); }
  };
}

export function deleteHistoryNote(noteId, expectedRevision) {
  return runTransaction(['noteHistory', 'notes'], 'readwrite', (transaction, setResult, fail) => {
    const history = transaction.objectStore('noteHistory');
    const request = history.get(noteId);
    request.onsuccess = () => {
      try {
        const note = request.result;
        requireCurrentHistoryNote(note, expectedRevision);
        const latest = history.index('bookId').getAll(note.bookId);
        latest.onsuccess = () => {
          try {
            if (sortNoteHistory(latest.result)[0]?.id !== noteId) {
              const error = new Error('这本书已有更新的备注与感悟，未删除任何记录，请重新读取后再操作。');
              error.code = 'LOCAL_VERSION_CONFLICT';
              throw error;
            }
            history.delete(noteId);
            // 删除备注不连带删除已经加入的总结；总结保留独立原文和来源。
            const cached = transaction.objectStore('notes').get(note.bookId);
            cached.onsuccess = () => {
              try {
                if (cached.result && latestHistoryId(cached.result) === noteId) {
                  restoreLatestNote(transaction, note.bookId, cached.result.revision, fail);
                }
              } catch (error) { fail(error); }
            };
            setResult(noteId);
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    };
  });
}

function writeSummaryLink(transaction, note, summaryLink, fail) {
  const updated = { ...note, summaryLink, revision: note.revision + 1 };
  transaction.objectStore('noteHistory').put(updated);
  const cached = transaction.objectStore('notes').get(note.bookId);
  cached.onsuccess = () => {
    try {
      if (cached.result && latestHistoryId(cached.result) === note.id) {
        transaction.objectStore('notes').put({
          ...cached.result, summaryLink, revision: cached.result.revision + 1,
        });
      }
    } catch (error) { fail(error); }
  };
  return updated;
}

export function setNoteInSummary(noteId, enabled, expectedRevision) {
  if (typeof enabled !== 'boolean') return Promise.reject(new Error('请明确选择保存到总结库或取消保存。'));
  return runTransaction(['noteHistory', 'entries', 'notes'], 'readwrite', (transaction, setResult, fail) => {
    const history = transaction.objectStore('noteHistory');
    const entries = transaction.objectStore('entries');
    const request = history.get(noteId);
    request.onsuccess = () => {
      try {
        const note = request.result;
        if (!note) requireCurrentHistoryNote(note, expectedRevision);
        const sameState = Boolean(note.summaryLink?.active) === enabled;
        if (sameState && !enabled) {
          setResult({ note, entry: null, outcome: 'unchanged' });
          return;
        }
        if (!sameState) requireCurrentHistoryNote(note, expectedRevision);
        const linked = note.summaryLink?.entryId ? entries.get(note.summaryLink.entryId) : null;
        const finish = (existing) => {
          try {
            if (existing && !ownsNoteSummary(note, existing)) {
              const error = new Error('总结来源与这条备注不匹配，未改动任何记录，请重新读取并核对。');
              error.code = 'LOCAL_NOTE_LINK_CONFLICT';
              throw error;
            }
            if (sameState && existing) {
              setResult({ note, entry: existing, outcome: 'unchanged' });
              return;
            }
            requireCurrentHistoryNote(note, expectedRevision);
            if (enabled) {
              const now = new Date().toISOString();
              const entry = existing || createNoteSummary(note, getBook(note.bookId)?.title || '未知作品', createLocalId(), now);
              if (!existing) entries.add(entry);
              const summaryLink = {
                entryId: entry.id, active: true, linkedAt: now,
                entryRevisionAtLink: existing ? note.summaryLink.entryRevisionAtLink : entry.revision,
                preserveOnCancel: existing
                  ? Boolean(note.summaryLink.preserveOnCancel || entry.revision !== note.summaryLink.entryRevisionAtLink)
                  : false,
              };
              const updated = writeSummaryLink(transaction, note, summaryLink, fail);
              setResult({ note: updated, entry, outcome: existing ? 'reused' : 'added' });
            } else {
              const remove = existing && canRemoveNoteSummary(note, existing);
              if (remove) entries.delete(existing.id);
              const summaryLink = existing && !remove
                ? { ...note.summaryLink, active: false, preserveOnCancel: true }
                : null;
              const updated = writeSummaryLink(transaction, note, summaryLink, fail);
              setResult({ note: updated, entry: remove ? null : existing,
                outcome: existing && !remove ? 'preserved-edited' : 'removed' });
            }
          } catch (error) { fail(error); }
        };
        if (linked) linked.onsuccess = () => finish(linked.result);
        else finish(null);
      } catch (error) { fail(error); }
    };
  });
}

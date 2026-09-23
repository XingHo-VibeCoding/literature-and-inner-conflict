import { validateEntry, validateNote } from '../../shared/validation.js';
import { requireCurrentEntry, reviseEntry, sortEntries } from './entryModel.js';
import { requireCurrentNote, reviseNote } from './readingModel.js';
import { adoptDemoAnalysis } from './analysisModel.js';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('此浏览器暂时无法使用本地存储。'));
      return;
    }

    const request = indexedDB.open('literature-inner-conflict', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      // 只添加缺少的存储区，保留已有日精进及索引。
      if (!database.objectStoreNames.contains('entries')) {
        const entries = database.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('createdAt', 'createdAt');
      }
      if (!database.objectStoreNames.contains('favorites')) database.createObjectStore('favorites', { keyPath: 'bookId' });
      if (!database.objectStoreNames.contains('notes')) database.createObjectStore('notes', { keyPath: 'bookId' });
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('请关闭其他旧版项目页面，再重试本地存储操作。'));
    };
    request.onerror = () => reject(request.error?.name === 'VersionError'
      ? new Error('本地数据已由新版页面更新，请刷新此页后重试。') : request.error);
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
  return runTransaction('entries', 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('entries');
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        requireCurrentEntry(request.result, expectedRevision);
        store.delete(id);
        setResult(id);
      } catch (error) { fail(error); }
    };
  });
}

export function createEntry(input) {
  const errors = validateEntry(input);
  if (Object.keys(errors).length) return Promise.reject(new Error(Object.values(errors)[0]));
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
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
  return runTransaction(['favorites', 'notes'], 'readonly', (transaction, setResult) => {
    const result = { favorites: [], notes: [] };
    for (const name of ['favorites', 'notes']) {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => { result[name] = request.result; };
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
  const error = validateNote(body);
  if (error) return Promise.reject(new Error(error));
  return runTransaction('notes', 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('notes');
    const request = store.get(bookId);
    request.onsuccess = () => {
      try {
        const note = reviseNote(bookId, body, request.result, expected);
        store.put(note);
        setResult(note);
      } catch (error) { fail(error); }
    };
  });
}

export function deleteNote(bookId, expected) {
  return runTransaction('notes', 'readwrite', (transaction, setResult, fail) => {
    const store = transaction.objectStore('notes');
    const request = store.get(bookId);
    request.onsuccess = () => {
      try {
        requireCurrentNote(request.result, expected);
        store.delete(bookId);
        setResult(bookId);
      } catch (error) { fail(error); }
    };
  });
}

import { sortEntries } from './entryModel.js';
import { sortNoteHistory } from './readingModel.js';

const PAGE_LIMIT = 20;
const CHANGED_MESSAGE = '账户已切换或登录已失效，已停止本次操作。请重新登录并读取。';

function dataError(message, code) {
  const error = new Error(message);
  error.name = 'AccountDataError';
  error.code = code;
  return error;
}

function safeError(error) {
  return ['PublicApiError', 'AccountDataError'].includes(error?.name) ? error
    : dataError('云端操作未能完成，请检查网络后手动重试。结果不明确时请先重新读取核对。', 'CLOUD_REQUEST_FAILED');
}

// 所有业务数据只向当前账户的云端接口读写；不接触浏览器数据库或持久存储。
export function createAccountData({ apiClient, session, bookIds } = {}) {
  const requiredMethods = ['getEntries', 'createEntry', 'updateEntry', 'deleteEntry', 'getFavorites',
    'getBookNotes', 'createNote', 'deleteNote', 'setNoteInSummary', 'setFavorite', 'saveAdoptedDemo'];
  if (!apiClient || !requiredMethods.every(key => typeof apiClient[key] === 'function')
    || !session || !['getToken', 'getSnapshot', 'subscribe', 'invalidate'].every(key => typeof session[key] === 'function')
    || !Array.isArray(bookIds) || !bookIds.length || bookIds.some(id => typeof id !== 'string' || !id)
    || new Set(bookIds).size !== bookIds.length) {
    throw dataError('账户数据服务配置不完整，请联系站点维护者。', 'INVALID_CONFIGURATION');
  }
  const books = [...bookIds];
  const bookSet = new Set(books);
  const operations = new Set();
  let unsubscribe = null;
  let generation = 0;

  function sameSession(operation) {
    const snapshot = session.getSnapshot();
    return operation.generation === generation && snapshot.status === 'signedIn'
      && snapshot.version === operation.version && snapshot.token === operation.token;
  }

  function attach() {
    if (unsubscribe) return;
    unsubscribe = session.subscribe(() => {
      for (const operation of operations) {
        if (!sameSession(operation)) operation.controller.abort();
      }
    });
  }

  function check(operation) {
    if (operation.controller.signal.aborted || !sameSession(operation)
      || session.getToken() !== operation.token) throw dataError(CHANGED_MESSAGE, 'SESSION_CHANGED');
  }

  async function call(operation, method, input = {}) {
    check(operation);
    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
    const cancel = () => rejectCancellation(dataError(CHANGED_MESSAGE, 'SESSION_CHANGED'));
    operation.controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await Promise.race([apiClient[method]({ ...input, token: operation.token,
        signal: operation.controller.signal }), cancellation]);
      check(operation);
      return result.data;
    } finally { operation.controller.signal.removeEventListener('abort', cancel); }
  }

  async function run(work) {
    attach();
    const token = session.getToken();
    const snapshot = session.getSnapshot();
    if (!token || snapshot.status !== 'signedIn') {
      throw dataError('请先登录，再读取或保存账户中的内容。', 'UNAUTHENTICATED');
    }
    const operation = { token, version: snapshot.version, generation, controller: new AbortController() };
    operations.add(operation);
    try {
      const result = await work(operation);
      check(operation);
      return result;
    } catch (caught) {
      // 旧账户的迟到 401 不能退出后来已登录的新账户。
      if (!sameSession(operation) || operation.controller.signal.aborted) throw dataError(CHANGED_MESSAGE, 'SESSION_CHANGED');
      if (caught?.httpStatus === 401 || caught?.code === 'UNAUTHENTICATED') {
        session.invalidate('登录状态已失效，请重新登录。');
        throw dataError('登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
      }
      throw safeError(caught);
    } finally {
      operations.delete(operation);
      operation.controller.abort();
    }
  }

  async function pages(operation, method, input, identity, metadata) {
    const items = [];
    const ids = new Set();
    const cursors = new Set();
    let cursor;
    let total;
    let firstMetadata;
    do {
      const data = await call(operation, method, { ...input, limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
      if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0
        || !data.page || data.page.limit !== PAGE_LIMIT || typeof data.page.hasMore !== 'boolean'
        || data.items.length > PAGE_LIMIT || (data.page.hasMore
          ? typeof data.page.nextCursor !== 'string' || !data.page.nextCursor || !data.items.length
          : data.page.nextCursor !== null)) {
        throw dataError('云端分页响应不完整，未使用空记录代替失败。请重新读取核对。', 'INVALID_RESPONSE');
      }
      if (total !== undefined && total !== data.total) {
        throw dataError('读取期间云端记录条数发生变化，请重新读取并核对。', 'DATA_CHANGED');
      }
      total = data.total;
      const currentMetadata = metadata?.(data);
      if (firstMetadata !== undefined && currentMetadata !== firstMetadata) {
        throw dataError('读取期间云端最新感悟发生变化，请重新读取并核对。', 'DATA_CHANGED');
      }
      firstMetadata = currentMetadata;
      for (const item of data.items) {
        const id = identity(item);
        if (typeof id !== 'string' || !id || ids.has(id)) {
          throw dataError('云端分页包含无效或重复的记录，已停止读取。请重新读取核对。', 'INVALID_RESPONSE');
        }
        ids.add(id);
        items.push(item);
      }
      if (items.length > total) throw dataError('云端分页条数与总数不一致，请重新读取核对。', 'INVALID_RESPONSE');
      cursor = data.page.hasMore ? data.page.nextCursor : undefined;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw dataError('云端分页游标重复，已停止读取。请重新读取核对。', 'INVALID_RESPONSE');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    if (items.length !== total) throw dataError('云端分页尚未完整读回，未将缺少的数据当作空记录。', 'INVALID_RESPONSE');
    return { items, metadata: firstMetadata };
  }

  const entryPages = operation => pages(operation, 'getEntries', {}, item => item?.id);
  const favoritePages = operation => pages(operation, 'getFavorites', {}, item =>
    ['book', 'entry'].includes(item?.targetType) && typeof item.targetId === 'string' && item.targetId
      ? JSON.stringify([item.targetType, item.targetId]) : '');

  async function notePages(operation, bookId) {
    const result = await pages(operation, 'getBookNotes', { bookId }, item => item?.bookId === bookId ? item.id : '', data => {
      if (data.bookId !== bookId || (data.total === 0 ? data.latestNoteId !== null
        : typeof data.latestNoteId !== 'string' || !data.latestNoteId)) {
        throw dataError('作品感悟的最新记录标识无效，请重新读取。', 'INVALID_RESPONSE');
      }
      return data.latestNoteId;
    });
    if (result.items.length && !result.items.some(note => note.id === result.metadata)) {
      throw dataError('未读到云端标记的最新感悟，请重新读取核对。', 'INVALID_RESPONSE');
    }
    return result;
  }

  function requireBook(bookId) {
    if (!bookSet.has(bookId)) throw dataError('作品不存在，请返回书单重新选择。', 'INVALID_INPUT');
  }

  return {
    readEntries: () => run(async operation => sortEntries((await entryPages(operation)).items)),
    readEntry: id => run(async operation => (await entryPages(operation)).items.find(entry => entry.id === id)),
    createEntry: input => run(operation => call(operation, 'createEntry', { input })),
    updateEntry: (entryId, input, expectedRevision) => run(operation => call(operation, 'updateEntry', {
      entryId, input: { ...input, expectedRevision },
    })),
    deleteEntry: (entryId, expectedRevision) => run(async operation => {
      await call(operation, 'deleteEntry', { entryId, expectedRevision });
      return entryId;
    }),
    readFavorites: () => run(async operation => (await favoritePages(operation)).items),
    readReadingData: () => run(async operation => {
      const [favorites, ...groups] = await Promise.all([favoritePages(operation), ...books.map(bookId => notePages(operation, bookId))]);
      const noteHistory = sortNoteHistory(groups.flatMap(group => group.items));
      if (new Set(noteHistory.map(note => note.id)).size !== noteHistory.length) {
        throw dataError('不同作品返回了重复的感悟标识，请重新读取核对。', 'INVALID_RESPONSE');
      }
      return {
        favorites: favorites.items.filter(item => item.targetType === 'book')
          .map(item => ({ bookId: item.targetId, favoritedAt: item.favoritedAt })),
        notes: groups.filter(group => group.items.length).map(group => {
          const note = group.items.find(item => item.id === group.metadata);
          return { ...note, historyId: note.id };
        }),
        noteHistory,
      };
    }),
    readNoteHistory: bookId => run(async operation => {
      if (bookId !== undefined) requireBook(bookId);
      const groups = await Promise.all((bookId === undefined ? books : [bookId]).map(id => notePages(operation, id)));
      return sortNoteHistory(groups.flatMap(group => group.items));
    }),
    setFavorite: (bookId, favorite) => run(async operation => {
      requireBook(bookId);
      const result = await call(operation, 'setFavorite', { targetType: 'book', targetId: bookId, favorite });
      return result.favorite ? { bookId, favoritedAt: result.favoritedAt } : null;
    }),
    setEntryFavorite: (entryId, favorite) => run(operation => call(operation, 'setFavorite', {
      targetType: 'entry', targetId: entryId, favorite,
    })),
    appendNote: (bookId, body) => run(operation => {
      requireBook(bookId);
      return call(operation, 'createNote', { bookId, body });
    }),
    deleteHistoryNote: (noteId, expectedRevision) => run(async operation => {
      await call(operation, 'deleteNote', { noteId, expectedRevision });
      return noteId;
    }),
    setNoteInSummary: (noteId, enabled, expectedRevision) => run(operation => call(operation,
      'setNoteInSummary', { noteId, enabled, expectedRevision })),
    saveAdoptedDemo: draft => run(operation => {
      if (draft?.source !== 'demo' || draft.demoId !== 'discussion-v1') {
        throw dataError('当前只能采纳页面提供的虚构示例演示草稿。', 'INVALID_INPUT');
      }
      return call(operation, 'saveAdoptedDemo', { entryId: draft.entryId, input: {
        expectedRevision: draft.baseRevision, sourceTextVersion: draft.sourceTextVersion,
        summary: draft.summary, questions: draft.questions,
      } });
    }),
    dispose() {
      generation += 1;
      for (const operation of operations) operation.controller.abort();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

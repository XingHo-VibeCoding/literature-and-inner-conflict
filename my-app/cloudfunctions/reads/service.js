const { createHmac, timingSafeEqual } = require('node:crypto');
const { ENTRIES_SQL, createEntriesRepository } = require('./entriesRepository');
const { NOTES_SQL, createReadingNotesRepository } = require('./readingNotesRepository');
const { FAVORITES_SQL, createFavoritesRepository } = require('./favoritesRepository');

class ApiError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
const invalid = (message) => new ApiError(400, 'INVALID_INPUT', message);

function iso(value) {
  const date = new Date(value);
  if (value === null || value === undefined || !Number.isFinite(date.getTime())) {
    throw new Error('数据库时间字段不完整。');
  }
  return date.toISOString();
}
function entry(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date_text)) throw new Error('数据库日期格式异常。');
  return {
    id: row.id, entryDate: row.entry_date_text, text: row.text,
    textVersion: row.text_version, revision: row.revision,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    adoptedAnalysis: row.adopted_analysis ?? null, origin: row.origin ?? null,
  };
}
function note(row) {
  return {
    id: row.id, bookId: row.book_id, body: row.body, revision: row.revision,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    savedAt: iso(row.saved_at), saveOrder: row.save_order,
    summaryLink: row.summary_entry_id === null ? null : {
      entryId: row.summary_entry_id, active: row.summary_active,
      linkedAt: iso(row.summary_linked_at), entryRevisionAtLink: row.summary_entry_revision_at_link,
      preserveOnCancel: row.summary_preserve_on_cancel,
    },
  };
}
function favorite(row) {
  return { targetType: row.target_type, targetId: row.target_id, favoritedAt: iso(row.favorited_at) };
}

function createReader({ query, bookIds, cursorSecret }) {
  if (typeof cursorSecret !== 'string' || Buffer.byteLength(cursorSecret) < 32) {
    throw new Error('请配置至少32字节的随机 CURSOR_SECRET。');
  }
  const entriesRepository = createEntriesRepository({ query });
  const readingNotesRepository = createReadingNotesRepository({ query });
  const favoritesRepository = createFavoritesRepository({ query });
  const sign = (value) => createHmac('sha256', cursorSecret).update(value).digest('base64url');
  // 游标只带排序位置及作用域摘要，不输出 owner_id；签名防止篡改或串用户。
  function encode(scope, keys) {
    const payload = Buffer.from(JSON.stringify({ v: 1, scope: sign(scope), keys })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }
  function decode(cursor, scope, kind) {
    if (!cursor) return null;
    try {
      if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const [payload, signature] = cursor.split('.');
      const expected = Buffer.from(sign(payload));
      const supplied = Buffer.from(signature);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (parsed.v !== 1 || parsed.scope !== sign(scope) || !Array.isArray(parsed.keys)) throw new Error();
      const keys = parsed.keys;
      const stamp = (value) => typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value));
      const id = (value) => typeof value === 'string' && value.length > 0;
      if (kind === 'entries') {
        if (keys.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(keys[0]) || !stamp(keys[1]) || !id(keys[2])) throw new Error();
      } else if (kind === 'notes') {
        if (keys.length !== 3 || !stamp(keys[0]) || !Number.isSafeInteger(keys[1]) || keys[1] < 1 || !id(keys[2])) throw new Error();
      } else if (keys.length !== 3 || !stamp(keys[0]) || !['book', 'entry'].includes(keys[1]) || !id(keys[2])) {
        throw new Error();
      }
      return keys;
    } catch { throw invalid('分页游标无效，请重新读取第一页。'); }
  }
  return async function read({ kind, ownerId, bookId, params }) {
    const allowed = new Set(['limit', 'cursor', ...(kind === 'favorites' ? ['targetType'] : [])]);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) throw invalid('查询参数未登记或重复。');
    }
    const limitText = params.get('limit');
    if (limitText !== null && (!/^[1-9]\d{0,2}$/.test(limitText) || Number(limitText) > 100)) {
      throw invalid('limit 必须是1到100之间的整数。');
    }
    const limit = limitText === null ? 20 : Number(limitText);
    const targetType = params.get('targetType');
    if (kind === 'favorites' && targetType !== null && !['book', 'entry'].includes(targetType)) {
      throw invalid('targetType 只能是 book 或 entry。');
    }
    if (kind === 'notes' && !bookIds.has(bookId)) {
      throw new ApiError(404, 'BOOK_NOT_FOUND', '作品不存在。');
    }
    if (params.has('cursor') && !params.get('cursor')) throw invalid('分页游标不能为空。');
    const scope = JSON.stringify([kind, ownerId, bookId ?? null, targetType, 'day17-sort-v1']);
    const keys = decode(params.get('cursor'), scope, kind);
    let load, map, position;
    if (kind === 'entries') {
      load = () => entriesRepository.list({ ownerId, keys, limit: limit + 1 });
      map = entry;
      position = (row) => [row.entry_date_text, iso(row.created_at), row.id];
    } else if (kind === 'notes') {
      load = () => readingNotesRepository.list({ ownerId, bookId, keys, limit: limit + 1 });
      map = note;
      position = (row) => [iso(row.saved_at), row.save_order, row.id];
    } else {
      load = () => favoritesRepository.list({ ownerId, targetType, keys, limit: limit + 1 });
      map = favorite;
      position = (row) => [iso(row.favorited_at), row.target_type, row.target_id];
    }
    const result = await load();
    const summary = result.rows[0];
    if (!summary || !Array.isArray(summary.rows)) throw new Error('数据库列表结果异常。');
    const total = Number(summary.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('数据库总数异常。');
    const rows = summary.rows.slice(0, limit);
    const hasMore = summary.rows.length > limit;
    const data = {
      items: rows.map(map), total,
      page: { limit, nextCursor: hasMore ? encode(scope, position(rows[rows.length - 1])) : null, hasMore },
    };
    if (kind === 'notes') return { bookId, latestNoteId: summary.latest_note_id ?? null, ...data };
    return data;
  };
}

module.exports = { ApiError, createReader, entry, ENTRIES_SQL, NOTES_SQL, FAVORITES_SQL };

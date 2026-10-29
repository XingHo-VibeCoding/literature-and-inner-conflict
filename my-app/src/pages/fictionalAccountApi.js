import { getBook } from '../services/catalog.js';
import { sortEntries, reviseEntry } from '../services/entryModel.js';
import { adoptDemoAnalysis } from '../services/analysisModel.js';
import {
  createHistoryNote, sortNoteHistory, createNoteSummary, ownsNoteSummary, canRemoveNoteSummary,
} from '../services/readingModel.js';

const DEFAULT_OWNER = 'fictional-reader-a';
const OTHER_OWNER = 'fictional-reader-b';

// 仅供页面回归：所有身份、凭据和内容均为虚构内存数据，任何地址都不转发网络。
export function createFictionalAccountApi({ authOrigin, apiOrigin = '' } = {}) {
  const rowsByOwner = new Map();
  const tokenOwners = new Map();
  const ownerTokens = new Map();
  const requests = [];
  let sequence = 0;
  let failSummary = false;

  function state(owner = DEFAULT_OWNER) {
    if (!rowsByOwner.has(owner)) rowsByOwner.set(owner, { entries: [], notes: [], favorites: [] });
    return rowsByOwner.get(owner);
  }

  function tokenFor(owner) {
    if (!ownerTokens.has(owner)) {
      const token = 'fictional-session-' + owner;
      ownerTokens.set(owner, token);
      tokenOwners.set(token, owner);
    }
    return ownerTokens.get(owner);
  }

  function stamp() { return new Date(Date.parse('2026-10-26T01:00:00.000Z') + ++sequence * 1000).toISOString(); }
  function id(kind) { return 'fictional-' + kind + '-' + ++sequence; }
  function response(status, body) {
    return new Response(JSON.stringify(body), { status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'fictional-account-request' } });
  }
  function success(data, status = 200) { return response(status, { ok: true, data, error: null }); }
  function failure(status, code) {
    return response(status, { ok: false, data: null,
      error: { code, message: '虚构接口返回的内部提示，不应直接显示。', retryable: status >= 500 } });
  }
  function page(items, query, extra = {}) {
    const limit = Number(query.get('limit') || 20);
    const offset = Number(query.get('cursor') || 0);
    const hasMore = offset + limit < items.length;
    return { items: items.slice(offset, offset + limit), total: items.length,
      page: { limit, nextCursor: hasMore ? String(offset + limit) : null, hasMore }, ...extra };
  }

  function summary(rows, note, enabled, expectedRevision) {
    const sameState = Boolean(note.summaryLink?.active) === enabled;
    if (sameState && !enabled) return { note, entry: null, outcome: 'unchanged' };
    const existing = rows.entries.find(entry => entry.id === note.summaryLink?.entryId);
    if (existing && !ownsNoteSummary(note, existing)) return failure(409, 'NOTE_LINK_CONFLICT');
    if (sameState && existing) return { note, entry: existing, outcome: 'unchanged' };
    if (note.revision !== expectedRevision) return failure(409, 'VERSION_CONFLICT');
    let entry;
    let summaryLink;
    let outcome;
    const now = stamp();
    if (enabled) {
      entry = existing || createNoteSummary(note, getBook(note.bookId)?.title || '虚构作品', id('entry'), now);
      if (!existing) rows.entries.push(entry);
      summaryLink = { entryId: entry.id, active: true, linkedAt: now,
        entryRevisionAtLink: existing ? note.summaryLink.entryRevisionAtLink : entry.revision,
        preserveOnCancel: existing
          ? Boolean(note.summaryLink.preserveOnCancel || entry.revision !== note.summaryLink.entryRevisionAtLink) : false };
      outcome = existing ? 'reused' : 'added';
    } else {
      const remove = existing && canRemoveNoteSummary(note, existing);
      if (remove) {
        rows.entries = rows.entries.filter(item => item.id !== existing.id);
        rows.favorites = rows.favorites.filter(item => item.targetType !== 'entry' || item.targetId !== existing.id);
      }
      summaryLink = existing && !remove ? { ...note.summaryLink, active: false, preserveOnCancel: true } : null;
      entry = remove ? null : existing || null;
      outcome = existing && !remove ? 'preserved-edited' : 'removed';
    }
    const updated = { ...note, revision: note.revision + 1, updatedAt: now, summaryLink };
    rows.notes = rows.notes.map(item => item.id === note.id ? updated : item);
    return { note: updated, entry, outcome };
  }

  async function fetch(url, options = {}) {
    if (options.signal?.aborted) throw new DOMException('虚构请求已取消。', 'AbortError');
    const method = options.method || 'GET';
    const authorization = options.headers?.Authorization || '';
    const owner = tokenOwners.get(authorization.replace(/^Bearer /, ''));
    if (url === authOrigin + '/auth/v1/signin') {
      const input = JSON.parse(options.body);
      const signedOwner = input.username === 'fictional.reader.b' ? OTHER_OWNER : DEFAULT_OWNER;
      requests.push({ path: '/auth/v1/signin', method, owner: signedOwner });
      return response(200, { access_token: tokenFor(signedOwner), expires_in: 3600, token_type: 'Bearer' });
    }
    if (url === authOrigin + '/auth/v1/user/me') {
      requests.push({ path: '/auth/v1/user/me', method, owner: owner || null });
      return owner ? response(200, { sub: owner, status: 'ACTIVE', internal_user_type: 'generalUser' })
        : response(401, { error: 'invalid_token' });
    }
    const parsed = new URL(url, apiOrigin || 'https://fictional-api.invalid');
    if (parsed.origin !== (apiOrigin || 'https://fictional-api.invalid')) {
      throw new Error('虚构接口禁止转发任何外部来源。');
    }
    const path = parsed.pathname;
    requests.push({ path, method, owner: owner || null });
    if (path === '/api/health') return response(200, { ok: true, service: '【literature-and-inner-conflict】' });
    if (!owner) return failure(401, 'UNAUTHENTICATED');
    const rows = state(owner);
    const input = options.body === undefined ? null : JSON.parse(options.body);
    if (path === '/api/entries') {
      if (method === 'GET') return success(page(sortEntries(rows.entries), parsed.searchParams));
      if (method === 'POST') {
        if (rows.entries.some(item => item.entryDate === input.entryDate && item.text === input.text)) return failure(409, 'DUPLICATE_ENTRY');
        const now = stamp();
        const saved = { id: id('entry'), entryDate: input.entryDate, text: input.text, textVersion: 1,
          revision: 1, createdAt: now, updatedAt: now, adoptedAnalysis: null, origin: null };
        rows.entries.push(saved);
        return success(saved, 201);
      }
    }
    if (path === '/api/favorites') {
      if (method === 'GET') {
        const targetType = parsed.searchParams.get('targetType');
        const favorites = rows.favorites.filter(item => !targetType || item.targetType === targetType)
          .sort((left, right) => right.favoritedAt.localeCompare(left.favoritedAt));
        return success(page(favorites, parsed.searchParams));
      }
      if (method === 'PATCH') {
        if (input.targetType === 'entry' && !rows.entries.some(item => item.id === input.targetId)) return failure(404, 'ENTRY_NOT_FOUND');
        const existing = rows.favorites.find(item => item.targetType === input.targetType && item.targetId === input.targetId);
        rows.favorites = rows.favorites.filter(item => item.targetType !== input.targetType || item.targetId !== input.targetId);
        const favoritedAt = input.favorite ? existing?.favoritedAt || stamp() : null;
        if (input.favorite) rows.favorites.push({ targetType: input.targetType, targetId: input.targetId, favoritedAt });
        return success({ targetType: input.targetType, targetId: input.targetId, favorite: input.favorite, favoritedAt });
      }
    }
    const bookMatch = /^\/api\/books\/([^/]+)\/notes$/.exec(path);
    if (bookMatch) {
      const bookId = decodeURIComponent(bookMatch[1]);
      if (!getBook(bookId)) return failure(404, 'BOOK_NOT_FOUND');
      if (method === 'GET') {
        const notes = sortNoteHistory(rows.notes.filter(item => item.bookId === bookId));
        return success(page(notes, parsed.searchParams, { bookId, latestNoteId: notes[0]?.id || null }));
      }
      if (method === 'POST') {
        const current = rows.notes.filter(item => item.bookId === bookId);
        const saved = { ...createHistoryNote(bookId, input.body, id('note'), stamp()),
          saveOrder: Math.max(0, ...current.map(item => item.saveOrder)) + 1 };
        rows.notes.push(saved);
        return success(saved, 201);
      }
    }
    const noteMatch = /^\/api\/notes\/([^/]+)(\/summary)?$/.exec(path);
    if (noteMatch) {
      const noteId = decodeURIComponent(noteMatch[1]);
      const note = rows.notes.find(item => item.id === noteId);
      if (!note) return failure(404, 'NOTE_NOT_FOUND');
      if (noteMatch[2] && method === 'PATCH') {
        if (failSummary) { failSummary = false; return failure(503, 'WRITE_FAILED'); }
        const result = summary(rows, note, input.enabled, input.expectedRevision);
        return result instanceof Response ? result : success(result);
      }
      if (!noteMatch[2] && method === 'DELETE') {
        if (note.revision !== Number(parsed.searchParams.get('expectedRevision'))
          || sortNoteHistory(rows.notes.filter(item => item.bookId === note.bookId))[0]?.id !== note.id) return failure(409, 'VERSION_CONFLICT');
        rows.notes = rows.notes.filter(item => item.id !== noteId);
        return success({ deleted: true, noteId });
      }
    }
    const entryMatch = /^\/api\/entries\/([^/]+)(\/analysis)?$/.exec(path);
    if (entryMatch) {
      const entryId = decodeURIComponent(entryMatch[1]);
      const entry = rows.entries.find(item => item.id === entryId);
      if (!entry) return failure(404, 'ENTRY_NOT_FOUND');
      if (method === 'PATCH') {
        let saved;
        try {
          saved = entryMatch[2] ? adoptDemoAnalysis(entry, {
            source: 'demo', demoId: 'discussion-v1', entryId,
            baseRevision: input.expectedRevision, sourceTextVersion: input.sourceTextVersion,
            summary: input.summary, questions: input.questions,
          }, stamp()) : reviseEntry(entry, input, input.expectedRevision, stamp());
        } catch { return failure(409, 'VERSION_CONFLICT'); }
        rows.entries = rows.entries.map(item => item.id === entryId ? saved : item);
        return success(saved);
      }
      if (!entryMatch[2] && method === 'DELETE') {
        if (entry.revision !== Number(parsed.searchParams.get('expectedRevision'))) return failure(409, 'VERSION_CONFLICT');
        rows.entries = rows.entries.filter(item => item.id !== entryId);
        rows.favorites = rows.favorites.filter(item => item.targetType !== 'entry' || item.targetId !== entryId);
        return success({ deleted: true, entryId });
      }
    }
    throw new Error('虚构接口尚未实现此路径：' + method + ' ' + path);
  }

  return {
    fetch, requests,
    createSession(owner = DEFAULT_OWNER) {
      return { version: 1, authOrigin, accessToken: tokenFor(owner), expiresAt: Date.now() + 3600000 };
    },
    readEntries: (owner = DEFAULT_OWNER) => structuredClone(sortEntries(state(owner).entries)),
    readNoteHistory: (bookId, owner = DEFAULT_OWNER) => structuredClone(sortNoteHistory(
      state(owner).notes.filter(item => bookId === undefined || item.bookId === bookId))),
    readFavorites: (owner = DEFAULT_OWNER) => structuredClone(state(owner).favorites),
    failNextSummary() { failSummary = true; },
  };
}

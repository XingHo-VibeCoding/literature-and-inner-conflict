const HEALTH_SERVICE = '【literature-and-inner-conflict】';
const ENTRY_KEYS = ['id', 'entryDate', 'text', 'textVersion', 'revision', 'createdAt', 'updatedAt', 'adoptedAnalysis', 'origin'];
const REQUEST_TIMEOUT_MS = 30000;
const SERVER_ERROR_MESSAGE = '服务暂时不可用，请稍后重试。';
const INPUT_FIELD_MESSAGES = {
  entryDate: '请填写有效且不晚于今天的记录日期。',
  text: '请填写 1 至 5000 个有效字符的原文，并检查是否含有无法保存的字符。',
  expectedRevision: '记录版本无效，请重新读取后再操作。',
  body: '请填写 1 至 1000 个有效字符的感悟原文。',
  summary: '总结须为 1–300 个有效字符。',
  questions: '请填写 1–2 个反思问题，每个为 1–100 个有效字符。',
  sourceTextVersion: '分析对应的原文版本无效，请重新读取。',
  enabled: '请明确选择是否加入总结库。',
  favorite: '请明确选择收藏或取消收藏。',
  'X-Client-Time-Zone': '记录时区无效，请刷新页面后重试。',
};
const SAFE_INPUT_FIELD_MESSAGES = {
  entryDate: ['请选择记录日期。', '日期必须是有效的 YYYY-MM-DD，年份为0001到9999。', '记录日期不能晚于当前时区的今天。'],
  text: ['请填写原文。', '原文必须是文字。', '原文包含无法保存的空字符，请删除后重试。',
    '原文包含无效 Unicode 字符，请检查后重试。', '原文至少需要1个有效字符。', '原文不能超过5000个有效字符。'],
};
const RESPONSE_ERROR_CODES = {
  400: ['INVALID_INPUT'],
  401: ['UNAUTHENTICATED'],
  403: ['CORS_ORIGIN_DENIED', 'CORS_METHOD_DENIED', 'CORS_HEADERS_DENIED'],
  404: ['NOT_FOUND', 'ENTRY_NOT_FOUND', 'BOOK_NOT_FOUND', 'NOTE_NOT_FOUND'],
  405: ['METHOD_NOT_ALLOWED'],
  409: ['DUPLICATE_ENTRY', 'VERSION_CONFLICT', 'NOTE_LINK_CONFLICT'],
  413: ['PAYLOAD_TOO_LARGE'],
  415: ['UNSUPPORTED_MEDIA_TYPE'],
};

function responseErrorCode(status, code) {
  const known = status >= 500 ? ['INTERNAL_ERROR', 'WRITE_FAILED'] : RESPONSE_ERROR_CODES[status] || [];
  return known.includes(code) ? code : status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED';
}

function responseErrorMessage(status, code) {
  if (status === 401) return '登录凭证无效或已过期，请重新登录。';
  if (status === 403) return '当前请求未获允许，请核对登录状态与请求配置。';
  if (status === 400) return '请检查必填字段和输入内容。';
  if (status === 404) return code === 'ENTRY_NOT_FOUND'
    ? '记录不存在或不属于当前用户。' : '请求的内容不存在，请重新读取后重试。';
  if (status === 409) {
    if (code === 'DUPLICATE_ENTRY') return '这一天已经保存过完全相同的原文，请勿重复提交。';
    if (code === 'VERSION_CONFLICT') return '记录已发生变化，请先重新读取，再核对修改或删除。';
    if (code === 'NOTE_LINK_CONFLICT') return '记录来源与阅读感悟关联不一致，已停止删除。';
    return '数据已发生变化，请重新读取并核对后再操作。';
  }
  if (status === 405) return '此操作暂不受支持，请核对请求方式。';
  if (status === 413) return '提交内容过大，请缩短后重试。';
  if (status === 415) return '提交格式不受支持，请核对请求格式。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  return '请求未能完成，请核对输入和登录状态后重试。';
}

function safeInputFields(fields) {
  if (!isObject(fields)) return undefined;
  const safe = {};
  for (const key of Object.keys(INPUT_FIELD_MESSAGES)) {
    if (Object.hasOwn(fields, key)) safe[key] = SAFE_INPUT_FIELD_MESSAGES[key]?.includes(fields[key])
      ? fields[key] : INPUT_FIELD_MESSAGES[key];
  }
  return Object.keys(safe).length ? safe : undefined;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function apiError(message, { code, httpStatus = null, fields, requestId = null, url } = {}) {
  const error = new Error(message);
  error.name = 'PublicApiError';
  error.code = code;
  error.httpStatus = httpStatus;
  error.requestId = requestId;
  if (fields !== undefined) error.fields = fields;
  if (url !== undefined) error.url = url;
  return error;
}

function parseOrigin(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('*')) {
    throw apiError(label + '必须是完整的 HTTPS 公网域名。', { code: 'INVALID_CONFIGURATION' });
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    throw apiError(label + '格式不正确，请核对部署配置。', { code: 'INVALID_CONFIGURATION' });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.href !== parsed.origin + '/') {
    throw apiError(label + '只填写 HTTPS 域名，不附加路径、凭证、查询参数或片段。', { code: 'INVALID_CONFIGURATION' });
  }
  return parsed.origin;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isEntry(value) {
  return hasExactKeys(value, ENTRY_KEYS)
    && typeof value.id === 'string' && value.id.length > 0
    && isCalendarDate(value.entryDate)
    && typeof value.text === 'string' && value.text.trim().length > 0
    && Number.isSafeInteger(value.textVersion) && value.textVersion >= 1
    && Number.isSafeInteger(value.revision) && value.revision >= 1
    && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt)
    && (value.adoptedAnalysis === null || isObject(value.adoptedAnalysis))
    && (value.origin === null || isObject(value.origin));
}

function isEntryList(data, limit) {
  return hasExactKeys(data, ['items', 'total', 'page'])
    && Array.isArray(data.items) && data.items.length <= limit && data.items.every(isEntry)
    && Number.isSafeInteger(data.total) && data.total >= data.items.length
    && hasExactKeys(data.page, ['limit', 'nextCursor', 'hasMore'])
    && data.page.limit === limit && typeof data.page.hasMore === 'boolean'
    && (data.page.hasMore
      ? typeof data.page.nextCursor === 'string' && data.page.nextCursor.length > 0 && data.items.length > 0
      : data.page.nextCursor === null);
}

function isId(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}

function positiveInteger(value) { return Number.isSafeInteger(value) && value >= 1; }

function isText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value.trim()).length <= maximum
    && !value.includes('\u0000') && !Array.from(value).some(char => char.codePointAt(0) >= 0xd800 && char.codePointAt(0) <= 0xdfff);
}

function isSummaryLink(value) {
  return value === null || (hasExactKeys(value, ['entryId', 'active', 'linkedAt', 'entryRevisionAtLink', 'preserveOnCancel'])
    && isId(value.entryId) && typeof value.active === 'boolean' && isTimestamp(value.linkedAt)
    && positiveInteger(value.entryRevisionAtLink) && typeof value.preserveOnCancel === 'boolean');
}

function isNote(value) {
  return hasExactKeys(value, ['id', 'bookId', 'body', 'revision', 'createdAt', 'updatedAt', 'savedAt', 'saveOrder', 'summaryLink'])
    && isId(value.id) && isId(value.bookId) && isText(value.body, 1000) && positiveInteger(value.revision)
    && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt) && isTimestamp(value.savedAt)
    && positiveInteger(value.saveOrder) && isSummaryLink(value.summaryLink);
}

function isFavorite(value) {
  return hasExactKeys(value, ['targetType', 'targetId', 'favoritedAt'])
    && ['book', 'entry'].includes(value.targetType) && isId(value.targetId) && isTimestamp(value.favoritedAt);
}

function isList(data, limit, validate, extraKeys = []) {
  return hasExactKeys(data, ['items', 'total', 'page', ...extraKeys])
    && Array.isArray(data.items) && data.items.length <= limit && data.items.every(validate)
    && Number.isSafeInteger(data.total) && data.total >= data.items.length
    && hasExactKeys(data.page, ['limit', 'nextCursor', 'hasMore']) && data.page.limit === limit
    && typeof data.page.hasMore === 'boolean'
    && (data.page.hasMore ? typeof data.page.nextCursor === 'string' && data.page.nextCursor.length > 0
      && data.items.length > 0 : data.page.nextCursor === null);
}

function pagination(limit, cursor) {
  if (!positiveInteger(limit) || limit > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !cursor))) {
    throw apiError('分页参数无效，请重新读取第一页。', { code: 'INVALID_INPUT' });
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) query.set('cursor', cursor);
  return query;
}

function requireId(value, label) {
  if (!isId(value)) throw apiError(label + '无效，请重新读取后再操作。', { code: 'INVALID_INPUT' });
}

function validateDemoInput(input) {
  if (!hasExactKeys(input, ['expectedRevision', 'sourceTextVersion', 'summary', 'questions'])
    || !positiveInteger(input.expectedRevision) || !positiveInteger(input.sourceTextVersion)
    || !isText(input.summary, 300) || !Array.isArray(input.questions) || input.questions.length < 1
    || input.questions.length > 2 || !input.questions.every(question => isText(question, 100))) {
    throw apiError('演示分析内容或版本无效，请核对总结、反思问题与当前原文版本。', { code: 'INVALID_INPUT' });
  }
  return { expectedRevision: input.expectedRevision, sourceTextVersion: input.sourceTextVersion,
    summary: input.summary, questions: [...input.questions] };
}

function isDemoAnalysis(value) {
  return hasExactKeys(value, ['source', 'demoId', 'sourceTextVersion', 'summary', 'questions', 'adoptedAt'])
    && value.source === 'demo' && value.demoId === 'discussion-v1' && positiveInteger(value.sourceTextVersion)
    && isText(value.summary, 300) && Array.isArray(value.questions) && value.questions.length >= 1
    && value.questions.length <= 2 && value.questions.every(question => isText(question, 100)) && isTimestamp(value.adoptedAt);
}

function isSummaryResult(data, noteId, enabled) {
  if (!hasExactKeys(data, ['note', 'entry', 'outcome']) || !isNote(data.note) || data.note.id !== noteId
    || !['unchanged', 'reused', 'added', 'preserved-edited', 'removed'].includes(data.outcome)
    || (data.entry !== null && (!isEntry(data.entry) || data.entry.origin?.type !== 'reading-note'
      || data.entry.origin.noteId !== noteId || data.entry.origin.bookId !== data.note.bookId))) return false;
  const link = data.note.summaryLink;
  if (enabled) return ['unchanged', 'reused', 'added'].includes(data.outcome) && link?.active === true
    && data.entry !== null && data.entry.id === link.entryId;
  if (data.outcome === 'removed') return link === null && data.entry === null;
  if (data.outcome === 'preserved-edited') return link?.active === false && link.preserveOnCancel === true
    && data.entry !== null && data.entry.id === link.entryId;
  return data.outcome === 'unchanged' && !link?.active
    && (data.entry === null || data.entry.id === link?.entryId);
}

function requireToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(token)) {
    throw apiError('请先准备有效的用户登录凭证。', { code: 'UNAUTHENTICATED' });
  }
}

function validateInput(input) {
  if (!isObject(input)) {
    throw apiError('请填写记录日期与原文。', { code: 'INVALID_INPUT' });
  }
  const fields = {};
  if (!isCalendarDate(input.entryDate)) fields.entryDate = '请填写有效的记录日期。';
  if (typeof input.text !== 'string' || input.text.trim().length === 0) fields.text = '请填写原文。';
  else if (Array.from(input.text.trim()).length > 5000) fields.text = '原文最多 5000 个有效字符。';
  if (Object.keys(fields).length) {
    throw apiError('请检查记录日期与原文。', { code: 'INVALID_INPUT', fields });
  }
  // 只传契约登记字段；原始空格、换行及日期保持不变。
  return { entryDate: input.entryDate, text: input.text };
}

function validateEntryTarget(entryId, expectedRevision) {
  if (typeof entryId !== 'string' || !entryId || entryId.length > 256 || /[\u0000-\u001f\u007f]/.test(entryId)) {
    throw apiError('记录 ID 无效，请重新读取记录。', { code: 'INVALID_INPUT' });
  }
  try { encodeURIComponent(entryId); } catch {
    throw apiError('记录 ID 无效，请重新读取记录。', { code: 'INVALID_INPUT' });
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw apiError('记录版本无效，请重新读取后再操作。', { code: 'INVALID_INPUT' });
  }
}

function validatePatch(input) {
  if (!isObject(input) || Object.keys(input).some(key => !['entryDate', 'text', 'expectedRevision'].includes(key))
    || (!Object.hasOwn(input, 'entryDate') && !Object.hasOwn(input, 'text'))) {
    throw apiError('修改仅支持记录日期、原文与预期版本，至少修改一个字段。', { code: 'INVALID_INPUT' });
  }
  const candidate = validateInput({ entryDate: input.entryDate ?? '2000-01-01', text: input.text ?? '占位校验' });
  if ((Object.hasOwn(input, 'entryDate') && input.entryDate == null) || (Object.hasOwn(input, 'text') && input.text == null)) {
    throw apiError('日期与原文不能设为空值。', { code: 'INVALID_INPUT' });
  }
  return { expectedRevision: input.expectedRevision,
    ...(Object.hasOwn(input, 'entryDate') ? { entryDate: candidate.entryDate } : {}),
    ...(Object.hasOwn(input, 'text') ? { text: candidate.text } : {}) };
}

// 此服务不读写浏览器存储，不打印请求头或保存用户凭证。
export function createPublicApiClient({ apiOrigin, requestOrigin = apiOrigin, fetchImpl = globalThis.fetch }) {
  const configuredOrigin = parseOrigin(apiOrigin, '公网接口地址');
  const targetOrigin = requestOrigin === '' ? '' : parseOrigin(requestOrigin, '请求地址');
  if (typeof fetchImpl !== 'function') {
    throw apiError('当前环境无法发送网络请求。', { code: 'INVALID_CONFIGURATION' });
  }

  async function request(path, { method = 'GET', token, body, signal, expectedStatus, validate, health = false } = {}) {
    const url = targetOrigin + path;
    if (signal?.aborted) throw apiError('已取消本次请求。', { code: 'ABORTED', url });
    const controller = new AbortController();
    let timedOut = false;
    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
    const cancel = () => {
      controller.abort();
      rejectCancellation(new Error('本次请求已终止。'));
    };
    const wait = promise => Promise.race([promise, cancellation]);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; cancel(); }, REQUEST_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (token !== undefined) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Client-Time-Zone'] = 'Asia/Shanghai';
    }
    let httpStatus = null;
    let requestId = null;
    try {
      const response = await wait(fetchImpl(url, {
        method, headers, signal: controller.signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }));
      httpStatus = response.status;
      requestId = response.headers.get('x-request-id');
      // 先按 HTTP 状态识别服务故障；即使网关返回 HTML，也不当作用户输入或网络失败。
      if (httpStatus >= 500) {
        let code = 'SERVER_ERROR';
        try {
          const failure = await wait(response.json());
          code = responseErrorCode(httpStatus, failure?.error?.code);
        } catch { /* 响应正文不可读时，仍使用固定中文服务故障提示。 */ }
        throw apiError(SERVER_ERROR_MESSAGE, { code, httpStatus, requestId, url });
      }
      let payload;
      try { payload = await wait(response.json()); } catch {
        throw apiError('接口返回的内容不是有效 JSON，请核对公网路由。', {
          code: 'INVALID_RESPONSE', httpStatus, requestId, url,
        });
      }
      if (controller.signal.aborted) throw new Error('本次请求已终止。');
      if (health) {
        if (httpStatus !== expectedStatus || !hasExactKeys(payload, ['ok', 'service'])
          || payload.ok !== true || payload.service !== HEALTH_SERVICE) {
          throw apiError('健康接口没有返回约定结果，请核对服务状态与公网地址。', {
            code: 'INVALID_RESPONSE', httpStatus, requestId, url,
          });
        }
        return { data: payload, httpStatus, requestId, url };
      }
      if (!hasExactKeys(payload, ['ok', 'data', 'error']) || typeof payload.ok !== 'boolean') {
        throw apiError('接口响应格式与约定不符，未使用空列表代替失败。', {
          code: 'INVALID_RESPONSE', httpStatus, requestId, url,
        });
      }
      if (httpStatus >= 400 && payload.ok === false && payload.data === null
        && isObject(payload.error) && typeof payload.error.code === 'string' && payload.error.code
        && typeof payload.error.message === 'string' && payload.error.message
        && typeof payload.error.retryable === 'boolean'
        && (payload.error.fields === undefined || (isObject(payload.error.fields)
          && Object.values(payload.error.fields).every(value => typeof value === 'string')))) {
        // 上游 message 和 fields 可能带有英文异常或内部详情，只呈现本地固定中文。
        const code = responseErrorCode(httpStatus, payload.error.code);
        throw apiError(responseErrorMessage(httpStatus, code), {
          code, httpStatus,
          fields: httpStatus === 400 && payload.error.code === 'INVALID_INPUT' ? safeInputFields(payload.error.fields) : undefined,
          requestId, url,
        });
      }
      if (httpStatus !== expectedStatus || payload.ok !== true || payload.error !== null || !validate(payload.data)) {
        throw apiError('接口状态或数据结构与约定不符，请核对实际响应。', {
          code: 'INVALID_RESPONSE', httpStatus, requestId, url,
        });
      }
      return { data: payload.data, httpStatus, requestId, url };
    } catch (error) {
      if (signal?.aborted) throw apiError('已取消本次请求。', { code: 'ABORTED', httpStatus, requestId, url });
      if (timedOut) throw apiError('请求超过 30 秒，请检查网络后再手动重试。', {
        code: 'TIMEOUT', httpStatus, requestId, url,
      });
      if (error?.code && error.httpStatus !== undefined) throw error;
      // 网络底层异常可能包含请求细节，因此只给出固定中文提示。
      throw apiError('网络请求失败，请核对网络连接与跨域配置后再手动重试。', {
        code: 'NETWORK_ERROR', httpStatus, requestId, url,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  return {
    // 保留经核对的公开地址供界面显示；开发代理的实际请求地址由各次 url 给出。
    apiOrigin: configuredOrigin,
    getHealth({ signal } = {}) {
      return request('/api/health', { signal, expectedStatus: 200, health: true });
    },
    getEntries({ token, signal, limit = 20, cursor } = {}) {
      try {
        requireToken(token);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
          || (cursor !== undefined && (typeof cursor !== 'string' || !cursor))) {
          throw apiError('分页参数无效，请重新读取第一页。', { code: 'INVALID_INPUT' });
        }
        const query = new URLSearchParams({ limit: String(limit) });
        if (cursor !== undefined) query.set('cursor', cursor);
        return request('/api/entries?' + query, {
          token, signal, expectedStatus: 200, validate: data => isEntryList(data, limit),
        });
      } catch (error) { return Promise.reject(error); }
    },
    updateEntry({ token, entryId, input, signal } = {}) {
      try {
        requireToken(token);
        const body = validatePatch(input);
        validateEntryTarget(entryId, body.expectedRevision);
        return request('/api/entries/' + encodeURIComponent(entryId), {
          method: 'PATCH', token, body, signal, expectedStatus: 200,
          validate: data => isEntry(data) && data.id === entryId,
        });
      } catch (error) { return Promise.reject(error); }
    },
    deleteEntry({ token, entryId, expectedRevision, signal } = {}) {
      try {
        requireToken(token);
        validateEntryTarget(entryId, expectedRevision);
        const query = new URLSearchParams({ expectedRevision: String(expectedRevision) });
        return request('/api/entries/' + encodeURIComponent(entryId) + '?' + query, {
          method: 'DELETE', token, signal, expectedStatus: 200,
          validate: data => hasExactKeys(data, ['deleted', 'entryId']) && data.deleted === true && data.entryId === entryId,
        });
      } catch (error) { return Promise.reject(error); }
    },
    createEntry({ token, input, signal } = {}) {
      try {
        requireToken(token);
        const body = validateInput(input);
        return request('/api/entries', { method: 'POST', token, body, signal, expectedStatus: 201, validate: isEntry });
      } catch (error) { return Promise.reject(error); }
    },
    getFavorites({ token, signal, limit = 20, cursor, targetType } = {}) {
      try {
        requireToken(token);
        const query = pagination(limit, cursor);
        if (targetType !== undefined) {
          if (!['book', 'entry'].includes(targetType)) throw apiError('收藏类型无效。', { code: 'INVALID_INPUT' });
          query.set('targetType', targetType);
        }
        return request('/api/favorites?' + query, { token, signal, expectedStatus: 200,
          validate: data => isList(data, limit, item => isFavorite(item) && (targetType === undefined || item.targetType === targetType)) });
      } catch (error) { return Promise.reject(error); }
    },
    getBookNotes({ token, bookId, signal, limit = 20, cursor } = {}) {
      try {
        requireToken(token);
        requireId(bookId, '作品 ID');
        const query = pagination(limit, cursor);
        return request('/api/books/' + encodeURIComponent(bookId) + '/notes?' + query, {
          token, signal, expectedStatus: 200,
          validate: data => isList(data, limit, item => isNote(item) && item.bookId === bookId, ['bookId', 'latestNoteId'])
            && data.bookId === bookId && (data.total === 0 ? data.latestNoteId === null : isId(data.latestNoteId)),
        });
      } catch (error) { return Promise.reject(error); }
    },
    createNote({ token, bookId, body, signal } = {}) {
      try {
        requireToken(token);
        requireId(bookId, '作品 ID');
        if (!isText(body, 1000)) throw apiError('请填写 1 至 1000 个有效字符的感悟原文。', { code: 'INVALID_INPUT' });
        return request('/api/books/' + encodeURIComponent(bookId) + '/notes', {
          method: 'POST', token, body: { body }, signal, expectedStatus: 201,
          validate: data => isNote(data) && data.bookId === bookId && data.body === body,
        });
      } catch (error) { return Promise.reject(error); }
    },
    deleteNote({ token, noteId, expectedRevision, signal } = {}) {
      try {
        requireToken(token);
        requireId(noteId, '感悟 ID');
        if (!positiveInteger(expectedRevision)) throw apiError('感悟版本无效，请重新读取。', { code: 'INVALID_INPUT' });
        const query = new URLSearchParams({ expectedRevision: String(expectedRevision) });
        return request('/api/notes/' + encodeURIComponent(noteId) + '?' + query, {
          method: 'DELETE', token, signal, expectedStatus: 200,
          validate: data => hasExactKeys(data, ['deleted', 'noteId']) && data.deleted === true && data.noteId === noteId,
        });
      } catch (error) { return Promise.reject(error); }
    },
    setNoteInSummary({ token, noteId, enabled, expectedRevision, signal } = {}) {
      try {
        requireToken(token);
        requireId(noteId, '感悟 ID');
        if (typeof enabled !== 'boolean' || !positiveInteger(expectedRevision)) {
          throw apiError('加入总结库的选择或感悟版本无效，请重新读取。', { code: 'INVALID_INPUT' });
        }
        return request('/api/notes/' + encodeURIComponent(noteId) + '/summary', {
          method: 'PATCH', token, body: { enabled, expectedRevision }, signal, expectedStatus: 200,
          validate: data => isSummaryResult(data, noteId, enabled),
        });
      } catch (error) { return Promise.reject(error); }
    },
    setFavorite({ token, targetType, targetId, favorite, signal } = {}) {
      try {
        requireToken(token);
        requireId(targetId, '收藏目标 ID');
        if (!['book', 'entry'].includes(targetType) || typeof favorite !== 'boolean') {
          throw apiError('收藏类型或收藏选择无效。', { code: 'INVALID_INPUT' });
        }
        return request('/api/favorites', { method: 'PATCH', token, body: { targetType, targetId, favorite },
          signal, expectedStatus: 200, validate: data => hasExactKeys(data, ['targetType', 'targetId', 'favorite', 'favoritedAt'])
            && data.targetType === targetType && data.targetId === targetId && data.favorite === favorite
            && (favorite ? isTimestamp(data.favoritedAt) : data.favoritedAt === null) });
      } catch (error) { return Promise.reject(error); }
    },
    saveAdoptedDemo({ token, entryId, input, signal } = {}) {
      try {
        requireToken(token);
        requireId(entryId, '记录 ID');
        const body = validateDemoInput(input);
        return request('/api/entries/' + encodeURIComponent(entryId) + '/analysis', {
          method: 'PATCH', token, body, signal, expectedStatus: 200,
          validate: data => isEntry(data) && data.id === entryId && data.revision === body.expectedRevision + 1
            && data.textVersion === body.sourceTextVersion && isDemoAnalysis(data.adoptedAnalysis)
            && data.adoptedAnalysis.sourceTextVersion === body.sourceTextVersion && data.adoptedAnalysis.summary === body.summary
            && JSON.stringify(data.adoptedAnalysis.questions) === JSON.stringify(body.questions),
        });
      } catch (error) { return Promise.reject(error); }
    },
  };
}

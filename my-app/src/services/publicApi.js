const HEALTH_SERVICE = '【literature-and-inner-conflict】';
const ENTRY_KEYS = ['id', 'entryDate', 'text', 'textVersion', 'revision', 'createdAt', 'updatedAt', 'adoptedAnalysis', 'origin'];
const REQUEST_TIMEOUT_MS = 30000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function apiError(message, { code, httpStatus = null, fields, requestId = null, url } = {}) {
  const error = new Error(message);
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

function requireToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8192 || /\s/.test(token)) {
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
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (token !== undefined) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Client-Time-Zone'] = 'Asia/Shanghai';
    }
    let httpStatus = null;
    let requestId = null;
    try {
      const response = await fetchImpl(url, {
        method, headers, signal: controller.signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      httpStatus = response.status;
      requestId = response.headers.get('x-request-id');
      let payload;
      try { payload = await response.json(); } catch {
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
        throw apiError(payload.error.message, {
          code: payload.error.code, httpStatus, fields: payload.error.fields, requestId, url,
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
    createEntry({ token, input, signal } = {}) {
      try {
        requireToken(token);
        const body = validateInput(input);
        return request('/api/entries', { method: 'POST', token, body, signal, expectedStatus: 201, validate: isEntry });
      } catch (error) { return Promise.reject(error); }
    },
  };
}
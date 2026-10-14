// Day 19：只调用既有接口；令牌仅来自当前进程，不读取 .env、不输出凭证。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://ritchie-d5gd1dg1yd29783e8-1502569246.ap-shanghai.app.tcloudbase.com';
const BASELINE_PATH = new URL('./_logs/day19-cloud-baseline.json', import.meta.url);
const FIXTURE = {
  entryDate: '2026-10-14',
  text: '  【虚构·Day19分层回归】今天只用虚构记录核对接口重构。\n保留原始空格与换行。  ',
};
const ENTRY_KEYS = ['id', 'entryDate', 'text', 'textVersion', 'revision', 'createdAt', 'updatedAt', 'adoptedAnalysis', 'origin'];
const NOTE_KEYS = ['id', 'bookId', 'body', 'revision', 'createdAt', 'updatedAt', 'savedAt', 'saveOrder', 'summaryLink'];
const MODES = new Set(['baseline', 'compare', 'write']);

class VerificationError extends Error {}
function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function keysExactly(value, keys, message) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), message);
  check(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), message);
}
function same(actual, expected, message) {
  try { assert.deepEqual(actual, expected); } catch { throw new VerificationError(message); }
}
function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, '时间必须是 UTC ISO 8601 字符串。');
}
function entry(value) {
  keysExactly(value, ENTRY_KEYS, '日精进必须保持原来的九个字段。');
  check(typeof value.id === 'string' && value.id.length > 0 && typeof value.text === 'string', '日精进 ID 或原文字段异常。');
  check(typeof value.entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.entryDate)
    && Number.isFinite(Date.parse(value.entryDate + 'T00:00:00.000Z'))
    && new Date(value.entryDate + 'T00:00:00.000Z').toISOString().slice(0, 10) === value.entryDate, '日精进日期异常。');
  for (const key of ['textVersion', 'revision']) check(Number.isSafeInteger(value[key]) && value[key] >= 1, '日精进版本异常。');
  timestamp(value.createdAt); timestamp(value.updatedAt);
  for (const key of ['adoptedAnalysis', 'origin']) {
    check(value[key] === null || (typeof value[key] === 'object' && !Array.isArray(value[key])), '日精进来源或分析字段异常。');
  }
}
function note(value) {
  keysExactly(value, NOTE_KEYS, '感悟必须保持原来的九个字段。');
  check(typeof value.id === 'string' && value.id.length > 0 && value.bookId === 'walden'
    && typeof value.body === 'string', '感悟 ID、作品或原文字段异常。');
  for (const key of ['revision', 'saveOrder']) check(Number.isSafeInteger(value[key]) && value[key] >= 1, '感悟版本或顺序异常。');
  timestamp(value.createdAt); timestamp(value.updatedAt); timestamp(value.savedAt);
  if (value.summaryLink !== null) {
    keysExactly(value.summaryLink, ['entryId', 'active', 'linkedAt', 'entryRevisionAtLink', 'preserveOnCancel'], '感悟关联字段异常。');
    check(typeof value.summaryLink.entryId === 'string' && value.summaryLink.entryId.length > 0
      && typeof value.summaryLink.active === 'boolean' && typeof value.summaryLink.preserveOnCancel === 'boolean'
      && Number.isSafeInteger(value.summaryLink.entryRevisionAtLink) && value.summaryLink.entryRevisionAtLink >= 1, '感悟关联值异常。');
    timestamp(value.summaryLink.linkedAt);
  }
}
function favorite(value) {
  keysExactly(value, ['targetType', 'targetId', 'favoritedAt'], '收藏必须保持原来的三个字段。');
  check(['book', 'entry'].includes(value.targetType) && typeof value.targetId === 'string' && value.targetId.length > 0, '收藏关联异常。');
  timestamp(value.favoritedAt);
}
function list(data, kind, limit) {
  keysExactly(data, kind === 'notes' ? ['bookId', 'latestNoteId', 'items', 'total', 'page'] : ['items', 'total', 'page'], '列表响应字段异常。');
  check(Array.isArray(data.items) && Number.isSafeInteger(data.total) && data.total >= data.items.length, '列表条数或总数异常。');
  keysExactly(data.page, ['limit', 'nextCursor', 'hasMore'], '分页字段异常。');
  check(data.page.limit === limit && data.items.length <= limit && typeof data.page.hasMore === 'boolean', '分页条数或状态异常。');
  check(data.page.hasMore ? typeof data.page.nextCursor === 'string' && data.page.nextCursor.length > 0 && data.items.length > 0
    : data.page.nextCursor === null, '下一页游标和分页状态不一致。');
  if (kind === 'notes') {
    check(data.bookId === 'walden' && (data.latestNoteId === null || typeof data.latestNoteId === 'string'), '感悟作品或最新 ID 异常。');
    check(data.total === 0 ? data.latestNoteId === null : typeof data.latestNoteId === 'string' && data.latestNoteId.length > 0, '最新感悟 ID 与总数不一致。');
  }
  data.items.forEach(kind === 'entries' ? entry : kind === 'notes' ? note : favorite);
}
function envelope(body, ok, code) {
  keysExactly(body, ['ok', 'data', 'error'], '业务响应顶层必须恰好是 ok、data、error。');
  check(body.ok === ok, '业务成功标记与 HTTP 状态不一致。');
  if (ok) check(body.error === null, '成功响应的 error 必须为空。');
  else {
    check(body.data === null, '失败响应的 data 必须为空。');
    keysExactly(body.error, ['code', 'message', 'retryable', ...(Object.hasOwn(body.error || {}, 'fields') ? ['fields'] : [])], '错误响应字段异常。');
    check(body.error.code === code && typeof body.error.message === 'string' && /[\u3400-\u9fff]/.test(body.error.message)
      && typeof body.error.retryable === 'boolean', '错误码、中文提示或重试标记异常。');
    if (Object.hasOwn(body.error, 'fields')) check(body.error.fields !== null && typeof body.error.fields === 'object'
      && !Array.isArray(body.error.fields) && Object.values(body.error.fields).every(value => typeof value === 'string'), '中文字段提示异常。');
  }
}

// 可从测试中导入；直接运行时只接受三个固定模式。
export async function runVerification(mode) {
  check(MODES.has(mode), '请选择 baseline、compare 或 write。');
  const token = process.env.DAY19_ACCESS_TOKEN;
  check(typeof token === 'string' && token.length > 0 && token.length <= 8192 && !/\s/.test(token),
    '请在本机当前进程准备 DAY19_ACCESS_TOKEN；不要把令牌发到聊天或写进文件。');
  const records = [];
  let baseline = null;
  let current = '开始前检查';
  const writeRunId = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
  let writeProgressSequence = 0;
  let progressReady = false;
  let progressFailed = false;
  const writeReceipts = [];

  // 每个阶段都新建独立文件，不覆盖旧证据；只保存安全的 POST 响应，不保存请求头或凭证。
  async function saveWriteProgress(stage) {
    const name = 'day19-cloud-write-' + writeRunId + '-' + String(++writeProgressSequence).padStart(2, '0') + '.json';
    try {
      await mkdir(new URL('./_logs/', import.meta.url), { recursive: true });
      await writeFile(new URL('./_logs/' + name, import.meta.url),
        JSON.stringify({ version: 1, origin: ORIGIN, savedAt: new Date().toISOString(), stage, postResponses: writeReceipts }, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx' });
      progressReady = true;
    } catch {
      progressFailed = true;
      throw new VerificationError('本地写入阶段证据无法保存；已停止后续请求，不会覆盖旧证据。');
    }
    console.log('本地写入证据：_logs/' + name + '；阶段：' + stage);
  }

  async function call(name, path, expectedStatus, { method = 'GET', body, rawBody, auth = true, invalidToken = false, code, kind, allow, limit = 20 } = {}) {
    current = name;
    const url = new URL(path, ORIGIN);
    check(url.origin === ORIGIN, '验证只能访问当前项目的固定公网域名。');
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + (invalidToken ? 'day19-fixed-invalid-user-token' : token);
    if (body !== undefined || rawBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Client-Time-Zone'] = 'Asia/Shanghai';
    }
    let response;
    try {
      response = await fetch(url.href, {
        method, headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        ...(body !== undefined ? { body: JSON.stringify(body) } : rawBody !== undefined ? { body: rawBody } : {}),
      });
    } catch { throw new VerificationError('网络请求失败或超时；没有自动重试。'); }
    let payload;
    try { payload = await response.json(); } catch { throw new VerificationError('实际响应不是有效 JSON；没有自动重试。'); }
    check(!JSON.stringify(payload).includes(token), '响应意外包含凭证，已停止且不会输出或保存响应。');
    const requestId = response.headers.get('x-request-id');
    const safeId = requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId);
    console.log(name + '：' + method + ' ' + path + '，HTTP ' + response.status);
    console.log('X-Request-Id：' + (safeId ? requestId : requestId ? '格式异常，未显示原值' : '响应头未提供'));
    console.log(JSON.stringify(payload, null, 2));
    const presence = {
      contentType: response.headers.has('content-type'),
      cacheControl: response.headers.has('cache-control'),
      requestId: response.headers.has('x-request-id'),
      contentTypeOptions: response.headers.has('x-content-type-options'),
      allow: response.headers.has('allow'),
      wwwAuthenticate: response.headers.has('www-authenticate'),
    };
    if (mode === 'write' && method === 'POST') {
      writeReceipts.push({ name, method, path, status: response.status, body: payload, headers: presence });
      await saveWriteProgress(response.status === 201
        ? '已取得正常 POST HTTP201；当前响应与后续验证尚未全部通过'
        : '已取得后续 POST 响应；完整回归尚未全部通过');
    }
    check(response.status === expectedStatus, '实际 HTTP 状态与本项预期不一致；已停止后续请求。');
    check(/application\/json/i.test(response.headers.get('content-type') || ''), '响应缺少 JSON 类型头。');
    check(/(?:^|,|\s)no-store(?:$|,|\s)/i.test(response.headers.get('cache-control') || ''), '响应缺少 no-store 缓存头。');
    if (path.split('?')[0] === '/api/health') {
      same(payload, expectedStatus === 200
        ? { ok: true, service: '【literature-and-inner-conflict】' }
        : { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 GET 请求。' } }, 'health 响应形状或内容变化。');
    } else {
      check(safeId, '业务响应缺少有效关联 ID。');
      check(response.headers.get('x-content-type-options') === 'nosniff', '业务响应缺少 nosniff 头。');
      envelope(payload, expectedStatus < 400, code);
      if (expectedStatus === 401) check(response.headers.get('www-authenticate') === 'Bearer', '401 响应缺少 Bearer 身份提示。');
      if (kind) list(payload.data, kind, limit);
    }
    if (allow) check(response.headers.get('allow') === allow, 'Allow 响应头与既有方法契约不一致。');
    const record = { name, method, path, status: response.status, body: payload, headers: presence };
    if (mode === 'compare') same(record, baseline.records[records.length], '本项 HTTP、完整 JSON 或关键响应头存在性与基线不同。');
    records.push(record);
    console.log('本项验证通过。');
    return payload;
  }

  async function pagination(name, path, kind) {
    const first = await call(name + '第一页', path + '?limit=1', 200, { kind, limit: 1 });
    if (!first.data.page.hasMore) {
      console.log(name + '当前只有一页，未调用不存在的第二页。');
      return;
    }
    const second = await call(name + '第二页', path + '?limit=1&cursor=' + encodeURIComponent(first.data.page.nextCursor), 200, { kind, limit: 1 });
    check(first.data.total === second.data.total, '分页前后总数变化，基线不是同一组稳定数据。');
    const identity = item => kind === 'favorites' ? JSON.stringify([item.targetType, item.targetId]) : item.id;
    check(!second.data.items.some(item => first.data.items.some(previous => identity(previous) === identity(item))), '两页包含重复条目。');
    if (kind === 'notes') same(first.data.latestNoteId, second.data.latestNoteId, '感悟第二页的全量最新 ID 变化。');
  }

  // 写入前后遍历全部已有页，避免只在第一页找虚构记录；不修改任何旧数据。
  async function allPages(name, path, kind) {
    const items = [];
    let cursor = null, total = null, latestNoteId = null;
    const seenCursors = new Set();
    const seenItems = new Set();
    do {
      const result = await call(name + '第' + (seenCursors.size + 1) + '页', path + '?limit=100'
        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 200, { kind, limit: 100 });
      if (total === null) { total = result.data.total; latestNoteId = result.data.latestNoteId ?? null; }
      else {
        check(total === result.data.total, '逐页读取期间总数变化，请先停止并核对稳定数据。');
        if (kind === 'notes') same(result.data.latestNoteId, latestNoteId, '逐页读取期间最新感悟 ID 变化。');
      }
      for (const item of result.data.items) {
        const id = kind === 'favorites' ? JSON.stringify([item.targetType, item.targetId]) : item.id;
        check(!seenItems.has(id), '逐页读取出现重复条目。');
        seenItems.add(id); items.push(item);
      }
      cursor = result.data.page.nextCursor;
      if (cursor !== null) {
        check(!seenCursors.has(cursor), '服务端重复返回同一个游标，已停止。');
        seenCursors.add(cursor);
        check(seenCursors.size <= total, '分页游标数量超过数据总数，已停止。');
      }
    } while (cursor !== null);
    check(items.length === total, '完整分页条数与 total 不一致。');
    return kind === 'notes' ? { items, total, latestNoteId } : { items, total };
  }

  try {
    if (mode === 'write') {
      const beforeEntries = await allPages('写入前日精进', '/api/entries', 'entries');
      check(!beforeEntries.items.some(item => item.entryDate === FIXTURE.entryDate && item.text === FIXTURE.text),
        '固定 Day19 虚构原文已经存在；停止正常写入，不删除旧记录，也不把 409 当作 201。');
      const beforeFavorites = await allPages('写入前收藏', '/api/favorites', 'favorites');
      const beforeNotes = await allPages('写入前感悟', '/api/books/walden/notes', 'notes');
      await saveWriteProgress('虚构原文不存在，已核对写入前列表；尚未发送正常 POST');
      const created = await call('正常写入虚构样例', '/api/entries', 201, { method: 'POST', body: FIXTURE });
      entry(created.data);
      same(created.data.entryDate, FIXTURE.entryDate, '写入后原日期变化。');
      same(created.data.text, FIXTURE.text, '写入后原始空格或换行变化。');
      same([created.data.textVersion, created.data.revision, created.data.adoptedAnalysis, created.data.origin], [1, 1, null, null], '新记录版本、分析或来源变化。');
      const duplicate = await call('相同原文重复写入', '/api/entries', 409, { method: 'POST', body: FIXTURE, code: 'DUPLICATE_ENTRY' });
      same(duplicate.error, { code: 'DUPLICATE_ENTRY', message: '这一天已经保存过完全相同的原文，请勿重复提交。', retryable: false }, '重复原文错误行为变化。');
      const missing = await call('缺少原文', '/api/entries', 400, { method: 'POST', body: { entryDate: FIXTURE.entryDate }, code: 'INVALID_INPUT' });
      same(missing.error, { code: 'INVALID_INPUT', message: '请检查必填字段和输入内容。', retryable: false, fields: { text: '请填写原文。' } }, '缺字段中文提示变化。');
      const afterEntries = await allPages('写入后日精进', '/api/entries', 'entries');
      const matches = afterEntries.items.filter(item => item.entryDate === FIXTURE.entryDate && item.text === FIXTURE.text);
      check(matches.length === 1 && afterEntries.total === beforeEntries.total + 1, '写入后应只新增一条固定虚构记录。');
      same(matches[0], created.data, 'POST 与 GET 的九字段记录不一致。');
      same(afterEntries.items.filter(item => item.id !== created.data.id), beforeEntries.items, '既有日精进被意外改变。');
      const afterFavorites = await allPages('写入后收藏', '/api/favorites', 'favorites');
      const afterNotes = await allPages('写入后感悟', '/api/books/walden/notes', 'notes');
      same(afterFavorites, beforeFavorites, '写入前后收藏发生变化。');
      same(afterNotes, beforeNotes, '写入前后感悟发生变化。');
      await saveWriteProgress('写入回归全部通过：201、409、400、GET 九字段一致，旧记录、收藏和感悟保留');
      console.log('写入回归通过：HTTP 201、409、400，GET 九字段一致，旧记录、收藏和感悟保留。');
      return;
    }

    if (mode === 'compare') {
      current = '读取本地基线';
      try { baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')); } catch {
        throw new VerificationError('未找到有效本地基线，请先在重构部署前运行 baseline。');
      }
      keysExactly(baseline, ['version', 'origin', 'savedAt', 'records'], '基线文件结构异常。');
      check(baseline.version === 1 && baseline.origin === ORIGIN && Array.isArray(baseline.records) && baseline.records.length > 0, '基线版本或项目不匹配。');
      console.log('将用当前令牌代表的同一测试用户逐项核对基线；请求编号只核对存在性。');
    }

    await call('健康检查', '/api/health', 200, { auth: false });
    await call('健康检查错误方法', '/api/health', 405, { method: 'POST', auth: false, allow: 'GET' });
    await call('日精进默认列表', '/api/entries', 200, { kind: 'entries' });
    await call('作品感悟默认列表', '/api/books/walden/notes', 200, { kind: 'notes' });
    await call('收藏默认列表', '/api/favorites', 200, { kind: 'favorites' });
    await call('仅作品收藏', '/api/favorites?targetType=book&limit=100', 200, { kind: 'favorites', limit: 100 });
    await call('仅日精进收藏', '/api/favorites?targetType=entry&limit=100', 200, { kind: 'favorites', limit: 100 });
    await pagination('日精进分页', '/api/entries', 'entries');
    await pagination('感悟分页', '/api/books/walden/notes', 'notes');
    await pagination('收藏分页', '/api/favorites', 'favorites');
    await call('无用户身份', '/api/entries', 401, { auth: false, code: 'UNAUTHENTICATED' });
    await call('新增没有用户身份', '/api/entries', 401, { method: 'POST', body: {}, auth: false, code: 'UNAUTHENTICATED' });
    await call('无效用户身份', '/api/favorites', 401, { invalidToken: true, code: 'UNAUTHENTICATED' });
    await call('无效条数', '/api/entries?limit=0', 400, { code: 'INVALID_INPUT' });
    await call('未登记查询参数', '/api/entries?ownerId=day19-fictional-owner', 400, { code: 'INVALID_INPUT' });
    await call('重复查询参数', '/api/entries?limit=1&limit=2', 400, { code: 'INVALID_INPUT' });
    await call('空分页游标', '/api/entries?cursor=', 400, { code: 'INVALID_INPUT' });
    await call('无效收藏类型', '/api/favorites?targetType=day19-invalid', 400, { code: 'INVALID_INPUT' });
    await call('不存在的作品', '/api/books/day19-not-a-published-book/notes', 404, { code: 'BOOK_NOT_FOUND' });
    await call('未登记路径', '/api/books/walden/day19-unknown', 404, { code: 'NOT_FOUND' });
    await call('日精进错误方法', '/api/entries', 405, { method: 'PATCH', code: 'METHOD_NOT_ALLOWED', allow: 'GET, POST' });
    await call('收藏错误方法', '/api/favorites', 405, { method: 'POST', code: 'METHOD_NOT_ALLOWED', allow: 'GET' });
    await call('感悟错误方法', '/api/books/walden/notes', 405, { method: 'POST', code: 'METHOD_NOT_ALLOWED', allow: 'GET' });
    await call('新增不接受查询参数', '/api/entries?day19=1', 400, { method: 'POST', body: {}, code: 'INVALID_INPUT' });
    const missing = await call('新增缺少原文', '/api/entries', 400, { method: 'POST', body: { entryDate: FIXTURE.entryDate }, code: 'INVALID_INPUT' });
    same(missing.error, { code: 'INVALID_INPUT', message: '请检查必填字段和输入内容。', retryable: false, fields: { text: '请填写原文。' } }, '缺字段中文提示变化。');
    await call('新增无效 JSON', '/api/entries', 400, { method: 'POST', rawBody: '{', code: 'INVALID_INPUT' });

    if (mode === 'baseline') {
      current = '保存本地基线';
      await mkdir(new URL('./_logs/', import.meta.url), { recursive: true });
      await writeFile(BASELINE_PATH, JSON.stringify({ version: 1, origin: ORIGIN, savedAt: new Date().toISOString(), records }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
        .catch(() => { throw new VerificationError('未保存基线：已有文件不会覆盖；请先人工核对已有基线或目录写入权限。'); });
      console.log('基线验证通过，共 ' + records.length + ' 项；已保存到本地 _logs/day19-cloud-baseline.json，未保存凭证或具体请求编号。');
    } else {
      current = '严格核对部署前后';
      same(records, baseline.records, '实际 HTTP、完整 JSON 或关键响应头存在性与基线不同；已停止，不伪装成回归通过。');
      console.log('部署前后严格回归通过，共 ' + records.length + ' 项；响应形状、值、状态和关键头存在性一致。');
    }
  } catch (error) {
    if (mode === 'write' && progressReady && !progressFailed) {
      try {
        await saveWriteProgress('回归在「' + current + '」停止；已取得的 POST 响应保留，完整回归未通过');
      } catch {
        console.log('未能补充停止阶段；此前独立证据文件没有被覆盖，请核对已有文件和终端输出。');
      }
    }
    // 不输出原异常、堆栈、请求对象或断言差异，避免凭证与内部配置泄露。
    if (error instanceof VerificationError) throw new VerificationError('在「' + current + '」停止：' + error.message);
    throw new VerificationError('在「' + current + '」未完成，请核对网络、凭证、部署或本地权限；未自动重试。');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVerification(process.argv[2]).catch(error => {
    console.error(error instanceof VerificationError ? error.message : '本次回归未完成；没有自动重试。');
    process.exitCode = 1;
  });
}

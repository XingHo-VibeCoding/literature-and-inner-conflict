const { randomUUID } = require('node:crypto');
const { createAccountWriter } = require('./accountWriter');
const { ApiError, entry } = require('./service');
const { INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, DELETE_ENTRY_SQL, createEntriesRepository } = require('./entriesRepository');

function invalid(message, fields) {
  const error = new ApiError(400, 'INVALID_INPUT', message);
  if (fields) error.fields = fields;
  return error;
}

function todayInZone(timeZone, now) {
  const zone = timeZone === undefined ? 'Asia/Shanghai' : timeZone;
  if (typeof zone !== 'string' || !zone || zone.length > 128 || /^[+-]/.test(zone)) {
    throw invalid('客户端时区无效，请使用有效的 IANA 时区。', {
      'X-Client-Time-Zone': '例如 Asia/Shanghai；省略时默认使用上海时区。',
    });
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    throw invalid('客户端时区无效，请使用有效的 IANA 时区。', {
      'X-Client-Time-Zone': '例如 Asia/Shanghai；省略时默认使用上海时区。',
    });
  }
  const current = new Date(now());
  if (!Number.isFinite(current.getTime())) {
    throw new ApiError(500, 'WRITE_FAILED', '服务端日期配置异常，请联系维护者。');
  }
  const parts = Object.fromEntries(formatter.formatToParts(current)
    .filter(({ type }) => ['year', 'month', 'day'].includes(type))
    .map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value.slice(0, 4) === '0000') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateFields(body, timeZone, now, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('请求体必须是 JSON 对象。');
  }
  const allowed = partial ? ['entryDate', 'text', 'expectedRevision'] : ['entryDate', 'text'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw invalid(partial ? '修改只能填写 entryDate、text 和 expectedRevision。'
      : '请求包含未登记字段，只能填写 entryDate 和 text。');
  }
  const hasDate = Object.prototype.hasOwnProperty.call(body, 'entryDate');
  const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
  if (partial && !hasDate && !hasText) throw invalid('至少需要修改日期或原文中的一项。');
  const today = todayInZone(timeZone, now);
  const fields = {};
  if (!partial || hasDate) {
    if (!hasDate) fields.entryDate = '请选择记录日期。';
    else if (!validDate(body.entryDate)) fields.entryDate = '日期必须是有效的 YYYY-MM-DD，年份为0001到9999。';
    else if (body.entryDate > today) fields.entryDate = '记录日期不能晚于当前时区的今天。';
  }
  if (!partial || hasText) {
    if (!hasText) fields.text = '请填写原文。';
    else if (typeof body.text !== 'string') fields.text = '原文必须是文字。';
    else if (body.text.includes('\u0000')) fields.text = '原文包含无法保存的空字符，请删除后重试。';
    else if (Array.from(body.text).some((character) => {
      const code = character.codePointAt(0);
      return code >= 0xd800 && code <= 0xdfff;
    })) fields.text = '原文包含无效 Unicode 字符，请检查后重试。';
    else {
      const length = Array.from(body.text.trim()).length;
      if (length < 1) fields.text = '原文至少需要1个有效字符。';
      else if (length > 5000) fields.text = '原文不能超过5000个有效字符。';
    }
  }
  if (partial && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)) {
    fields.expectedRevision = 'expectedRevision 必须是大于或等于1的整数，请先读取记录版本。';
  }
  if (Object.keys(fields).length) throw invalid('请检查必填字段和输入内容。', fields);
}

function createWriter({ query, now = () => new Date(), books = new Map() }) {
  const entriesRepository = createEntriesRepository({ query });
  const writeAccount = createAccountWriter({ query, now, books });
  return async function write({ ownerId, body, timeZone, operation = 'POST', entryId, expectedRevision, kind, bookId, noteId }) {
    if (['notes', 'note', 'noteSummary', 'favorites', 'entryAnalysis'].includes(kind)) {
      return writeAccount({ ownerId, body, operation, entryId, expectedRevision, kind, bookId, noteId });
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(operation)) throw invalid('写入操作无效。');
    if (operation !== 'DELETE') validateFields(body, timeZone, now, operation === 'PATCH');
    if (typeof ownerId !== 'string' || !ownerId.trim()) {
      throw new ApiError(500, 'WRITE_FAILED', '写入身份配置异常，请联系维护者。');
    }
    if (operation !== 'POST' && (typeof entryId !== 'string' || !entryId.trim()
      || entryId.length > 512 || /[\/\u0000-\u001f\u007f]/.test(entryId))) {
      throw invalid('记录 ID 格式无效。');
    }
    if (operation === 'DELETE' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw invalid('expectedRevision 必须是大于或等于1的整数，请先读取记录版本。', {
        expectedRevision: '删除必须携带当前记录版本。',
      });
    }
    // 原文逐字保留；每次创建独立 ID，删除后同文重建不会复用旧页面的目标。
    const id = operation === 'POST' ? `entry-${randomUUID()}` : undefined;
    let result;
    try {
      if (operation === 'PATCH') {
        result = await entriesRepository.patch({ ownerId, entryId, expectedRevision: body.expectedRevision, body });
      } else if (operation === 'DELETE') {
        result = await entriesRepository.remove({ ownerId, entryId, expectedRevision });
      } else result = await entriesRepository.insert({ id, ownerId, entryDate: body.entryDate, text: body.text });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'WRITE_FAILED'
          || (error.status === 409 && error.code === 'DUPLICATE_ENTRY')) throw error;
        throw new ApiError(500, 'WRITE_FAILED', error.message, error.retryable);
      }
      throw new ApiError(500, 'WRITE_FAILED', '写入失败，请稍后重试。', true);
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
      throw new ApiError(500, 'WRITE_FAILED', '数据库写入返回格式异常，请联系维护者。');
    }
    if (operation === 'POST') {
      if (result.rows.length === 0) {
        throw new ApiError(409, 'DUPLICATE_ENTRY', '这一天已经保存过完全相同的原文，请勿重复提交。');
      }
      try { return entry(result.rows[0]); } catch {
        throw new ApiError(500, 'WRITE_FAILED', '数据库写入返回字段异常，请联系维护者。');
      }
    }
    const outcome = result.rows[0]?.outcome;
    if (outcome === 'duplicate') throw new ApiError(409, 'DUPLICATE_ENTRY', '这一天已经保存过完全相同的原文，请勿重复提交。');
    if (outcome === 'not_found') throw new ApiError(404, 'ENTRY_NOT_FOUND', '记录不存在或不属于当前用户。');
    if (outcome === 'version_conflict') throw new ApiError(409, 'VERSION_CONFLICT', '记录已发生变化，请先重新读取，再核对修改或删除。');
    if (outcome === 'link_conflict') throw new ApiError(409, 'NOTE_LINK_CONFLICT', '记录来源与阅读感悟关联不一致，已停止删除。');
    if (operation === 'DELETE' && outcome === 'deleted') return { deleted: true, entryId };
    if (operation === 'PATCH' && outcome === 'updated') {
      try { return entry(result.rows[0].record); } catch {}
    }
    throw new ApiError(500, 'WRITE_FAILED', '数据库写入返回字段异常，请联系维护者。');
  };
}

module.exports = { INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, DELETE_ENTRY_SQL, createWriter };

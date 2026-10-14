const { createHash } = require('node:crypto');
const { ApiError, entry } = require('./service');
const { INSERT_ENTRY_SQL, createEntriesRepository } = require('./entriesRepository');

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

function createWriter({ query, now = () => new Date() }) {
  const entriesRepository = createEntriesRepository({ query });
  return async function write({ ownerId, body, timeZone }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw invalid('请求体必须是 JSON 对象。');
    }
    if (Object.keys(body).some((key) => !['entryDate', 'text'].includes(key))) {
      throw invalid('请求包含未登记字段，只能填写 entryDate 和 text。');
    }
    const today = todayInZone(timeZone, now);
    const fields = {};
    if (!Object.prototype.hasOwnProperty.call(body, 'entryDate')) {
      fields.entryDate = '请选择记录日期。';
    } else if (!validDate(body.entryDate)) {
      fields.entryDate = '日期必须是有效的 YYYY-MM-DD，年份为0001到9999。';
    } else if (body.entryDate > today) {
      fields.entryDate = '记录日期不能晚于当前时区的今天。';
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'text')) {
      fields.text = '请填写原文。';
    } else if (typeof body.text !== 'string') {
      fields.text = '原文必须是文字。';
    } else if (body.text.includes('\u0000')) {
      fields.text = '原文包含无法保存的空字符，请删除后重试。';
    } else if (Array.from(body.text).some((character) => {
      const code = character.codePointAt(0);
      return code >= 0xd800 && code <= 0xdfff;
    })) {
      fields.text = '原文包含无效 Unicode 字符，请检查后重试。';
    } else {
      const length = Array.from(body.text.trim()).length;
      if (length < 1) fields.text = '原文至少需要1个有效字符。';
      else if (length > 5000) fields.text = '原文不能超过5000个有效字符。';
    }
    if (Object.keys(fields).length) throw invalid('请检查必填字段和输入内容。', fields);
    if (typeof ownerId !== 'string' || !ownerId.trim()) {
      throw new ApiError(500, 'WRITE_FAILED', '写入身份配置异常，请联系维护者。');
    }

    // 不去空白、不规范化字符；客户端不能指定 ID，版本和时间仍由数据库生成。
    // 此规则仅覆盖当前新增流程；未来 PATCH 实现前必须重新核对可编辑记录的防重模型。
    const id = `entry-${createHash('sha256')
      .update(JSON.stringify([ownerId, body.entryDate, body.text]), 'utf8').digest('hex')}`;
    let result;
    try {
      result = await entriesRepository.insert({ id, ownerId, entryDate: body.entryDate, text: body.text });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'WRITE_FAILED') throw error;
        throw new ApiError(500, 'WRITE_FAILED', error.message, error.retryable);
      }
      throw new ApiError(500, 'WRITE_FAILED', '写入失败，请稍后重试。', true);
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
      throw new ApiError(500, 'WRITE_FAILED', '数据库写入返回格式异常，请联系维护者。');
    }
    if (result.rows.length === 0) {
      throw new ApiError(409, 'DUPLICATE_ENTRY', '这一天已经保存过完全相同的原文，请勿重复提交。');
    }
    try { return entry(result.rows[0]); } catch {
      throw new ApiError(500, 'WRITE_FAILED', '数据库写入返回字段异常，请联系维护者。');
    }
  };
}

module.exports = { INSERT_ENTRY_SQL, createWriter };
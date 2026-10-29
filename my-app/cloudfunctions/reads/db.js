const { ApiError } = require('./service');
const { ENTRIES_SQL, INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, DELETE_ENTRY_SQL } = require('./entriesRepository');
const { NOTES_SQL } = require('./readingNotesRepository');
const { INSERT_NOTE_SQL, DELETE_NOTE_SQL, SET_NOTE_SUMMARY_SQL, SET_FAVORITE_SQL,
  ADOPT_DEMO_ANALYSIS_SQL } = require('./accountWritesRepository');
const { FAVORITES_SQL } = require('./favoritesRepository');

// 只公开固定错误代码；供应商的原始消息和细节可能包含 SQL 或用户数据。
const diagnosticCodes = new Set([
  'INVALID_PARAM', 'UNAUTHORIZED', 'ACTION_FORBIDDEN', 'DATABASE_PERMISSION_DENIED',
  'DATABASE_42601', 'DATABASE_42P01', 'DATABASE_42703', 'DATABASE_42704',
  'DATABASE_23505', '23505', 'DATABASE_40P01', '40P01', 'DATABASE_40001', '40001', 'DATABASE_42501', 'DATABASE_28000', 'INTERNAL_ERROR',
]);

// 凭证仅由服务端配置；固定写语句使用平台写角色，三条列表 SELECT 保持只读。
function createCloudBaseQuery(envId, apiKey, fetchImpl = fetch) {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(envId || '')) {
    throw new Error('请配置有效的 CLOUDBASE_ENV_ID。');
  }
  if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey)) {
    throw new Error('请在云函数中配置服务端 CLOUDBASE_APIKEY。');
  }
  const endpoint = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
  const writeSql = new Set([INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, DELETE_ENTRY_SQL,
    INSERT_NOTE_SQL, DELETE_NOTE_SQL, SET_NOTE_SUMMARY_SQL, SET_FAVORITE_SQL, ADOPT_DEMO_ANALYSIS_SQL]);
  const allowedSql = new Set([ENTRIES_SQL, NOTES_SQL, FAVORITES_SQL, ...writeSql]);
  return async function query(sql, values) {
    const writing = writeSql.has(sql);
    const code = writing ? 'WRITE_FAILED' : 'INTERNAL_ERROR';
    const action = writing ? '写入' : '读取';
    if (!allowedSql.has(sql) || !Array.isArray(values)
      || values.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
      throw new ApiError(500, code, `${action}配置异常，请联系维护者。`);
    }
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ sql, parameters: values, role: writing ? 'cloudbase_postgres' : 'cloudbase_read_only_user' }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(500, code, '数据库服务暂时不可用，请稍后重试。', true);
    }
    // 只增加安全诊断，不透传原始错误，也不降级角色或自动重试。
    if (!response.ok) {
      const upstreamStatus = Number.isInteger(response.status)
        && response.status >= 100 && response.status <= 599 ? response.status : 'UNKNOWN';
      let upstreamCode = 'UNCLASSIFIED';
      try {
        const problem = await response.json();
        if (problem && typeof problem === 'object' && !Array.isArray(problem)
          && diagnosticCodes.has(problem.code)) upstreamCode = problem.code;
      } catch {
        // 非 JSON 或读取失败仍保留原来的错误封套和重试标记。
      }
      // 唯一约束是并发防重的最后一道保护；只映射固定新增与修改 SQL。
      if ([INSERT_ENTRY_SQL, PATCH_ENTRY_SQL, SET_NOTE_SUMMARY_SQL].includes(sql)
        && ['DATABASE_23505', '23505'].includes(upstreamCode)) {
        throw new ApiError(409, 'DUPLICATE_ENTRY', '这一天已经保存过完全相同的原文，请勿重复提交。');
      }
      if (writing && ((sql === INSERT_NOTE_SQL && ['DATABASE_23505', '23505'].includes(upstreamCode))
        || ['DATABASE_40P01', '40P01', 'DATABASE_40001', '40001'].includes(upstreamCode))) {
        throw new ApiError(409, 'VERSION_CONFLICT', '账户数据正在变化，本次未保存，请重新读取后手动重试。');
      }
      throw new ApiError(500, code,
        `${action}失败（SQL 服务 HTTP ${upstreamStatus}，错误代码：${upstreamCode}），请核对服务端配置。`,
        response.status >= 500 || response.status === 429);
    }
    let rows;
    try { rows = await response.json(); } catch {
      throw new ApiError(500, code, '数据库服务返回异常，请稍后重试。', true);
    }
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new ApiError(500, code, '数据库服务返回格式异常，请联系维护者。');
    }
    return { rows };
  };
}

module.exports = { createCloudBaseQuery };

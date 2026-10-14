const { ApiError, ENTRIES_SQL, NOTES_SQL, FAVORITES_SQL } = require('./service');
const { INSERT_ENTRY_SQL } = require('./writer');

// 只公开固定错误代码；供应商的原始消息和细节可能包含 SQL 或用户数据。
const diagnosticCodes = new Set([
  'INVALID_PARAM', 'UNAUTHORIZED', 'ACTION_FORBIDDEN', 'DATABASE_PERMISSION_DENIED',
  'DATABASE_42601', 'DATABASE_42P01', 'DATABASE_42703', 'DATABASE_42704',
  'DATABASE_23505', 'DATABASE_42501', 'DATABASE_28000', 'INTERNAL_ERROR',
]);

// 凭证仅由服务端配置；仅固定 INSERT 使用平台写角色，其余三条 SELECT 保持只读。
function createCloudBaseQuery(envId, apiKey, fetchImpl = fetch) {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(envId || '')) {
    throw new Error('请配置有效的 CLOUDBASE_ENV_ID。');
  }
  if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey)) {
    throw new Error('请在云函数中配置服务端 CLOUDBASE_APIKEY。');
  }
  const endpoint = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
  const allowedSql = new Set([ENTRIES_SQL, NOTES_SQL, FAVORITES_SQL, INSERT_ENTRY_SQL]);
  return async function query(sql, values) {
    const writing = sql === INSERT_ENTRY_SQL;
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

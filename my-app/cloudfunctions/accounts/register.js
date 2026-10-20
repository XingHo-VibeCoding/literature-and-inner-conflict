const TIMEOUT_MS = 10000;
const WINDOW_MS = 60000;
const MAX_ATTEMPTS = 5;

// 只维护当前进程的限流状态；多个实例之间不共享计数。
class RegistrationError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function invalid(message) {
  return new RegistrationError(400, 'INVALID_INPUT', message);
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 2
    || !Object.hasOwn(input, 'username') || !Object.hasOwn(input, 'password')) {
    throw invalid('请只提交用户名和密码。');
  }
  const { username, password } = input;
  if (typeof username !== 'string' || username.trim() !== username || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/.test(username)) {
    throw invalid('用户名需为 2–48 位，以英文字母或数字开头，仅支持英文字母、数字、点、下划线和短横线。');
  }
  if (typeof password !== 'string' || password.trim() !== password
    || !/^[A-Za-z0-9][A-Za-z0-9()!@#$%^&*|?><_-]{7,31}$/.test(password)
    || [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/].filter((rule) => rule.test(password)).length < 3) {
    throw invalid('密码需为 8–32 位，以英文字母或数字开头，并包含大写字母、小写字母、数字、指定符号中的至少三类。');
  }
  return { username, password };
}

function createRegistrar({ createUser, envId, enabled = false, now = Date.now, timeoutMs = TIMEOUT_MS }) {
  let attempts = [];
  let busy = false;
  const configured = typeof envId === 'string' && envId.trim() === envId
    && /^[a-z0-9][a-z0-9-]{2,127}$/.test(envId) && typeof createUser === 'function';
  return async function register(input) {
    if (!enabled || !configured) {
      throw new RegistrationError(503, 'REGISTRATION_UNAVAILABLE', '注册服务暂未就绪，请稍后再试。');
    }
    const { username, password } = validateInput(input);
    const currentTime = now();
    attempts = attempts.filter((time) => currentTime - time < WINDOW_MS);
    if (attempts.length >= MAX_ATTEMPTS) {
      throw new RegistrationError(429, 'RATE_LIMITED', '注册请求较多，请稍后再试。',
        Math.max(1, Math.ceil((attempts[0] + WINDOW_MS - currentTime) / 1000)));
    }
    if (busy) {
      throw new RegistrationError(429, 'RATE_LIMITED', '上一笔注册仍在处理，请稍后再试。', 10);
    }
    attempts.push(currentTime);
    busy = true;
    let timer;
    // 即使响应超时，也等管理请求真正结束才释放并发位，防止重叠创建。
    const operation = Promise.resolve().then(() => createUser({
      EnvId: envId, Name: username, Password: password, Type: 'externalUser', UserStatus: 'ACTIVE',
    })).then((result) => { busy = false; return result; }, (error) => { busy = false; throw error; });
    try {
      const result = await Promise.race([
        operation,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new RegistrationError(504, 'REGISTRATION_RESULT_UNKNOWN',
            '注册请求已超过 10 秒，结果尚未确认。请先尝试登录，勿重复注册。')), timeoutMs);
        }),
      ]);
      if (!result?.Data || typeof result.Data.Uid !== 'string' || !result.Data.Uid.trim()
        || result.Data.Uid.length > 64) {
        throw new RegistrationError(503, 'REGISTRATION_RESULT_UNKNOWN',
          '注册结果尚未确认。请先尝试登录，勿重复注册。');
      }
      return { registered: true };
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      if (error?.code === 'FailedOperation.DuplicatedData') {
        throw new RegistrationError(409, 'USERNAME_TAKEN', '该用户名已被使用，请直接登录或换一个用户名。');
      }
      // 管理服务错误可能带有账号、密码和请求正文，任何情况都不透传。
      throw new RegistrationError(503, 'REGISTRATION_RESULT_UNKNOWN',
        '注册服务暂时不可用，本次结果尚未确认。请先尝试登录，勿重复注册。');
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { RegistrationError, validateInput, createRegistrar, TIMEOUT_MS };

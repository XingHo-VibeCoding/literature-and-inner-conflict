const STORAGE_PREFIX = 'literature.account-session.v1:';
const MAX_TIMER_MS = 2147483647;
const EXPIRED_MESSAGE = '登录凭证无效或已过期，请重新登录。';
const CLEAR_FAILED_MESSAGE = '本页已退出，但保存的登录凭据未能清除。请允许本站使用浏览器存储后再次退出，刷新前请先处理。';

function sessionError(message, code) {
  const error = new Error(message);
  error.name = 'AccountSessionError';
  error.code = code;
  return error;
}

function isToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192
    && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function safeError(caught) {
  return ['AccountAuthError', 'AccountSessionError'].includes(caught?.name) ? caught
    : sessionError('账户请求未完成，请检查网络后手动重试。', 'SESSION_REQUEST_FAILED');
}

// 此存储只包含短期登录凭据；不保存密码、刷新令牌、用户资料或业务记录。
export function createAccountSession({ authClient, authOrigin, storage, eventTarget,
  now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let origin;
  try {
    const parsed = new URL(authOrigin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.href !== parsed.origin + '/' || authOrigin.trim() !== authOrigin || authOrigin.includes('*')) throw new Error();
    origin = parsed.origin;
  } catch {
    throw sessionError('登录服务须配置完整的 HTTPS 域名。', 'INVALID_CONFIGURATION');
  }
  if (!authClient || !['signIn', 'signUp', 'verifySession'].every(key => typeof authClient[key] === 'function')) {
    throw sessionError('账户会话服务尚未正确配置。', 'INVALID_CONFIGURATION');
  }
  const storageKey = STORAGE_PREFIX + origin;
  const listeners = new Set();
  let epoch = 0;
  let pending = null;
  let expiryTimer = null;
  let attachedTarget = null;
  let snapshot = Object.freeze({ status: 'signedOut', mode: null, token: '', expiresAt: null,
    persistent: false, message: '', version: 0, registered: false, suggestLogin: false,
    canRestore: false, loginStatus: null, profileStatus: null });
  const resolveStorage = () => storage === undefined ? globalThis.localStorage : storage;
  const resolveTarget = () => eventTarget === undefined ? globalThis.window : eventTarget;

  function update(value) {
    snapshot = Object.freeze({ ...snapshot, ...value, version: epoch });
    for (const listener of listeners) listener();
  }

  function stopTimer() {
    if (expiryTimer !== null) clearTimeoutImpl(expiryTimer);
    expiryTimer = null;
  }

  function stopPending() {
    const previous = pending;
    pending = null;
    previous?.controller.abort();
    previous?.detach?.();
  }

  function reset(message = '', status = 'signedOut') {
    update({ status, mode: null, token: '', expiresAt: null, persistent: false, message,
      registered: false, suggestLogin: false, canRestore: false, loginStatus: null, profileStatus: null });
  }

  function clearSaved() {
    try {
      const target = resolveStorage();
      if (!target) throw new Error();
      target.removeItem(storageKey);
      return true;
    } catch { return false; }
  }

  function invalidate(message = EXPIRED_MESSAGE) {
    epoch += 1;
    stopPending();
    stopTimer();
    const cleared = clearSaved();
    reset(cleared ? message : CLEAR_FAILED_MESSAGE, cleared ? 'signedOut' : 'error');
    return snapshot;
  }

  function scheduleExpiry() {
    stopTimer();
    if (snapshot.status !== 'signedIn' || snapshot.expiresAt === null) return;
    const remaining = snapshot.expiresAt - now();
    if (remaining <= 0) { invalidate(); return; }
    expiryTimer = setTimeoutImpl(() => {
      expiryTimer = null;
      if (snapshot.expiresAt !== null && snapshot.expiresAt <= now()) invalidate();
      else scheduleExpiry();
    }, Math.min(remaining, MAX_TIMER_MS));
    expiryTimer?.unref?.();
  }

  function attach() {
    if (attachedTarget) return;
    const target = resolveTarget();
    if (!target?.addEventListener) return;
    attachedTarget = target;
    target.addEventListener('storage', onStorage);
    target.addEventListener('pageshow', onPageShow);
    target.addEventListener('pagehide', onPageHide);
    target.addEventListener('focus', onFocus);
  }

  function begin(status, mode = null, signal) {
    attach();
    epoch += 1;
    stopPending();
    stopTimer();
    const controller = new AbortController();
    const operation = { id: epoch, controller, detach: null };
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', cancel, { once: true });
    operation.detach = () => signal?.removeEventListener('abort', cancel);
    pending = operation;
    reset('', status);
    update({ mode });
    return operation;
  }

  function check(operation) {
    if (operation.id !== epoch || operation.controller.signal.aborted) {
      throw sessionError('已取消本次账户请求。', 'ABORTED');
    }
  }

  async function wait(operation, promise) {
    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
    const cancel = () => rejectCancellation(sessionError('已取消本次账户请求。', 'ABORTED'));
    operation.controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (operation.controller.signal.aborted) cancel();
      const result = await Promise.race([promise, cancellation]);
      check(operation);
      return result;
    } finally {
      operation.controller.signal.removeEventListener('abort', cancel);
    }
  }

  function finish(operation) {
    operation.detach?.();
    if (pending === operation) pending = null;
  }

  function showFailure(operation, error) {
    if (operation.id !== epoch) return;
    reset(error.message, error.code === 'ABORTED' ? 'signedOut' : 'error');
    update({ registered: error.registered === true, suggestLogin: error.registered === true,
      loginStatus: error.loginStatus ?? null, profileStatus: error.profileStatus ?? null });
  }

  function save(result) {
    if (!isToken(result?.token)) throw sessionError('登录未返回有效凭据，请重新登录。', 'INVALID_SESSION');
    const expiresAt = Number.isSafeInteger(result.expiresAt) && result.expiresAt > 0 ? result.expiresAt : null;
    if (expiresAt !== null && expiresAt <= now()) throw sessionError(EXPIRED_MESSAGE, 'SESSION_EXPIRED');
    let persistent = false;
    let message = '当前登录仅在本页有效：服务未提供有效的登录到期时间。';
    if (expiresAt !== null) {
      try {
        const target = resolveStorage();
        if (!target) throw new Error();
        target.setItem(storageKey, JSON.stringify({ version: 1, authOrigin: origin,
          accessToken: result.token, expiresAt }));
        persistent = true;
        message = '';
      } catch {
        message = '已登录，但浏览器未能保存登录凭据。当前登录仅在本页有效。';
      }
    }
    update({ status: 'signedIn', mode: null, token: result.token, expiresAt, persistent, message,
      registered: result.registered === true, suggestLogin: false, canRestore: false,
      loginStatus: result.loginStatus ?? null, profileStatus: result.profileStatus ?? null });
    scheduleExpiry();
  }

  async function authenticate(method, input = {}) {
    const operation = begin('authenticating', method === 'signUp' ? 'register' : 'login', input.signal);
    try {
      check(operation);
      if (!clearSaved()) throw sessionError('浏览器未能清除先前的登录凭据。请允许本站使用存储后再登录。', 'STORAGE_CLEAR_FAILED');
      const request = authClient[method]({ ...input, signal: operation.controller.signal });
      input = null;
      const result = await wait(operation, request);
      save(result);
      return result;
    } catch (caught) {
      const error = safeError(caught);
      showFailure(operation, error);
      throw error;
    } finally {
      input = null;
      finish(operation);
    }
  }

  async function restore({ signal } = {}) {
    const operation = begin('restoring', null, signal);
    let raw;
    let saved;
    try {
      check(operation);
      try { raw = resolveStorage()?.getItem(storageKey); } catch {
        throw sessionError('浏览器暂时无法读取已保存的登录状态，请允许本站使用存储后重试。', 'STORAGE_READ_FAILED');
      }
      if (!raw) { reset(); return snapshot; }
      try { saved = JSON.parse(raw); } catch { saved = null; }
      const valid = saved !== null && typeof saved === 'object' && !Array.isArray(saved)
        && Object.keys(saved).sort().join(',') === 'accessToken,authOrigin,expiresAt,version'
        && saved.version === 1 && saved.authOrigin === origin && isToken(saved.accessToken)
        && Number.isSafeInteger(saved.expiresAt) && saved.expiresAt > 0;
      if (!valid || saved.expiresAt <= now()) {
        const error = sessionError(valid ? EXPIRED_MESSAGE : '保存的登录状态无效，请重新登录。', valid ? 'SESSION_EXPIRED' : 'INVALID_SESSION');
        if (!clearSaved()) throw sessionError(CLEAR_FAILED_MESSAGE, 'STORAGE_CLEAR_FAILED');
        throw error;
      }
      const result = await wait(operation, authClient.verifySession({ token: saved.accessToken, signal: operation.controller.signal }));
      if (saved.expiresAt <= now()) {
        if (!clearSaved()) throw sessionError(CLEAR_FAILED_MESSAGE, 'STORAGE_CLEAR_FAILED');
        throw sessionError(EXPIRED_MESSAGE, 'SESSION_EXPIRED');
      }
      if (result?.token !== saved.accessToken || result?.profileStatus !== 200) {
        throw sessionError('登录状态核验未返回有效结果，请重新登录。', 'INVALID_SESSION');
      }
      // 核验期间其他标签可能已退出；提交状态前再核对存储，避免恢复迟到会话。
      let current;
      try { current = resolveStorage()?.getItem(storageKey); } catch {
        throw sessionError('浏览器暂时无法核对已保存的登录状态，请稍后重试。', 'STORAGE_READ_FAILED');
      }
      if (current !== raw) return restore({ signal });
      update({ status: 'signedIn', token: saved.accessToken, expiresAt: saved.expiresAt,
        persistent: true, profileStatus: 200, message: '' });
      scheduleExpiry();
      return snapshot;
    } catch (caught) {
      let error = safeError(caught);
      if (operation.id === epoch && ['UNAUTHENTICATED', 'INVALID_PROFILE', 'INVALID_SESSION'].includes(error.code)
        && !clearSaved()) error = sessionError(CLEAR_FAILED_MESSAGE, 'STORAGE_CLEAR_FAILED');
      showFailure(operation, error);
      if (operation.id === epoch && saved?.expiresAt > now()
        && !['ABORTED', 'SESSION_EXPIRED', 'UNAUTHENTICATED', 'INVALID_PROFILE', 'INVALID_SESSION',
          'STORAGE_CLEAR_FAILED', 'STORAGE_READ_FAILED'].includes(error.code)) {
        try {
          if (resolveStorage()?.getItem(storageKey) === raw) update({ canRestore: true });
        } catch { /* 无法核对缓存时不提供恢复成功的暗示。 */ }
      }
      throw error;
    } finally { finish(operation); }
  }

  function onStorage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    if (event.newValue === null || event.key === null) {
      epoch += 1;
      stopPending();
      stopTimer();
      reset('已在其他标签页退出登录。');
      return;
    }
    restore().catch(() => {});
  }

  function onPageShow(event) {
    // 从浏览器往返缓存恢复时也重新向云端核验，不沿用缓存的已登录画面。
    if (event.persisted) restore().catch(() => {});
  }

  function onPageHide() {
    const registering = snapshot.mode === 'register';
    epoch += 1;
    stopPending();
    stopTimer();
    reset(registering ? '页面已离开，注册结果尚未确认。返回后请先尝试登录，不要立即重复注册。' : '');
  }

  function getToken() {
    if (snapshot.status === 'signedIn' && snapshot.expiresAt !== null && snapshot.expiresAt <= now()) invalidate();
    return snapshot.status === 'signedIn' ? snapshot.token : '';
  }

  function onFocus() { getToken(); }

  return {
    storageKey,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      attach();
      return () => listeners.delete(listener);
    },
    restore,
    signIn: input => authenticate('signIn', input),
    signUp: input => authenticate('signUp', input),
    signOut: () => invalidate('已退出登录。'),
    invalidate,
    getToken,
    cancel() {
      const registering = snapshot.mode === 'register';
      epoch += 1;
      stopPending();
      stopTimer();
      reset(registering ? '注册已停止等待，结果尚未确认。请先尝试登录，勿重复注册。' : '已取消本次账户请求。');
      if (registering) update({ suggestLogin: true });
      return snapshot;
    },
    dispose() {
      epoch += 1;
      stopPending();
      stopTimer();
      attachedTarget?.removeEventListener('storage', onStorage);
      attachedTarget?.removeEventListener('pageshow', onPageShow);
      attachedTarget?.removeEventListener('pagehide', onPageHide);
      attachedTarget?.removeEventListener('focus', onFocus);
      attachedTarget = null;
    },
  };
}

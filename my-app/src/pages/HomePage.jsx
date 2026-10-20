import { useEffect, useMemo, useRef, useState } from 'react';
import { homeSections } from '../services/homeMock.js';
import { createPublicApiClient } from '../services/publicApi.js';
import { createAccountAuthClient } from '../services/accountAuth.js';
import AccountPanel from '../components/AccountPanel.jsx';

const updateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function formatTime(value) {
  return updateFormatter.format(new Date(value)).replaceAll('/', '.').replace(' ', ' · ');
}

function localDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function makeTestText() {
  const marker = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `【虚构·Day20接线验证·${marker}】今天读完一页后，我记下了一个问题。本条仅用于验证公网写入与读回。`;
}

function emptyView(status = 'loading') {
  return { status, items: [], total: null, page: null, error: '', code: '', httpStatus: null, requestId: null, fetchedAt: null, loadingMore: false };
}

function requestEvidence(result) {
  return { httpStatus: result.httpStatus ?? null, requestId: result.requestId ?? null };
}

function RequestEvidence({ value }) {
  return <p className="home-cloud-evidence">
    <span>HTTP：{value.httpStatus ?? '尚未取得响应'}</span>
    <span>关联 ID：{value.requestId || '响应未提供或浏览器未开放读取'}</span>
  </p>;
}

export default function HomePage() {
  const apiOrigin = import.meta.env.VITE_API_ORIGIN || '';
  const apiSetup = useMemo(() => {
    try {
      return { client: createPublicApiClient({ apiOrigin, requestOrigin: import.meta.env.DEV ? '' : apiOrigin }), error: '' };
    } catch (error) {
      return { client: null, error: error.message };
    }
  }, [apiOrigin]);
  const accountSetup = useMemo(() => {
    try {
      return { client: createAccountAuthClient({ authOrigin: import.meta.env.VITE_AUTH_ORIGIN || '',
        registrationOrigin: apiOrigin, registrationRequestOrigin: import.meta.env.DEV ? '' : apiOrigin }), error: '' };
    } catch (error) {
      return { client: null, error: error.message };
    }
  }, [apiOrigin]);
  const publicOrigin = apiOrigin.replace(/\/$/, '');
  const tokenRef = useRef('');
  const sessionVersion = useRef(0);
  const readController = useRef(null);
  const writeController = useRef(null);
  const writingRef = useRef(false);
  const loginController = useRef(null);
  const loginBusyRef = useRef(false);
  const accountAttemptRef = useRef(null);
  const copyBusyRef = useRef(false);
  const deleteDialog = useRef(null);
  const deleteTrigger = useRef(null);
  const cancelDeleteButton = useRef(null);
  const deleteConfirmationRef = useRef(null);
  const [copyState, setCopyState] = useState({ status: 'idle', message: '' });
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginState, setLoginState] = useState({ status: 'idle', message: '', loginStatus: null, profileStatus: null, matched: null });
  const [accountState, setAccountState] = useState({ status: 'idle', message: '' });
  const [accountVerified, setAccountVerified] = useState(false);
  const [accountResetVersion, setAccountResetVersion] = useState(0);
  const [hasCredential, setHasCredential] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [readRequest, setReadRequest] = useState({ cursor: undefined, append: false, revision: 0 });
  const [healthRevision, setHealthRevision] = useState(0);
  const [view, setView] = useState(() => emptyView());
  const [health, setHealth] = useState({ status: 'loading', message: '', httpStatus: null, requestId: null, fetchedAt: null });
  const [testText, setTestText] = useState(makeTestText);
  const [writeState, setWriteState] = useState({ status: 'idle', message: '', httpStatus: null, requestId: null });
  const [writeReceipt, setWriteReceipt] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editText, setEditText] = useState('');
  const [mutationState, setMutationState] = useState({ status: 'idle', message: '' });
  const [mutationReceipt, setMutationReceipt] = useState(null);
  const [patchEvidence, setPatchEvidence] = useState(null);
  const [deleteEvidence, setDeleteEvidence] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!dialog) return;
    if (deleteConfirmation) {
      if (!dialog.open) dialog.showModal();
      cancelDeleteButton.current?.focus();
    } else if (dialog.open) {
      dialog.close();
      deleteTrigger.current?.focus();
    }
  }, [deleteConfirmation]);

  useEffect(() => {
    const controller = new AbortController();
    if (!apiSetup.client) {
      setHealth({ status: 'error', message: apiSetup.error, httpStatus: null, requestId: null, fetchedAt: null });
      return () => controller.abort();
    }
    setHealth({ status: 'loading', message: '', httpStatus: null, requestId: null, fetchedAt: null });
    apiSetup.client.getHealth({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setHealth({ status: 'success', message: result.data.service, ...requestEvidence(result), fetchedAt: new Date().toISOString() });
    }).catch((error) => {
      if (!controller.signal.aborted) setHealth({ status: 'error', message: error.message, ...requestEvidence(error), fetchedAt: null });
    });
    return () => controller.abort();
  }, [apiSetup, healthRevision]);

  useEffect(() => {
    const controller = new AbortController();
    const currentSession = sessionVersion.current;
    readController.current = controller;
    if (!apiSetup.client) {
      setView({ ...emptyView('error'), error: apiSetup.error });
      return () => controller.abort();
    }
    setView((current) => readRequest.append && current.items.length
      ? { ...current, loadingMore: true, error: '', code: '' }
      : emptyView());
    // 未准备凭证时明确提示；接口返回 401 也不显示为空记录。
    apiSetup.client.getEntries({ token: tokenRef.current, signal: controller.signal, limit: 20, cursor: readRequest.cursor }).then((result) => {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      setView((current) => {
        const items = readRequest.append
          ? [...current.items, ...result.data.items.filter((entry) => !current.items.some((saved) => saved.id === entry.id))]
          : result.data.items;
        return { status: items.length ? 'content' : 'empty', items, total: result.data.total, page: result.data.page, error: '', code: '', ...requestEvidence(result), fetchedAt: new Date().toISOString(), loadingMore: false };
      });
    }).catch((error) => {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      if (expireSession(error)) return;
      setView((current) => readRequest.append && current.items.length && error.httpStatus !== 401 && error.code !== 'UNAUTHENTICATED'
        ? { ...current, loadingMore: false, error: error.message, code: error.code || '', ...requestEvidence(error) }
        : { ...emptyView(error.httpStatus === 401 || error.code === 'UNAUTHENTICATED' ? 'unauthorized' : 'error'), error: error.message, code: error.code || '', ...requestEvidence(error) });
    });
    return () => controller.abort();
  }, [apiSetup, readRequest]);

  useEffect(() => {
    // 整页离开可能进入浏览器往返缓存，pagehide 时也要清除私人会话。
    const hidePage = () => clearCredential();
    window.addEventListener('pagehide', hidePage);
    return () => {
      window.removeEventListener('pagehide', hidePage);
      sessionVersion.current += 1;
      tokenRef.current = '';
      readController.current?.abort();
      writeController.current?.abort();
      loginController.current?.abort();
    };
  }, []);

  function clearDeleteConfirmation() {
    // 同步作废旧按钮持有的确认，避免取消或切换会话后的迟到操作误删。
    deleteConfirmationRef.current = null;
    setDeleteConfirmation(null);
  }

  function refreshEntries() {
    clearDeleteConfirmation();
    setReadRequest((current) => ({ cursor: undefined, append: false, revision: current.revision + 1 }));
  }

  function refreshAll() {
    refreshEntries();
    setHealthRevision((current) => current + 1);
  }

  function resetMutations() {
    clearDeleteConfirmation();
    setSelectedEntry(null);
    setEditDate('');
    setEditText('');
    setMutationState({ status: 'idle', message: '' });
    setMutationReceipt(null);
    setPatchEvidence(null);
    setDeleteEvidence(null);
  }

  function expireSession(error) {
    if ((error.httpStatus !== 401 && error.code !== 'UNAUTHENTICATED') || !tokenRef.current) return false;
    sessionVersion.current += 1;
    readController.current?.abort();
    writeController.current?.abort();
    loginController.current?.abort();
    writingRef.current = loginBusyRef.current = copyBusyRef.current = false;
    tokenRef.current = '';
    setHasCredential(false);
    setAccountVerified(false);
    setAccountResetVersion((version) => version + 1);
    accountAttemptRef.current = null;
    setTestText(makeTestText());
    setAccountState({ status: 'error', message: '登录状态已失效，请重新登录。' });
    setLoginPassword('');
    setTokenInput('');
    setCopyState({ status: 'idle', message: '' });
    resetMutations();
    setWriteReceipt(null);
    setWriteState({ status: 'idle', message: '', httpStatus: null, requestId: null });
    setView({ ...emptyView('unauthorized'), error: error.message, code: error.code || '', ...requestEvidence(error) });
    return true;
  }

  async function authenticateAccount({ mode, username, password }) {
    if (writingRef.current || loginBusyRef.current) return;
    if (!accountSetup.client || !apiSetup.client) {
      setAccountState({ status: 'error', message: accountSetup.error || '记录服务暂不可用，请稍后再试。' });
      return;
    }
    sessionVersion.current += 1;
    const currentSession = sessionVersion.current;
    readController.current?.abort();
    loginController.current?.abort();
    writeController.current?.abort();
    const controller = new AbortController();
    loginController.current = controller;
    loginBusyRef.current = true;
    tokenRef.current = '';
    setTokenInput('');
    setHasCredential(false);
    setAccountVerified(false);
    accountAttemptRef.current = mode;
    setTestText(makeTestText());
    setCredentialError('');
    setLoginPassword('');
    setLoginState({ status: 'idle', message: '', loginStatus: null, profileStatus: null, matched: null });
    resetMutations();
    setCopyState({ status: 'idle', message: '' });
    setWriteReceipt(null);
    setWriteState({ status: 'idle', message: '', httpStatus: null, requestId: null });
    setView(emptyView('unauthorized'));
    setAccountState({ status: 'loading', message: mode === 'register' ? '正在创建账号并登录…' : '正在登录并验证身份…' });
    try {
      const operation = mode === 'register' ? accountSetup.client.signUp : accountSetup.client.signIn;
      const pending = operation({ username, password, signal: controller.signal });
      username = password = null;
      const result = await pending;
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      tokenRef.current = result.token;
      setHasCredential(true);
      setAccountVerified(true);
      setAccountState({ status: 'success', message: result.registered ? '注册成功，已登录。正在读取你的记录。' : '已登录，正在读取你的记录。' });
      refreshEntries();
    } catch (error) {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      setAccountState({ status: 'error', message: error.code ? error.message : '暂时未能完成，请稍后重试。', registered: error.registered === true });
    } finally {
      username = password = null;
      if (currentSession === sessionVersion.current) { loginBusyRef.current = false; accountAttemptRef.current = null; }
    }
  }

  function prepareCredential(event) {
    event.preventDefault();
    if (writingRef.current || loginBusyRef.current) return;
    const token = tokenInput.trim();
    setTokenInput('');
    if (!token || /\s/.test(token)) {
      setCredentialError('请填写已有会话中的单行 access_token；不要填写密码或管理员 API Key。输入框已清空。');
      return;
    }
    sessionVersion.current += 1;
    resetMutations();
    copyBusyRef.current = false;
    setCopyState({ status: 'idle', message: '' });
    writeController.current?.abort();
    writingRef.current = false;
    loginController.current?.abort();
    setLoginPassword('');
    setLoginState({ status: 'idle', message: '', loginStatus: null, profileStatus: null, matched: null });
    tokenRef.current = token;
    setTestText(makeTestText());
    setAccountVerified(false);
    setAccountResetVersion((version) => version + 1);
    setAccountState({ status: 'idle', message: '' });
    setHasCredential(true);
    setCredentialError('');
    setWriteReceipt(null);
    setWriteState({ status: 'idle', message: '', httpStatus: null, requestId: null });
    setView(emptyView());
    refreshEntries();
  }

  function clearCredential() {
    const registrationUnconfirmed = accountAttemptRef.current === 'register' && loginBusyRef.current;
    accountAttemptRef.current = null;
    sessionVersion.current += 1;
    resetMutations();
    copyBusyRef.current = false;
    setCopyState({ status: 'idle', message: '' });
    readController.current?.abort();
    loginController.current?.abort();
    loginBusyRef.current = false;
    setLoginPassword('');
    setLoginUsername('');
    setLoginState({ status: 'idle', message: '', loginStatus: null, profileStatus: null, matched: null });
    writeController.current?.abort();
    writingRef.current = false;
    tokenRef.current = '';
    setTokenInput('');
    setHasCredential(false);
    setAccountVerified(false);
    setAccountResetVersion((version) => version + 1);
    setAccountState(registrationUnconfirmed
      ? { status: 'error', message: '注册已停止等待，结果尚未确认。请先尝试登录，勿重复注册。', suggestLogin: true }
      : { status: 'idle', message: '' });
    setTestText(makeTestText());
    setCredentialError('');
    setView(emptyView('unauthorized'));
    setWriteReceipt(null);
    setWriteState({ status: 'idle', message: '本页凭证和已读取的私人数据已清除。', httpStatus: null, requestId: null });
    refreshEntries();
  }

  async function loginLocally(event) {
    event.preventDefault();
    // 只在开发环境加载本地登录服务；生产构建移除此分支与认证请求地址。
    if (!import.meta.env.DEV || writingRef.current || loginBusyRef.current || !apiSetup.client) return;
    const username = loginUsername.trim();
    const password = loginPassword;
    setLoginPassword('');
    copyBusyRef.current = false;
    setCopyState({ status: 'idle', message: '' });
    sessionVersion.current += 1;
    resetMutations();
    const currentSession = sessionVersion.current;
    const controller = new AbortController();
    loginController.current?.abort();
    loginController.current = controller;
    loginBusyRef.current = true;
    tokenRef.current = '';
    setTokenInput('');
    setHasCredential(false);
    setCredentialError('');
    setView(emptyView('unauthorized'));
    setWriteReceipt(null);
    setWriteState({ status: 'idle', message: '', httpStatus: null, requestId: null });
    setAccountVerified(false);
    setTestText(makeTestText());
    setAccountResetVersion((version) => version + 1);
    setAccountState({ status: 'idle', message: '' });
    setLoginState({ status: 'loading', message: '正在登录并核对测试用户身份…', loginStatus: null, profileStatus: null, matched: null });
    refreshEntries();
    try {
      const { loginTestSession } = await import('../services/devLogin.js');
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      const result = await loginTestSession({ username, password,
        expectedUserId: import.meta.env.VITE_TEST_USER_ID || '', signal: controller.signal });
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      tokenRef.current = result.token;
      setHasCredential(true);
      setLoginState({ status: 'success', message: '本地登录及测试身份核验通过，正在读取云端记录。',
        loginStatus: result.loginStatus, profileStatus: result.profileStatus, matched: result.matched });
      refreshEntries();
    } catch (error) {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      setLoginState({ status: 'error', message: error.code ? error.message : '本地登录暂时失败，请核对配置后手动重试。',
        loginStatus: error.loginStatus ?? null, profileStatus: error.profileStatus ?? null, matched: error.code === 'TEST_USER_MISMATCH' ? false : null });
    } finally {
      if (currentSession === sessionVersion.current) loginBusyRef.current = false;
    }
  }

  async function copyTestCredential() {
    // 用户显式点击才临时复制，成功读库前不能复制短期凭证。
    if (!import.meta.env.DEV || !hasCredential || !tokenRef.current || view.httpStatus !== 200
      || !['content', 'empty'].includes(view.status) || view.loadingMore
      || writingRef.current || loginBusyRef.current || copyBusyRef.current) return;
    const currentSession = sessionVersion.current;
    copyBusyRef.current = true;
    setCopyState({ status: 'copying', message: '正在复制短期凭证…' });
    try {
      await navigator.clipboard.writeText(tokenRef.current);
      if (currentSession !== sessionVersion.current) return;
      setCopyState({ status: 'success', message: '短期凭证已复制。请只粘贴到自己的公网检查台，使用后覆盖或清空剪贴板。' });
    } catch {
      if (currentSession !== sessionVersion.current) return;
      setCopyState({ status: 'error', message: '复制失败，请检查浏览器剪贴板权限后手动重试。' });
    } finally {
      if (currentSession === sessionVersion.current) copyBusyRef.current = false;
    }
  }

  // 三类写入共用完整分页核对，目标在后续页时也能按原文与版本验证。
  async function readEntriesForVerification(controller, currentSession) {
    const pages = [];
    const items = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let cursor;
    let total;
    let result;
    do {
      result = await apiSetup.client.getEntries({ token: tokenRef.current, signal: controller.signal, limit: 20, cursor });
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      if (total !== undefined && total !== result.data.total) throw new Error('读回期间记录总数发生变化，请仅重新读取核对。');
      total = result.data.total;
      pages.push(result.data);
      for (const entry of result.data.items) {
        if (seenIds.has(entry.id)) throw new Error('分页返回了重复 ID，本次尚未核对。');
        seenIds.add(entry.id);
        items.push(entry);
      }
      cursor = result.data.page.hasMore ? result.data.page.nextCursor : undefined;
      if (cursor && seenCursors.has(cursor)) throw new Error('分页游标重复，本次尚未核对。');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    if (items.length !== total) throw new Error('全部分页条数与 total 不一致，本次尚未核对。');
    setView({ status: items.length ? 'content' : 'empty', items, total, page: result.data.page,
      error: '', code: '', ...requestEvidence(result), fetchedAt: new Date().toISOString(), loadingMore: false });
    return { items, total, pages, result };
  }

  async function readBack(receipt, controller, currentSession) {
    const verified = await readEntriesForVerification(controller, currentSession);
    if (!verified) return;
    const { items, result } = verified;
    const saved = items.find((entry) => entry.id === receipt.entry.id);
    if (!saved || saved.entryDate !== receipt.entry.entryDate || saved.text !== receipt.entry.text
      || saved.entryDate !== receipt.input.entryDate || saved.text !== receipt.input.text) {
      setWriteState({ status: 'readback-error', message: 'POST 已返回 201，但本次列表未读到 ID、日期和原文完全一致的记录。写入尚未核验，请先只读核对，勿重复创建。', ...requestEvidence(result) });
      return;
    }
    setWriteState({ status: 'success', message: `写入验证通过：POST 201，随后 GET ${result.httpStatus} 读回相同 ID、日期和原文。记录 ID：${saved.id}`, ...requestEvidence(result) });
  }

  async function writeTest(event) {
    event.preventDefault();
    if (writingRef.current || loginBusyRef.current || !apiSetup.client || !tokenRef.current) return;
    clearDeleteConfirmation();
    if (!testText.trim()) {
      setWriteState({ status: 'error', message: '测试原文不能为空；草稿已保留。', httpStatus: null, requestId: null });
      return;
    }
    writingRef.current = true;
    const controller = new AbortController();
    writeController.current = controller;
    const currentSession = sessionVersion.current;
    setWriteReceipt(null);
    setWriteState({ status: 'writing', message: '正在写入虚构测试记录…', httpStatus: null, requestId: null });
    let receipt = null;
    try {
      const input = { entryDate: localDate(), text: testText };
      const result = await apiSetup.client.createEntry({ token: tokenRef.current, input, signal: controller.signal });
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      if (result.httpStatus !== 201) throw Object.assign(new Error('未取得契约规定的 HTTP 201，不能确认写入成功。草稿已保留。'), requestEvidence(result));
      receipt = { entry: result.data, input, ...requestEvidence(result) };
      setWriteReceipt(receipt);
      setWriteState({ status: 'verifying', message: 'POST 已返回 201，正在重新读取数据库记录并核对原文…', ...requestEvidence(result) });
      await readBack(receipt, controller, currentSession);
    } catch (error) {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      if (expireSession(error)) return;
      const fields = error.fields ? Object.values(error.fields).join('；') : '';
      setWriteState({ status: receipt ? 'readback-error' : error.httpStatus === 409 ? 'duplicate' : 'error',
        message: receipt ? `POST 已返回 201，但读回核对失败：${error.message} 请先只读核对，勿重复创建。`
          : error.httpStatus === 409 ? `重复提交已被接口拒绝（409）：${error.message} 测试文本已保留，没有记作新的写入成功。`
            : `${error.message}${fields ? ` ${fields}` : ''} 草稿已保留；请求结果不明确时，先刷新云端记录核对，避免重复写入。`,
        ...requestEvidence(error) });
    } finally {
      if (currentSession === sessionVersion.current) writingRef.current = false;
    }
  }

  async function verifyWriteAgain() {
    if (writingRef.current || loginBusyRef.current || !writeReceipt || !apiSetup.client || !tokenRef.current) return;
    clearDeleteConfirmation();
    writingRef.current = true;
    const controller = new AbortController();
    writeController.current = controller;
    const currentSession = sessionVersion.current;
    setWriteState({ status: 'verifying', message: '仅重新读取列表，不发送新的写入请求…', ...requestEvidence(writeReceipt) });
    try {
      await readBack(writeReceipt, controller, currentSession);
    } catch (error) {
      if (!controller.signal.aborted && currentSession === sessionVersion.current && !expireSession(error)) setWriteState({ status: 'readback-error', message: `读回核对失败：${error.message} 已保留 POST 201 的结果，未重复写入。`, ...requestEvidence(error) });
    } finally {
      if (currentSession === sessionVersion.current) writingRef.current = false;
    }
  }

  function selectEntry(entry) {
    if (writingRef.current || loginBusyRef.current) return;
    clearDeleteConfirmation();
    setSelectedEntry(entry);
    setEditDate(entry.entryDate);
    setEditText(entry.text);
    setMutationReceipt(null);
    setMutationState({ status: 'idle', message: '' });
  }

  async function readBackMutation(receipt, controller, currentSession) {
    const verified = await readEntriesForVerification(controller, currentSession);
    if (!verified) return;
    const { items, total, pages, result } = verified;
    const saved = items.find(entry => entry.id === receipt.before.id);
    const evidence = { before: receipt.before, after: saved, pages, total, readCount: items.length,
      writeStatus: receipt.httpStatus, ...requestEvidence(result) };
    if (receipt.operation === 'PATCH') {
      if (!saved || saved.entryDate !== receipt.entry.entryDate || saved.text !== receipt.entry.text
        || saved.entryDate !== receipt.input.entryDate || saved.text !== receipt.input.text
        || saved.revision !== receipt.entry.revision || saved.textVersion !== receipt.entry.textVersion
        || saved.revision !== receipt.before.revision + 1
        || saved.textVersion !== receipt.before.textVersion + (receipt.before.text === receipt.input.text ? 0 : 1)) {
        throw new Error('GET 未读到与本次 PATCH 相同的 ID、日期、原文及版本，本次尚未核对。');
      }
      setPatchEvidence(evidence);
      setSelectedEntry(saved);
      setMutationState({ status: 'success', message: '修改已核对：PATCH 200，随后 GET 200 读回相同 ID、日期、原文与版本。', ...requestEvidence(result) });
    } else {
      if (saved) throw new Error('GET 全部分页仍返回目标 ID，删除尚未核对。');
      setDeleteEvidence(evidence);
      setSelectedEntry(null);
      setEditDate('');
      setEditText('');
      setMutationState({ status: 'success', message: '删除已核对：DELETE 200，随后 GET 200 全部分页不再返回目标 ID。', ...requestEvidence(result) });
    }
    setMutationReceipt(null);
  }

  function requestDelete() {
    if (writingRef.current || loginBusyRef.current || reading || !selectedEntry || !apiSetup.client
      || !tokenRef.current || mutationReceipt || deleteConfirmationRef.current) return;
    const confirmation = { entry: selectedEntry, session: sessionVersion.current };
    deleteConfirmationRef.current = confirmation;
    setDeleteConfirmation(confirmation);
    setMutationState({ status: 'idle', message: '' });
  }

  function cancelDelete() {
    if (!deleteConfirmationRef.current) return;
    clearDeleteConfirmation();
    setMutationState({ status: 'cancelled', message: '已取消删除，没有发送 DELETE 请求。' });
  }

  async function mutateEntry(operation, event, confirmedTarget) {
    event?.preventDefault();
    if (writingRef.current || loginBusyRef.current || reading || !selectedEntry || !apiSetup.client || !tokenRef.current || mutationReceipt) return;
    if (operation === 'DELETE' && (!confirmedTarget || deleteConfirmationRef.current !== confirmedTarget
      || confirmedTarget.session !== sessionVersion.current || confirmedTarget.entry.id !== selectedEntry.id
      || confirmedTarget.entry.revision !== selectedEntry.revision)) {
      clearDeleteConfirmation();
      return;
    }
    clearDeleteConfirmation();
    writingRef.current = true;
    readController.current?.abort();
    const controller = new AbortController();
    writeController.current = controller;
    const currentSession = sessionVersion.current;
    const before = selectedEntry;
    const input = { entryDate: editDate, text: editText, expectedRevision: before.revision };
    let receipt;
    if (operation === 'PATCH') setPatchEvidence(null);
    else setDeleteEvidence(null);
    setMutationState({ status: 'writing', message: operation === 'PATCH' ? '正在修改云端记录…' : '正在删除云端记录…' });
    try {
      const result = operation === 'PATCH'
        ? await apiSetup.client.updateEntry({ token: tokenRef.current, entryId: before.id, input, signal: controller.signal })
        : await apiSetup.client.deleteEntry({ token: tokenRef.current, entryId: before.id, expectedRevision: before.revision, signal: controller.signal });
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      receipt = { operation, before, input, entry: result.data, ...requestEvidence(result) };
      setMutationReceipt(receipt);
      setMutationState({ status: 'verifying', message: `${operation} 已返回 200，正在逐页 GET 核对实际结果…`, ...requestEvidence(result) });
      await readBackMutation(receipt, controller, currentSession);
    } catch (error) {
      if (controller.signal.aborted || currentSession !== sessionVersion.current) return;
      if (expireSession(error)) return;
      const fields = error.fields ? Object.values(error.fields).join('；') : '';
      setMutationState({ status: receipt ? 'readback-error' : 'error',
        message: receipt ? `${operation} 已返回 200，但读回尚未核对：${error.message} 请只读核对，勿重复写入。`
          : error.httpStatus === 409 ? `版本或数据冲突（409）：${error.message} 草稿已保留。请先刷新云端记录核对，再重新选择记录；不会自动重试。`
            : `${error.message}${fields ? ' ' + fields : ''} 草稿已保留；结果不明确时先刷新云端记录核对，避免重复操作。`, ...requestEvidence(error) });
    } finally {
      if (currentSession === sessionVersion.current) writingRef.current = false;
    }
  }

  async function verifyMutationAgain() {
    if (writingRef.current || loginBusyRef.current || !mutationReceipt || !apiSetup.client || !tokenRef.current) return;
    clearDeleteConfirmation();
    writingRef.current = true;
    readController.current?.abort();
    const controller = new AbortController();
    writeController.current = controller;
    const currentSession = sessionVersion.current;
    setMutationState({ status: 'verifying', message: '正在逐页 GET 只读核对，不重新发送 PATCH 或 DELETE。', ...requestEvidence(mutationReceipt) });
    try {
      await readBackMutation(mutationReceipt, controller, currentSession);
    } catch (error) {
      if (!controller.signal.aborted && currentSession === sessionVersion.current && !expireSession(error)) setMutationState({ status: 'readback-error', message: `读回尚未核对：${error.message} 未重新发送写入请求。`, ...requestEvidence(error) });
    } finally {
      if (currentSession === sessionVersion.current) writingRef.current = false;
    }
  }

  const latest = view.items[0];
  const analysis = latest?.adoptedAnalysis;
  const completeAnalysis = analysis && analysis.source === 'ai' && typeof analysis.summary === 'string'
    && Array.isArray(analysis.questions) && analysis.questions.every((question) => typeof question === 'string');
  const reading = view.status === 'loading' || view.loadingMore;
  const loginBusy = loginState.status === 'loading' || accountState.status === 'loading';
  const canCopyCredential = hasCredential && view.httpStatus === 200 && ['content', 'empty'].includes(view.status);
  const writeBusy = writeState.status === 'writing' || writeState.status === 'verifying'
    || mutationState.status === 'writing' || mutationState.status === 'verifying';

  return (
    <div className="home-page">
      <section className="home-introduction" aria-labelledby="home-title">
        <div>
          <p className="home-kicker"><span aria-hidden="true" /> 在文字里，慢慢靠近自己</p>
          <h1 id="home-title">文学与内心冲突</h1>
          <p className="home-intro-text">记录生活的褶皱，在文学、哲学与人文社科中，寻找理解自己的另一种目光。</p>
        </div>
        <div className="home-update">
          <span>云端记录更新时间</span>
          {latest ? <time dateTime={latest.updatedAt} title={latest.updatedAt}>{formatTime(latest.updatedAt)}</time>
            : <span>{view.status === 'loading' ? '正在读取…' : view.status === 'empty' ? '暂无云端记录' : '等待读取云端记录'}</span>}
          <span>北京时间 · 数据库 entries</span>
        </div>
      </section>

      <AccountPanel state={accountState} disabled={writeBusy || loginBusy}
        signedIn={accountVerified} resetVersion={accountResetVersion}
        onSubmit={authenticateAccount} onCancel={clearCredential} onLogout={clearCredential} />

      <div className="home-workspace">
        <section className="home-state-card" aria-labelledby="home-state-title">
          <div className="home-card-heading">
            <p className="home-section-label">一页近况</p>
            <span className="home-demo-label">{latest ? '云端记录' : '写给此刻'}</span>
          </div>
          <h2 id="home-state-title">此刻的自我</h2>
          <div className="home-state-body" aria-live="polite" aria-busy={reading}>
            {completeAnalysis && latest ? <div className="home-cloud-analysis">
              <p className="home-summary-label">AI 解读 · 已采纳，独立于用户原文</p>
              <p className="home-summary">{analysis.summary}</p>
              <ul>{analysis.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
            </div> : <div className="home-guidance" aria-label="本站原创寄语">
              <p className="home-summary">把此刻写下来，<br />让文字慢慢照见自己。</p>
              <p className="home-summary-detail">有些心绪，还没有名字。先留下一段经历，再让阅读陪你慢慢辨认。</p>
              <p className="home-guidance-source">本站原创寄语</p>
            </div>}
            {view.status === 'content' && latest && <div className="home-original home-cloud-original">
              <p className="home-original-label">用户原文 · <time dateTime={latest.entryDate}>{latest.entryDate}</time></p>
              <p>{latest.text}</p>
            </div>}
          </div>
          <details className="home-record-tools" id="home-record-tools">
            <summary>记录与刷新<span className="home-record-status" aria-live="polite">{reading ? '读取中' : view.status === 'content' ? '已连接' : view.status === 'empty' ? '暂无记录' : view.status === 'unauthorized' ? '未连接' : '读取失败'}</span></summary>
            <p className="home-state-note">这里保留你保存的原文与日期，AI 解读单独标注。</p>
            <div className="home-record-state" aria-live="polite">
              {view.status === 'loading' && <p role="status">正在读取云端记录…</p>}
              {view.status === 'empty' && <p>你的云端记录还没有内容。这里会显示你保存的日精进原文与日期。</p>}
              {view.status === 'unauthorized' && <p>尚未读取你的云端记录。目前没有有效的登录状态，私人记录暂不展示。</p>}
              {view.status === 'error' && <div className="home-state-error" role="alert">
                <p>云端记录暂时没有读到</p>
                <p>{view.error}</p>
                <button type="button" onClick={refreshAll} disabled={writeBusy || loginBusy}>重新读取</button>
              </div>}
              {view.status === 'content' && latest && <>
                {!completeAnalysis && <p className="home-cloud-no-analysis">{analysis ? '这条记录的分析暂时无法完整展示，已保存的原文保持不变。' : '这条记录暂无已采纳的 AI 分析。原文按数据库内容保留。'}</p>}
                <p className="home-cloud-count">已读 {view.items.length} 条 / 共 {view.total} 条</p>
              </>}
            </div>
            <button className="home-cloud-refresh" type="button" onClick={refreshAll} disabled={reading || writeBusy || loginBusy}>刷新状态与云端记录</button>
            <p className="home-cloud-refresh-note">刷新此处会重新读取记录；整页刷新或离开首页后，需要重新验证登录状态。</p>
          </details>
        </section>

        <section className="home-choices" aria-labelledby="home-choices-title">
          <div className="home-choices-heading">
            <p className="home-section-label">两个入口，一段与自己的对话</p>
            <h2 id="home-choices-title">今天，想从哪里开始？</h2>
            <p>可以先写下此刻，也可以先遇见一本书。</p>
          </div>
          <nav className="home-entry-grid" aria-label="两个主入口">
            {homeSections.map((section) => <a key={section.id}
              className={`home-entry-card home-entry-${section.id}`} href={section.href}
              aria-labelledby={`home-${section.id}-title`}>
              <div className="home-entry-top" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" className="home-entry-icon">
                  {section.iconPaths.map((path) => <path key={path} d={path} />)}
                </svg>
                <span>{section.number}</span>
              </div>
              <p className="home-entry-caption">{section.caption}</p>
              <h3 id={`home-${section.id}-title`}>{section.title}</h3>
              <p className="home-entry-description">{section.description}</p>
              <ul className="home-entry-features" aria-label={`${section.title}板块内容`}>
                {section.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <span className="home-entry-action">{section.action} <span aria-hidden="true">↗</span></span>
            </a>)}
          </nav>
        </section>
      </div>

      <aside className="home-letter" aria-labelledby="home-letter-title">
        <div className="home-letter-heading">
          <span className="home-letter-mark" aria-hidden="true">予</span>
          <h2 id="home-letter-title">写在页边</h2>
          <span>我们的初心与祝愿</span>
        </div>
        <div className="home-letter-copy">
          <p>理解自己，或许始于允许一个问题暂时没有答案。</p>
          <p>我们想留下一处空间，让经历被认真记录，让阅读与生活相互照见。<br className="home-letter-break" />愿你在文字间获得片刻从容，带着对自己的善意，继续走向生活。</p>
        </div>
        <span className="home-letter-source">本站原创寄语</span>
      </aside>

      <dialog ref={deleteDialog} aria-labelledby="cloud-delete-confirm-title" aria-describedby="cloud-delete-warning" onCancel={cancelDelete}>
        {deleteConfirmation && <>
          <h2 id="cloud-delete-confirm-title">确认删除这条云端记录？</h2>
          <p>日期：{deleteConfirmation.entry.entryDate} · 记录版本：{deleteConfirmation.entry.revision}</p>
          <p className="delete-preview">记录 ID：{deleteConfirmation.entry.id}</p>
          <p className="delete-preview">原文预览：{Array.from(deleteConfirmation.entry.text).slice(0, 160).join('')}</p>
          <p id="cloud-delete-warning">这是永久删除，记录及其关联收藏将被清理；阅读感悟原文保留。</p>
          <div className="dialog-actions">
            <button ref={cancelDeleteButton} type="button" autoFocus onClick={cancelDelete}>取消删除</button>
            <button type="button" className="danger-button" onClick={() => mutateEntry('DELETE', undefined, deleteConfirmation)} disabled={writeBusy || loginBusy || reading || Boolean(mutationReceipt)}>确认永久删除</button>
          </div>
        </>}
      </dialog>

      <p className="home-storage-note">首页近况和检查台读取云端数据；两个入口内的日精进、感悟、收藏与固定演示仍沿用原有本地流程。未自动导入本机记录。</p>

      <details className="home-cloud-check" id="home-cloud-check">
        <summary>公网接线检查台</summary>
        <p className="home-cloud-check-intro">核对接口、私人记录及增删改查。已有凭证只保存在本页内存，不进入环境变量、浏览器存储或链接。</p>
        <div className="home-cloud-check-grid">
          <section aria-labelledby="cloud-health-title">
            <h3 id="cloud-health-title">01 · 健康与请求地址</h3>
            <p className={health.status === 'error' ? 'home-cloud-error' : ''} role={health.status === 'error' ? 'alert' : 'status'}>{health.status === 'loading' ? '正在请求健康接口…' : health.status === 'success' ? `健康接口正常：${health.message}` : health.message}</p>
            <RequestEvidence value={health} />
            {health.fetchedAt && <p className="home-cloud-small">最后检查：<time dateTime={health.fetchedAt}>{formatTime(health.fetchedAt)}</time>（北京时间）</p>}
            <dl className="home-cloud-addresses">
              <dt>公网 API</dt><dd>{publicOrigin || '未配置 VITE_API_ORIGIN'}</dd>
              <dt>健康接口</dt><dd>{publicOrigin ? `${publicOrigin}/api/health` : '等待配置'}</dd>
              <dt>记录接口</dt><dd>{publicOrigin ? `${publicOrigin}/api/entries?limit=20` : '等待配置'}</dd>
            </dl>
            {import.meta.env.DEV && <p className="home-cloud-small">本地通过 Vite 的 /api 代理转发到以上公网 API；部署后浏览器直接请求公网地址，并接受 CORS 检查。</p>}
          </section>

          <section aria-labelledby="cloud-credential-title">
            <h3 id="cloud-credential-title">02 · 准备私人数据凭证</h3>
            {import.meta.env.DEV && <div className="home-cloud-dev-login">
              <h4>本地测试账号登录</h4>
              <p className="home-cloud-small">此入口仅用于本地联调，不会进入公网部署。输入现有测试账号，登录后先核对测试 UID，一致才读取私人数据。</p>
              <form onSubmit={loginLocally} autoComplete="off">
                <label htmlFor="cloud-test-username">测试账号用户名</label>
                <input id="cloud-test-username" type="text" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="off" spellCheck="false" disabled={writeBusy || loginBusy} />
                <label htmlFor="cloud-test-password">测试账号密码</label>
                <input id="cloud-test-password" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="off" aria-describedby="cloud-login-help" disabled={writeBusy || loginBusy} />
                <p id="cloud-login-help" className="home-cloud-small">提交后立即清空密码。账号密码与令牌不进入链接、浏览器存储、错误提示或日志；令牌仅暂存在本页内存。</p>
                <div className="home-cloud-actions"><button type="submit" disabled={!apiSetup.client || writeBusy || loginBusy || !loginUsername.trim() || !loginPassword}>{loginBusy ? '正在登录并核验…' : '本地登录并核验身份'}</button></div>
              </form>
              {loginState.message && <div className={loginState.status === 'error' ? 'home-cloud-error' : 'home-cloud-small'} role={loginState.status === 'error' ? 'alert' : 'status'}>
                <p>{loginState.message}</p>
                <p className="home-cloud-evidence"><span>登录 HTTP：{loginState.loginStatus ?? '尚未取得响应'}</span><span>身份核验 HTTP：{loginState.profileStatus ?? '尚未取得响应'}</span><span>测试 UID 一致：{loginState.matched === null ? '尚未核验' : String(loginState.matched)}</span></p>
              </div>}
            </div>}
            <form onSubmit={prepareCredential}>
              <label htmlFor="cloud-access-token">已有会话的短期 access_token</label>
              <input id="cloud-access-token" type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoComplete="off" spellCheck="false" aria-describedby="cloud-token-help" disabled={writeBusy || loginBusy} />
              <p id="cloud-token-help" className="home-cloud-small">填写单行用户令牌。提交后输入框立即清空；请勿填写账号密码或管理员 API Key。</p>
              {credentialError && <p className="home-cloud-error" role="alert">{credentialError}</p>}
              <div className="home-cloud-actions">
                <button type="submit" disabled={!apiSetup.client || writeBusy || loginBusy || !tokenInput.trim()}>准备凭证并读取</button>
                <button type="button" onClick={clearCredential}>清除凭证与私人数据</button>
              </div>
            </form>
            <p className="home-cloud-small" role="status">{hasCredential ? '凭证已暂存在本页内存；是否有效以接口返回为准。' : '本页未保存凭证。私人接口的 401 表示需要身份，不表示数据库为空。'}</p>
            {import.meta.env.DEV && <div>
              <div className="home-cloud-actions"><button type="button" onClick={copyTestCredential} disabled={!canCopyCredential || reading || writeBusy || loginBusy || copyState.status === 'copying'}>复制短期凭证供公网验收</button></div>
              <p className="home-cloud-small">仅在本地成功读取 entries 后可用，点击才复制。剪贴板会临时包含用户短期凭证，粘贴到自己的公网检查台后请覆盖或清空；页面不会自动复制。</p>
              {copyState.message && <p className={copyState.status === 'error' ? 'home-cloud-error' : 'home-cloud-small'} role={copyState.status === 'error' ? 'alert' : 'status'}>{copyState.message}</p>}
            </div>}
          </section>
        </div>

        <section className="home-cloud-records" aria-labelledby="cloud-records-title">
          <div className="home-cloud-heading">
            <h3 id="cloud-records-title">03 · 核心表 entries 的实际返回</h3>
            <span>{view.total === null ? '尚未成功读取' : `已读 ${view.items.length} / 共 ${view.total} 条`}</span>
          </div>
          <RequestEvidence value={view} />
          {view.fetchedAt && <p className="home-cloud-small">本页最后读取：<time dateTime={view.fetchedAt}>{formatTime(view.fetchedAt)}</time>（北京时间）</p>}
          {view.error && <p className="home-cloud-error" role="alert">{view.code && `${view.code}：`}{view.error}</p>}
          {view.items.length > 0 && <details className="home-cloud-returned">
            <summary>查看已读记录的原文、日期与版本</summary>
            <ul className="home-cloud-entry-list">{view.items.map((entry) => <li key={entry.id}>
              <p className="home-cloud-entry-date"><time dateTime={entry.entryDate}>{entry.entryDate}</time><span>正文版本 {entry.textVersion} · 记录版本 {entry.revision}</span></p>
              <p className="home-cloud-entry-text">{entry.text}</p>
              <p className="home-cloud-small">记录 ID：{entry.id}</p>
              <div className="home-cloud-actions"><button type="button" onClick={() => selectEntry(entry)} disabled={writeBusy || loginBusy || reading || Boolean(mutationReceipt)}>选择此记录进行修改或删除</button></div>
            </li>)}</ul>
          </details>}
          {view.status === 'empty' && <p>HTTP 200 已返回：当前身份的记录总数为 0。</p>}
          {view.page?.hasMore && <button type="button" onClick={() => setReadRequest((current) => ({ cursor: view.page.nextCursor, append: true, revision: current.revision + 1 }))} disabled={reading || writeBusy || loginBusy}>{view.loadingMore ? '正在读取下一页…' : '读取下一页'}</button>}
        </section>

        <section className="home-cloud-write" aria-labelledby="cloud-write-title">
          <h3 id="cloud-write-title">04 · 一次虚构写入与读回核对</h3>
          <p>点击下面的写入按钮，会把这段文本写入真实数据库的 entries 表，归属当前凭证用户；日期按设备当地今天填写。写入并核对后，可在记录列表选择这条虚构记录，再验证修改和删除。</p>
          <form onSubmit={writeTest}>
            <label htmlFor="cloud-test-text">虚构测试原文</label>
            <textarea id="cloud-test-text" value={testText} onChange={(event) => setTestText(event.target.value)} disabled={writeBusy || loginBusy} aria-describedby="cloud-write-help" rows={3} />
            <p id="cloud-write-help" className="home-cloud-small">本页测试标记保持不变，失败时保留文本，不自动重发。相同用户、日期和原文再次提交应返回 409。</p>
            <div className="home-cloud-actions">
              <button type="submit" disabled={!apiSetup.client || !hasCredential || writeBusy || loginBusy || reading || Boolean(writeReceipt)}>{writeState.status === 'writing' ? '正在写入…' : writeState.status === 'verifying' ? '正在读回核对…' : writeReceipt ? '已取得写入结果' : '写入虚构记录并读回核对'}</button>
              {writeReceipt && <button type="button" onClick={verifyWriteAgain} disabled={writeBusy || loginBusy || reading || !hasCredential}>只读核对这次写入</button>}
            </div>
          </form>
          {!hasCredential && <p className="home-cloud-small">先准备有效用户凭证，才能执行写入测试。</p>}
          {writeState.message && <div className={`home-cloud-write-result ${writeState.status === 'success' ? 'home-cloud-write-success' : ''}`} role={['error', 'duplicate', 'readback-error'].includes(writeState.status) ? 'alert' : 'status'}>
            <p>{writeState.message}</p>
            <RequestEvidence value={writeState} />
            {writeReceipt && <p className="home-cloud-small">POST 结果：HTTP {writeReceipt.httpStatus} · 关联 ID：{writeReceipt.requestId || '响应未提供或浏览器未开放读取'}</p>}
          </div>}
        </section>
        <section className="home-cloud-write" aria-labelledby="cloud-mutation-title">
          <h3 id="cloud-mutation-title">05 · 单条修改、删除与 GET 核对</h3>
          <p>先展开上方已读记录，选择要操作的一条。修改原文会增加正文版本并清除旧 AI 分析；删除需要再次确认，且无法撤销。验收请使用标有“虚构”的测试记录。</p>
          {selectedEntry ? <>
            <p className="home-cloud-small">选中 ID：{selectedEntry.id} · 预期记录版本：{selectedEntry.revision}</p>
            <form onSubmit={(event) => mutateEntry('PATCH', event)}>
              <label htmlFor="cloud-edit-date">记录日期</label>
              <input id="cloud-edit-date" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} disabled={writeBusy || loginBusy || Boolean(mutationReceipt) || Boolean(deleteConfirmation)} required />
              <label htmlFor="cloud-edit-text">用户原文 · 修改草稿</label>
              <textarea id="cloud-edit-text" value={editText} onChange={(event) => setEditText(event.target.value)} disabled={writeBusy || loginBusy || Boolean(mutationReceipt) || Boolean(deleteConfirmation)} rows={4} aria-describedby="cloud-edit-help" required />
              <p id="cloud-edit-help" className="home-cloud-small">保留原始空格与换行，失败时保留草稿。保存后会请求 GET 逐页核对；版本冲突时请先刷新，再核对并重新选择。</p>
              <div className="home-cloud-actions">
                <button type="submit" disabled={writeBusy || loginBusy || reading || Boolean(mutationReceipt) || Boolean(deleteConfirmation)}>保存修改并读回核对</button>
                <button ref={deleteTrigger} type="button" onClick={requestDelete} disabled={writeBusy || loginBusy || reading || Boolean(mutationReceipt) || Boolean(deleteConfirmation)}>删除这条云端记录</button>
              </div>
            </form>
          </> : <p className="home-cloud-small">尚未选择记录。请在“查看已读记录的原文、日期与版本”中选择。</p>}
          {mutationState.message && <div className="home-cloud-write-result" role={['error', 'readback-error'].includes(mutationState.status) ? 'alert' : 'status'} aria-busy={mutationState.status === 'writing' || mutationState.status === 'verifying'}>
            <p>{mutationState.message}</p><RequestEvidence value={mutationState} />
            {mutationReceipt && <p className="home-cloud-small">{mutationReceipt.operation} 已响应 HTTP {mutationReceipt.httpStatus}；实际 GET 结果尚未核对。</p>}
          </div>}
          {mutationReceipt && <div className="home-cloud-actions"><button type="button" onClick={verifyMutationAgain} disabled={writeBusy || loginBusy || reading || !hasCredential}>只读核对这次修改或删除</button></div>}
          {patchEvidence && <div className="home-cloud-write-result home-cloud-write-success" data-testid="patch-evidence">
            <p>PATCH 前后对比 · 已经实际 GET 核对</p>
            <p className="home-cloud-small">记录 ID：{patchEvidence.before.id} · PATCH HTTP {patchEvidence.writeStatus} / GET HTTP {patchEvidence.httpStatus}</p>
            <p>修改前：{patchEvidence.before.entryDate} · 正文版本 {patchEvidence.before.textVersion} · 记录版本 {patchEvidence.before.revision}</p>
            <p className="home-cloud-entry-text">{patchEvidence.before.text}</p>
            <p>修改后：{patchEvidence.after.entryDate} · 正文版本 {patchEvidence.after.textVersion} · 记录版本 {patchEvidence.after.revision}</p>
            <p className="home-cloud-entry-text">{patchEvidence.after.text}</p>
          </div>}
          {deleteEvidence && <div className="home-cloud-write-result home-cloud-write-success" data-testid="delete-evidence">
            <p>DELETE 后 GET 验证 · 已核对全部 {deleteEvidence.pages.length} 页</p>
            <p className="home-cloud-small">目标 ID：{deleteEvidence.before.id} · DELETE HTTP {deleteEvidence.writeStatus} / GET HTTP {deleteEvidence.httpStatus}</p>
            <p>删除前：{deleteEvidence.before.entryDate} · 记录版本 {deleteEvidence.before.revision}</p>
            <p className="home-cloud-entry-text">{deleteEvidence.before.text}</p>
            <p>删除后：GET 共 {deleteEvidence.total} 条，已读 {deleteEvidence.readCount} 条；全部返回中目标 ID 已消失。</p>
            <details className="home-cloud-returned"><summary>查看删除后实际 GET 各页返回</summary><pre className="home-cloud-json">{JSON.stringify(deleteEvidence.pages, null, 2)}</pre></details>
          </div>}
        </section>
      </details>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { useAutoHeightMotion } from './usePanelMotion.js';

const emptyState = { status: 'idle', message: '' };
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/;
const passwordPattern = /^[A-Za-z0-9][A-Za-z0-9()!@#$%^&*|?><_-]{7,31}$/;

function registrationPasswordError(value) {
  if (!passwordPattern.test(value)) {
    return '密码需为 8–32 位，以字母或数字开头；特殊符号仅可使用 ()!@#$%^&*|?><_-。';
  }
  const types = [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/]
    .filter((pattern) => pattern.test(value)).length;
  return types >= 3 ? '' : '密码需包含大写字母、小写字母、数字、特殊符号中的至少三类。';
}

export default function AccountPanel({
  state = emptyState, disabled = false, signedIn = false, resetVersion = 0,
  onSubmit, onCancel, onLogout,
}) {
  const id = useId();
  const usernameRef = useRef(null);
  const triggerRef = useRef(null);
  const pendingRef = useRef(false);
  const attemptVersionRef = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [hideExternalMessage, setHideExternalMessage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = state.status === 'loading' || submitting;
  const unavailable = disabled || busy;
  const externalMessage = hideExternalMessage ? '' : (state.message || '');
  const errorMessage = localError || (state.status === 'error' ? externalMessage : '');
  const statusMessage = state.status !== 'error' ? externalMessage : '';
  const isRegister = mode === 'register';
  const panelRef = useAutoHeightMotion([expanded, mode, errorMessage, statusMessage, signedIn]);

  useEffect(() => {
    if (expanded && !signedIn) usernameRef.current?.focus({ preventScroll: true });
  }, [expanded, mode, signedIn]);

  useEffect(() => {
    setHideExternalMessage(false);
  }, [state.status, state.message]);

  useEffect(() => {
    attemptVersionRef.current += 1;
    pendingRef.current = false;
    setSubmitting(false);
    setUsername('');
    setPassword('');
    setConfirmation('');
    setLocalError('');
    setErrorField('');
    setHideExternalMessage(false);
  }, [resetVersion]);

  useEffect(() => {
    if (state.registered || state.suggestLogin) {
      setMode('login');
      setPassword('');
      setConfirmation('');
      setLocalError('');
      setErrorField('');
      setHideExternalMessage(false);
    }
  }, [state.registered, state.suggestLogin]);

  useEffect(() => {
    if (signedIn) {
      setExpanded(false);
      setUsername('');
      setPassword('');
      setConfirmation('');
      setLocalError('');
      setErrorField('');
    }
  }, [signedIn]);

  function clearError() {
    setLocalError('');
    setErrorField('');
    setHideExternalMessage(true);
  }

  function changeMode(nextMode) {
    if (unavailable || nextMode === mode) return;
    setMode(nextMode);
    setPassword('');
    setConfirmation('');
    clearError();
  }

  function closeForm() {
    attemptVersionRef.current += 1;
    pendingRef.current = false;
    setSubmitting(false);
    setUsername('');
    setPassword('');
    setConfirmation('');
    clearError();
    setExpanded(false);
    onCancel?.();
    triggerRef.current?.focus({ preventScroll: true });
  }

  async function submit(event) {
    event.preventDefault();
    if (unavailable || pendingRef.current) return;
    const normalizedUsername = username.trim();
    clearError();
    if (!usernamePattern.test(normalizedUsername)) {
      setLocalError('用户名需为 2–48 位，以字母或数字开头，仅可包含字母、数字、点、下划线和短横线。');
      setErrorField('username');
      usernameRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!password) {
      setLocalError('请输入密码。');
      setErrorField('password');
      return;
    }
    if (isRegister) {
      const passwordError = registrationPasswordError(password);
      if (passwordError) {
        setLocalError(passwordError);
        setErrorField('password');
        return;
      }
      if (password !== confirmation) {
        setLocalError('两次输入的密码不一致，请重新确认。');
        setErrorField('confirmation');
        return;
      }
    }

    pendingRef.current = true;
    const attemptVersion = ++attemptVersionRef.current;
    setSubmitting(true);
    setUsername(normalizedUsername);
    setPassword('');
    setConfirmation('');
    try {
      await onSubmit?.({ mode, username: normalizedUsername, password });
    } catch {
      if (attemptVersion !== attemptVersionRef.current) return;
      setLocalError(isRegister ? '暂时无法注册，请稍后重试。' : '暂时无法登录，请稍后重试。');
    } finally {
      if (attemptVersion === attemptVersionRef.current) {
        pendingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  if (signedIn) {
    return <section ref={panelRef} className="home-account home-account-signed-in" aria-label="我的账号">
      <div className="home-account-session">
        <p role="status" aria-live="polite">已登录</p>
        <button type="button" className="home-account-logout" disabled={unavailable}
          onClick={() => onLogout?.()}>退出登录</button>
      </div>
      {errorMessage && <p className="home-account-error" role="alert">{errorMessage}</p>}
      {statusMessage && <p className="home-account-status" role="status" aria-live="polite">{statusMessage}</p>}
    </section>;
  }

  return <section ref={panelRef} className="home-account" aria-label="我的账号">
    <div className="home-account-heading">
      <p>登录后，接着写自己的故事。</p>
      <button ref={triggerRef} type="button" className="home-account-toggle"
        aria-expanded={expanded} aria-controls={id + '-form'}
        disabled={unavailable} onClick={() => expanded ? closeForm() : setExpanded(true)}>
        {expanded ? '收起账号面板' : '登录 / 注册'}
      </button>
    </div>
    {!expanded && errorMessage && <p className="home-account-error" role="alert">{errorMessage}</p>}
    {expanded && <div className="home-account-panel" id={id + '-form'}>
      <div className="home-account-modes" role="group" aria-label="选择登录或注册">
        <button type="button" aria-pressed={!isRegister} disabled={unavailable}
          onClick={() => changeMode('login')}>登录</button>
        <button type="button" aria-pressed={isRegister} disabled={unavailable}
          onClick={() => changeMode('register')}>注册</button>
      </div>
      <form className="home-account-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="home-account-field">
          <label htmlFor={id + '-username'}>用户名</label>
          <input ref={usernameRef} id={id + '-username'} name="username" type="text"
            value={username} autoComplete="username" autoCapitalize="none" spellCheck={false}
            maxLength={48} required disabled={unavailable}
            aria-invalid={errorField === 'username'}
            aria-describedby={id + '-username-hint' + (errorField === 'username' ? ' ' + id + '-error' : '')}
            onChange={(event) => { setUsername(event.target.value); clearError(); }} />
          <p className="home-account-hint" id={id + '-username-hint'}>
            用户名区分大小写。{isRegister && '2–48 位，以字母或数字开头，仅可使用字母、数字、点、下划线和短横线。'}
          </p>
        </div>
        <div className="home-account-field">
          <label htmlFor={id + '-password'}>密码</label>
          <input id={id + '-password'} name="password" type="password"
            value={password} autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={isRegister ? 32 : 128} required disabled={unavailable}
            aria-invalid={errorField === 'password'}
            aria-describedby={isRegister ? id + '-password-hint' + (errorField === 'password' ? ' ' + id + '-error' : '') : (errorField === 'password' ? id + '-error' : undefined)}
            onChange={(event) => { setPassword(event.target.value); clearError(); }} />
          {isRegister && <p className="home-account-hint" id={id + '-password-hint'}>
            8–32 位，以字母或数字开头；大写字母、小写字母、数字、特殊符号至少三类。
            特殊符号仅限 <span className="home-account-symbols">{'()!@#$%^&*|?><_-'}</span>。
          </p>}
        </div>
        {isRegister && <div className="home-account-field">
          <label htmlFor={id + '-confirmation'}>确认密码</label>
          <input id={id + '-confirmation'} name="password-confirmation" type="password"
            value={confirmation} autoComplete="new-password" maxLength={32} required
            disabled={unavailable} aria-invalid={errorField === 'confirmation'}
            aria-describedby={errorField === 'confirmation' ? id + '-error' : undefined}
            onChange={(event) => { setConfirmation(event.target.value); clearError(); }} />
        </div>}
        {isRegister && <p className="home-account-note">注册后自动登录，记录只归你自己。</p>}
        {errorMessage && <p className="home-account-error" id={id + '-error'} role="alert">{errorMessage}</p>}
        {statusMessage && <p className="home-account-status" role="status" aria-live="polite">{statusMessage}</p>}
        <div className="home-account-actions">
          <button className="home-account-submit" type="submit" disabled={unavailable}>
            {busy ? (isRegister ? '正在注册…' : '正在登录…') : (isRegister ? '注册并登录' : '登录')}
          </button>
          <button className="home-account-cancel" type="button" onClick={closeForm}>取消</button>
        </div>
      </form>
    </div>}
  </section>;
}

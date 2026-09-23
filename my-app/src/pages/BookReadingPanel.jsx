import { useEffect, useRef, useState } from 'react';
import { countCharacters, validateNote } from '../../shared/validation.js';
import { deleteNote, saveNote, setFavorite } from '../services/localStore.js';

export default function BookReadingPanel({ book, favorite, note, onSaved, onReload, onDraftChange }) {
  const [savedNote, setSavedNote] = useState(note);
  const [body, setBody] = useState(note?.body || '');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const deleteDialog = useRef(null);
  const reloadDialog = useRef(null);
  const dirty = body !== (savedNote?.body || '');

  useEffect(() => {
    onDraftChange({ dirty, saving: busy });
    const beforeUnload = (event) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy, onDraftChange]);

  useEffect(() => () => onDraftChange({ dirty: false, saving: false }), [onDraftChange]);

  async function write(action, success) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try { success(await action()); }
    catch (failure) {
      setError(failure.code === 'LOCAL_VERSION_CONFLICT' ? failure.message
        : '本地写入未完成，请重试。当前输入与上次成功保存的状态均已保留。');
    } finally { lock.current = false; setBusy(false); }
  }

  function submit(event) {
    event.preventDefault();
    const validation = validateNote(body);
    setFieldError(validation);
    setMessage('');
    if (validation) return;
    write(() => saveNote(book.id, body, savedNote), (value) => {
      setSavedNote(value);
      onSaved('notes', value);
      setMessage('备注已保存在当前浏览器，原文与日期已保留。');
    });
  }

  return (
    <section className="reading-panel" aria-labelledby="reading-title">
      <h3 id="reading-title">我的阅读记录</h3>
      <p className="storage-notice">收藏和备注仅保存在当前浏览器，换设备不共享；清理浏览器数据可能丢失，同一浏览器配置的使用者可以看到。备注由你填写，不会发送给 AI。</p>
      <div className="record-actions">
        <span>{favorite ? '已收藏' : '未收藏'}</span>
        <button type="button" disabled={busy} onClick={() => write(
          () => setFavorite(book.id, !favorite),
          (value) => {
            onSaved('favorites', value);
            setMessage(value ? '已收藏。' : '已取消收藏，备注保留。');
          },
        )}>{favorite ? '取消收藏' : '收藏作品'}</button>
        <button type="button" disabled={busy} onClick={() => {
          if (dirty) reloadDialog.current.showModal();
          else onReload();
        }}>重新读取</button>
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="reading-note">我的阅读备注（原文）</label>
        <textarea id="reading-note" rows={6} value={body} disabled={busy}
          aria-invalid={Boolean(fieldError)} aria-describedby="note-help note-count note-error"
          onChange={(event) => { setBody(event.target.value); setFieldError(''); setMessage(''); }} />
        <div className="input-help">
          <p className="scope-note" id="note-help">每件作品一条备注，保存时保留空格和换行；无需先收藏。</p>
          <p id="note-count">{countCharacters(body)} / 1000 字符</p>
        </div>
        <p id="note-error" className="field-error" role={fieldError ? 'alert' : undefined}>{fieldError}</p>
        <div className="record-actions">
          <button type="submit" className="primary-button" disabled={busy}>{busy ? '正在处理…' : '保存备注'}</button>
          {savedNote && <button type="button" className="danger-button" disabled={busy}
            onClick={() => deleteDialog.current.showModal()}>删除备注</button>}
          {dirty && <span>有未保存的更改</span>}
        </div>
      </form>
      {savedNote ? (
        <div className="saved-note">
          <h4>上次保存的原文</h4>
          <p className="entry-original">{savedNote.body}</p>
          <p className="saved-date">创建：<time dateTime={savedNote.createdAt}>{new Date(savedNote.createdAt).toLocaleString('zh-CN')}</time><br />
            更新：<time dateTime={savedNote.updatedAt}>{new Date(savedNote.updatedAt).toLocaleString('zh-CN')}</time></p>
        </div>
      ) : <p>这件作品还没有已保存的备注。</p>}
      {error && <p className="error-panel" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      <dialog ref={deleteDialog} aria-labelledby="delete-note-title">
        <h2 id="delete-note-title">删除《{book.title}》的备注？</h2>
        <p>只删除这件作品的备注，收藏保持不变。删除后无法恢复；本页未保存的备注输入也会清空。</p>
        <p className="delete-preview">{savedNote?.body}</p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => deleteDialog.current.close()}>保留备注</button>
          <button type="button" className="danger-button" onClick={() => {
            deleteDialog.current.close();
            write(() => deleteNote(book.id, savedNote), () => {
              setSavedNote(null);
              setBody('');
              setFieldError('');
              onSaved('notes', null);
              setMessage('备注已删除，收藏状态保持不变。');
            });
          }}>确认删除</button>
        </div>
      </dialog>
      <dialog ref={reloadDialog} aria-labelledby="reload-note-title">
        <h2 id="reload-note-title">放弃本页输入并重新读取？</h2>
        <p>先复制需要保留的输入。重新读取会载入最新保存的内容，丢弃本页尚未保存的更改。</p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => reloadDialog.current.close()}>继续编辑</button>
          <button type="button" onClick={onReload}>放弃并重新读取</button>
        </div>
      </dialog>
    </section>
  );
}

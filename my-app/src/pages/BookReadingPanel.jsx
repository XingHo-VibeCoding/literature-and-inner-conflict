import { useEffect, useRef, useState } from 'react';
import { countCharacters, validateNote } from '../../shared/validation.js';
import { useAccountSession } from '../components/AccountSession.jsx';
import { sortNoteHistory } from '../services/readingModel.js';

export default function BookReadingPanel({ book, favorite, notes, onFavoriteChange, onNotesChange, onReload, onDraftChange }) {
  const { data, signedIn, busy: accountBusy } = useAccountSession();
  const mounted = useRef(false);
  const savedNotes = sortNoteHistory(notes);
  const savedNote = savedNotes[0] || null;
  const olderNotes = savedNotes.slice(1);
  const [body, setBody] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingNote, setDeletingNote] = useState(null);
  const [operation, setOperation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const lock = useRef(false);
  const favoriteLock = useRef(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const deleteDialog = useRef(null);
  const reloadDialog = useRef(null);
  const input = useRef(null);
  const latestHeading = useRef(null);
  const summaryButtons = useRef(new Map());
  const pendingFocus = useRef(null);
  const dirty = body !== '';
  const processing = busy || favoriteBusy;
  const showingHistory = historyOpen && olderNotes.length > 0;

  useEffect(() => {
    onDraftChange({ dirty, saving: processing });
    const beforeUnload = (event) => {
      if (dirty || processing) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, processing, onDraftChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onDraftChange({ dirty: false, saving: false });
    };
  }, [onDraftChange]);

  useEffect(() => {
    if (processing || !pendingFocus.current) return;
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    focus();
  }, [processing, notes]);

  async function write(action, success, nextOperation) {
    if (!mounted.current || !signedIn || !data || lock.current || favoriteLock.current) return;
    lock.current = true;
    setBusy(true);
    setOperation(nextOperation);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (mounted.current) success(result);
    }
    catch (failure) {
      if (!mounted.current) return;
      setError(['LOCAL_VERSION_CONFLICT', 'LOCAL_NOTE_LINK_CONFLICT', 'VERSION_CONFLICT', 'NOTE_LINK_CONFLICT'].includes(failure.code) ? failure.message
        : '账户云端写入结果未确认。当前输入与上次成功读取的状态均已保留，请先重新读取核对，再决定是否重试。');
    } finally {
      if (!mounted.current) return;
      if (!pendingFocus.current) {
        pendingFocus.current = nextOperation?.type === 'summary'
          ? () => summaryButtons.current.get(nextOperation.noteId)?.focus()
          : () => input.current?.focus();
      }
      lock.current = false;
      setBusy(false);
      setOperation(null);
    }
  }

  function submit(event) {
    event.preventDefault();
    const validation = validateNote(body);
    setFieldError(validation);
    setMessage('');
    if (validation) { input.current?.focus(); return; }
    write(() => data.appendNote(book.id, body), (value) => {
      onNotesChange((current) => [...current, value]);
      setBody('');
      setHistoryOpen(false);
      pendingFocus.current = () => input.current?.focus();
      setMessage('阅读备注与感悟已保存到账户云端，新增为一条独立记录，原文和保存时间已保留。');
    }, { type: 'save' });
  }

  async function toggleFavorite() {
    if (!mounted.current || !signedIn || !data || favoriteLock.current || lock.current) return;
    const wasFavorite = favorite;
    favoriteLock.current = true;
    setFavoriteBusy(true);
    setError('');
    setMessage('');
    try {
      await data.setFavorite(book.id, !wasFavorite);
      if (!mounted.current) return;
      onFavoriteChange(book.id, !wasFavorite);
      setMessage(wasFavorite
        ? `已取消收藏《${book.title}》。`
        : `已收藏《${book.title}》，已保存到账户云端。`);
    } catch {
      if (!mounted.current) return;
      setError(wasFavorite
        ? '取消收藏失败：结果未确认，页面保留已收藏状态，请重新读取后核对。'
        : '收藏失败：结果未确认，页面保留未收藏状态，请重新读取后核对。');
    } finally {
      favoriteLock.current = false;
      if (mounted.current) setFavoriteBusy(false);
    }
  }

  function toggleSummary(note) {
    const enabled = !note.summaryLink?.active;
    write(() => data.setNoteInSummary(note.id, enabled, note.revision), (result) => {
      onNotesChange((current) => current.map((item) => item.id === result.note.id ? result.note : item));
      const messages = {
        added: '已保存到总结库，刷新后仍会保留；再次点击可取消。',
        reused: '已重新关联原有总结，保留其中的内容，没有重复新建。',
        removed: '已取消保存到总结库，阅读备注与感悟仍保留。',
        'preserved-edited': '已取消这条备注的入库关联；总结中的副本已被你修改，因此保留了修改后的内容。',
        unchanged: '这条备注的入库状态已与账户云端记录同步。',
      };
      setMessage(messages[result.outcome]);
      pendingFocus.current = () => summaryButtons.current.get(note.id)?.focus();
    }, { type: 'summary', noteId: note.id, enabled });
  }

  function renderSavedNote(note, latest) {
    const selected = Boolean(note.summaryLink?.active);
    const changing = busy && operation?.type === 'summary' && operation.noteId === note.id;
    const Heading = latest ? 'h3' : 'h4';
    const savedLabel = new Date(note.savedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    return (
      <article className={`saved-note${selected ? ' is-in-summary' : ''}`} key={note.id}
        aria-labelledby={`note-title-${note.id}`}>
        <div className="saved-note-copy">
          <Heading id={`note-title-${note.id}`} ref={latest ? latestHeading : undefined} tabIndex={-1}>
            {latest ? '上次保存的原文' : '往期阅读备注与感悟'}
          </Heading>
          <p className="entry-original">{note.body}</p>
          <p className="saved-date">保存时间：<time dateTime={note.savedAt}>
            {savedLabel}
          </time>（北京时间）</p>
        </div>
        <div className="note-summary-action">
          <button type="button" className="favorite-button summary-toggle" disabled={processing}
            ref={(button) => {
              if (button) summaryButtons.current.set(note.id, button);
              else summaryButtons.current.delete(note.id);
            }}
            aria-pressed={selected} aria-busy={changing}
            aria-label={`${selected ? '取消' : '保存'} ${savedLabel} 的${latest ? '最新' : '往期'}备注到总结库`}
            onClick={() => toggleSummary(note)}>
            {changing ? selected ? '取消中…' : '保存中…' : selected ? '已保存到总结库' : '保存到总结库'}
          </button>
          {selected && <span className="scope-note">再次点击可取消</span>}
        </div>
      </article>
    );
  }

  if (!signedIn || !data) return <section className="reading-panel" aria-labelledby="reading-title">
    <h2 id="reading-title">我的阅读记录</h2>
    <p role="status">{accountBusy ? '正在核验账户，尚未读取个人阅读记录…' : !signedIn
      ? '请先登录，再保存自己的阅读备注、感悟与收藏。' : '账户云端数据服务尚未正确配置，个人阅读记录未读取。'}</p>
  </section>;

  return (
    <section className="reading-panel" aria-labelledby="reading-title">
      <h2 id="reading-title">我的阅读记录</h2>
      <p className="storage-notice">阅读备注与感悟、总结关联和书本收藏保存在当前账户的云端，刷新后会重新读取。原文由你填写，不会发送给 AI。</p>
      <div className="record-actions">
        <span aria-live="polite">{favorite ? '已收藏' : '未收藏'}</span>
        <button type="button" className="favorite-button" disabled={processing}
          aria-busy={favoriteBusy} aria-pressed={favorite}
          aria-label={favorite ? `已收藏《${book.title}》，点击取消收藏` : `收藏《${book.title}》`}
          onClick={() => void toggleFavorite()}>
          {favoriteBusy ? (favorite ? '取消中…' : '收藏中…') : favorite ? '已收藏' : '收藏'}
        </button>
        <button type="button" disabled={processing} onClick={() => {
          if (dirty) reloadDialog.current.showModal();
          else onReload();
        }}>重新读取备注与感悟</button>
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="reading-note">我的阅读备注与感悟（原文）</label>
        <textarea id="reading-note" ref={input} rows={6} value={body} disabled={processing}
          aria-invalid={Boolean(fieldError)} aria-describedby="note-help note-count note-error"
          onChange={(event) => { setBody(event.target.value); setFieldError(''); setMessage(''); }} />
        <div className="input-help">
          <p className="scope-note" id="note-help">每次保存新增一条，保留原文空格和换行；无需先收藏。</p>
          <p id="note-count">{countCharacters(body)} / 1000 字符</p>
        </div>
        <p id="note-error" className="field-error" role={fieldError ? 'alert' : undefined}>{fieldError}</p>
        <div className="record-actions">
          <button type="submit" className="primary-button" disabled={processing}>
            {busy && operation?.type === 'save' ? '正在保存…' : '保存备注与感悟'}
          </button>
          {savedNote && <button type="button" className="danger-button" disabled={processing}
            onClick={() => { setDeletingNote(savedNote); deleteDialog.current.showModal(); }}>删除备注</button>}
          {savedNote && <button type="button" disabled={processing || olderNotes.length === 0}
            aria-expanded={showingHistory} aria-controls="past-reading-notes"
            onClick={() => setHistoryOpen((value) => !value)}>
            {showingHistory ? '收起往期备注' : '查看往期备注'}（{olderNotes.length}）
          </button>}
          {dirty && <span>有未保存的更改</span>}
        </div>
      </form>
      {error && <p className="error-panel" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      {savedNote ? renderSavedNote(savedNote, true) : <p>这件作品还没有已保存的阅读备注与感悟。</p>}
      <section id="past-reading-notes" className="past-reading-notes" hidden={!showingHistory}
        aria-labelledby="past-reading-title">
        <h3 id="past-reading-title">往期阅读备注与感悟</h3>
        {showingHistory && olderNotes.map((note) => renderSavedNote(note, false))}
      </section>
      <dialog ref={deleteDialog} aria-labelledby="delete-note-title">
        <h2 id="delete-note-title">删除《{book.title}》最新的一条备注？</h2>
        <p>只删除下面这条，往期备注和本页尚未保存的输入均保留。已加入总结库的记录独立保留；删除备注后无法恢复。</p>
        <p className="delete-preview">{deletingNote?.body}</p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => deleteDialog.current.close()}>保留备注</button>
          <button type="button" className="danger-button" onClick={() => {
            deleteDialog.current.close();
            if (!deletingNote) return;
            write(() => data.deleteHistoryNote(deletingNote.id, deletingNote.revision), (id) => {
              onNotesChange((current) => current.filter((item) => item.id !== id));
              setMessage('这条备注已删除；更早的备注、当前输入与总结库记录均保留。');
              pendingFocus.current = () => {
                if (savedNotes.length > 1) latestHeading.current?.focus();
                else input.current?.focus();
              };
            }, { type: 'delete', noteId: deletingNote.id });
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

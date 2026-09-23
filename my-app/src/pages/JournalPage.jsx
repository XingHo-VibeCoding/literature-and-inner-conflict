import { useEffect, useRef, useState } from 'react';
import { countCharacters, localToday, validateEntry } from '../../shared/validation.js';
import { createEntry, deleteEntry, readEntries, updateEntry } from '../services/localStore.js';
import { sortEntries } from '../services/entryModel.js';
import { DEMO_ENTRY_TEXT } from '../services/analysisModel.js';
import AnalysisPanel from './AnalysisPanel.jsx';

export default function JournalPage({ onDraftChange }) {
  const baseline = useRef({ entryDate: localToday(), text: '' });
  const [entryDate, setEntryDate] = useState(baseline.current.entryDate);
  const [text, setText] = useState('');
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('view');
  const [editBase, setEditBase] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const [analysisState, setAnalysisState] = useState({ dirty: false, saving: false });
  const [analysisVisit, setAnalysisVisit] = useState(0);
  const submitting = useRef(false);
  const dialog = useRef(null);
  const entry = entries.find((item) => item.id === selectedId);
  const editing = mode === 'new' || mode === 'edit';
  const formDirty = editing && (text !== baseline.current.text || entryDate !== baseline.current.entryDate);
  const dirty = formDirty || analysisState.dirty;
  const busy = working || analysisState.saving;
  const count = countCharacters(text);

  function resetForm(value = { entryDate: localToday(), text: '' }) {
    baseline.current = { entryDate: value.entryDate, text: value.text };
    setEntryDate(value.entryDate);
    setText(value.text);
    setErrors({});
    setOperationError('');
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError('');
    setNotice('');
    readEntries().then((saved) => {
      if (!active) return;
      setEntries(saved);
      setSelectedId((current) => saved.some((item) => item.id === current) ? current : saved[0]?.id || null);
      setMode(saved.length ? 'view' : 'new');
      setEditBase(null);
      resetForm();
      setNotice(saved.length ? '已从此浏览器读取记录。' : '');
    }).catch(() => {
      if (active) setReadError('暂时无法读取此浏览器的记录。这不代表记录为空，原有数据不会被清除，请稍后重试。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    onDraftChange({ dirty, saving: busy });
  }, [dirty, busy, onDraftChange]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, busy]);

  useEffect(() => {
    if (confirmation) dialog.current.showModal();
    else dialog.current.close();
  }, [confirmation]);

  function applyAction(action) {
    setAnalysisState({ dirty: false, saving: false });
    setAnalysisVisit((value) => value + 1);
    setNotice('');
    setOperationError('');
    setErrors({});
    setEditBase(null);
    if (action.type === 'fixture') {
      resetForm({ entryDate, text: '' });
      setText(DEMO_ENTRY_TEXT);
      setSelectedId(null);
      setMode('new');
    } else if (action.type === 'delete') {
      setConfirmation({ kind: 'delete', entry });
    } else if (action.type === 'new') {
      resetForm();
      setSelectedId(null);
      setMode('new');
    } else if (action.type === 'edit') {
      resetForm(entry);
      setEditBase(entry);
      setMode('edit');
    } else if (action.type === 'reload') {
      setLoadAttempt((attempt) => attempt + 1);
    } else {
      const nextId = action.id || selectedId || entries[0]?.id || null;
      setSelectedId(nextId);
      setMode(nextId ? 'view' : 'new');
      resetForm();
    }
  }

  function requestAction(action) {
    if (submitting.current || analysisState.saving) return;
    if (dirty) setConfirmation({ kind: 'discard', action });
    else applyAction(action);
  }

  function reportFailure(error, fallback) {
    setOperationError(error.code === 'LOCAL_VERSION_CONFLICT' ? error.message : fallback);
  }

  async function save(input) {
    if (submitting.current) return;
    submitting.current = true;
    setWorking(true);
    setOperationError('');
    setNotice('');
    try {
      const saved = mode === 'edit'
        ? await updateEntry(editBase.id, input, editBase.revision)
        : await createEntry(input);
      setEntries((current) => sortEntries([...current.filter((item) => item.id !== saved.id), saved]));
      setSelectedId(saved.id);
      setMode('view');
      setEditBase(null);
      resetForm();
      setNotice(mode === 'edit'
        ? editBase.adoptedAnalysis && input.text !== editBase.text
          ? '原文修改已保存，对应的旧分析已清除，可重新核对分析。'
          : '修改已保存在此浏览器，原记录已更新。'
        : '已保存在此浏览器。');
    } catch (error) {
      reportFailure(error, '保存未成功，输入已保留。请检查浏览器存储是否可用，或稍后重试；此前保存的内容不会被覆盖。');
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  }

  function handleSave(event) {
    event.preventDefault();
    if (submitting.current) return;
    const input = { entryDate, text };
    const nextErrors = validateEntry(input);
    setErrors(nextErrors);
    setOperationError('');
    if (Object.keys(nextErrors).length) return;
    if (mode === 'edit' && editBase.adoptedAnalysis && text !== editBase.text) {
      setConfirmation({ kind: 'replace', input });
    } else void save(input);
  }

  async function remove(target) {
    if (submitting.current) return;
    submitting.current = true;
    setWorking(true);
    setOperationError('');
    setNotice('');
    try {
      await deleteEntry(target.id, target.revision);
      const remaining = entries.filter((item) => item.id !== target.id);
      setEntries(remaining);
      setSelectedId(remaining[0]?.id || null);
      setMode(remaining.length ? 'view' : 'new');
      resetForm();
      setNotice('记录已删除。');
    } catch (error) {
      reportFailure(error, '删除未成功，记录仍保留在页面中。请稍后重试。');
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  }

  function confirmAction() {
    const action = confirmation;
    setConfirmation(null);
    if (action.kind === 'discard') applyAction(action.action);
    else if (action.kind === 'replace') void save(action.input);
    else void remove(action.entry);
  }

  return (
    <div className="journal">
      <p className="storage-notice">
        数据仅保存在当前浏览器；换设备不共享，清理浏览器数据后可能丢失。
        同一浏览器的使用者可读取这些记录。本步操作均在本地完成，不会发送给 AI。
      </p>
      <p className="scope-note">按日期回看自己的想法与行动。分析目前支持虚构示例的本地演示，真实 AI 尚未接入。</p>
      {loading && <p role="status">正在读取此浏览器的记录……</p>}
      {readError && <div className="error-panel" role="alert">
        <p>{readError}</p>
        <button type="button" onClick={() => requestAction({ type: 'reload' })}>重新读取记录</button>
      </div>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {operationError && <div className="error-panel" role="alert">
        <p>{operationError}</p>
        <button type="button" disabled={busy} onClick={() => requestAction({ type: 'reload' })}>重新读取记录</button>
      </div>}

      {!loading && !readError && <>
        <div className="journal-toolbar">
          <button type="button" disabled={busy} onClick={() => requestAction({ type: 'new' })}>新建日精进</button>
          <button type="button" disabled={busy} onClick={() => requestAction({ type: 'reload' })}>刷新记录列表</button>
        </div>
        <section className="history-section" aria-labelledby="history-title">
          <h2 id="history-title">历史记录（{entries.length} 条）</h2>
          <p className="scope-note">记录日期从新到旧，同一天按创建时间从新到旧。</p>
          {entries.length ? <ol className="history-list">
            {entries.map((item) => <li key={item.id}>
              <button className="history-item" type="button" disabled={busy}
                aria-current={selectedId === item.id ? 'true' : undefined}
                onClick={() => requestAction({ type: 'select', id: item.id })}>
                <time dateTime={item.entryDate}>{item.entryDate}</time>
                <span className="history-excerpt">{Array.from(item.text.trim()).slice(0, 64).join('')}{countCharacters(item.text) > 64 ? '…' : ''}</span>
                <span className="scope-note">{item.adoptedAnalysis?.source === 'demo' ? '有已采纳演示分析' : item.adoptedAnalysis ? '有已采纳分析' : '暂无已采纳分析'}</span>
              </button>
            </li>)}
          </ol> : <p>还没有保存的日精进，可以从下面写下第一条。</p>}
        </section>

        {editing && <form className="journal-form" onSubmit={handleSave} noValidate>
          <fieldset disabled={working}>
            <legend>{mode === 'edit' ? '修改这条日精进' : '写下一条日精进'}</legend>
            {mode === 'new' && <div className="record-actions">
              <button type="button" onClick={() => requestAction({ type: 'fixture' })}>填写虚构示例</button>
              <span className="scope-note">仅填入表单，保存后才能载入演示分析。</span>
            </div>}
            <label htmlFor="entry-date">记录日期</label>
            <input id="entry-date" type="date" min="0001-01-01" max={localToday()} value={entryDate}
              onChange={(event) => { setEntryDate(event.target.value); setErrors({}); setOperationError(''); }}
              aria-invalid={Boolean(errors.entryDate)} aria-describedby={errors.entryDate ? 'date-error' : undefined} />
            {errors.entryDate && <p className="field-error" id="date-error" role="alert">{errors.entryDate}</p>}

            <label htmlFor="entry-text">日精进原文</label>
            <textarea id="entry-text" rows={8} value={text}
              placeholder="写下今天发生了什么、你的想法，以及实际做出的行动。"
              onChange={(event) => { setText(event.target.value); setErrors({}); setOperationError(''); }}
              aria-invalid={Boolean(errors.text)} aria-describedby={`text-help character-count${errors.text ? ' text-error' : ''}`} />
            <div className="input-help">
              <p className="scope-note" id="text-help">首尾空白不计入字数；保存时保留原文和换行。</p>
              <p className={count > 5000 ? 'field-error' : 'scope-note'} id="character-count">{count} / 5000 字</p>
            </div>
            {errors.text && <p className="field-error" id="text-error" role="alert">{errors.text}</p>}
            <div className="record-actions">
              <button className="primary-button" type="submit" disabled={mode === 'edit' && !formDirty}>
                {working ? '正在保存……' : mode === 'edit' ? '保存修改' : '保存日精进'}
              </button>
              {entries.length > 0 && <button type="button" onClick={() => requestAction({ type: 'cancel' })}>取消编辑</button>}
            </div>
            <p className="scope-note">请先保存原文，再查看分析。真实 AI 尚未接入；演示仅适用于“填写虚构示例”提供的固定原文。</p>
          </fieldset>
        </form>}

        {!editing && entry && <section className="saved-entry" aria-labelledby="saved-title">
          <h2 id="saved-title">记录详情</h2>
          <p className="saved-date">记录日期：<time dateTime={entry.entryDate}>{entry.entryDate}</time></p>
          <h3>你的原文</h3>
          <p className="entry-original">{entry.text}</p>
          <p className="scope-note">创建时间：{new Date(entry.createdAt).toLocaleString('zh-CN')}<br />更新时间：{new Date(entry.updatedAt).toLocaleString('zh-CN')}</p>
          {entry.adoptedAnalysis && <section className="adopted-analysis"
            aria-label={entry.adoptedAnalysis.source === 'demo' ? '已采纳的演示分析' : '已采纳的 AI 分析'}>
            <h3>{entry.adoptedAnalysis.source === 'demo' ? '已采纳的演示分析' : '已采纳的 AI 分析'}</h3>
            <p>{entry.adoptedAnalysis.source === 'demo'
              ? '来自固定虚构测试结果，经你核对或编辑后采纳；非真实 AI 生成，与原文分开展示。'
              : 'AI 生成并经你采纳，与原文分开展示。'}</p>
            <p className="entry-original">{entry.adoptedAnalysis.summary}</p>
            <ul>{entry.adoptedAnalysis.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
            {entry.adoptedAnalysis.adoptedAt && <p className="scope-note">采纳时间：<time dateTime={entry.adoptedAnalysis.adoptedAt}>{new Date(entry.adoptedAnalysis.adoptedAt).toLocaleString('zh-CN')}</time></p>}
          </section>}
          <AnalysisPanel key={`${entry.id}:${analysisVisit}`} entry={entry} disabled={working} onStateChange={setAnalysisState}
            onAdopted={(saved) => setEntries((current) => sortEntries(current.map((item) => item.id === saved.id ? saved : item)))} />
          <div className="record-actions">
            <button type="button" disabled={busy} onClick={() => requestAction({ type: 'edit' })}>修改记录</button>
            <button className="danger-button" type="button" disabled={busy} onClick={() => requestAction({ type: 'delete' })}>删除记录</button>
            <a href="#/books">从这条记录去选书</a>
          </div>
          {busy && <p role="status">正在处理，请稍候……</p>}
        </section>}
      </>}

      <dialog ref={dialog} aria-labelledby="record-confirm-title" onCancel={() => setConfirmation(null)}>
        <h2 id="record-confirm-title">{confirmation?.kind === 'delete' ? '确认删除这条记录？' : confirmation?.kind === 'replace' ? '修改原文会清除旧分析' : '要放弃未保存的更改吗？'}</h2>
        {confirmation?.kind === 'delete' ? <>
          <p>将删除 {confirmation.entry.entryDate} 的这条日精进及其已采纳分析。此操作无法撤回，不影响其他记录。</p>
          <p className="delete-preview">{Array.from(confirmation.entry.text).slice(0, 100).join('')}</p>
        </> : <p>{confirmation?.kind === 'replace'
          ? '这条记录的原文已改变，保存后会清除对应的旧分析。仅修改日期不会清除分析。'
          : '继续操作会丢弃这次尚未保存的输入，已经保存的内容不受影响。'}</p>}
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => setConfirmation(null)}>{confirmation?.kind === 'delete' ? '保留记录' : '继续编辑'}</button>
          <button type="button" className={confirmation?.kind === 'delete' ? 'danger-button' : ''} onClick={confirmAction}>
            {confirmation?.kind === 'delete' ? '确认删除' : confirmation?.kind === 'replace' ? '确认修改原文' : '放弃更改'}
          </button>
        </div>
      </dialog>
    </div>
  );
}

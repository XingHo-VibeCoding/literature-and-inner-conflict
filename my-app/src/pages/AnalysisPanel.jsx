import { useEffect, useRef, useState } from 'react';
import { countCharacters, validateAnalysis } from '../../shared/validation.js';
import { createDemoDraft, isDemoEntry } from '../services/analysisModel.js';
import { requireCurrentEntry } from '../services/entryModel.js';
import { readEntry, saveAdoptedDemo } from '../services/localStore.js';

export default function AnalysisPanel({ entry, disabled, onStateChange, onAdopted }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const dialog = useRef(null);
  const request = useRef(0);
  const lock = useRef(false);
  const eligible = isDemoEntry(entry);

  useEffect(() => {
    onStateChange({ dirty: Boolean(draft), saving });
  }, [draft, saving, onStateChange]);

  useEffect(() => () => {
    request.current += 1;
    onStateChange({ dirty: false, saving: false });
  }, [onStateChange]);

  useEffect(() => {
    if (confirmation) dialog.current.showModal();
    else dialog.current.close();
  }, [confirmation]);

  async function loadDemo() {
    if (disabled || lock.current || !eligible) return;
    lock.current = true;
    const token = ++request.current;
    setLoading(true);
    setDraft(null);
    setErrors({});
    setFailure('');
    setNotice('');
    try {
      const latest = await readEntry(entry.id);
      if (request.current !== token) return;
      requireCurrentEntry(latest, entry.revision);
      setDraft(createDemoDraft(latest));
      setNotice('已载入固定演示草稿，尚未保存；没有调用 AI。');
    } catch (error) {
      if (request.current === token) setFailure(error.code === 'LOCAL_VERSION_CONFLICT'
        ? error.message : '演示草稿未能载入。请重新读取记录后再试，已保存内容保持不变。');
    } finally {
      if (request.current === token) { lock.current = false; setLoading(false); }
    }
  }

  async function adopt(event) {
    event.preventDefault();
    if (disabled || lock.current || !draft) return;
    const nextErrors = validateAnalysis(draft);
    setErrors(nextErrors);
    setNotice('');
    if (Object.keys(nextErrors).length) return;
    lock.current = true;
    setSaving(true);
    setFailure('');
    try {
      const saved = await saveAdoptedDemo(draft);
      onAdopted(saved);
      setDraft(null);
      setNotice('演示分析已采纳并保存在当前浏览器；原文与记录日期保持不变。');
    } catch (error) {
      setFailure(error.code === 'LOCAL_VERSION_CONFLICT' ? error.message
        : '采纳保存未成功。草稿和此前成功保存的分析均已保留，请稍后重试。');
    } finally { lock.current = false; setSaving(false); }
  }

  function edit(patch) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setErrors({});
    setNotice('');
  }

  function confirm() {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'reload') void loadDemo();
    else {
      setDraft(null);
      setErrors({});
      setFailure('');
      setNotice('已放弃本次演示草稿，原文和已采纳内容保留。');
    }
  }

  return (
    <section className="analysis-panel" aria-labelledby="analysis-title">
      <h3 id="analysis-title">日精进分析 · 本地演示</h3>
      <p className="storage-notice">真实 AI 尚未接入。这里使用固定的虚构示例和预先编写的测试结果，演示编辑与采纳流程，不会发送原文、历史记录、收藏或备注。</p>
      <div className="record-actions">
        <button type="button" disabled>分析本次总结（AI 暂未接入）</button>
        <button type="button" disabled={disabled || !eligible || loading || saving}
          onClick={() => draft ? setConfirmation('reload') : void loadDemo()}>
          {loading ? '正在读取演示…' : draft ? '重新载入演示草稿' : '载入固定演示草稿'}
        </button>
      </div>
      {!eligible && <p className="scope-note">此记录不是固定虚构示例。可点击“新建日精进”，再选择“填写虚构示例”并保存，体验本地演示。</p>}
      {draft && <form onSubmit={adopt} noValidate>
        <fieldset disabled={disabled || saving}>
          <legend>演示草稿（固定测试结果，非真实 AI 生成）</legend>
          <p>请对照上方原文核对，可编辑后再采纳。修改演示文字也不会改变它的来源标记。</p>
          <label htmlFor="analysis-summary">演示总结</label>
          <textarea id="analysis-summary" rows={4} value={draft.summary}
            aria-invalid={Boolean(errors.summary)} aria-describedby="summary-count summary-error"
            onChange={(event) => edit({ summary: event.target.value })} />
          <p className="scope-note" id="summary-count">{countCharacters(draft.summary)} / 300 字符</p>
          <p className="field-error" id="summary-error" role={errors.summary ? 'alert' : undefined}>{errors.summary}</p>
          {draft.questions.map((question, index) => (
            <div className="analysis-question" key={index}>
              <label htmlFor={`analysis-question-${index}`}>反思问题 {index + 1}</label>
              <textarea id={`analysis-question-${index}`} rows={2} value={question}
                aria-invalid={Boolean(errors[`question${index}`])}
                aria-describedby={`question-count-${index} question-error-${index}`}
                onChange={(event) => edit({ questions: draft.questions.map((value, position) => position === index ? event.target.value : value) })} />
              <p className="scope-note" id={`question-count-${index}`}>{countCharacters(question)} / 100 字符</p>
              <p className="field-error" id={`question-error-${index}`} role={errors[`question${index}`] ? 'alert' : undefined}>{errors[`question${index}`]}</p>
              {draft.questions.length > 1 && <button type="button"
                onClick={() => edit({ questions: draft.questions.filter((_, position) => position !== index) })}>移除问题 {index + 1}</button>}
            </div>
          ))}
          {errors.questions && <p className="field-error" role="alert">{errors.questions}</p>}
          <div className="record-actions">
            {draft.questions.length < 2 && <button type="button" onClick={() => edit({ questions: [...draft.questions, ''] })}>添加反思问题</button>}
            <button type="submit" className="primary-button">{saving ? '正在保存…' : '采纳并保存演示分析'}</button>
            <button type="button" onClick={() => setConfirmation('discard')}>放弃演示草稿</button>
          </div>
        </fieldset>
      </form>}
      {failure && <p className="error-panel" role="alert">{failure}</p>}
      {notice && <p role="status">{notice}</p>}
      <dialog ref={dialog} aria-labelledby="analysis-confirm-title" onCancel={() => setConfirmation(null)}>
        <h2 id="analysis-confirm-title">{confirmation === 'reload' ? '放弃草稿并重新载入演示？' : '放弃本次演示草稿？'}</h2>
        <p>这会丢弃尚未采纳的演示内容和编辑，原文与此前已采纳的分析保持不变。</p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => setConfirmation(null)}>保留草稿</button>
          <button type="button" onClick={confirm}>{confirmation === 'reload' ? '放弃并重新载入' : '确认放弃草稿'}</button>
        </div>
      </dialog>
    </section>
  );
}

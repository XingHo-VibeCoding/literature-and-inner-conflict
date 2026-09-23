import { validateAnalysis } from '../../shared/validation.js';
import { requireCurrentEntry } from './entryModel.js';

export const DEMO_ENTRY_TEXT = '【虚构·分析演示】今天讨论作业时，我担心想法不够好，起初没有发言。\n后来我先写下一个问题，再向同学说明了自己的看法。';
const DEMO_ID = 'discussion-v1';

export function isDemoEntry(entry) {
  return entry?.text?.trim() === DEMO_ENTRY_TEXT;
}

export function createDemoDraft(entry) {
  if (!isDemoEntry(entry)) throw new Error('固定演示只适用于页面提供的虚构示例，不能用于其他原文。');
  return {
    source: 'demo', demoId: DEMO_ID,
    entryId: entry.id, sourceTextVersion: entry.textVersion, baseRevision: entry.revision,
    summary: '这段虚构记录中，叙述者起初因担心想法不够好而没有发言，随后先写下问题，再向同学表达看法。记录只提供了这一次讨论的经历，无法据此判断长期变化。',
    questions: ['先写下一个问题，对这次表达起到了什么作用？', '下次遇到类似场景，你想尝试哪一个小行动？'],
  };
}

export function adoptDemoAnalysis(current, draft, now = new Date().toISOString()) {
  requireCurrentEntry(current, draft?.baseRevision);
  if (current.id !== draft.entryId || current.textVersion !== draft.sourceTextVersion) {
    const error = new Error('分析草稿不属于当前记录的原文版本。草稿已保留，请重新读取记录并核对。');
    error.code = 'LOCAL_VERSION_CONFLICT';
    throw error;
  }
  if (draft.source !== 'demo' || draft.demoId !== DEMO_ID || !isDemoEntry(current)) {
    throw new Error('当前只能采纳对应虚构示例的演示草稿。');
  }
  const errors = validateAnalysis(draft);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    adoptedAnalysis: {
      source: 'demo', demoId: DEMO_ID,
      sourceTextVersion: current.textVersion,
      // 编辑后的内容原样保存；来源标记与正文分开，刷新后仍能识别演示。
      summary: draft.summary, questions: [...draft.questions], adoptedAt: now,
    },
  };
}

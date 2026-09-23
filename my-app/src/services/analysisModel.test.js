import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis } from '../../shared/validation.js';
import { adoptDemoAnalysis, createDemoDraft, DEMO_ENTRY_TEXT } from './analysisModel.js';
import { reviseEntry } from './entryModel.js';

const entry = {
  id: 'fiction-analysis', entryDate: '2026-09-23', text: `  ${DEMO_ENTRY_TEXT}  `,
  textVersion: 1, revision: 1, createdAt: '2026-09-23T01:00:00Z',
  updatedAt: '2026-09-23T01:00:00Z', adoptedAnalysis: null,
};

test('分析编辑校验：总结 1–300 字符，问题 1–2 个且每题 1–100 字符', () => {
  assert.deepEqual(validateAnalysis({ summary: '甲', questions: ['乙'] }), {});
  assert.deepEqual(validateAnalysis({ summary: ' ' + '😀'.repeat(300) + ' ', questions: ['甲'.repeat(100), '乙'] }), {});
  assert.ok(validateAnalysis({ summary: ' \n', questions: ['问题'] }).summary);
  assert.ok(validateAnalysis({ summary: '甲'.repeat(301), questions: ['问题'] }).summary);
  assert.ok(validateAnalysis({ summary: '总结', questions: [' ', '乙'.repeat(101)] }).question0);
  assert.ok(validateAnalysis({ summary: '总结', questions: [' ', '乙'.repeat(101)] }).question1);
  for (const questions of [[], ['一', '二', '三'], null, '问题']) {
    assert.ok(validateAnalysis({ summary: '总结', questions }).questions);
  }
  assert.ok(validateAnalysis({ summary: '总结', questions: [null] }).question0);
  assert.ok(validateAnalysis(null).summary);
});

test('演示只对应固定虚构原文，来源不能冒充真实 AI', () => {
  const draft = createDemoDraft(entry);
  assert.equal(draft.source, 'demo');
  assert.deepEqual(validateAnalysis(draft), {});
  assert.throws(() => createDemoDraft({ ...entry, text: '其他记录' }));
  assert.throws(() => adoptDemoAnalysis(entry, { ...draft, source: 'ai' }));
  assert.throws(() => adoptDemoAnalysis(entry, { ...draft, demoId: '其他示例' }));
});

test('采纳保留原文和日期，单独保存演示来源、编辑内容与采纳时间', () => {
  const draft = { ...createDemoDraft(entry), summary: '  【虚构】核对后的总结\n保留换行  ', questions: ['  我下一步想做什么？  '] };
  const saved = adoptDemoAnalysis(entry, draft, '2026-09-23T02:00:00Z');
  for (const key of ['id', 'entryDate', 'text', 'textVersion', 'createdAt']) assert.equal(saved[key], entry[key]);
  assert.equal(saved.revision, 2);
  assert.equal(saved.adoptedAnalysis.source, 'demo');
  assert.equal(saved.adoptedAnalysis.summary, draft.summary);
  assert.equal(saved.adoptedAnalysis.adoptedAt, '2026-09-23T02:00:00Z');
  assert.deepEqual(saved.adoptedAnalysis.questions, draft.questions);
  draft.questions[0] = '后来改动草稿';
  assert.equal(saved.adoptedAnalysis.questions[0], '  我下一步想做什么？  ');
  assert.equal(entry.adoptedAnalysis, null);
});

test('过期、跨记录、跨原文版本和已删除记录的草稿均不能采纳', () => {
  const draft = createDemoDraft(entry);
  const conflict = { code: 'LOCAL_VERSION_CONFLICT' };
  assert.throws(() => adoptDemoAnalysis(null, draft), conflict);
  assert.throws(() => adoptDemoAnalysis({ ...entry, revision: 2 }, draft), conflict);
  assert.throws(() => adoptDemoAnalysis(entry, { ...draft, entryId: '另一条' }), conflict);
  assert.throws(() => adoptDemoAnalysis(entry, { ...draft, sourceTextVersion: 2 }), conflict);
});

test('无效编辑保存失败，旧分析保持原样', () => {
  const saved = adoptDemoAnalysis(entry, createDemoDraft(entry));
  const before = structuredClone(saved);
  const draft = createDemoDraft(saved);
  assert.throws(() => adoptDemoAnalysis(saved, { ...draft, summary: '' }));
  assert.deepEqual(saved, before);
});

test('仅改日期保留演示来源和分析；改原文后清除对应分析', () => {
  const saved = adoptDemoAnalysis(entry, createDemoDraft(entry));
  const dateOnly = reviseEntry(saved, { entryDate: '2026-09-22', text: saved.text }, saved.revision);
  assert.deepEqual(dateOnly.adoptedAnalysis, saved.adoptedAnalysis);
  const changed = reviseEntry(dateOnly, { entryDate: dateOnly.entryDate, text: '【虚构】原文已修改。' }, dateOnly.revision);
  assert.equal(changed.adoptedAnalysis, null);
  assert.equal(changed.textVersion, 2);
});

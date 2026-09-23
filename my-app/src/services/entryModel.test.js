import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCurrentEntry, reviseEntry, sortEntries } from './entryModel.js';

const sample = {
  id: 'fiction-entry', entryDate: '2026-09-21', text: '【虚构】我先写下一个问题。',
  textVersion: 2, revision: 3, createdAt: '2026-09-21T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  adoptedAnalysis: { sourceTextVersion: 2, summary: '虚构分析样本', questions: ['下一步想做什么？'] },
};

test('回看按记录日期降序，同一天按创建时间降序，不改变输入列表', () => {
  const entries = [
    { ...sample, id: '早创建', entryDate: '2026-09-23', createdAt: '2026-09-23T01:00:00Z' },
    { ...sample, id: '旧日期', entryDate: '2026-09-21', createdAt: '2026-09-23T03:00:00Z' },
    { ...sample, id: '晚创建', entryDate: '2026-09-23', createdAt: '2026-09-23T02:00:00Z' },
  ];
  assert.deepEqual(sortEntries(entries).map((entry) => entry.id), ['晚创建', '早创建', '旧日期']);
  assert.equal(entries[0].id, '早创建');
});

test('修改原文保留标识和创建时间，增加版本并清除旧分析', () => {
  const updated = reviseEntry(sample, {entryDate: sample.entryDate, text: '  【虚构】我向同学提了一个问题。\n'}, 3, '2026-09-23T01:00:00Z');
  assert.equal(updated.id, sample.id);
  assert.equal(updated.createdAt, sample.createdAt);
  assert.equal(updated.textVersion, 3);
  assert.equal(updated.revision, 4);
  assert.equal(updated.adoptedAnalysis, null);
  assert.equal(updated.text, '  【虚构】我向同学提了一个问题。\n');
  assert.equal(sample.textVersion, 2);
  assert.ok(sample.adoptedAnalysis);
});

test('仅修改日期保留原文版本和已采纳分析', () => {
  const updated = reviseEntry(sample, {entryDate: '2026-09-22', text: sample.text}, 3);
  assert.equal(updated.textVersion, sample.textVersion);
  assert.deepEqual(updated.adoptedAnalysis, sample.adoptedAnalysis);
  assert.equal(updated.revision, 4);
});

test('过期修改和过期删除均被拒绝，不覆盖更新或复活已删记录', () => {
  assert.throws(() => reviseEntry(sample, {entryDate: sample.entryDate, text: '旧页面输入'}, 2), {code:'LOCAL_VERSION_CONFLICT'});
  assert.throws(() => requireCurrentEntry(sample, 2), {code:'LOCAL_VERSION_CONFLICT'});
  assert.throws(() => requireCurrentEntry(null, 3), {code:'LOCAL_VERSION_CONFLICT'});
  assert.throws(() => reviseEntry(null, {entryDate: sample.entryDate, text: '已删除记录'}, 3), {code:'LOCAL_VERSION_CONFLICT'});
});

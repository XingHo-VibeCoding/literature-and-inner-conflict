import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, validateNote } from '../../shared/validation.js';
import { filterPersonalBooks, requireCurrentNote, reviseNote } from './readingModel.js';
import { buildRecommendations, listBooks } from './catalog.js';

test('备注边界按字符计数，空白无效，1000 有效，1001 无效', () => {
  assert.ok(validateNote('  \n\t'));
  assert.equal(validateNote('甲'), '');
  assert.equal(validateNote('  ' + '甲'.repeat(1000) + '\n'), '');
  assert.ok(validateNote('甲'.repeat(1001)));
  assert.equal(countCharacters(' 😀甲\n乙 '), 4);
});

test('保存备注保留空格、换行和创建日期，更新同一条备注', () => {
  const first = reviseNote('walden', '  【虚构】想法\n行动  ', null, null, '2026-09-23T01:00:00Z');
  assert.equal(first.body, '  【虚构】想法\n行动  ');
  const second = reviseNote('walden', '【虚构】修改后', first, first, '2026-09-23T02:00:00Z');
  assert.equal(second.bookId, first.bookId);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.updatedAt, '2026-09-23T02:00:00Z');
  assert.equal(second.revision, 2);
});

test('阻止旧版本覆盖、重复新建和复活已删除备注', () => {
  const original = reviseNote('walden', '【虚构】旧版', null, null, '2026-09-23T01:00:00Z');
  const current = reviseNote('walden', '【虚构】新版', original, original);
  const conflict = { code: 'LOCAL_VERSION_CONFLICT' };
  assert.throws(() => reviseNote('walden', '旧页覆盖', current, original), conflict);
  assert.throws(() => reviseNote('walden', '重复新建', current, null), conflict);
  assert.throws(() => reviseNote('walden', '已删内容', null, original), conflict);
  assert.throws(() => requireCurrentNote(current, original), conflict);
  const recreated = reviseNote('walden', '重新创建', null, null, '2026-09-23T03:00:00Z');
  assert.throws(() => requireCurrentNote(recreated, original), conflict);
});

test('收藏与备注筛选独立，叠加类型后仍按书库顺序', () => {
  const reading = {
    favorites: [{ bookId: 'from-the-soil' }, { bookId: 'walden' }],
    notes: [{ bookId: 'analects', body: '【虚构】备注' }],
  };
  assert.deepEqual(filterPersonalBooks(listBooks(), 'favorites', reading).map((book) => book.id), ['walden', 'from-the-soil']);
  assert.deepEqual(filterPersonalBooks(listBooks('philosophy'), 'favorites', reading).map((book) => book.id), ['walden']);
  assert.deepEqual(filterPersonalBooks(listBooks(), 'noted', reading).map((book) => book.id), ['analects']);
  assert.equal(filterPersonalBooks(listBooks('literature'), 'noted', reading).length, 0);
  assert.equal(reading.notes[0].body, '【虚构】备注');
});

test('个人视图的推荐仍来自符合类型的全库', () => {
  const selection = { category: 'philosophy', situationTagId: 'rethink-life', directionTagId: 'simpler-life' };
  const expected = buildRecommendations(selection);
  assert.deepEqual(buildRecommendations({ ...selection, view: 'favorites' }), expected);
  assert.deepEqual(buildRecommendations({ ...selection, view: 'noted' }), expected);
  assert.equal(expected.results.groups[0].items.length, 3);
});

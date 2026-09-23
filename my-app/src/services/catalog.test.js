import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../shared/catalog.json' with { type: 'json' };
import { buildRecommendations, getRecommendationContext, resolveRecommendationContext } from './catalog.js';

const selection = {
  category: 'all', situationTagId: 'rethink-life', directionTagId: 'review-choices',
};
const recommend = (changes = {}) => buildRecommendations({ ...selection, ...changes });
const ids = (group) => group.items.map((item) => item.bookId);

test('未选全、未知标签或无效类型不产生推荐', () => {
  for (const change of [
    { situationTagId: '', directionTagId: '' }, { situationTagId: '' },
    { directionTagId: '' }, { situationTagId: 'unknown' },
    { directionTagId: 'unknown' }, { category: 'unknown' },
  ]) {
    const response = recommend(change);
    assert.equal(response.results, null);
    assert.ok(Object.keys(response.errors).length > 0);
  }
});

test('先按类型匹配，再按顺序限制每组最多三本', () => {
  const all = recommend().results;
  for (const group of all.groups) {
    assert.equal(group.totalMatches, 4);
    assert.deepEqual(ids(group), ['tao-yuanming-collection', 'walden', 'analects']);
    assert.equal(new Set(ids(group)).size, group.items.length);
  }
  const philosophy = recommend({ category: 'philosophy' }).results;
  for (const group of philosophy.groups) {
    assert.deepEqual(ids(group), ['walden', 'analects', 'meditations']);
  }
});

test('单组或双组无匹配时保持空结果，不补入其他书目', () => {
  const oneEmpty = recommend({ category: 'literature', directionTagId: 'social-perspective' }).results;
  assert.deepEqual(ids(oneEmpty.groups[0]), ['tao-yuanming-collection', 'walden']);
  assert.deepEqual(ids(oneEmpty.groups[1]), []);
  const bothEmpty = recommend({
    category: 'literature', situationTagId: 'beyond-the-self', directionTagId: 'social-perspective',
  }).results;
  assert.ok(bothEmpty.groups.every((group) => group.totalMatches === 0 && group.items.length === 0));
});

test('同书跨组分别保留理由，只允许进入本次结果中的作品', () => {
  const results = recommend({ directionTagId: 'simpler-life' }).results;
  const mirror = getRecommendationContext(results, 'mirror', 'walden');
  const change = getRecommendationContext(results, 'change', 'walden');
  assert.equal(mirror.groupTitle, '映照当下');
  assert.equal(change.groupTitle, '探索改变');
  assert.notEqual(mirror.baseReason, change.baseReason);
  assert.match(mirror.baseReason, /正在重新思考怎样生活/);
  assert.match(change.baseReason, /尝试更简朴的生活/);
  assert.equal(getRecommendationContext(results, 'change', 'analects'), null);
  assert.equal(getRecommendationContext(results, 'mirror', 'meditations'), null);
  assert.equal(getRecommendationContext(results, 'unknown', 'walden'), null);
});

test('改条件、清除结果或换书库版本后，不复用旧详情理由', () => {
  const results = recommend().results;
  const context = getRecommendationContext(results, 'mirror', 'walden');
  assert.equal(resolveRecommendationContext(context, results).bookId, 'walden');
  assert.equal(resolveRecommendationContext(null, results), null);
  assert.equal(resolveRecommendationContext(context, null), null);
  for (const change of [
    { category: 'philosophy' }, { situationTagId: 'relationship-confusion' },
    { directionTagId: 'simpler-life' },
  ]) assert.equal(resolveRecommendationContext(context, recommend(change).results), null);
  assert.equal(resolveRecommendationContext({ ...context, catalogVersion: 'old' }, results), null);
});

test('内容中的标签均有定义、同书同组不重复，匹配依据非空', () => {
  for (const [tags, field] of [
    [catalog.situationTags, 'situationMatches'], [catalog.directionTags, 'directionMatches'],
  ]) {
    const tagIds = new Set(tags.map((tag) => tag.id));
    assert.equal(tagIds.size, tags.length);
    for (const book of catalog.books) {
      assert.equal(new Set(book[field].map((item) => item.tagId)).size, book[field].length);
      for (const match of book[field]) {
        assert.ok(tagIds.has(match.tagId));
        assert.ok(match.basis.trim().length > 0);
      }
    }
  }
});

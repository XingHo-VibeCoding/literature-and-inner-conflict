import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations, getBook, getRecommendationContext, resolveRecommendationContext } from './catalog.js';
import { createDemoExplanation, explanationKey, hasDemoExplanation, validateExplanation } from './explanationDemo.js';

function resultsFor(situationTagId, directionTagId, category = 'all', selectionId = '本次结果') {
  return { ...buildRecommendations({ situationTagId, directionTagId, category }).results, selectionId };
}

test('讲解正文与问题分别非空，合计不超过 300 个字符', () => {
  assert.equal(validateExplanation({ explanation: '甲'.repeat(299), readingQuestion: '乙' }), true);
  assert.equal(validateExplanation({ explanation: '甲'.repeat(300), readingQuestion: '乙' }), false);
  assert.equal(validateExplanation({ explanation: ' ', readingQuestion: '乙' }), false);
  assert.equal(validateExplanation({ explanation: '甲', readingQuestion: ' ' }), false);
  assert.equal(validateExplanation({ explanation: null, readingQuestion: '乙' }), false);
});

test('同一作品在两组的演示内容各自对应组别、选择和作品', () => {
  const results = resultsFor('rethink-life', 'simpler-life');
  const book = getBook('walden');
  const mirror = getRecommendationContext(results, 'mirror', book.id);
  const change = getRecommendationContext(results, 'change', book.id);
  const first = createDemoExplanation(book, mirror, results);
  const second = createDemoExplanation(book, change, results);
  assert.equal(first.bookId, book.id);
  assert.equal(second.bookId, book.id);
  assert.equal(first.source, 'demo');
  assert.equal(second.source, 'demo');
  assert.notEqual(first.explanation, second.explanation);
  assert.notEqual(first.readingQuestion, second.readingQuestion);
  assert.notEqual(first.contextKey, second.contextKey);
  assert.match(first.explanation, /重新思考怎样生活/);
  assert.match(second.explanation, /尝试更简朴的生活/);
});

test('社会视角示例与书库、对应条件和来源保持一致', () => {
  const results = resultsFor('beyond-the-self', 'social-perspective', 'humanities-social-sciences');
  const book = getBook('from-the-soil');
  for (const groupId of ['mirror', 'change']) {
    const context = getRecommendationContext(results, groupId, book.id);
    const sample = createDemoExplanation(book, context, results);
    assert.equal(sample.groupId, groupId);
    assert.equal(validateExplanation(sample), true);
    assert.match(sample.explanation, /乡土中国/);
    assert.match(book.sources[0].url, /^https:\/\//);
  }
});

test('只接受本次结果中的正确作品、组别、条件和结果批次', () => {
  const results = resultsFor('rethink-life', 'simpler-life');
  const context = getRecommendationContext(results, 'mirror', 'walden');
  assert.throws(() => createDemoExplanation(getBook('analects'), context, results));
  assert.throws(() => createDemoExplanation(getBook('walden'), { ...context, groupId: 'change' }, results));
  assert.throws(() => createDemoExplanation(getBook('walden'), { ...context, conditions: { ...context.conditions, category: 'philosophy' } }, results));
  const newResults = resultsFor('rethink-life', 'simpler-life', 'all', '重新生成');
  assert.equal(resolveRecommendationContext(context, newResults), null);
  assert.throws(() => createDemoExplanation(getBook('walden'), context, newResults));
});

test('无固定示例的组合保持为空，不借用别书或别组讲解', () => {
  const results = resultsFor('rethink-life', 'review-choices');
  const context = getRecommendationContext(results, 'change', 'walden');
  assert.equal(hasDemoExplanation(getBook('walden'), context), false);
  assert.equal(createDemoExplanation(getBook('walden'), context, results), null);
  assert.equal(explanationKey(null), null);
});

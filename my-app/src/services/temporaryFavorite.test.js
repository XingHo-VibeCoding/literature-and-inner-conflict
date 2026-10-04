import test from 'node:test';
import assert from 'node:assert/strict';
import { runTemporaryFavoriteAction, shouldFailTemporaryFavorite } from './temporaryFavorite.js';

test('只有明确的失败参数才进入收藏失败演示', () => {
  assert.equal(shouldFailTemporaryFavorite(''), false);
  assert.equal(shouldFailTemporaryFavorite('?favorite-demo=ok'), false);
  assert.equal(shouldFailTemporaryFavorite('?favorite-demo=fail'), true);
});

test('临时收藏动作可以分别模拟成功与失败', async () => {
  await assert.doesNotReject(runTemporaryFavoriteAction({ search: '', delay: 0 }));
  await assert.rejects(
    runTemporaryFavoriteAction({ search: '?favorite-demo=fail', delay: 0 }),
    /收藏交互失败测试/,
  );
});

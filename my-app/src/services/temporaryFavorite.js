const FAILURE_PARAMETER = 'favorite-demo';

export function shouldFailTemporaryFavorite(search = '') {
  return new URLSearchParams(search).get(FAILURE_PARAMETER) === 'fail';
}

export function runTemporaryFavoriteAction({
  search = globalThis.location?.search || '',
  delay = 450,
} = {}) {
  return new Promise((resolve, reject) => {
    globalThis.setTimeout(() => {
      if (shouldFailTemporaryFavorite(search)) {
        reject(new Error('这是一次收藏交互失败测试。'));
      } else {
        resolve();
      }
    }, delay);
  });
}

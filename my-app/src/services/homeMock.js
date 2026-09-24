// Day 8 本地假数据：仅用于首页演示，不读取或写入浏览器中的个人记录。
export const homeSections = [
  {
    id: 'journal',
    href: '#/journal',
    number: '01 / 记录',
    title: '自总结投放分析',
    caption: '把经历，写回自己的语言',
    description: '留下感受、想法与行动。回看自己的文字，让反思有迹可循。',
    features: ['写下日精进', '核对简短分析', '回看过往记录'],
    action: '去写下与回看',
    iconPaths: [
      'M25 8H10v25h22V20M15 15h6M15 21h4M15 27h11M23 19l2-6 8-8 4 4-8 8-6 2Z',
      'm30 8 4 4',
    ],
  },
  {
    id: 'books',
    href: '#/books',
    number: '02 / 阅读',
    title: '书单推荐讲解',
    caption: '让别人的文字，照见生活',
    description: '从你选择的处境与方向出发，寻找映照当下、探索改变的阅读线索。',
    features: ['浏览作品书库', '查看两类推荐', '收藏与写备注'],
    action: '去寻找阅读线索',
    iconPaths: [
      'M20 11c-5-4-10-4-15-3v23c5-1 10-1 15 3 5-4 10-4 15-3V8c-5-1-10-1-15 3Zm0 0v23M10 15c2 0 4 0 6 1M10 21c2 0 4 0 6 1M25 16c2-1 3-1 5-1M25 22c2-1 3-1 5-1',
    ],
  },
];

const homeSnapshot = {
  updatedAt: '2026-09-25T00:30:00+08:00',
  original: {
    date: '2026-09-25',
    text: '今天讨论作业时，我担心想法不够好，起初没有发言。后来我先写下一个问题，再向同学说明了自己的看法。',
  },
  interpretation: {
    label: 'AI 解读示例 · 供你核对',
    summary: '从担心想法不够好，\n到尝试说出自己的看法。',
    detail: '这次讨论里，先写下一个问题，成为了开口的起点。',
  },
};

// 用短暂等待模拟读取过程；取消后停止计时，避免离开首页后显示迟到结果。
export function readHomeMock({ scenario = 'content', signal } = {}) {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('已取消本次首页演示读取。', 'AbortError');
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      if (scenario === 'error') {
        reject(new Error('这是一次模拟读取失败，不代表记录为空。请重试，或继续进入其他板块。'));
      } else {
        resolve(scenario === 'empty' ? null : structuredClone(homeSnapshot));
      }
    }, 450);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

import { countCharacters } from '../../shared/validation.js';
import { getRecommendationContext } from './catalog.js';

const examples = {
  walden: {
    mirror: {
      'rethink-life': {
        explanation: '梭罗在《瓦尔登湖》中记录建屋、种植与观察自然，也思考个人需要和社会惯习。你选择“正在重新思考怎样生活”时，可以拿这些日常实践作参照，看看自己的安排来自什么需要。',
        readingQuestion: '你最想重新检视哪一项日常安排？',
      },
    },
    change: {
      'simpler-life': {
        explanation: '你选择“尝试更简朴的生活”。《瓦尔登湖》把建屋、种植等日常经历与简朴生活的思考放在一起，提供比较个人需要和社会惯习的角度；无需照搬作者的生活方式。',
        readingQuestion: '哪些开支或安排对你确有必要？',
      },
    },
  },
  'from-the-soil': {
    mirror: {
      'beyond-the-self': {
        explanation: '费孝通在《乡土中国》中分析社会关系和秩序。你选择“觉得困扰不只来自自己”时，可以借它尝试辨认关系期待和群体规则；作品讨论的是乡土社会，不能直接替你判断当下经历。',
        readingQuestion: '这段经历里有哪些共同的关系期待？',
      },
    },
    change: {
      'social-perspective': {
        explanation: '你选择“从社会背景理解经历”。《乡土中国》中的差序格局等概念提供一个观察关系结构的起点；阅读时仍需辨别书中的乡土环境与自己的现实环境有哪些差异。',
        readingQuestion: '哪些关系规则与你的实际环境相符？',
      },
    },
  },
};

export function validateExplanation(value) {
  if (typeof value?.explanation !== 'string' || typeof value?.readingQuestion !== 'string') return false;
  const body = countCharacters(value.explanation);
  const question = countCharacters(value.readingQuestion);
  return body >= 1 && question >= 1 && body + question <= 300;
}

export function explanationKey(context) {
  if (!context) return null;
  return JSON.stringify([
    context.selectionId, context.catalogVersion, context.bookId, context.groupId,
    context.conditions?.category, context.conditions?.situationTagId, context.conditions?.directionTagId,
  ]);
}

export function createDemoExplanation(book, context, results) {
  const matched = getRecommendationContext(results, context?.groupId, book?.id);
  if (!matched || matched.catalogVersion !== context.catalogVersion
    || matched.selectionId !== context.selectionId
    || matched.baseReason !== context.baseReason
    || matched.groupTitle !== context.groupTitle
    || ['category', 'situationTagId', 'directionTagId'].some((key) => matched.conditions[key] !== context.conditions?.[key])) {
    throw new Error('本次推荐条件已改变，请返回书单重新查看两类推荐。');
  }
  const tagId = context.groupId === 'mirror'
    ? context.conditions.situationTagId : context.conditions.directionTagId;
  const example = examples[book.id]?.[context.groupId]?.[tagId];
  if (!example) return null;
  if (!validateExplanation(example)) throw new Error('这份演示讲解内容不完整，请保留原有作品资料和推荐理由。');
  return {
    ...example, source: 'demo', bookId: book.id, groupId: context.groupId,
    contextKey: explanationKey(context),
  };
}

export function hasDemoExplanation(book, context) {
  const tagId = context?.groupId === 'mirror'
    ? context.conditions?.situationTagId : context?.conditions?.directionTagId;
  return Boolean(examples[book?.id]?.[context?.groupId]?.[tagId]);
}

import catalog from '../../shared/catalog.json' with { type: 'json' };

export const bookCategories = [
  { id: 'all', label: '全部' },
  { id: 'literature', label: '文学' },
  { id: 'philosophy', label: '哲学' },
  { id: 'humanities-social-sciences', label: '人文社科' },
];

export function categoryLabel(id) {
  return bookCategories.find((category) => category.id === id)?.label || id;
}

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

function hasCompleteDetails(book) {
  return ['id', 'title', 'author', 'intro'].every((key) => hasText(book[key]))
    && Array.isArray(book.categories) && book.categories.length > 0
    && book.categories.every((id) => bookCategories.some((item) => item.id !== 'all' && item.id === id))
    && Array.isArray(book.topics) && book.topics.length > 0 && book.topics.every(hasText)
    && Array.isArray(book.sources) && book.sources.length > 0
    && book.sources.every((source) => hasText(source.name) && /^https:\/\//.test(source.url));
}

const availableBooks = catalog.books.filter(hasCompleteDetails).sort((a, b) => a.displayOrder - b.displayOrder);

export function listBooks(category = 'all') {
  return availableBooks.filter((book) => category === 'all' || book.categories.includes(category));
}

export function getBook(id) {
  return availableBooks.find((book) => book.id === id);
}

export const situationTags = catalog.situationTags;
export const directionTags = catalog.directionTags;

export function buildRecommendations({ category, situationTagId, directionTagId }) {
  const situation = situationTags.find((tag) => tag.id === situationTagId);
  const direction = directionTags.find((tag) => tag.id === directionTagId);
  const errors = {};
  if (!situation) errors.situation = '请选择当前处境。';
  if (!direction) errors.direction = '请选择改变方向。';
  if (!bookCategories.some((item) => item.id === category)) errors.category = '请选择有效的作品类型。';
  if (Object.keys(errors).length) return { errors, results: null };

  const candidates = listBooks(category);
  const definitions = [
    { id: 'mirror', title: '映照当下', field: 'situationMatches', tag: situation, prefix: '你当前选择' },
    { id: 'change', title: '探索改变', field: 'directionMatches', tag: direction, prefix: '你希望' },
  ];
  const groups = definitions.map(({ id, title, field, tag, prefix }) => {
    const seen = new Set();
    const matches = [];
    for (const book of candidates) {
      const match = book[field]?.find((item) => item.tagId === tag.id && hasText(item.basis));
      if (!match || seen.has(book.id)) continue;
      seen.add(book.id);
      matches.push({ bookId: book.id, baseReason: `${prefix}「${tag.label}」。${match.basis}` });
    }
    return { id, title, tagLabel: tag.label, totalMatches: matches.length, items: matches.slice(0, 3) };
  });

  return {
    errors: {},
    results: {
      catalogVersion: catalog.catalogVersion,
      conditions: { category, situationTagId, directionTagId },
      situationLabel: situation.label,
      directionLabel: direction.label,
      groups,
    },
  };
}

export function getRecommendationContext(results, groupId, bookId) {
  if (!results || results.catalogVersion !== catalog.catalogVersion) return null;
  const group = results.groups.find((item) => item.id === groupId);
  const item = group?.items.find((match) => match.bookId === bookId);
  if (!item) return null;
  return { ...item, groupId, groupTitle: group.title, conditions: results.conditions,
    catalogVersion: results.catalogVersion, selectionId: results.selectionId };
}

export function resolveRecommendationContext(context, results) {
  if (!context || !results || context.catalogVersion !== results.catalogVersion) return null;
  if (context.selectionId !== results.selectionId) return null;
  if (!['category', 'situationTagId', 'directionTagId'].every((key) => context.conditions[key] === results.conditions[key])) return null;
  return getRecommendationContext(results, context.groupId, context.bookId);
}

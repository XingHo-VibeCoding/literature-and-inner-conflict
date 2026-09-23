export function requireCurrentNote(current, expected) {
  const matches = expected
    ? current && current.revision === expected.revision && current.createdAt === expected.createdAt
    : !current;
  if (!matches) {
    const error = new Error(current
      ? '备注已在其他页面更新。本页输入已保留，请复制需要保留的内容，再重新读取并核对。'
      : '备注已在其他页面删除。本页输入已保留，请复制需要保留的内容，再重新读取。');
    error.code = 'LOCAL_VERSION_CONFLICT';
    throw error;
  }
}

export function reviseNote(bookId, body, current, expected, now = new Date().toISOString()) {
  requireCurrentNote(current, expected);
  return {
    bookId, body,
    revision: current ? current.revision + 1 : 1,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };
}

export function filterPersonalBooks(books, view, reading) {
  if (view === 'favorites') return books.filter((book) => reading.favorites.some((item) => item.bookId === book.id));
  if (view === 'noted') return books.filter((book) => reading.notes.some((item) => item.bookId === book.id));
  return books;
}

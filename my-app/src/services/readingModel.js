export function requireCurrentNote(current, expected) {
  const matches = expected
    ? current && current.revision === expected.revision && current.createdAt === expected.createdAt
      && (current.historyId || `legacy:${current.bookId}`) === (expected.historyId || `legacy:${expected.bookId}`)
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

export function migrateLegacyNote(note) {
  return {
    ...note,
    id: `legacy:${note.bookId}`,
    savedAt: note.updatedAt || note.createdAt,
    saveOrder: note.saveOrder || note.revision || 1,
    summaryLink: null,
  };
}

export function createHistoryNote(bookId, body, id, now = new Date().toISOString()) {
  return { id, bookId, body, revision: 1, createdAt: now, updatedAt: now, savedAt: now, saveOrder: 1, summaryLink: null };
}

export function sortNoteHistory(notes) {
  return [...notes].sort((left, right) =>
    right.savedAt.localeCompare(left.savedAt) || right.saveOrder - left.saveOrder || right.id.localeCompare(left.id));
}

export function requireCurrentHistoryNote(current, expectedRevision) {
  if (!current || current.revision !== expectedRevision) {
    const error = new Error(current
      ? '这条备注的状态已在其他页面改变，请重新读取后再操作。'
      : '这条备注已被删除，请重新读取。');
    error.code = 'LOCAL_VERSION_CONFLICT';
    throw error;
  }
}

export function ownsNoteSummary(note, entry) {
  return entry?.origin?.type === 'reading-note' && entry.origin.noteId === note.id
    && entry.origin.bookId === note.bookId;
}

export function canRemoveNoteSummary(note, entry) {
  return ownsNoteSummary(note, entry) && !note.summaryLink?.preserveOnCancel
    && entry.revision === note.summaryLink?.entryRevisionAtLink;
}

export function createNoteSummary(note, bookTitle, id, now = new Date().toISOString()) {
  const entryDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(note.savedAt));
  return {
    id, entryDate, text: note.body, textVersion: 1, revision: 1,
    createdAt: now, updatedAt: now, adoptedAnalysis: null,
    origin: { type: 'reading-note', noteId: note.id, bookId: note.bookId, bookTitle, noteSavedAt: note.savedAt },
  };
}

export function sortEntries(entries) {
  return [...entries].sort((left, right) =>
    right.entryDate.localeCompare(left.entryDate)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id));
}

export function requireCurrentEntry(current, expectedRevision) {
  if (!current || current.revision !== expectedRevision) {
    const error = new Error(current
      ? '这条记录已在其他页面更新。本页内容已保留，请重新读取并核对后再修改。'
      : '这条记录已被删除。本页内容已保留，请重新读取记录。');
    error.code = 'LOCAL_VERSION_CONFLICT';
    throw error;
  }
}

export function reviseEntry(current, input, expectedRevision, now = new Date().toISOString()) {
  requireCurrentEntry(current, expectedRevision);
  const textChanged = current.text !== input.text;
  return {
    ...current,
    entryDate: input.entryDate,
    text: input.text,
    textVersion: current.textVersion + (textChanged ? 1 : 0),
    revision: current.revision + 1,
    updatedAt: now,
    adoptedAnalysis: textChanged ? null : current.adoptedAnalysis,
  };
}

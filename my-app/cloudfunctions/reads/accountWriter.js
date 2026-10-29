const { randomUUID } = require('node:crypto');
const { ApiError, entry, note } = require('./service');
const { createAccountWritesRepository } = require('./accountWritesRepository');

const DEMO_ENTRY_TEXT = '【虚构·分析演示】今天讨论作业时，我担心想法不够好，起初没有发言。\n后来我先写下一个问题，再向同学说明了自己的看法。';
function invalid(message, fields) {
  const error = new ApiError(400, 'INVALID_INPUT', message);
  if (fields) error.fields = fields;
  return error;
}
function objectFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw invalid('请求只允许填写约定字段，不能指定用户归属、来源或服务端时间。');
  }
}
function resourceId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\/\u0000-\u001f\u007f]/.test(value)) {
    throw invalid('资源 ID 格式无效。');
  }
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('请先读取当前记录，并提供有效的版本。', {
    expectedRevision: '版本必须为大于或等于 1 的整数。',
  });
}
function text(value, maximum, label) {
  const valid = typeof value === 'string' && !value.includes('\u0000')
    && !Array.from(value).some(character => {
      const code = character.codePointAt(0);
      return code >= 0xd800 && code <= 0xdfff;
    });
  const length = valid ? Array.from(value.trim()).length : 0;
  if (!valid || length < 1 || length > maximum) throw invalid(`${label}须为 1–${maximum} 个有效字符，并使用可保存的文字。`);
}
function oneRow(result) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new ApiError(500, 'WRITE_FAILED', '账户数据写入结果异常，请联系维护者。');
  }
  return result.rows[0];
}
function failure(outcome, kind) {
  if (outcome === 'not_found') throw new ApiError(404, kind === 'entry' ? 'ENTRY_NOT_FOUND' : 'NOTE_NOT_FOUND', '记录不存在或不属于当前用户。');
  if (outcome === 'book_not_found') throw new ApiError(404, 'BOOK_NOT_FOUND', '作品不在当前书库中。');
  if (outcome === 'version_conflict') throw new ApiError(409, 'VERSION_CONFLICT', '记录已发生变化，请重新读取并核对后再操作。');
  if (outcome === 'not_latest') throw new ApiError(409, 'NOTE_NOT_LATEST', '这本书已有更新的感悟，未删除任何记录，请重新读取。');
  if (outcome === 'link_conflict') throw new ApiError(409, 'NOTE_LINK_CONFLICT', '感悟与总结副本来源不一致，未更改任何记录。');
  if (outcome === 'duplicate') throw new ApiError(409, 'DUPLICATE_ENTRY', '同一天已有完全相同的原文，请先核对，勿重复加入总结。');
  if (outcome === 'context_mismatch') throw new ApiError(409, 'ANALYSIS_CONTEXT_MISMATCH', '固定演示仅适用于当前虚构示例及对应原文版本。');
}

function createAccountWriter({ query, books = new Map(), now = () => new Date() }) {
  const repository = createAccountWritesRepository({ query });
  const catalog = [...books].map(([id, book]) => ({ id, title: typeof book === 'string' ? book : book.title }));
  const bookIds = new Set(catalog.filter(book => typeof book.title === 'string' && book.title).map(book => book.id));
  const requireBook = id => { if (!bookIds.has(id)) throw new ApiError(404, 'BOOK_NOT_FOUND', '作品不在当前书库中。'); };
  return async function write({ ownerId, kind, operation, body, bookId, noteId, entryId, expectedRevision }) {
    if (typeof ownerId !== 'string' || !ownerId.trim()) throw new ApiError(500, 'WRITE_FAILED', '账户身份配置异常。');
    let result;
    try {
      if (kind === 'notes' && operation === 'POST') {
        requireBook(bookId);
        objectFields(body, ['body']);
        text(body.body, 1000, '阅读感悟原文');
        result = await repository.insertNote({ id: `note-${randomUUID()}`, ownerId, bookId, body: body.body });
        return note(oneRow(result));
      }
      if (kind === 'note' && operation === 'DELETE') {
        resourceId(noteId);
        revision(expectedRevision);
        const row = oneRow(await repository.deleteNote({ ownerId, noteId, expectedRevision }));
        failure(row.outcome, 'note');
        if (row.outcome === 'deleted') return { deleted: true, noteId };
      } else if (kind === 'noteSummary' && operation === 'PATCH') {
        resourceId(noteId);
        objectFields(body, ['enabled', 'expectedRevision']);
        revision(body.expectedRevision);
        if (typeof body.enabled !== 'boolean') throw invalid('请明确选择加入总结或取消加入。');
        const row = oneRow(await repository.setSummary({ ownerId, noteId, ...body, entryId: `entry-${randomUUID()}`, catalog }));
        failure(row.outcome, 'note');
        if (['unchanged', 'reused', 'added', 'preserved-edited', 'removed'].includes(row.outcome)) {
          return { note: note(row.note_record), entry: row.entry_record ? entry(row.entry_record) : null, outcome: row.outcome };
        }
      } else if (kind === 'favorites' && operation === 'PATCH') {
        objectFields(body, ['targetType', 'targetId', 'favorite']);
        if (!['book', 'entry'].includes(body.targetType) || typeof body.favorite !== 'boolean') {
          throw invalid('收藏目标只能是作品或日精进，并明确是否收藏。');
        }
        resourceId(body.targetId);
        if (body.targetType === 'book') requireBook(body.targetId);
        const row = oneRow(await repository.setFavorite({ ownerId, ...body }));
        failure(row.outcome, 'entry');
        if (row.outcome === 'saved') {
          const timestamp = body.favorite ? new Date(row.favorited_at) : null;
          if (body.favorite && (!row.favorited_at || !Number.isFinite(timestamp.getTime()))) throw new Error('收藏时间无效。');
          return { targetType: body.targetType, targetId: body.targetId, favorite: body.favorite,
            favoritedAt: timestamp ? timestamp.toISOString() : null };
        }
      } else if (kind === 'entryAnalysis' && operation === 'PATCH') {
        resourceId(entryId);
        objectFields(body, ['expectedRevision', 'sourceTextVersion', 'summary', 'questions']);
        revision(body.expectedRevision);
        revision(body.sourceTextVersion);
        text(body.summary, 300, '演示总结');
        if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 2) {
          throw invalid('请保留 1–2 个反思问题。');
        }
        for (const question of body.questions) text(question, 100, '反思问题');
        const adoptedAt = new Date(now()).toISOString();
        const row = oneRow(await repository.adoptAnalysis({ ownerId, entryId, body, demoText: DEMO_ENTRY_TEXT, adoptedAt }));
        failure(row.outcome, 'entry');
        if (row.outcome === 'updated') return entry(row.record);
      } else throw invalid('账户数据写入操作无效。');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'WRITE_FAILED', '账户数据保存未完成，请稍后手动重试。', true);
    }
    throw new ApiError(500, 'WRITE_FAILED', '账户数据写入结果不符合约定。');
  };
}
module.exports = { createAccountWriter, DEMO_ENTRY_TEXT };

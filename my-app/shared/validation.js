export function localToday(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

export function countCharacters(text) {
  // 非文字输入不做隐式转换，交给各入口返回中文校验提示。
  return typeof text === 'string' ? Array.from(text.trim()).length : 0;
}

export function validateNote(body) {
  if (typeof body !== 'string') return '感悟须为文字，请检查输入内容。';
  const length = countCharacters(body);
  if (length === 0) return '请写下至少 1 个有效字符，不能只输入空白。';
  if (length > 1000) return `当前为 ${length} 个字符，最多可保存 1000 个，请自行精简；输入已保留。`;
  return '';
}

export function validateAnalysis(input) {
  const errors = {};
  const summaryLength = typeof input?.summary === 'string' ? countCharacters(input.summary) : 0;
  if (summaryLength < 1 || summaryLength > 300) errors.summary = '总结须为 1–300 个有效字符，不能只输入空白。';
  if (!Array.isArray(input?.questions) || input.questions.length < 1 || input.questions.length > 2) {
    errors.questions = '请保留 1–2 个反思问题。';
  } else {
    input.questions.forEach((question, index) => {
      const length = typeof question === 'string' ? countCharacters(question) : 0;
      if (length < 1 || length > 100) errors[`question${index}`] = `反思问题 ${index + 1} 须为 1–100 个有效字符，不能只输入空白。`;
    });
  }
  return errors;
}

export function validateEntry(input, today = localToday()) {
  const { entryDate, text } = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = {};
  const parsed = typeof entryDate === 'string' ? new Date(`${entryDate}T00:00:00Z`) : new Date(NaN);
  const validDate = typeof entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
    && entryDate.slice(0, 4) !== '0000'
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === entryDate;

  if (!validDate) errors.entryDate = '请选择一个有效的记录日期。';
  else if (entryDate > today) errors.entryDate = '记录日期不能晚于今天，请选择今天或过去的日期。';

  const length = countCharacters(text);
  if (typeof text !== 'string') errors.text = '原文须为文字，请检查输入内容。';
  else if (length === 0) errors.text = '请写下至少 1 个有效字符，不能只输入空白。';
  else if (length > 5000) errors.text = `当前为 ${length} 个字符，最多可保存 5000 个，请自行精简；输入已保留。`;
  return errors;
}

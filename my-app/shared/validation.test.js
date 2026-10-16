import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, localToday, validateEntry, validateNote } from './validation.js';

const check = (entryDate, text) => validateEntry({ entryDate, text }, '2026-09-23');

test('拒绝空白和 5001 个字符，接受 1 与 5000 个字符', () => {
  assert.ok(check('2026-09-23', ' \n\t ').text);
  assert.deepEqual(check('2026-09-23', '字'), {});
  assert.deepEqual(check('2026-09-23', '字'.repeat(5000)), {});
  assert.ok(check('2026-09-23', '字'.repeat(5001)).text);
});

test('表情按 Unicode 码点计数，保留内部空格和换行', () => {
  assert.equal(countCharacters('  写😀\n想 法  '), 6);
  assert.deepEqual(check('2026-09-23', '😀'.repeat(5000)), {});
  assert.ok(check('2026-09-23', '😀'.repeat(5001)).text);
});

test('拒绝未来日期、不存在的日期以及缺失的日期', () => {
  for (const date of ['2026-09-24', '2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '', '2026-9-1']) {
    assert.ok(check(date, '虚构记录').entryDate, date);
  }
  assert.deepEqual(check('2024-02-29', '虚构记录'), {});
  assert.deepEqual(check('2026-09-23', '虚构记录'), {});
});

test('当天日期取设备本地日历，校验不改写输入原文', () => {
  assert.equal(localToday(new Date(2026, 8, 23, 0, 5)), '2026-09-23');
  const input = { entryDate: '2026-09-23', text: '  【虚构】今天先完成了一个小任务。\n ' };
  const original = { ...input };
  assert.deepEqual(validateEntry(input, '2026-09-23'), {});
  assert.deepEqual(input, original);
});


test('缺少记录对象、日期或非文字原文返回中文校验且不抛裸异常', () => {
  for (const input of [undefined, null, false, 12, [], '虚构输入']) {
    const errors = validateEntry(input, '2026-10-16');
    assert.equal(errors.entryDate, '请选择一个有效的记录日期。');
    assert.equal(errors.text, '原文须为文字，请检查输入内容。');
  }
  for (const text of [undefined, null, 0, {}, [], Symbol('虚构类型')]) {
    const input = { entryDate: '2026-10-16', text };
    assert.deepEqual(validateEntry(input, '2026-10-16'), { text: '原文须为文字，请检查输入内容。' });
    assert.equal(input.text, text);
    assert.equal(countCharacters(text), 0);
  }
  for (const entryDate of [undefined, null, 42, {}, Symbol('虚构日期')]) {
    assert.deepEqual(validateEntry({ entryDate, text: '【虚构】类型校验' }, '2026-10-16'),
      { entryDate: '请选择一个有效的记录日期。' });
  }
});

test('非文字感悟返回中文且不把对象或数字改写成原文', () => {
  for (const input of [undefined, null, false, 12, {}, [], Symbol('虚构感悟')]) {
    assert.equal(validateNote(input), '感悟须为文字，请检查输入内容。');
  }
  assert.match(validateNote('  '), /至少 1 个有效字符/);
  assert.equal(validateNote('  【虚构】保留空格与换行。\n '), '');
});

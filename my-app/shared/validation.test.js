import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, localToday, validateEntry } from './validation.js';

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

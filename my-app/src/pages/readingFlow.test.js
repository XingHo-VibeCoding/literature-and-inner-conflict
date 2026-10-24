import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createServer } from 'vite';
import { readEntries, readNoteHistory } from '../services/localStore.js';

let dom;
let server;
let App;
let createRoot;
let root;
const originalGlobals = new Map();

function setGlobal(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  // 独立的模拟页面和内存库；不加载网络资源、不使用真人浏览器数据。
  dom = new JSDOM('<div id="root"></div>', {
    url: 'http://reading-flow.test.invalid/#/books/walden', pretendToBeVisual: true,
  });
  const httpCrypto = { getRandomValues: (array) => webcrypto.getRandomValues(array) };
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('crypto', httpCrypto);
  setGlobal('indexedDB', new IDBFactory());
  setGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(dom.window, 'crypto', { configurable: true, value: httpCrypto });
  dom.window.indexedDB = indexedDB;
  dom.window.scrollTo = () => {};
  const dialog = dom.window.HTMLDialogElement.prototype;
  if (!dialog.showModal) dialog.showModal = function () { this.open = true; };
  if (!dialog.close) dialog.close = function () { this.open = false; };
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ default: App } = await server.ssrLoadModule('/src/App.jsx'));
});

after(async () => {
  if (root) await act(async () => root.unmount());
  if (server) await server.close();
  dom?.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function settleUntil(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    if (check()) return;
  }
  assert.fail(`等待超时：${label}`);
}

async function mountApp() {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App)));
  await settleUntil(() => document.querySelector('#reading-note'), '阅读面板读取完成');
}

function button(text, scope = document) {
  const found = [...scope.querySelectorAll('button')].find((item) => item.textContent.trim() === text);
  assert.ok(found, `找到按钮：${text}`);
  return found;
}

async function click(element) {
  assert.ok(element, '操作目标存在');
  assert.notEqual(element.disabled, true, '操作目标不是禁用状态');
  await act(async () => element.click());
}

async function fill(element, text) {
  assert.ok(element, '输入框存在');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    setter.call(element, text);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

function latestCard() { return document.querySelector('.reading-panel > .saved-note'); }
function historyButton() { return document.querySelector('button[aria-controls="past-reading-notes"]'); }
function summaryButton(card = latestCard()) { return card.querySelector('.summary-toggle'); }

async function toggleSummary(card) {
  const toggle = summaryButton(card);
  const previous = toggle.getAttribute('aria-pressed');
  await click(toggle);
  await settleUntil(() => !toggle.disabled && toggle.getAttribute('aria-pressed') !== previous, '入库状态更新');
}

test('虚构页面完整流程：多条留存、草稿保护、持久入库、总结来源与单条删除', async () => {
  assert.equal(typeof crypto.randomUUID, 'undefined');
  await mountApp();
  const texts = [
    '【虚构】第一条：我想减少被比较推着走的时间。',
    '【虚构】第二条：明天留出半小时散步，不带手机。',
    '  【虚构】第三条：先把想法写下来。\n周六尝试一个小行动。  ',
  ];
  for (const [index, text] of texts.entries()) {
    await fill(document.querySelector('#reading-note'), text);
    assert.ok(document.querySelector('.reading-panel').textContent.includes('有未保存的更改'));
    const save = button('保存备注与感悟');
    await act(async () => {
      save.click();
      if (index === 0) save.click();
    });
    await settleUntil(() => !save.disabled && document.querySelector('#reading-note').value === '', '保存并清空成功的草稿');
    assert.equal(latestCard().querySelector('.entry-original').textContent, text);
    assert.equal(document.activeElement.id, 'reading-note');
    assert.equal((await readNoteHistory('walden')).length, index + 1);
  }
  assert.equal(document.querySelectorAll('.saved-note').length, 1);
  assert.equal(historyButton().getAttribute('aria-expanded'), 'false');
  assert.ok(historyButton().textContent.includes('（2）'));
  const actions = [...document.querySelectorAll('.reading-panel form .record-actions button')];
  assert.deepEqual(actions.map((item) => item.textContent.trim()), ['保存备注与感悟', '删除备注', '查看往期备注（2）']);

  const draft = '  【虚构】第四条尚未保存\n不要丢掉这段输入  ';
  await fill(document.querySelector('#reading-note'), draft);
  await click(historyButton());
  assert.equal(historyButton().getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...document.querySelectorAll('#past-reading-notes .entry-original')].map((item) => item.textContent), [texts[1], texts[0]]);
  assert.equal(document.querySelector('#reading-note').value, draft);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'noteHistory') throw new DOMException('虚构的本地写入失败', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try {
    await click(summaryButton());
    await settleUntil(() => !summaryButton().disabled && document.querySelector('.reading-panel .error-panel'), '显示真实写入失败');
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.equal(summaryButton().getAttribute('aria-pressed'), 'false');
  assert.ok(!latestCard().classList.contains('is-in-summary'));
  assert.equal(document.querySelector('#reading-note').value, draft);
  assert.equal((await readEntries()).length, 0);
  await toggleSummary(latestCard());
  assert.equal(summaryButton().getAttribute('aria-pressed'), 'true');
  assert.ok(latestCard().classList.contains('is-in-summary'));
  assert.equal(document.querySelector('#reading-note').value, draft);
  assert.equal(document.activeElement, summaryButton());
  assert.equal((await readEntries()).length, 1);

  await click(document.querySelector('.site-nav a[href="#/journal"]'));
  const leave = document.querySelector('dialog[aria-labelledby="leave-title"]');
  assert.equal(leave.open, true);
  assert.equal(window.location.hash, '#/books/walden');
  await click(button('继续编辑', leave));
  assert.equal(document.querySelector('#reading-note').value, draft);
  await fill(document.querySelector('#reading-note'), '');

  await act(async () => root.unmount());
  root = null;
  window.history.replaceState(null, '', '#/books/walden');
  await mountApp();
  assert.equal(summaryButton().getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelectorAll('.saved-note').length, 1);
  assert.equal((await readNoteHistory('walden')).length, 3);

  await click(document.querySelector('.site-nav a[href="#/journal"]'));
  await settleUntil(() => document.querySelector('.journal-shell .saved-entry'), '总结页显示导入的原文');
  assert.equal(document.querySelector('.saved-entry > .entry-original').textContent, texts[2]);
  assert.ok(document.querySelector('.history-item .reading-source').textContent.includes('来自《瓦尔登湖》的阅读备注与感悟'));
  assert.ok(document.querySelector('.saved-entry .reading-source').textContent.includes('来自《瓦尔登湖》'));
  await click(button('修改记录'));
  const edited = texts[2] + '\n【虚构】我把行动改成周六执行。';
  await fill(document.querySelector('.journal-form textarea'), edited);
  await click(button('保存修改'));
  await settleUntil(() => document.querySelector('.saved-entry > .entry-original')?.textContent === edited, '保存对总结的独立编辑');

  await click(document.querySelector('.site-nav a[href="#/books"]'));
  await settleUntil(() => document.querySelector('.book-card a[href="#/books/walden"]'), '书目列表读取完成');
  await click(document.querySelector('.book-card a[href="#/books/walden"]'));
  await settleUntil(() => document.querySelector('#reading-note'), '返回阅读面板');
  await fill(document.querySelector('#reading-note'), draft);
  await toggleSummary(latestCard());
  assert.equal(document.querySelector('#reading-note').value, draft);
  assert.equal(summaryButton().getAttribute('aria-pressed'), 'false');
  assert.ok(!latestCard().classList.contains('is-in-summary'));
  assert.equal((await readEntries())[0].text, edited);
  assert.ok(document.querySelector('.success-message').textContent.includes('保留了修改后的内容'));
  await toggleSummary(latestCard());
  await toggleSummary(latestCard());
  assert.equal((await readEntries()).length, 1);
  assert.equal((await readEntries())[0].text, edited);

  await click(historyButton());
  const firstCard = [...document.querySelectorAll('#past-reading-notes .saved-note')]
    .find((card) => card.querySelector('.entry-original').textContent === texts[0]);
  await toggleSummary(firstCard);
  assert.equal((await readEntries()).length, 2);
  await toggleSummary(firstCard);
  assert.equal((await readEntries()).length, 1);
  assert.equal(document.querySelector('#reading-note').value, draft);

  for (let remaining = 2; remaining >= 0; remaining -= 1) {
    await click(button('删除备注'));
    const dialog = document.querySelector('dialog[aria-labelledby="delete-note-title"]');
    assert.equal(dialog.open, true);
    await click(button('确认删除', dialog));
    await settleUntil(() => !button('保存备注与感悟').disabled
      && document.querySelectorAll('.saved-note').length === (remaining ? (remaining > 1 ? 2 : 1) : 0), '删除后更新原文卡');
    assert.equal(document.querySelector('#reading-note').value, draft);
    assert.equal((await readNoteHistory('walden')).length, remaining);
    if (remaining) {
      assert.equal(latestCard().querySelector('.entry-original').textContent, texts[remaining - 1]);
      assert.equal(document.activeElement, latestCard().querySelector('[id^="note-title-"]'));
    } else assert.equal(document.activeElement.id, 'reading-note');
  }
  assert.equal((await readEntries())[0].text, edited);

  // 同一公网 HTTP 模拟环境中回归 Day 14 原有的推荐生成和详情跳转修复。
  await fill(document.querySelector('#reading-note'), '');
  await click(document.querySelector('.site-nav a[href="#/books"]'));
  await settleUntil(() => document.querySelector('.recommendation-form'), '进入书目推荐表单');
  await click(button('文学'));
  // 自定义宣纸单选器通过真实键盘事件操作，并验证错误聚焦与取消不会提交。
  const situation = document.getElementById('situation-tag');
  const direction = document.getElementById('direction-tag');
  async function pressSelection(selection, key) {
    await act(async () => {
      selection.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true,
      }));
    });
  }
  await click(button('查看两类推荐'));
  await settleUntil(() => document.activeElement === situation, '未选择时聚焦当前处境');
  assert.equal(situation.getAttribute('role'), 'combobox');
  assert.equal(direction.getAttribute('role'), 'combobox');
  assert.equal(situation.getAttribute('aria-invalid'), 'true');
  assert.equal(direction.getAttribute('aria-invalid'), 'true');
  assert.match(situation.getAttribute('aria-describedby'), /situation-error/);
  assert.equal(document.querySelectorAll('.recommendation-group').length, 0);

  await pressSelection(situation, 'ArrowDown');
  assert.equal(situation.getAttribute('aria-expanded'), 'true');
  assert.equal(situation.getAttribute('aria-activedescendant'), 'situation-tag-option-1');
  assert.equal(document.getElementById('situation-tag-option-1').getAttribute('aria-selected'), 'false');
  assert.equal(document.getElementById('situation-tag-value').textContent, '请选择当前处境');
  await pressSelection(situation, 'Escape');
  assert.equal(situation.getAttribute('aria-expanded'), 'false');
  assert.equal(situation.hasAttribute('aria-activedescendant'), false);
  assert.equal(document.getElementById('situation-tag-value').textContent, '请选择当前处境');
  assert.equal(situation.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, situation);

  for (const [selection, label] of [
    [situation, '正在重新思考怎样生活'],
    [direction, '重新审视生活中的重要选择'],
  ]) {
    await act(async () => selection.focus());
    await pressSelection(selection, 'ArrowDown');
    assert.equal(selection.getAttribute('aria-expanded'), 'true');
    const option = document.getElementById(selection.getAttribute('aria-activedescendant'));
    assert.equal(option.getAttribute('role'), 'option');
    assert.equal(option.textContent, label);
    await pressSelection(selection, 'Enter');
    assert.equal(selection.getAttribute('aria-expanded'), 'false');
    assert.equal(option.getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById(selection.id + '-value').textContent, label);
    assert.equal(document.activeElement, selection);
    assert.equal(document.querySelectorAll('.recommendation-group').length, 0);
    if (selection === situation) {
      await click(button('查看两类推荐'));
      await settleUntil(() => document.activeElement === direction, '仅缺改变方向时聚焦对应选择器');
      assert.equal(situation.getAttribute('aria-invalid'), 'false');
      assert.equal(direction.getAttribute('aria-invalid'), 'true');
      assert.match(direction.getAttribute('aria-describedby'), /direction-error/);
    }
  }
  await click(button('查看两类推荐'));
  assert.equal(document.querySelectorAll('.recommendation-group').length, 2);
  await click(document.querySelector('.recommendation-group a[href="#/books/walden"]'));
  await settleUntil(() => document.querySelector('[aria-label="本次推荐理由"]'), '公网 HTTP 推荐详情跳转');
  assert.equal(window.location.hash, '#/books/walden');
  assert.ok(document.querySelector('[aria-label="本次推荐理由"]').textContent.includes('映照当下'));
});

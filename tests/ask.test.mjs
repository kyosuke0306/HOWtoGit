import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseAnswer, formatAnswer, SYSTEM } from '../js/ask.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('質問の最後に画面の状況を付ける', () => {
  const body = buildRequest([{ role: 'user', text: 'merge って?' }, { role: 'model', text: '合流です' }, { role: 'user', text: '次は?' }], 'HEAD: main');
  assert.equal(body.systemInstruction.parts[0].text, SYSTEM);
  assert.equal(body.contents.length, 3);
  assert.equal(body.contents[0].parts[0].text, 'merge って?');
  assert.match(body.contents[2].parts[0].text, /^次は\?[\s\S]*HEAD: main$/);
  assert.equal(body.contents[1].role, 'model');
});

test('考え中の部分を除いて答えを取り出す', () => {
  const json = { candidates: [{ content: { parts: [{ text: '考え中', thought: true }, { text: '答え' }, { text: 'です' }] } }] };
  assert.equal(parseAnswer(json), '答えです');
  assert.throws(() => parseAnswer({ promptFeedback: { blockReason: 'SAFETY' } }), /答えられません/);
  assert.throws(() => parseAnswer({}), /空/);
});

test('答えの整形: コード・太字・HTML のエスケープ', () => {
  const html = formatAnswer('**大事** `git merge` <b>\n```\ngit push\n```', esc);
  assert.match(html, /<b>大事<\/b>/);
  assert.match(html, /<code>git merge<\/code>/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<pre>git push<\/pre>/);
});

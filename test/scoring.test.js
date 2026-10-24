'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { score, shuffleIds, ANCHOR_ORDER } = require('../server/scoring');
const questions = require('../server/data/questions.json');

const fill = (v) => Object.fromEntries(questions.map((q) => [q.id, typeof v === 'function' ? v(q) : v]));

test('题库：8 个维度各 5 题，共 40 题', () => {
  assert.equal(questions.length, 40);
  for (const a of ANCHOR_ORDER) assert.equal(questions.filter((q) => q.anchor === a).length, 5);
});

test('全 1 分：每个维度 1.0，全部并列', () => {
  const r = score(questions, fill(1));
  assert.ok(ANCHOR_ORDER.every((a) => r.scores[a] === 1));
  assert.equal(r.primary.length, 8);
});

test('全 6 分：每个维度 6.0', () => {
  assert.ok(ANCHOR_ORDER.every((a) => score(questions, fill(6)).scores[a] === 6));
});

test('单一最高维度', () => {
  const r = score(questions, fill((q) => (q.anchor === 'EC' ? 6 : 2)));
  assert.deepEqual(r.primary, ['EC']);
  assert.equal(r.ranking[0], 'EC');
});

test('并列最高：全部列出', () => {
  const r = score(questions, fill((q) => (q.anchor === 'EC' || q.anchor === 'SV' ? 6 : 2)));
  assert.deepEqual(r.primary, ['SV', 'EC'].sort((a, b) => ANCHOR_ORDER.indexOf(a) - ANCHOR_ORDER.indexOf(b)));
});

test('第二名仅差 0.2：一并列出', () => {
  const ans = fill((q) => (q.anchor === 'TF' || q.anchor === 'GM' ? 5 : 2));
  ans[6] = 4; // GM 少 1 分
  assert.deepEqual(score(questions, ans).primary, ['TF', 'GM']);
});

test('最认同 3 题：所属维度各加 4 分后再平均', () => {
  const r = score(questions, fill(3), [1, 2, 16]);
  assert.equal(r.scores.TF, (15 + 8) / 5);
  assert.equal(r.scores.SE, (15 + 4) / 5);
  assert.equal(r.scores.GM, 3);
});

test('缺题、非法值、重复/无效 picks 会报错', () => {
  const ans = fill(3);
  delete ans[7];
  assert.throws(() => score(questions, ans));
  assert.throws(() => score(questions, fill(7)));
  assert.throws(() => score(questions, fill(3), [1, 1]));
  assert.throws(() => score(questions, fill(3), [999]));
});

test('随机顺序：同种子可复现且是完整排列', () => {
  const ids = questions.map((q) => q.id);
  const a = shuffleIds(ids, 42); const b = shuffleIds(ids, 42);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice().sort((x, y) => x - y), ids);
  assert.notDeepEqual(a, shuffleIds(ids, 43));
});

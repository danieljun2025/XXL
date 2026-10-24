'use strict';

const ANCHOR_ORDER = ['TF', 'GM', 'AU', 'SE', 'EC', 'SV', 'CH', 'LS'];
const ITEMS_PER_ANCHOR = 5;
const BONUS = 4;

// 可复现的伪随机数（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleIds(ids, seed) {
  const out = ids.slice();
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * questions: [{id, anchor}]；answers: {id: 1..6}；picks: 最认同的题号（可为空）
 * 每个维度：(5 题得分之和 + 4 × 被选中题数) / 5。
 * 主职业锚：得分最高者；并列则全部列出；唯一最高时，若第二名仅低 1 个原始分（0.2）以内，也一并列出。
 */
function score(questions, answers, picks = []) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const raw = Object.fromEntries(ANCHOR_ORDER.map((a) => [a, 0]));
  for (const q of questions) {
    const v = answers[q.id];
    if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`题 ${q.id} 缺少有效答案`);
    raw[q.anchor] += v;
  }
  const uniq = new Set(picks);
  if (uniq.size !== picks.length) throw new Error('最认同的题目不能重复');
  for (const id of uniq) {
    if (!byId.has(id)) throw new Error(`无效的题号 ${id}`);
    raw[byId.get(id).anchor] += BONUS;
  }
  const scores = {};
  for (const a of ANCHOR_ORDER) scores[a] = Math.round((raw[a] / ITEMS_PER_ANCHOR) * 10) / 10;
  const ranking = ANCHOR_ORDER.slice().sort((x, y) => raw[y] - raw[x] || ANCHOR_ORDER.indexOf(x) - ANCHOR_ORDER.indexOf(y));
  const max = raw[ranking[0]];
  let primary = ranking.filter((a) => raw[a] === max);
  if (primary.length === 1 && max - raw[ranking[1]] <= 1) primary = [ranking[0], ranking[1]];
  return { raw, scores, ranking, primary };
}

module.exports = { ANCHOR_ORDER, shuffleIds, score };

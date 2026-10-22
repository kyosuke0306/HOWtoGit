import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../js/git.js';
import { Shell } from '../js/shell.js';
import { diagnose } from '../js/help.js';

const ui = { openEditor() {}, clear() {}, showHint() {}, showMission() {} };
function setup(cmds) {
  const w = new World();
  const sh = new Shell(w, ui);
  for (const c of cmds) sh.run(c, { out() {}, hint() {}, ev() {} });
  return w;
}
const cmdsOf = (items) => items.flatMap((i) => i.steps.map((s) => s[1]));

test('HELP: 競合中なら abort か直して進める手順', () => {
  const w = setup(['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'git switch -c x', 'echo b > f.txt', 'git commit -am 2', 'git switch main', 'echo c > f.txt', 'git commit -am 3', 'git merge x']);
  const items = diagnose(w);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /マージの途中で競合/);
  assert.ok(cmdsOf(items).includes('git merge --abort'));
  assert.ok(cmdsOf(items).includes('git add f.txt'));
});

test('HELP: 記録前の変更・ステージ・未追跡ファイル', () => {
  const w = setup(['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'echo b > f.txt', 'echo n > new.txt', 'echo s > s.txt', 'git add s.txt']);
  const c = cmdsOf(diagnose(w));
  assert.ok(c.includes('git restore --staged s.txt'));
  assert.ok(c.includes('git restore f.txt'));
  assert.ok(c.includes('rm new.txt'));
});

test('HELP: main に直接コミットしたら別ブランチに逃がして戻す手順', () => {
  const w = setup(['gh repo create r', 'mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'git remote add origin https://github.com/you/r.git', 'git push -u origin main', 'echo b > f.txt', 'git commit -am 2']);
  const c = cmdsOf(diagnose(w));
  assert.deepEqual(c, ['git branch feature/rescue', 'git reset --hard origin/main', 'git switch feature/rescue']);
});

test('HELP: 何も壊れていなければ空', () => {
  const w = setup(['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1']);
  assert.deepEqual(diagnose(w), []);
});

test('HELP: 管理外ならフォルダに入る手順', () => {
  const w = setup([]);
  assert.deepEqual(cmdsOf(diagnose(w, { teamPath: '~/cafe-shop' })), ['cd ~/cafe-shop']);
});

import { snapshot, restorePlan } from '../js/help.js';

// 計画どおりに打つと、依頼前とまったく同じ状態に戻るか
function roundTrip(before, during) {
  const w = setup(before);
  const sh = new Shell(w, ui);
  const path = w.cwd;
  const snap = snapshot(w, path);
  const run = (c) => sh.run(c, { out() {}, hint() {}, ev() {} });
  during.forEach(run);
  const plan = restorePlan(w, snap);
  plan.steps.forEach(([, c]) => run(c));
  const after = snapshot(w, path);
  return { snap, after, plan };
}

test('HELP: 依頼前に戻す (ブランチ作成・コミット・変更)', () => {
  const { snap, after, plan } = roundTrip(
    ['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'git branch keep'],
    ['git switch -c x', 'echo b > f.txt', 'git commit -am 2', 'git switch main', 'echo c > f.txt', 'git commit -am 3', 'git branch -f keep x', 'git tag v1', 'echo d > f.txt', 'echo n > n.txt'],
  );
  assert.deepEqual(after, snap);
  assert.ok(plan.steps.some(([, c]) => c === 'git branch -D x'));
});

test('HELP: 依頼前に戻す (マージの途中・別ブランチにいる)', () => {
  const { snap, after } = roundTrip(
    ['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'git switch -c x', 'echo b > f.txt', 'git commit -am 2', 'git switch main', 'echo c > f.txt', 'git commit -am 3'],
    ['git merge x'],
  );
  assert.deepEqual(after, snap);
});

test('HELP: 依頼前に戻す (消したブランチと別の場所)', () => {
  const { snap, after } = roundTrip(
    ['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'git switch -c x', 'echo b > f.txt', 'git commit -am 2'],
    ['git switch main', 'git branch -D x', 'cd ..'],
  );
  assert.deepEqual(after, snap);
});

test('HELP: 何もしていなければ手順なし', () => {
  const w = setup(['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1']);
  assert.deepEqual(restorePlan(w, snapshot(w, w.cwd)).steps, []);
});

test('HELP: 書きかけから始まった依頼は --soft で戻し、変更を残す', () => {
  const { snap, after, plan } = roundTrip(
    ['mkdir r', 'cd r', 'git init', 'echo a > f.txt', 'git add .', 'git commit -m 1', 'echo s > .env', 'echo j > share.js', 'git add .'],
    ['git commit -m oops'],
  );
  assert.ok(plan.steps.some(([, c]) => c.startsWith('git reset --soft')));
  assert.deepEqual(after, snap);
});

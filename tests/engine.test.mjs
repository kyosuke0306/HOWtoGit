import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, headId, computeStatus } from '../js/git.js';
import { Shell } from '../js/shell.js';
import { merge3 } from '../js/diff.js';

function setup() {
  const w = new World();
  const sh = new Shell(w, { openEditor() {}, clear() {}, showHint() {}, showMission() {} });
  const log = [];
  let events = [];
  const ctx = {
    errorCount: 0,
    out(t, cls) { const s = typeof t === 'string' ? t : t.map((x) => x[0]).join(''); log.push(s); if (cls === 'err') ctx.errorCount++; },
    hint(t) { log.push('HINT ' + t); },
    ev(type, data) { events.push({ type, ...data }); },
  };
  const run = (line) => { log.length = 0; events = []; sh.run(line, ctx); return { out: log.join('\n'), events }; };
  return { w, sh, run };
}

test('merge3 clean and conflict', () => {
  const r = merge3('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n');
  assert.equal(r.text, 'A\nb\nC\n');
  assert.equal(r.conflicts, 0);
  const r2 = merge3('a\nb\n', 'x\nb\n', 'y\nb\n', 'HEAD', 'feat');
  assert.equal(r2.conflicts, 1);
  assert.equal(r2.text, '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat\nb\n');
});

test('basic init/add/commit/branch/merge', () => {
  const { w, run } = setup();
  run('mkdir app && cd app');
  assert.equal(w.cwd, '~/app');
  run('git init');
  run('echo "hello" > a.txt');
  assert.match(run('git status').out, /Untracked files/);
  run('git add a.txt');
  const c = run('git commit -m "first"');
  assert.match(c.out, /root-commit/);
  run('git switch -c feature');
  run('echo "world" >> a.txt && git commit -am "more"');
  run('git switch main');
  assert.equal(w.dir.files['a.txt'], 'hello\n');
  const m = run('git merge feature');
  assert.match(m.out, /Fast-forward/);
  assert.equal(w.dir.files['a.txt'], 'hello\nworld\n');
});

test('conflict merge and resolve', () => {
  const { w, run } = setup();
  run('git init');
  run('echo "line1" > f.txt && git add . && git commit -m base');
  run('git switch -c b');
  run('echo "B" > f.txt && git commit -am b');
  run('git switch main');
  run('echo "M" > f.txt && git commit -am m');
  const r = run('git merge b');
  assert.match(r.out, /CONFLICT/);
  assert.ok(r.events.some((e) => e.type === 'conflict'));
  assert.match(w.dir.files['f.txt'], /<<<<<<< HEAD\nM\n=======\nB\n>>>>>>> b/);
  assert.match(run('git commit -m x').out, /unmerged/);
  run('echo "MB" > f.txt && git add f.txt');
  const done = run('git commit');
  assert.ok(done.events.some((e) => e.type === 'merge' && e.resolved));
  assert.equal(w.objects[headId(w.repo)].parents.length, 2);
});

test('3-way merge without conflict creates merge commit', () => {
  const { w, run } = setup();
  run('git init');
  run('echo "1" > a.txt && echo "1" > b.txt && git add . && git commit -m base');
  run('git switch -c f && echo 2 > b.txt && git commit -am f');
  run('git switch main && echo 2 > a.txt && git commit -am m');
  const r = run('git merge f');
  assert.match(r.out, /ort/);
  assert.equal(w.dir.files['a.txt'], '2\n');
  assert.equal(w.dir.files['b.txt'], '2\n');
});

test('remote push/pull/rejected', () => {
  const { w, run } = setup();
  run('git init && echo a > a.txt && git add . && git commit -m init');
  run('gh repo create demo');
  run('git remote add origin https://github.com/you/demo.git');
  assert.match(run('git push').out, /no upstream/);
  const p = run('git push -u origin main');
  assert.match(p.out, /new branch/);
  const url = 'https://github.com/you/demo.git';
  w.teammateCommit(url, 'main', { 'b.txt': 'b\n' }, 'teammate', '田中');
  run('echo c > c.txt && git add . && git commit -m mine');
  const rej = run('git push');
  assert.match(rej.out, /rejected/);
  const pl = run('git pull');
  assert.match(pl.out, /ort/);
  assert.match(run('git push').out, /main -> main/);
  assert.equal(w.remotes[url].branches.main, headId(w.repo));
});

test('clone, stash, rebase, cherry-pick, revert, tag, reflog', () => {
  const { w, run } = setup();
  const url = 'https://github.com/team/shop.git';
  w.createRemote(url, 'team');
  w.teammateCommit(url, 'main', { 'menu.txt': 'coffee 400\ntea 300\n' }, 'init', '田中');
  run('git clone ' + url);
  run('cd shop');
  assert.equal(w.dir.files['menu.txt'], 'coffee 400\ntea 300\n');
  // stash
  run('echo "wip" >> menu.txt');
  assert.match(run('git stash').out, /Saved/);
  assert.equal(w.dir.files['menu.txt'], 'coffee 400\ntea 300\n');
  run('git stash pop');
  assert.match(w.dir.files['menu.txt'], /wip/);
  run('git restore menu.txt');
  // rebase
  run('git switch -c feat && echo x > x.txt && git add . && git commit -m x');
  w.teammateCommit(url, 'main', { 'y.txt': 'y\n' }, 'y', '佐藤');
  run('git fetch');
  const rb = run('git rebase origin/main');
  assert.match(rb.out, /Successfully rebased/);
  assert.ok(w.isAncestor(w.remotes[url].branches.main, headId(w.repo)));
  // cherry-pick
  run('git switch main');
  const before = headId(w.repo);
  run('git cherry-pick feat');
  assert.equal(w.dir.files['x.txt'], 'x\n');
  assert.equal(w.objects[headId(w.repo)].parents[0], before);
  // revert
  run('git revert HEAD');
  assert.equal(w.dir.files['x.txt'], undefined);
  // tag & push tag
  run('git tag v1.0');
  run('git push origin v1.0');
  assert.ok(w.remotes[url].tags['v1.0']);
  // reflog recovery
  run('git reset --hard HEAD~2');
  assert.match(run('git reflog').out, /reset: moving/);
  run('git reset --hard HEAD@{1}');
  assert.equal(w.objects[headId(w.repo)].message.startsWith('Revert'), true);
});

test('switch blocked by local changes; gitignore', () => {
  const { w, run } = setup();
  run('git init && echo a > a.txt && git add . && git commit -m init');
  run('git switch -c f && echo b > a.txt && git commit -am f && git switch main');
  run('echo dirty > a.txt');
  assert.match(run('git switch f').out, /would be overwritten/);
  run('git restore a.txt');
  run('echo "*.log" > .gitignore && echo x > debug.log');
  const st = computeStatus(w, w.dir);
  assert.ok(!st.untracked.some((u) => u.path === 'debug.log'));
  run('git add .');
  assert.equal(w.repo.index['debug.log'], undefined);
  assert.equal(w.repo.index['.gitignore'], '*.log\n');
});

test('rebase conflict continue', () => {
  const { w, run } = setup();
  run('git init && echo base > f.txt && git add . && git commit -m base');
  run('git switch -c feat && echo feat > f.txt && git commit -am feat');
  run('git switch main && echo main > f.txt && git commit -am main');
  run('git switch feat');
  const r = run('git rebase main');
  assert.match(r.out, /CONFLICT/);
  run('echo merged > f.txt && git add f.txt');
  const c = run('git rebase --continue');
  assert.match(c.out, /Successfully/);
  assert.equal(w.dir.files['f.txt'], 'merged\n');
  assert.equal(w.repo.head.name, 'feat');
});

test('gh pr flow', () => {
  const { w, run } = setup();
  const url = 'https://github.com/team/shop.git';
  w.createRemote(url, 'team');
  w.teammateCommit(url, 'main', { 'a.txt': 'a\n' }, 'init', '田中');
  run('git clone ' + url + ' && cd shop');
  run('git switch -c feature/x && echo x > x.txt && git add . && git commit -m x');
  assert.match(run('gh pr create').out, /push/);
  run('git push -u origin feature/x');
  run('gh pr create --title "Xを追加"');
  const m = run('gh pr merge 1');
  assert.match(m.out, /Merged/);
  run('git switch main && git pull');
  assert.equal(w.dir.files['x.txt'], 'x\n');
});

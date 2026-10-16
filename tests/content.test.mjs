import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, headId } from '../js/git.js';
import { Shell } from '../js/shell.js';
import { MISSIONS, FIRST_MISSION } from '../js/missions.js';
import { createApi, buildTeamRemote, TEAM_URL } from '../js/scenario.js';

const ui = { openEditor() {}, clear() {}, showHint() {}, showMission() {} };

function harness() {
  const game = { world: new World(), lastCmd: '', chat() {} };
  const api = createApi(game);
  const sh = new Shell(game.world, ui);
  const log = [];
  const exec = (cmd) => {
    const events = [];
    const ctx = {
      errorCount: 0,
      out(t, c) { log.push(typeof t === 'string' ? t : t.map((x) => x[0]).join('')); if (c === 'err') ctx.errorCount++; },
      hint() {},
      ev(type, d = {}) { events.push({ type, ...d }); },
    };
    // 疑似コマンド: EDIT <file> <content>
    const m = cmd.match(/^EDIT (\S+) ([\s\S]*)$/);
    if (m) { game.world.dir.files[m[1]] = m[2]; events.push({ type: 'file-write' }); }
    else sh.run(cmd.replace(/\{\{(.+?)\}\}/g, (_, msg) => findCommit(game.world, msg)), ctx);
    game.lastCmd = cmd;
    return events;
  };
  return { game, api, exec, log };
}

function findCommit(w, msg) {
  const c = Object.values(w.objects).filter((o) => o.message.startsWith(msg)).sort((a, b) => b.seq - a.seq)[0];
  if (!c) throw new Error('commit not found: ' + msg);
  return c.id.slice(0, 7);
}

// ミッションの解答
const M_SOL = {
  'feature-branch': (m) => ['git switch main', `git switch -c ${m.branch}`, `echo "x" > ${m.file}`, 'git add .', 'git commit -m "add"', `git push -u origin ${m.branch}`],
  'pull-latest': () => ['git switch main', 'git pull'],
  'push-rejected': () => ['git switch main', 'echo "- あなた" >> README.md', 'git commit -am "メンバー追加"', 'git push', 'git pull', 'git push'],
  'safe-merge': (m) => ['git switch main', 'git pull', `git merge origin/${m.good}`, 'git push'],
  'resolve-conflict': (m, w) => ['git switch main', `EDIT menu.txt ${w.dir.files['menu.txt'].split('\n').map((l) => (l.startsWith(m.name + ' ') ? m.target : l)).join('\n')}`, 'git commit -am "値上げ"', 'git push', 'git pull', '__RESOLVE__', 'git add menu.txt', 'git commit', 'git push'],
  'stash-hotfix': () => ['git stash', 'git switch main', 'git pull', '__FIXTYPO__', 'git commit -am "誤字修正"', 'git push', 'git switch feature/discount', 'git stash pop'],
  'revert-bad': () => ['git switch main', 'git pull', 'git revert {{テスト用に全部0円にした}}', 'git push'],
  'release-tag': (m) => ['git switch main', 'git pull', `git tag ${m.tag}`, `git push origin ${m.tag}`],
  'cleanup-branch': (m) => ['git switch main', `git branch -d ${m.branch}`, `git push origin --delete ${m.branch}`],
  amend: () => ['git commit --amend -m "ログイン画面を追加"'],
  'unstage-secret': () => ['git restore --staged .env', 'echo ".env" >> .gitignore', 'git add .gitignore', 'git commit -m "シェアボタン"'],
  'cherry-fix': () => ['git fetch', 'git switch main', 'git pull', 'git cherry-pick {{バグ修正: 税込み価格の計算ミス}}', 'git push'],
  'rebase-feature': (m) => ['git fetch', `git switch ${m.branch}`, 'git rebase origin/main', `git push -u origin ${m.branch}`],
  'pr-flow': (m) => ['git switch main', `git switch -c ${m.branch}`, `echo x > ${m.name}.html`, 'git add .', 'git commit -m pr', `git push -u origin ${m.branch}`, 'gh pr create --title t', '__PRMERGE__', 'git switch main', 'git pull'],
  'review-pr': (m) => [`gh pr merge ${m.number}`, 'git switch main', 'git pull'],
  discard: (m) => [`git restore ${m.file}`],
  'reflog-rescue': () => ['git reset --hard HEAD@{1}'],
  gitignore: () => ['echo "*.log" > .gitignore', 'echo "node_modules/" >> .gitignore', 'git add .gitignore', 'git commit -m ignore'],
  'merge-feature': (m) => ['git switch main', 'git pull', `git merge origin/${m.branch}`, 'git push'],
};

function play(api, exec, game, def, mem, log) {
  let res = null;
  const cmds = M_SOL[def.id] ? M_SOL[def.id](mem, game.world) : [];
  for (let c of cmds) {
    if (c === '__RESOLVE__') {
      const f = game.world.dir.files['menu.txt'];
      if (!/<<<<<<</.test(f)) continue;
      c = 'EDIT menu.txt ' + f.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> [^\n]*\n/g, '$1');
    }
    if (c === '__FIXTYPO__') c = 'EDIT index.html ' + game.world.dir.files['index.html'].replace('あいます', 'あります');
    if (c === '__PRMERGE__') c = `gh pr merge ${game.world.prCounter}`;
    const evs = exec(c);
    if (def.noConflict && evs.some((e) => e.type === 'conflict')) return { fail: 'conflict' };
    res = def.check(api, evs, mem);
    if (res) return res;
  }
  return res;
}

test('challenge: all missions solvable in sequence', () => {
  for (let round = 0; round < 3; round++) {
    const { game, api, exec, log } = harness();
    buildTeamRemote(game.world);
    for (const c of [`git clone ${TEAM_URL}`, 'cd cafe-shop']) exec(c);
    assert.equal(FIRST_MISSION.check(api, [], {}), 'success');
    const order = [...MISSIONS].sort(() => Math.random() - 0.5);
    const played = [];
    for (const def of order) {
      if (def.can && !def.can(api)) {
        // 状態をきれいにしてから再判定
        exec('git switch main'); exec('git reset --hard origin/main'); exec('git clean -f');
        if (def.can && !def.can(api)) continue;
      }
      const mem = {};
      def.setup && def.setup(api, mem);
      game.world.cwd = api.teamPath();
      const res = play(api, exec, game, def, mem, log);
      played.push(def.id);
      assert.equal(res, 'success', `mission ${def.id} round ${round}: ${JSON.stringify(res)}\n${log.slice(-25).join('\n')}`);
    }
    assert.ok(played.length >= MISSIONS.length - 1, 'skipped: ' + MISSIONS.filter((m) => !played.includes(m.id)).map((m) => m.id));
  }
});

test('safe-merge fails when merging the conflicting branch', () => {
  const { game, api, exec } = harness();
  buildTeamRemote(game.world);
  exec(`git clone ${TEAM_URL}`); exec('cd cafe-shop');
  const def = MISSIONS.find((m) => m.id === 'safe-merge');
  const mem = {};
  def.setup(api, mem);
  exec('git pull');
  const evs = exec(`git merge origin/${mem.bad}`);
  assert.ok(evs.some((e) => e.type === 'conflict'));
});

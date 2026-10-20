// コマンドをボタンで組み立てる
import { computeStatus, headId, currentBranch } from './git.js';

// 1 行 = 1 グループ。作業の流れの順 (見る → 書いて記録 → ブランチ → 共有 → 戻す)
export const GROUPS = [
  ['見る', ['status', 'diff', 'log', 'cd']],
  ['記録', ['edit', 'add', 'commit', 'tag']],
  ['ブランチ', ['branch', 'switch', 'merge', 'rebase', 'cherry-pick']],
  ['共有', ['clone', 'fetch', 'pull', 'push', 'gh']],
  ['戻す', ['restore', 'stash', 'reset', 'revert']],
];

// 各コマンドの説明 (短く)
export const DESC = {
  status: '今の状態を見る',
  add: '変更を記録の準備 (ステージ) に載せる',
  commit: 'ステージした変更を記録する',
  log: '履歴を見る',
  branch: 'ブランチ (付箋) を作る・消す',
  switch: 'ブランチを移動する',
  checkout: 'ブランチの移動・ファイルの復元',
  merge: '指定したブランチを今のブランチに取り込む',
  rebase: '今のブランチを指定先の先端に付け替える',
  reset: 'ブランチを過去に戻す (共有前に)',
  revert: '打ち消すコミットを作る (共有後に)',
  restore: 'ファイルを最後の記録に戻す',
  stash: '作業中の変更を一時退避',
  fetch: 'GitHub の最新を見に行く (取り込まない)',
  pull: 'GitHub の最新を取り込む',
  push: '手元のコミットを GitHub に送る',
  gh: 'GitHub の Pull Request を操作',
  'cherry-pick': '選んだコミットだけコピーする',
  tag: 'コミットに名札を付ける',
  diff: '変更点を見る',
  show: 'コミットの中身を見る',
  reflog: 'HEAD の移動履歴を見る',
  clone: 'リポジトリを丸ごとコピーする',
  init: 'Git の管理を始める',
  remote: 'GitHub の登録',
  edit: 'ファイルを編集する',
  cd: 'フォルダを移動する',
};

const BASE = {
  status: 'git status', add: 'git add ', commit: 'git commit', log: 'git log --oneline --all',
  branch: 'git branch ', switch: 'git switch ', merge: 'git merge ', rebase: 'git rebase ',
  reset: 'git reset ', revert: 'git revert ', restore: 'git restore ', stash: 'git stash',
  fetch: 'git fetch', pull: 'git pull', push: 'git push', gh: 'gh pr ',
  'cherry-pick': 'git cherry-pick ', tag: 'git tag ', diff: 'git diff', edit: 'edit ', clone: 'git clone ', cd: 'cd ',
};

export function baseFor(cmd, world) {
  if (cmd === 'commit' && !world.easy) return 'git commit -m ""';
  return BASE[cmd];
}

// 入力中のコマンド名を取り出す
export function cmdOf(line) {
  const m = line.trim().match(/^(?:git\s+([\w-]+)|(gh|edit|cd|ls|cat|echo|mkdir))/);
  return m ? m[1] || m[2] : null;
}

function commitChips(world, repo, n = 8) {
  const tips = [headId(repo), ...Object.values(repo.branches), ...Object.values(repo.remoteRefs)].filter(Boolean);
  const set = new Set();
  tips.forEach((t) => world.ancestors(t).forEach((c) => set.add(c)));
  return [...set].sort((a, b) => world.objects[b].seq - world.objects[a].seq).slice(0, n).map((id) => {
    const c = world.objects[id];
    const name = world.easy && /^C\d+'*$/.test(c.message) ? c.message : id.slice(0, 7);
    return { label: world.easy ? name : `${name} ${c.message.split('\n')[0].slice(0, 10)}`, add: name, kind: 'commit' };
  });
}

// 今の状態に合った引数の候補
export function chipsFor(cmd, world, line, extra = {}) {
  const dir = world.dir;
  const repo = dir.repo;
  const chips = [];
  const has = (t) => line.split(/\s+/).includes(t);
  const add = (label, value = label, kind = '') => { if (!has(value)) chips.push({ label, add: value, kind }); };
  if (cmd === 'clone') { (extra.urls || []).forEach((u) => add(u.replace('https://github.com/', ''), u, 'url')); return chips; }
  if (cmd === 'cd') {
    Object.keys(world.dirs).filter((p) => p !== world.cwd && p.startsWith(world.cwd + '/')).forEach((p) => add(p.slice(world.cwd.length + 1)));
    if (world.cwd !== '~') add('..');
    return chips;
  }
  if (cmd === 'edit') { Object.keys(dir.files).sort().forEach((f) => add(f, f, 'file')); return chips; }
  if (!repo) return chips;
  const cur = currentBranch(repo);
  const branches = Object.keys(repo.branches);
  const remoteRefs = Object.keys(repo.remoteRefs);
  const s = computeStatus(world, dir);
  const changed = [...new Set([...s.unstaged, ...s.untracked].map((x) => x.path))];
  switch (cmd) {
    case 'add': add('.', '.'); changed.forEach((f) => add(f, f, 'file')); break;
    case 'commit': if (!world.easy) add('-a (変更を全部)', '-a'); add('--amend (直前を修正)', '--amend'); break;
    case 'branch':
      ['feature', 'bugFix', 'hotfix'].filter((b) => !branches.includes(b)).forEach((b) => add(b, b, 'new'));
      add('-d (削除)', '-d', 'flag'); add('-f (移動)', '-f', 'flag');
      branches.filter((b) => b !== cur).forEach((b) => add(b, b, 'branch'));
      if (has('-f')) commitChips(world, repo).forEach((c) => add(c.label, c.add, 'commit'));
      break;
    case 'switch':
      add('-c (作って移動)', '-c', 'flag');
      if (has('-c')) ['feature', 'bugFix', 'hotfix'].filter((b) => !branches.includes(b)).forEach((b) => add(b, b, 'new'));
      branches.filter((b) => b !== cur).forEach((b) => add(b, b, 'branch'));
      remoteRefs.map((r) => r.split('/').slice(1).join('/')).filter((b) => !branches.includes(b) && b).forEach((b) => add(b, b, 'branch'));
      add('--detach (コミットへ)', '--detach', 'flag');
      if (has('--detach')) commitChips(world, repo).forEach((c) => add(c.label, c.add, 'commit'));
      break;
    case 'merge': case 'rebase':
      if (repo.op && repo.op.type === cmd) { add('--continue', '--continue', 'flag'); add('--abort (中止)', '--abort', 'flag'); }
      branches.filter((b) => b !== cur).forEach((b) => add(b, b, 'branch'));
      remoteRefs.forEach((r) => add(r, r, 'remote'));
      break;
    case 'reset':
      add('HEAD~1 (1つ前)', 'HEAD~1'); add('--soft', '--soft', 'flag'); add('--hard (変更も消す)', '--hard', 'danger');
      commitChips(world, repo).forEach((c) => add(c.label, c.add, 'commit'));
      break;
    case 'revert': case 'cherry-pick': case 'show':
      if (repo.op && repo.op.type === cmd) { add('--continue', '--continue', 'flag'); add('--abort', '--abort', 'flag'); }
      if (cmd === 'revert') add('HEAD', 'HEAD');
      commitChips(world, repo).forEach((c) => add(c.label, c.add, 'commit'));
      break;
    case 'restore': add('--staged (ステージから外す)', '--staged', 'flag'); [...changed, ...s.staged.map((x) => x.path)].forEach((f) => add(f, f, 'file')); add('.', '.'); break;
    case 'stash': add('pop (戻す)', 'pop'); add('list', 'list'); add('-u (新規も)', '-u', 'flag'); break;
    case 'pull': add('--rebase (一直線)', '--rebase', 'flag'); break;
    case 'push':
      if (cur && !repo.upstream[cur]) add(`-u origin ${cur} (初回)`, `-u origin ${cur}`);
      Object.keys(repo.tags).forEach((t) => add(`origin ${t} (タグ)`, `origin ${t}`));
      add('origin --delete', 'origin --delete', 'flag');
      if (has('--delete')) remoteRefs.filter((r) => r.startsWith('origin/')).map((r) => r.slice(7)).filter((b) => b !== 'main').forEach((b) => add(b, b, 'branch'));
      add('--force (上書き)', '--force', 'danger');
      break;
    case 'tag': tagNames(world, repo).forEach((t) => add(t, t, 'new')); commitChips(world, repo).forEach((c) => add(c.label, c.add, 'commit')); break;
    case 'diff': add('--staged', '--staged', 'flag'); branches.filter((b) => b !== cur).forEach((b) => add(b, b, 'branch')); remoteRefs.forEach((r) => add(r, r, 'remote')); break;
    case 'gh': {
      const url = repo.remotes.origin;
      const r = url && world.remotes[url];
      add('create (作成)', 'create'); add('list', 'list');
      if (r) r.prs.filter((p) => p.state === 'open').forEach((p) => add(`merge ${p.number}`, `merge ${p.number}`));
      break;
    }
    default: break;
  }
  return chips;
}

// 作業途中 (競合など) のときに出す近道
export function opChips(world) {
  const repo = world.dir.repo;
  if (!repo) return [];
  const chips = [];
  for (const c of repo.conflicts) chips.push({ label: `edit ${c.path}`, line: `edit ${c.path}` }, { label: `git add ${c.path}`, line: `git add ${c.path}` });
  if (repo.op) {
    const t = repo.op.type;
    if (!repo.conflicts.length) chips.push({ label: t === 'merge' ? 'git commit' : `git ${t} --continue`, line: t === 'merge' ? 'git commit' : `git ${t} --continue` });
    chips.push({ label: `git ${t} --abort (中止)`, line: `git ${t} --abort` });
  }
  return chips;
}

// タグ名の候補: ステージは v1。それ以外は今ある最新の版の「次」を2通り (例: v1.0 → v1.1 / v2.0)
function tagNames(world, repo) {
  if (world.easy) return repo.tags.v1 ? [] : ['v1'];
  const r = world.remotes[repo.remotes.origin];
  const all = [...Object.keys(repo.tags), ...Object.keys((r && r.tags) || {})];
  let best = null;
  for (const t of all) {
    const m = t.match(/^v(\d+)\.(\d+)$/);
    if (m && (!best || +m[1] > best[0] || (+m[1] === best[0] && +m[2] > best[1]))) best = [+m[1], +m[2]];
  }
  const names = best ? [`v${best[0]}.${best[1] + 1}`, `v${best[0] + 1}.0`] : ['v1.0'];
  return names.filter((n) => !all.includes(n));
}

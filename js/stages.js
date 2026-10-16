// ステージ: ゴールの形にブランチを合わせるパズル
import { World } from './git.js';
import { silentRun } from './scenario.js';
import { repoShape } from './shape.js';

export const STAGE_DIR = '~/repo';
const URL = 'https://github.com/you/repo.git';

// 準備用の小さな関数
const C = (n) => `git commit${n > 1 ? ` && git commit`.repeat(n - 1) : ''}`;
function withRemote(w, run) {
  w.createRemote(URL, 'you');
  run(`git remote add origin ${URL} && git push -u origin main`);
}
// 仲間がリモートに push したことにする
function teammate(w, branch = 'main') {
  const n = w.easyN + 1;
  w.teammateCommit(URL, branch, { [`t${n}.txt`]: `${n}\n` }, `C${n}`, '田中');
}

export const STAGES = [
  // ---- 1. 記録 ----
  {
    id: 's-commit', ch: 1, title: 'コミット',
    goal: 'コミットを2回しよう',
    learn: 'commit = 今の状態を記録する。点が1つ増える。',
    setup: (w, run) => run(C(1)),
    solution: ['git commit', 'git commit'],
    hint: 'git commit を2回',
  },
  {
    id: 's-branch', ch: 1, title: 'ブランチ',
    goal: 'bugFix ブランチを作って、そこへ移動しよう',
    learn: 'branch = コミットに貼る付箋。switch で付箋を乗り換える。',
    setup: (w, run) => run(C(2)),
    solution: ['git switch -c bugFix'],
    hint: 'git switch -c bugFix (作成+移動)',
  },
  {
    id: 's-branch-commit', ch: 1, title: '枝分かれ',
    goal: 'bugFix で1回、main で1回コミットしよう',
    learn: 'それぞれのブランチでコミットすると枝分かれする。',
    setup: (w, run) => run(C(1) + ' && git branch bugFix'),
    solution: ['git switch bugFix', 'git commit', 'git switch main', 'git commit'],
    hint: 'switch bugFix → commit → switch main → commit',
  },
  // ---- 2. 合流 ----
  {
    id: 's-merge', ch: 2, title: 'マージ',
    goal: 'bugFix を main に取り込もう',
    learn: 'merge = 相手の変更を今のブランチに取り込む。2本の線が合流する。',
    setup: (w, run) => run(`${C(1)} && git switch -c bugFix && git commit && git switch main && git commit`),
    solution: ['git merge bugFix'],
    hint: 'main にいる状態で git merge bugFix',
  },
  {
    id: 's-ff', ch: 2, title: '早送り',
    goal: 'main を feature の位置まで進めよう',
    learn: 'main が遅れているだけなら、付箋を前に進めるだけ (Fast-forward)。',
    setup: (w, run) => run(`${C(1)} && git switch -c feature && git commit && git commit && git switch main`),
    solution: ['git merge feature'],
    hint: 'git merge feature',
  },
  {
    id: 's-merge-both', ch: 2, title: '両方取り込む',
    goal: 'main に featA と featB を両方取り込もう',
    learn: 'マージは何回でもできる。',
    setup: (w, run) => run(`${C(1)} && git switch -c featA && git commit && git switch main && git switch -c featB && git commit && git switch main && git commit`),
    solution: ['git merge featA', 'git merge featB'],
    hint: 'merge featA → merge featB',
  },
  {
    id: 's-rebase', ch: 2, title: 'リベース',
    goal: 'bugFix を main の先に付け替えて、一直線にしよう',
    learn: 'rebase = 自分のコミットを相手の先端へ付け替える。コミットはコピー (C3\') になる。',
    setup: (w, run) => run(`${C(1)} && git switch -c bugFix && git commit && git switch main && git commit && git switch bugFix`),
    solution: ['git rebase main'],
    hint: 'bugFix にいる状態で git rebase main',
  },
  {
    id: 's-conflict', ch: 2, title: '競合',
    goal: 'bugFix を main に取り込もう (同じ行を変えている！)',
    learn: '同じ行を別々に変えると競合する。edit で直して add → commit。',
    setup: (w, run) => {
      run('echo "コーヒー 400円" > menu.txt && git add . && git commit -m C1');
      run('git switch -c bugFix && echo "コーヒー 450円" > menu.txt && git commit -am C2');
      run('git switch main && echo "コーヒー 420円" > menu.txt && git commit -am C3');
    },
    solution: ['git merge bugFix', '__resolve menu.txt', 'git add menu.txt', 'git commit'],
    hint: 'merge → edit menu.txt で直す → add → commit',
  },
  // ---- 3. 移動と取り消し ----
  {
    id: 's-detach', ch: 3, title: 'HEAD を動かす',
    goal: 'HEAD を C2 に移動しよう',
    learn: 'HEAD = 今いる場所。ブランチではなくコミットを直接指すこともできる。',
    setup: (w, run) => run(C(3)),
    solution: ['git switch --detach C2'],
    hint: 'git switch --detach C2 (または git checkout C2)',
  },
  {
    id: 's-relative', ch: 3, title: '相対指定',
    goal: 'bugFix を main の2つ前に移そう',
    learn: 'HEAD~2 = 2つ前。branch -f で付箋を貼り替える。',
    setup: (w, run) => run(`${C(4)} && git branch bugFix`),
    solution: ['git branch -f bugFix main~2'],
    hint: 'git branch -f bugFix main~2',
  },
  {
    id: 's-reset', ch: 3, title: 'reset',
    goal: '最後のコミットを取り消そう (まだ共有していない)',
    learn: 'reset = ブランチを過去に戻す。共有前のコミット向け。',
    setup: (w, run) => run(C(3)),
    solution: ['git reset HEAD~1'],
    hint: 'git reset HEAD~1',
  },
  {
    id: 's-revert', ch: 3, title: 'revert',
    goal: 'C3 を打ち消そう (もう共有済み)',
    learn: 'revert = 打ち消すコミットを新しく作る。履歴を消さないので共有済みでも安全。',
    setup: (w, run) => { run(C(3)); withRemote(w, run); },
    solution: ['git revert C3'],
    hint: 'git revert C3',
  },
  {
    id: 's-cherry', ch: 3, title: 'いいとこ取り',
    goal: 'side の C3 と C5 だけ main に持ってこよう',
    learn: 'cherry-pick = 選んだコミットだけコピーする。',
    setup: (w, run) => run(`${C(1)} && git switch -c side && git commit && git commit && git commit && git commit && git switch main`),
    solution: ['git cherry-pick C3 C5'],
    hint: 'git cherry-pick C3 C5',
  },
  {
    id: 's-tag', ch: 3, title: 'タグ',
    goal: 'C2 に v1 タグを付けよう',
    learn: 'tag = 動かない名札。リリースの目印に。',
    setup: (w, run) => run(C(3)),
    solution: ['git tag v1 C2'],
    hint: 'git tag v1 C2',
  },
  // ---- 4. チーム ----
  {
    id: 's-push', ch: 4, title: 'push',
    goal: '手元のコミットを GitHub に送ろう',
    learn: 'push = 手元のコミットをリモートへ。origin/main も追いつく。',
    remote: true,
    setup: (w, run) => { run(C(1)); withRemote(w, run); run(C(2)); },
    solution: ['git push'],
    hint: 'git push',
  },
  {
    id: 's-pull', ch: 4, title: 'pull',
    goal: '仲間が push した変更を取り込もう',
    learn: 'pull = fetch (取ってくる) + merge (取り込む)。',
    remote: true,
    setup: (w, run) => { run(C(2)); withRemote(w, run); teammate(w); },
    solution: ['git pull'],
    hint: 'git pull',
  },
  {
    id: 's-fetch', ch: 4, title: 'fetch',
    goal: 'GitHub の状況だけ確認しよう (自分の main は動かさない)',
    learn: 'fetch = 取ってくるだけ。origin/main だけが動く。',
    remote: true,
    setup: (w, run) => { run(C(2)); withRemote(w, run); teammate(w); teammate(w); },
    solution: ['git fetch'],
    hint: 'git fetch',
  },
  {
    id: 's-rejected', ch: 4, title: '先を越された',
    goal: '自分の C3 を GitHub に送ろう (仲間が先に push している)',
    learn: 'push が拒否されたら、pull で取り込んでから push。',
    remote: true,
    setup: (w, run) => { run(C(2)); withRemote(w, run); run(C(1)); teammate(w); },
    solution: ['git pull', 'git push'],
    hint: 'git pull → git push',
  },
  {
    id: 's-pull-rebase', ch: 4, title: '一直線で共有',
    goal: '自分の C3 を、マージせずに一直線で GitHub に送ろう',
    learn: 'pull --rebase = 取ってきて、自分のコミットを先端に付け替える。',
    remote: true,
    setup: (w, run) => { run(C(2)); withRemote(w, run); run(C(1)); teammate(w); },
    solution: ['git pull --rebase', 'git push'],
    hint: 'git pull --rebase → git push',
  },
  {
    id: 's-feature-flow', ch: 4, title: '総まとめ',
    goal: 'feature を作って1回コミット、main にマージして GitHub に送ろう',
    learn: 'ブランチで作業 → main にマージ → 共有。これが基本の流れ。',
    remote: true,
    setup: (w, run) => { run(C(1)); withRemote(w, run); },
    solution: ['git switch -c feature', 'git commit', 'git switch main', 'git merge feature', 'git push'],
    hint: 'switch -c feature → commit → switch main → merge feature → push',
  },
];

STAGES.forEach((s) => { s.par = s.solution.filter((c) => !c.startsWith('__')).length; });

// ステージの世界を作る (solved = true ならゴールの状態)
export function buildStage(stage, { solved = false } = {}) {
  const w = new World();
  w.easy = true;
  w.user.name = 'あなた';
  silentRun(w, 'mkdir repo');
  w.cwd = STAGE_DIR;
  const run = (cmd) => silentRun(w, cmd, STAGE_DIR);
  run('git init');
  stage.setup(w, run);
  if (solved) {
    for (const cmd of stage.solution) {
      const m = cmd.match(/^__resolve (\S+)$/);
      if (m) {
        const d = w.dirs[STAGE_DIR];
        d.files[m[1]] = d.files[m[1]].replace(/<<<<<<< [^\n]*\n[\s\S]*?=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, '$1');
      } else run(cmd);
    }
  }
  return w;
}

export function stageShape(w, stage) {
  const d = w.dirs[STAGE_DIR];
  return d && d.repo ? repoShape(w, d.repo, { remote: !!stage.remote }) : '';
}

export function stars(stage, used) {
  if (used <= stage.par) return 3;
  if (used <= stage.par + 2) return 2;
  return 1;
}

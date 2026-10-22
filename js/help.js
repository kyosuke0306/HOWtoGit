// HELP: 「元に戻す手順」を組み立てる (自動では直さない。実務の復旧手順を学ぶ)
import { computeStatus } from './git.js';

const short = (id) => id.slice(0, 7);
const statusKey = (w, dir) => JSON.stringify(computeStatus(w, dir));

// 依頼が始まった時点のリポジトリを覚えておく
export function snapshot(w, path, remote) {
  const dir = w.dirs[path];
  const repo = dir && dir.repo;
  if (!repo) return { path, repo: false };
  return {
    path,
    repo: true,
    head: { ...repo.head },
    branches: { ...repo.branches },
    tags: { ...repo.tags },
    status: statusKey(w, dir),
    clean: !Object.values(computeStatus(w, dir)).some((v) => Array.isArray(v) && v.length),
    remote: remote ? JSON.stringify(remote.branches) : null,
  };
}

// 依頼前の状態に戻す手順。戻り値: { steps: [[説明, コマンド]], notes: [文] }
export function restorePlan(w, snap, remote) {
  const steps = [];
  const notes = [];
  if (!snap || !snap.repo) return null;
  const dir = w.dirs[snap.path];
  const repo = dir && dir.repo;
  if (!repo) return null;
  if (w.cwd !== snap.path) steps.push(['リポジトリのフォルダに入る', `cd ${snap.path}`]);
  if (repo.op) steps.push([`途中の ${repo.op.type} をやめる`, `git ${repo.op.type} --abort`]);

  // 書きかけの変更
  const s = computeStatus(w, dir);
  const dirty = s.staged.length || s.unstaged.length || s.untracked.length || s.conflicts.length;
  if (dirty && statusKey(w, dir) !== snap.status) {
    if (snap.clean) {
      steps.push(['書きかけの変更を捨てる', 'git reset --hard']);
      if (s.untracked.length) steps.push(['新しく作ったファイルを消す', 'git clean -f']);
    } else {
      notes.push('この依頼は書きかけの変更がある状態から始まっています。変更は自分で元に戻してください (git status で確認)。');
    }
  }

  // 依頼前にいたブランチへ
  const sh = snap.head;
  const cur = repo.head.type === 'branch' ? repo.head.name : null;
  if (sh.type === 'branch') {
    const b = sh.name, was = snap.branches[b];
    if (cur !== b) {
      if (repo.branches[b] !== undefined) steps.push([`${b} に戻る`, `git switch ${b}`]);
      else if (was) steps.push([`消した ${b} を作り直して戻る`, `git switch -c ${b} ${short(was)}`]);
    }
    const now = repo.branches[b];
    if (was && now !== undefined && now !== was) {
      // 書きかけの変更から始まった依頼は、変更を残したまま (--soft) ブランチだけ戻す
      steps.push(snap.clean ? [`${b} を依頼前のコミットに戻す`, `git reset --hard ${short(was)}`] : [`${b} を依頼前のコミットに戻す (変更は残す)`, `git reset --soft ${short(was)}`]);
    }
  } else if (repo.head.type !== 'detached' || repo.head.id !== sh.id) {
    steps.push(['依頼前に見ていたコミットに戻る', `git switch --detach ${short(sh.id)}`]);
  }

  // ほかのブランチ
  const startBranch = sh.type === 'branch' ? sh.name : null;
  for (const [b, id] of Object.entries(snap.branches)) {
    if (b === startBranch) continue;
    if (repo.branches[b] === undefined) steps.push([`消した ${b} を作り直す`, `git branch ${b} ${short(id)}`]);
    else if (repo.branches[b] !== id) steps.push([`${b} を依頼前の位置に戻す`, `git branch -f ${b} ${short(id)}`]);
  }
  for (const b of Object.keys(repo.branches)) {
    if (snap.branches[b] === undefined && b !== startBranch) steps.push([`依頼中に作った ${b} を消す`, `git branch -D ${b}`]);
  }
  for (const t of Object.keys(repo.tags)) if (snap.tags[t] === undefined) steps.push([`依頼中に付けたタグ ${t} を消す`, `git tag -d ${t}`]);

  // ブランチを移動せずに reset --hard <ID> するなら、先の「変更を捨てる」は要らない
  const plain = steps.findIndex(([, c]) => c === 'git reset --hard');
  if (plain >= 0 && !steps.some(([, c]) => c.startsWith('git switch')) && steps.some(([, c]) => c.startsWith('git reset --hard '))) steps.splice(plain, 1);

  if (remote && snap.remote && JSON.stringify(remote.branches) !== snap.remote) {
    notes.push('GitHub に送った (push した) ものは戻りません。仲間も使っているので、手元だけ戻しましょう。');
  }
  return { steps, notes };
}

// 戻り値: [{ title, why, steps: [[説明, コマンド]] }]
export function diagnose(w, { teamPath } = {}) {
  const dir = w.dir;
  const repo = dir && dir.repo;
  const out = [];
  if (!repo) {
    out.push({
      title: 'Git の管理外にいる',
      why: 'いまのフォルダはリポジトリではありません。',
      steps: teamPath ? [['リポジトリのフォルダに入る', `cd ${teamPath}`]] : [['リポジトリをコピーする', 'git clone <URL>'], ['そのフォルダに入る', 'cd <フォルダ名>']],
    });
    return out;
  }
  const s = computeStatus(w, dir);
  const branch = repo.head.type === 'branch' ? repo.head.name : null;
  const head = branch ? repo.branches[branch] : repo.head.id;

  // 作業途中 (merge / rebase など)
  if (repo.op) {
    const op = repo.op.type;
    const name = { merge: 'マージ', rebase: 'リベース', 'cherry-pick': 'チェリーピック', revert: 'リバート' }[op] || op;
    const files = s.conflicts.map((c) => c.path);
    out.push({
      title: `${name}の途中${files.length ? 'で競合している' : ''}`,
      why: files.length ? `${files.join(', ')} の同じ場所を両方が変えています。` : `${name}が終わっていません。`,
      steps: [
        [`やめて${name}前に戻す`, `git ${op} --abort`],
        ...(files.length ? [['または、直して進める: ファイルを直す', `edit ${files[0]}`], ['直したことを伝える', `git add ${files.join(' ')}`]] : []),
        ['進める', op === 'merge' ? 'git commit' : `git ${op} --continue`],
      ],
    });
    return out; // 途中の作業が片付くまでは他の手当てはしない
  }

  // HEAD がブランチから外れている
  if (!branch) {
    const lost = w.onlyIn(head, repo.branches.main || null).filter((id) => !Object.values(repo.branches).some((b) => w.isAncestor(id, b)));
    out.push({
      title: 'HEAD がブランチから外れている',
      why: '過去のコミットを直接見ている状態です。ここでのコミットはどのブランチにも残りません。',
      steps: [
        ...(lost.length ? [['ここで作ったコミットを残すなら、ブランチにする', 'git switch -c rescue']] : []),
        ['main に戻る', 'git switch main'],
      ],
    });
  }

  // まだ記録していない変更
  if (s.staged.length) {
    out.push({
      title: 'ステージに入れたものがある',
      why: '次のコミットに入る予定のファイルです。間違えて入れたなら外せます。',
      steps: [['ステージから外す (変更は残る)', `git restore --staged ${s.staged.map((x) => x.path).join(' ')}`]],
    });
  }
  const changed = s.unstaged.map((x) => x.path);
  if (changed.length) {
    out.push({
      title: '記録前の変更がある',
      why: `${changed.join(', ')} を書き換えたままです。`,
      steps: [
        ['変更を捨てて最後のコミットに戻す', `git restore ${changed.join(' ')}`],
        ['または、捨てずに一時退避する', 'git stash'],
      ],
    });
  }
  if (s.untracked.length) {
    out.push({
      title: 'Git がまだ知らないファイルがある',
      why: `${s.untracked.map((x) => x.path).join(', ')} は一度も add していません。`,
      steps: [['いらないなら消す', `rm ${s.untracked.map((x) => x.path).join(' ')}`], ['使うなら記録する', 'git add <ファイル>']],
    });
  }

  // リモートとのずれ
  const up = branch && repo.remoteRefs[`origin/${branch}`];
  if (branch && up) {
    const ahead = w.onlyIn(head, up).length;
    const behind = w.onlyIn(up, head).length;
    if (ahead && branch === 'main') {
      out.push({
        title: `main に直接コミットしている (${ahead}個)`,
        why: 'main はみんなの共有ブランチ。作業はブランチで行い、main は GitHub と同じ位置に戻します。',
        steps: [
          ['今のコミットを別ブランチに残す', 'git branch feature/rescue'],
          ['main を GitHub と同じ位置に戻す', 'git reset --hard origin/main'],
          ['残したブランチで作業を続ける', 'git switch feature/rescue'],
        ],
      });
    } else if (ahead && behind) {
      out.push({
        title: 'GitHub と手元が枝分かれしている',
        why: `手元だけに ${ahead}個、GitHub だけに ${behind}個のコミットがあります。`,
        steps: [['GitHub の変更を取り込む', 'git pull'], ['そのあと送る', 'git push']],
      });
    } else if (behind) {
      out.push({ title: `GitHub より ${behind}個 遅れている`, why: '仲間の変更がまだ手元にありません。', steps: [['取り込む', 'git pull']] });
    }
  }

  if (repo.stash.length) {
    out.push({ title: `退避した変更が ${repo.stash.length}個ある`, why: 'git stash でしまった変更です。', steps: [['中身を見る', 'git stash list'], ['戻す', 'git stash pop']] });
  }
  return out;
}

// どの状態でも使える調べ方と、最後の手段
export const LOOK = [['いまの状態を見る', 'git status'], ['ブランチの形を見る', 'git log --oneline --graph --all']];
export const LAST_RESORT = [['HEAD が動いた履歴を見る', 'git reflog'], ['壊れる前の位置に戻す (n は reflog の番号)', 'git reset --hard HEAD@{n}']];

// HELP: いまの状態から「元に戻す手順」を組み立てる (自動では直さない。実務の復旧手順を学ぶ)
import { computeStatus } from './git.js';

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

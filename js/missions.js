// チャレンジモードのミッション
import { TEAM_URL, FILES } from './scenario.js';
import { computeStatus, headId, currentBranch, isIgnored, mergeOnRemote } from './git.js';

const T = (api) => api.teamRepo();
const tPath = (api) => api.teamPath();
const rmain = (api) => api.remote().branches.main;

function isClean(api) {
  const d = T(api);
  if (!d || d.repo.op) return false;
  const s = computeStatus(api.w, d);
  return !s.staged.length && !s.unstaged.length && !s.conflicts.length;
}

// チームリポジトリ内のどこか (作業ツリー・stash・コミット) に文字列が残っているか
function existsSomewhere(api, needle) {
  const d = T(api);
  if (Object.values(d.files).some((v) => (v || '').includes(needle))) return true;
  if (d.repo.stash.some((s) => Object.values(s.work).some((v) => (v || '').includes(needle)))) return true;
  const tips = [headId(d.repo), ...Object.values(d.repo.branches)].filter(Boolean);
  for (const t of tips) for (const c of api.w.ancestors(t)) if (Object.values(api.w.objects[c].tree).some((v) => v.includes(needle))) return true;
  return false;
}

function treeOfRemote(api, b) { return api.remoteTree(b) || {}; }

const rnd = (n) => Math.floor(Math.random() * n);

export const FIRST_MISSION = {
  id: 'clone',
  title: 'チームに参加しよう',
  who: '田中',
  story: 'ようこそ Cafe Shop チームへ！まずはチームのリポジトリを手元にクローンして、そのフォルダに入ってね。',
  detail: `URL: <code>${TEAM_URL}</code>`,
  points: 50,
  hints: ['git clone <URL> でコピーできます', `git clone ${TEAM_URL}`, 'cd cafe-shop でフォルダに入ろう'],
  check: (api) => (T(api) && api.cwd === tPath(api) ? 'success' : null),
};

export const MISSIONS = [
  {
    id: 'feature-branch',
    title: '新機能ブランチ',
    who: '田中',
    points: 100,
    setup(api, m) {
      m.name = api.pick(['access', 'news', 'coupon', 'recruit', 'faq', 'gallery']);
      m.branch = `feature/${m.name}`;
      m.file = `${m.name}.html`;
      m.story = `新しく「${m.name}」ページを作りたいです！ <b>${m.branch}</b> ブランチで <b>${m.file}</b> を作ってコミットし、GitHub に push してください。`;
    },
    can: (api) => true,
    hints: (m) => ['まずは main から作業ブランチを作ろう: git switch -c ' + m.branch, `ファイルを作る: echo "<h1>${m.name}</h1>" > ${m.file}`, 'git add → git commit -m "..."', `初回の push: git push -u origin ${m.branch}`],
    check(api, evs, m) {
      const t = treeOfRemote(api, m.branch);
      return t[m.file] !== undefined ? 'success' : null;
    },
  },
  {
    id: 'pull-latest',
    title: '最新を取り込め',
    who: '佐藤',
    points: 80,
    setup(api, m) {
      const item = api.pick(['パフェ 700円', 'サンドイッチ 600円', 'ラテ 480円', 'プリン 350円']);
      const menu = treeOfRemote(api, 'main')['menu.txt'] || FILES['menu.txt'];
      api.teammatePush('main', { 'menu.txt': menu + item + '\n' }, `メニューに${item.split(' ')[0]}を追加`, '佐藤');
      if (Math.random() < 0.5) api.teammatePush('main', { 'README.md': (treeOfRemote(api, 'main')['README.md'] || '') + '\n営業時間: 9:00-18:00\n' }, '営業時間を追記', '田中');
      m.story = `メニューに「${item}」を追加して GitHub に push しました！あなたのローカルの <b>main</b> も最新にしておいてください。`;
    },
    hints: () => ['main ブランチにいるか確認 (git switch main)', 'git pull でリモートの変更を取り込めます', 'git fetch → git merge origin/main でもOK'],
    check(api) {
      const d = T(api);
      return d.repo.branches.main && api.contains(rmain(api), d.repo.branches.main) ? 'success' : null;
    },
  },
  {
    id: 'push-rejected',
    title: '先を越された！',
    who: '店長',
    points: 150,
    can: (api) => isClean(api),
    setup(api, m) {
      m.readme = treeOfRemote(api, 'main')['README.md'];
      m.tc = api.teammatePush('main', { 'style.css': (treeOfRemote(api, 'main')['style.css'] || '') + `/* 調整 ${rnd(100)} */\n` }, 'スタイルを微調整', '田中');
      m.story = 'README.md の「メンバー」にあなたの名前を追加して、<b>main</b> に push してください。(ちなみに田中さんもさっき何か push してたような…)';
    },
    hints: () => ['git switch main → README.md に追記 (echo "- 名前" >> README.md)', 'git commit -am "メンバーに追加" → git push', 'rejected になったら git pull してからもう一度 git push！'],
    check(api, evs, m) {
      const t = treeOfRemote(api, 'main');
      if (api.markers(t['README.md'])) return { fail: '競合マーカーが残ったまま push してしまった！' };
      return t['README.md'] !== m.readme && api.contains(m.tc, rmain(api)) ? 'success' : null;
    },
  },
  {
    id: 'safe-merge',
    title: '競合させるな！',
    who: '佐藤',
    points: 220,
    noConflict: true,
    can: (api) => isClean(api),
    setup(api, m) {
      const menu = treeOfRemote(api, 'main')['menu.txt'] || FILES['menu.txt'];
      const lines = menu.trimEnd().split('\n');
      const first = lines[0];
      const name = first.split(' ')[0];
      const names = api.pick([['tanaka-work', 'sato-work'], ['plan-a', 'plan-b'], ['idea-1', 'idea-2']]);
      const [bad, good] = Math.random() < 0.5 ? names : [names[1], names[0]];
      m.bad = `feature/${bad}`; m.good = `feature/${good}`;
      const changed = (p) => [`${name} ${p}円`, ...lines.slice(1)].join('\n') + '\n';
      m.badId = api.teammatePush(m.bad, { 'menu.txt': changed(480) }, `${name}の値段を見直し`, '田中', 'main');
      m.goodId = api.teammatePush(m.good, { 'hours.txt': '営業時間 9:00-18:00\n定休日 水曜\n' }, '営業時間のページを追加', '佐藤', 'main');
      api.teammatePush('main', { 'menu.txt': changed(450) }, `${name}を450円に値上げ`, '店長');
      m.story = `店長が main の menu.txt を更新しました。<b>${m.bad}</b> と <b>${m.good}</b> のうち、<b>main と競合しない方だけ</b>を main にマージして push してください。<br><span class="t-err">⚠ 競合を起こしたら失敗です！</span>`;
    },
    hints: (m) => ['git fetch でリモートの情報を取ってこよう', `git show origin/${m.bad} や git show origin/${m.good} で、それぞれ何を変更したか見てみよう`, 'git show origin/main で、店長がどのファイルを変えたかも確認', 'main と同じファイル・同じ行を変えている方が競合します'],
    check(api, evs, m) {
      const r = rmain(api);
      if (api.contains(m.badId, r)) return { fail: '競合するブランチを main に入れてしまった！' };
      return api.contains(m.goodId, r) ? 'success' : null;
    },
  },
  {
    id: 'resolve-conflict',
    title: '値上げ戦争',
    who: '店長',
    points: 200,
    can: (api) => isClean(api),
    setup(api, m) {
      const menu = treeOfRemote(api, 'main')['menu.txt'] || FILES['menu.txt'];
      const lines = menu.trimEnd().split('\n');
      const idx = Math.min(1, lines.length - 1);
      const name = lines[idx].split(' ')[0];
      m.name = name;
      m.price = api.pick([380, 400, 420, 450]);
      m.target = `${name} ${m.price}円`;
      const other = lines.slice(); other[idx] = `${name} ${m.price + 30}円`;
      m.tc = api.teammatePush('main', { 'menu.txt': other.join('\n') + '\n' }, `${name}の値段を変更`, '佐藤');
      m.story = `menu.txt の「${name}」を <b>${m.price}円</b> に変更して main に push してください！<br><small>(佐藤さんも同じ行を変えたらしい…。競合したら <b>${m.target}</b> が正解です)</small>`;
    },
    hints: (m) => [`menu.txt を編集: edit menu.txt で「${m.name}」の行を ${m.price}円 に`, 'コミットして push → 拒否されたら git pull', '競合したら edit menu.txt でマーカーを消して正しい値段に → git add → git commit → git push'],
    check(api, evs, m) {
      const t = treeOfRemote(api, 'main')['menu.txt'] || '';
      if (api.markers(t)) return { fail: '競合マーカー (<<<<<<<) が残ったまま push してしまった！' };
      return t.split('\n').includes(m.target) && api.contains(m.tc, rmain(api)) ? 'success' : null;
    },
  },
  {
    id: 'stash-hotfix',
    title: '緊急！誤字修正',
    who: '店長',
    points: 200,
    once: true,
    can: (api) => isClean(api) && !(T(api).repo.branches['feature/discount']),
    setup(api, m) {
      const p = tPath(api);
      const idx = treeOfRemote(api, 'main')['index.html'] || FILES['index.html'];
      api.sh('git switch main && git switch -c feature/discount', p);
      m.tc = api.teammatePush('main', { 'index.html': idx.replace('あります', 'あいます') }, 'キャッチコピーを調整', '田中');
      m.wip = '// 割引機能: 作業中';
      const d = T(api);
      d.files['app.js'] = (d.files['app.js'] || '') + `\nfunction discount(price) {\n  ${m.wip}\n}\n`;
      api.w.cwd = p;
      m.story = '割引機能 (feature/discount) の作業中にごめん！ GitHub の main の index.html に「あいます」という <b>誤字</b> が入ってしまった。main で「あります」に直して push して！<br><b>今の作業 (app.js の変更) は消さないでね。</b>';
    },
    hints: () => ['作業中の変更は git stash で退避できます', 'git switch main → git pull で最新に', 'edit index.html で誤字を直して commit → push', 'git switch feature/discount → git stash pop で作業を戻す'],
    check(api, evs, m) {
      const t = treeOfRemote(api, 'main');
      if (Object.values(t).some((v) => v.includes(m.wip))) return { fail: '作業中のコードを main に push してしまった！' };
      if (!existsSomewhere(api, m.wip)) return { fail: '作業中の変更が消えてしまった…' };
      const idx = t['index.html'] || '';
      return api.contains(m.tc, rmain(api)) && !idx.includes('あいます') && idx.includes('あります') && !api.markers(idx) ? 'success' : null;
    },
  },
  {
    id: 'revert-bad',
    title: '0円事件',
    who: '店長',
    points: 160,
    setup(api, m) {
      const menu = treeOfRemote(api, 'main')['menu.txt'] || FILES['menu.txt'];
      m.good = menu;
      m.bad = api.teammatePush('main', { 'menu.txt': menu.replace(/\d+円/g, '0円') }, 'テスト用に全部0円にした', '佐藤');
      m.story = '大変！佐藤さんのテスト用コミット「テスト用に全部0円にした」が本番の main に入ってしまった！<b>git revert</b> で打ち消して push して。<br><span class="t-err">⚠ 共有ブランチの履歴を書き換える reset + force push は厳禁！</span>';
    },
    hints: () => ['git switch main → git pull で問題のコミットを取り込む', 'git log --oneline で問題のコミットIDを確認', 'git revert <ID> で打ち消しコミットを作る', 'git push で共有'],
    check(api, evs, m) {
      const t = treeOfRemote(api, 'main');
      if (!api.contains(m.bad, rmain(api))) return { fail: '共有された履歴を消してしまった！revert を使おう' };
      return t['menu.txt'] === m.good ? 'success' : null;
    },
  },
  {
    id: 'release-tag',
    title: 'リリース準備',
    who: '店長',
    points: 100,
    setup(api, m) {
      const tags = Object.keys(api.remote().tags);
      m.tag = `v1.${tags.length}`;
      m.base = rmain(api);
      m.story = `いよいよリリースです！ GitHub の main の最新コミットに <b>${m.tag}</b> タグを付けて、GitHub に push してください。`;
    },
    hints: (m) => ['git switch main → git pull で最新に', `git tag ${m.tag}`, `タグは別途 push が必要: git push origin ${m.tag}`],
    check(api, evs, m) {
      const id = api.remote().tags[m.tag];
      if (!id) return null;
      return api.contains(m.base, id) ? 'success' : { fail: 'タグが古いコミットに付いています。main の最新に付けよう' };
    },
  },
  {
    id: 'cleanup-branch',
    title: 'ブランチのお掃除',
    who: '佐藤',
    points: 100,
    setup(api, m) {
      m.branch = `feature/${api.pick(['old-banner', 'campaign', 'summer-sale'])}-${rnd(90) + 10}`;
      api.teammatePush(m.branch, { 'banner.txt': '夏のセール開催中！\n' }, 'バナーを追加', '佐藤', 'main');
      const r = api.remote();
      const n = ++api.w.prCounter;
      r.prs.push({ number: n, title: 'バナーを追加', head: m.branch, base: 'main', state: 'merged', author: '佐藤' });
      mergeOnRemote(api.w, r, 'main', m.branch, `Merge pull request #${n} from ${m.branch}`, '佐藤');
      api.sh(`git fetch && git branch ${m.branch} origin/${m.branch}`, tPath(api));
      m.story = `<b>${m.branch}</b> はもうマージ済みで不要になりました。ローカルと GitHub の <b>両方</b> から削除して整理してください。`;
    },
    hints: (m) => ['git branch -a でブランチ一覧を確認', `ローカルの削除: git branch -d ${m.branch}`, `リモートの削除: git push origin --delete ${m.branch}`],
    check(api, evs, m) {
      return !T(api).repo.branches[m.branch] && !api.remote().branches[m.branch] ? 'success' : null;
    },
  },
  {
    id: 'amend',
    title: 'メッセージのタイポ',
    who: '田中',
    points: 100,
    can: (api) => isClean(api) && !!currentBranch(T(api).repo),
    setup(api, m) {
      const p = tPath(api);
      api.w.cwd = p;
      m.file = `login-${rnd(900) + 100}.html`;
      api.sh(`echo "<form>ログイン</form>" > ${m.file} && git add ${m.file} && git commit -m "ろぐいん画面をついか"`, p);
      m.bad = headId(T(api).repo);
      m.story = 'あれ？ さっきのあなたのコミット、メッセージが「ろぐいん画面をついか」になってるよ。まだ push してないなら <b>「ログイン画面を追加」</b> に直しておいて！';
    },
    hints: () => ['git log --oneline で直前のコミットを確認', '直前のコミットを修正: git commit --amend -m "ログイン画面を追加"'],
    check(api, evs, m) {
      const d = T(api);
      const h = headId(d.repo);
      const c = api.w.objects[h];
      if (api.w.ancestors(h).has(m.bad) && h !== m.bad) return { fail: '修正ではなく新しいコミットを重ねてしまった (--amend を使おう)' };
      return h !== m.bad && c.message.includes('ログイン画面を追加') && c.tree[m.file] !== undefined ? 'success' : null;
    },
  },
  {
    id: 'unstage-secret',
    title: 'パスワード流出の危機',
    who: '佐藤',
    points: 130,
    can: (api) => isClean(api),
    setup(api, m) {
      const p = tPath(api);
      api.w.cwd = p;
      m.secret = `PASSWORD=cafe${rnd(9000) + 1000}`;
      T(api).files['.env'] = m.secret + '\n';
      T(api).files['share.js'] = 'function share() {\n  // SNSでシェア\n}\n';
      api.sh('git add .', p);
      m.start = headId(T(api).repo);
      m.story = 'シェアボタン (share.js) をコミットしようとして、うっかり <b>パスワード入りの .env</b> までステージしちゃった！ .env をステージから外して、<b>share.js だけ</b>コミットして。<br><small>(ボーナス: .gitignore に .env を書いてコミットすると完璧)</small>';
    },
    hints: () => ['git status でステージの状態を確認', 'ステージから外す: git restore --staged .env', 'git commit -m "シェアボタンを追加"', 'ボーナス: echo ".env" >> .gitignore && git add .gitignore'],
    check(api, evs, m) {
      const d = T(api);
      const h = headId(d.repo);
      for (const c of api.w.onlyIn(h, m.start)) if (api.w.objects[c].tree['.env'] !== undefined) return { fail: 'パスワードをコミットしてしまった！' };
      const t = api.w.tree(h);
      if (t['share.js'] !== undefined && h !== m.start) {
        m.bonus = isIgnored(d, '.env') && t['.gitignore'] !== undefined && t['.gitignore'].includes('.env') ? 50 : 0;
        return 'success';
      }
      return null;
    },
  },
  {
    id: 'cherry-fix',
    title: 'いいとこ取り',
    who: '佐藤',
    points: 180,
    once: true,
    can: (api) => (treeOfRemote(api, 'main')['app.js'] || '').includes('price * 10'),
    setup(api, m) {
      api.teammatePush('experiment', { 'style.css': (treeOfRemote(api, 'main')['style.css'] || '') + 'body { background: rainbow; }\n' }, '実験: 背景を虹色に', '佐藤', 'main');
      const app = treeOfRemote(api, 'experiment')['app.js'];
      m.fix = api.teammatePush('experiment', { 'app.js': app.replace('price * 10', 'Math.floor(price * 1.1)') }, 'バグ修正: 税込み価格の計算ミス', '佐藤');
      api.teammatePush('experiment', { 'bgm.js': 'playMusic("jazz.mp3");\n' }, '実験: BGMを追加', '佐藤');
      m.story = '実験用の <b>experiment</b> ブランチに、税込み計算のバグ修正を入れちゃった。<b>「バグ修正」のコミットだけ</b>を main に取り込んで push してくれる？ 他の実験はまだ main に入れないで！';
    },
    hints: () => ['git fetch → git log --oneline origin/experiment でコミットIDを確認', 'git switch main → git pull', 'git cherry-pick <バグ修正のID>', 'git push'],
    check(api, evs, m) {
      const t = treeOfRemote(api, 'main');
      if (t['bgm.js'] !== undefined || (t['style.css'] || '').includes('rainbow')) return { fail: '実験的な変更まで main に入れてしまった！' };
      return (t['app.js'] || '').includes('1.1') ? 'success' : null;
    },
  },
  {
    id: 'rebase-feature',
    title: '一直線の履歴',
    who: '田中',
    points: 200,
    can: (api) => isClean(api),
    setup(api, m) {
      const d = T(api);
      m.branch = `feature/profile-${rnd(90) + 10}`;
      const base = rmain(api);
      const c1 = api.w.commitOn(base, { 'profile.html': '<h1>スタッフ紹介</h1>\n' }, 'スタッフ紹介ページを追加', api.w.user.name);
      const c2 = api.w.commitOn(c1, { 'profile.css': '.staff { margin: 8px; }\n' }, 'スタッフ紹介のCSS', api.w.user.name);
      d.repo.branches[m.branch] = c2;
      api.teammatePush('main', { 'README.md': (treeOfRemote(api, 'main')['README.md'] || '') + '\n## 更新履歴\n' }, 'READMEに更新履歴を追加', '田中');
      api.teammatePush('main', { 'index.html': (treeOfRemote(api, 'main')['index.html'] || '').replace('</body>', '<footer>© Cafe Shop</footer>\n</body>') }, 'フッターを追加', '佐藤');
      m.story = `あなたが昨日作った <b>${m.branch}</b> ブランチ、その後 main がかなり進んじゃった。<b>GitHub の main の最新</b>に <b>rebase</b> して、一直線の履歴にしてから push してね。(マージコミットは作らないで！)`;
    },
    hints: (m) => ['git fetch で origin/main を最新に', `git switch ${m.branch}`, 'git rebase origin/main', `git push -u origin ${m.branch}`],
    check(api, evs, m) {
      const id = api.remote().branches[m.branch];
      if (!id) return null;
      const extra = api.w.onlyIn(id, rmain(api));
      if (extra.some((c) => api.w.objects[c].parents.length > 1)) return { fail: 'マージコミットができてしまった (rebase を使おう)' };
      return api.contains(rmain(api), id) && extra.length >= 2 ? 'success' : null;
    },
  },
  {
    id: 'pr-flow',
    title: 'プルリクエスト',
    who: '店長',
    points: 200,
    setup(api, m) {
      m.name = api.pick(['blog', 'event', 'shop-list', 'reserve', 'map']);
      m.branch = `feature/${m.name}`;
      m.story = `「${m.name}」ページをお願い！今回は <b>Pull Request</b> 経由で。<b>${m.branch}</b> ブランチで ${m.name}.html を作り、push → PR 作成 → マージ。最後にローカルの main も最新にしてね。`;
    },
    hints: (m) => [`git switch main → git switch -c ${m.branch}`, `echo "..." > ${m.name}.html → add → commit`, `git push -u origin ${m.branch}`, 'gh pr create --title "..." → gh pr merge <番号>', 'git switch main → git pull'],
    check(api, evs, m) {
      const merged = api.remote().prs.some((p) => p.head === m.branch && p.state === 'merged');
      const d = T(api);
      return merged && d.repo.branches.main && api.contains(rmain(api), d.repo.branches.main) ? 'success' : null;
    },
  },
  {
    id: 'review-pr',
    title: 'レビュー依頼',
    who: '佐藤',
    points: 120,
    setup(api, m) {
      m.branch = `feature/drink-${rnd(90) + 10}`;
      const menu = treeOfRemote(api, 'main')['menu.txt'] || FILES['menu.txt'];
      api.teammatePush(m.branch, { 'menu.txt': menu + 'レモネード 450円\n' }, 'レモネードを追加', '佐藤', 'main');
      m.number = ++api.w.prCounter;
      api.remote().prs.push({ number: m.number, title: 'レモネードを追加', head: m.branch, base: 'main', state: 'open', author: '佐藤' });
      m.story = `PR #${m.number}「レモネードを追加」を作りました！確認してマージお願いします🍋 マージしたら、あなたのローカルの main も更新しておいてね。`;
    },
    hints: (m) => ['gh pr list で PR 一覧を確認', `gh pr view ${m.number} で内容を確認`, `gh pr merge ${m.number}`, 'git switch main → git pull'],
    check(api, evs, m) {
      const pr = api.remote().prs.find((p) => p.number === m.number);
      const d = T(api);
      return pr.state === 'merged' && d.repo.branches.main && api.contains(rmain(api), d.repo.branches.main) ? 'success' : null;
    },
  },
  {
    id: 'discard',
    title: 'ファイルを壊した！',
    who: '田中',
    points: 80,
    can: (api) => isClean(api),
    setup(api, m) {
      const d = T(api);
      api.w.cwd = tPath(api);
      m.file = api.pick(Object.keys(api.w.tree(headId(d.repo))).filter((f) => /\.(js|html|css|txt)$/.test(f)));
      d.files[m.file] = 'ああああああああ (猫がキーボードの上を歩いた)\n';
      m.story = `大変、<b>${m.file}</b> が猫に荒らされた！🐈 最後にコミットした状態に戻して。`;
    },
    hints: (m) => ['git status / git diff で状態を確認', `git restore ${m.file} で最後のコミットの状態に戻せます`],
    check(api, evs, m) {
      const d = T(api);
      if ((api.w.tree(headId(d.repo))[m.file] || '').includes('猫がキーボード')) return { fail: '壊れたファイルをコミットしてしまった！' };
      return d.files[m.file] === api.w.tree(headId(d.repo))[m.file] ? 'success' : null;
    },
  },
  {
    id: 'reflog-rescue',
    title: '消えたコミットを救え',
    who: '佐藤',
    points: 180,
    can: (api) => isClean(api) && !!currentBranch(T(api).repo),
    setup(api, m) {
      const p = tPath(api);
      api.w.cwd = p;
      m.file = `contact-${rnd(900) + 100}.html`;
      m.content = '<form>お問い合わせフォーム</form>\n';
      T(api).files[m.file] = m.content;
      api.sh(`git add ${m.file} && git commit -m "お問い合わせフォームを追加" && git reset --hard HEAD~1`, p);
      m.story = 'あっ…さっきあなたが作った「お問い合わせフォームを追加」のコミット、<b>git reset --hard</b> で消しちゃったみたい！ <b>reflog</b> で探して、今のブランチに復活させて！';
    },
    hints: () => ['git reflog で HEAD の移動履歴を見よう', '「commit: お問い合わせフォームを追加」の行の ID か HEAD@{n} を探す', 'git reset --hard <ID> や git cherry-pick <ID> で復活'],
    check(api, evs, m) {
      const d = T(api);
      return d.files[m.file] === m.content && api.w.tree(headId(d.repo))[m.file] === m.content ? 'success' : null;
    },
  },
  {
    id: 'gitignore',
    title: 'ゴミを入れるな',
    who: '田中',
    points: 120,
    once: true,
    can: (api) => isClean(api) && !api.w.tree(headId(T(api).repo))['.gitignore'],
    setup(api, m) {
      const d = T(api);
      api.w.cwd = tPath(api);
      Object.assign(d.files, { 'debug.log': 'ERROR 2026-04-01 something wrong\n', 'node_modules/jquery.js': '/* jQuery */\n', 'error.log': 'oops\n' });
      m.story = '<b>*.log ファイル</b> と <b>node_modules/</b> フォルダはコミットしたくない。<b>.gitignore</b> を作ってコミットしてね。';
    },
    hints: () => ['edit .gitignore で .gitignore を作成', '中身: *.log と node_modules/ の2行', 'git add .gitignore && git commit -m ".gitignoreを追加"'],
    check(api) {
      const d = T(api);
      const t = api.w.tree(headId(d.repo));
      if (Object.keys(t).some((p) => p.endsWith('.log') || p.startsWith('node_modules/'))) return { fail: 'ログやライブラリをコミットしてしまった！' };
      if (!t['.gitignore']) return null;
      const fake = { files: { '.gitignore': t['.gitignore'] } };
      return ['debug.log', 'error.log', 'node_modules/jquery.js'].every((p) => isIgnored(fake, p)) ? 'success' : null;
    },
  },
  {
    id: 'merge-feature',
    title: 'マージ担当',
    who: '田中',
    points: 130,
    setup(api, m) {
      m.branch = `feature/news-${rnd(90) + 10}`;
      api.teammatePush(m.branch, { 'news.html': '<h1>お知らせ</h1>\n' }, 'お知らせページを追加', '田中', 'main');
      m.tip = api.teammatePush(m.branch, { 'news.html': '<h1>お知らせ</h1>\n<p>新メニュー登場</p>\n' }, 'お知らせを追記', '田中');
      api.teammatePush('main', { 'style.css': (treeOfRemote(api, 'main')['style.css'] || '') + '.news { color: red; }\n' }, 'お知らせ用のスタイル', '佐藤');
      m.story = `<b>${m.branch}</b> のレビューが終わったよ。あなたの手元で main に <b>マージ</b> して、GitHub に push してくれる？`;
    },
    hints: (m) => ['git fetch で新しいブランチを取得', 'git switch main → git pull', `git merge origin/${m.branch}`, 'git push'],
    check(api, evs, m) {
      return api.contains(m.tip, rmain(api)) ? 'success' : null;
    },
  },
];

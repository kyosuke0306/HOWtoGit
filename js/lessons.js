// チュートリアル (レッスン) の定義
import { buildTeamRemote, TEAM_URL, TEAM_DIR, FILES } from './scenario.js';
import { isIgnored } from './git.js';

const MYAPP = '~/my-app';
const MYAPP_URL = 'https://github.com/you/my-app.git';

// よく使う準備
function myApp(api, extra = '') {
  api.sh('mkdir my-app');
  api.w.cwd = MYAPP;
  api.sh('git init && echo "# My App" > README.md && git add . && git commit -m "最初のコミット"');
  api.sh('echo "<h1>My App</h1>" > index.html && git add . && git commit -m "トップページを追加"');
  if (extra) api.sh(extra);
}

function teamClone(api) {
  buildTeamRemote(api.w);
  api.sh('git clone ' + TEAM_URL);
  api.w.cwd = TEAM_DIR;
}

const onBranch = (api, b) => api.branch() === b;
const work = (api, f) => api.dir.files[f];
const inHead = (api, f) => api.headTree()[f] !== undefined;

export const LESSONS = withSoftSteps([
  {
    id: 'first-commit',
    chapter: 1,
    title: 'はじめてのコミット',
    summary: 'リポジトリを作って、最初の記録をしよう',
    intro: '<p>Git = 変更の<b>セーブポイント</b>。</p><p><b>編集 → add → commit</b> で記録します。</p>',
    setup() {},
    steps: [
      { text: '名前を設定しよう', hint: 'git config --global user.name "Taro"', check: (api, evs) => api.has(evs, 'config') },
      { text: 'フォルダを作って入ろう', hint: 'mkdir my-app && cd my-app', check: (api) => api.cwd === MYAPP },
      { text: 'Git リポジトリにしよう', hint: 'git init', check: (api) => !!api.repo },
      { text: 'ファイルを作ろう', hint: 'echo "# My App" > README.md', check: (api) => work(api, 'README.md') !== undefined },
      { text: '状態を確認 (赤 = 未追跡)', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: 'ステージに載せよう', hint: 'git add README.md', check: (api) => api.repo.index['README.md'] !== undefined },
      { text: 'コミットしよう', hint: 'git commit -m "最初のコミット"', check: (api) => !!api.head() },
      { text: '履歴を見よう', hint: 'git log', check: (api, evs) => api.has(evs, 'log') },
    ],
    outro: '最初のコミット完了！',
  },
  {
    id: 'record-changes',
    chapter: 1,
    title: '変更を記録する',
    summary: 'diff で変更を確認してコミット',
    intro: '<p>変更したら <b>diff で確認 → add → commit</b>。</p>',
    setup(api) {
      api.sh('mkdir my-app');
      api.w.cwd = MYAPP;
      api.sh('git init && echo "# My App" > README.md && git add . && git commit -m "最初のコミット"');
    },
    steps: [
      { text: 'README.md に追記しよう', hint: 'echo "Gitの練習アプリです" >> README.md', check: (api) => work(api, 'README.md') !== api.headTree()['README.md'] },
      { text: '差分を見よう', hint: 'git diff', check: (api, evs) => api.has(evs, 'diff') },
      { text: 'ステージに載せよう', hint: 'git add README.md', check: (api) => api.repo.index['README.md'] === work(api, 'README.md') && api.repo.index['README.md'] !== api.headTree()['README.md'] },
      { text: 'ステージ済みの差分を見よう', hint: 'git diff --staged', check: (api, evs) => api.has(evs, 'diff', (e) => e.staged) },
      { text: 'コミットしよう', hint: 'git commit -m "説明を追加"', check: (api) => api.w.ancestors(api.head()).size >= 2 && api.headTree()['README.md'] === work(api, 'README.md') },
      { text: 'index.html を作ってコミット', hint: 'echo "<h1>My App</h1>" > index.html && git add index.html && git commit -m "トップページを追加"', check: (api) => inHead(api, 'index.html') },
      { text: '1行ずつ履歴を見よう', hint: 'git log --oneline', check: (api, evs) => api.has(evs, 'log') },
    ],
    outro: 'これが基本サイクル！',
  },
  {
    id: 'undo',
    chapter: 1,
    title: '変更を取り消す',
    summary: 'restore と amend でやり直し',
    intro: '<p>間違えても戻せます。</p><ul><li><code>restore</code> 変更を捨てる</li><li><code>restore --staged</code> ステージから外す</li><li><code>--amend</code> 直前のコミットを修正</li></ul>',
    setup(api) { myApp(api); },
    steps: [
      { text: 'index.html を壊そう', hint: 'echo "めちゃくちゃ" > index.html', check: (api) => work(api, 'index.html') !== api.headTree()['index.html'] },
      { text: '元に戻そう', hint: 'git restore index.html', check: (api) => work(api, 'index.html') === api.headTree()['index.html'] },
      { text: 'memo.txt を作ってステージ', hint: 'echo "パスワード1234" > memo.txt && git add memo.txt', check: (api) => api.repo.index['memo.txt'] !== undefined },
      { text: 'ステージから外そう', hint: 'git restore --staged memo.txt', check: (api) => api.repo.index['memo.txt'] === undefined && work(api, 'memo.txt') !== undefined },
      { text: 'memo.txt を削除', hint: 'rm memo.txt', check: (api) => work(api, 'memo.txt') === undefined },
      { text: 'わざと誤字でコミット', hint: 'echo "<footer>2026</footer>" >> index.html && git commit -am "ふったーをついか"', check: (api) => api.w.objects[api.head()].message.includes('ふったー') },
      { text: 'メッセージを直そう', hint: 'git commit --amend -m "フッターを追加"', check: (api, evs) => api.has(evs, 'amend') && !api.w.objects[api.head()].message.includes('ふったー') },
    ],
    outro: 'ミスはすぐ直せる！',
  },
  {
    id: 'branch',
    chapter: 2,
    title: 'ブランチを作る',
    summary: 'branch と switch で作業を枝分かれ',
    intro: '<p>ブランチ = <b>作業の枝分かれ</b>。</p><p>HEAD = 今いる場所。</p>',
    setup(api) { myApp(api); },
    steps: [
      { text: 'ブランチ一覧を見よう', hint: 'git branch', check: (api, evs) => api.has(evs, 'branch-list') },
      { text: 'feature/about を作ろう', hint: 'git branch feature/about', check: (api) => api.repo.branches['feature/about'] !== undefined },
      { text: '移動しよう', hint: 'git switch feature/about', check: (api) => onBranch(api, 'feature/about') },
      { text: 'about.html をコミット', hint: 'echo "<h1>About</h1>" > about.html && git add . && git commit -m "Aboutページを追加"', check: (api) => onBranch(api, 'feature/about') && inHead(api, 'about.html') },
      { text: 'main に戻ろう', hint: 'git switch main && ls', check: (api) => onBranch(api, 'main') },
      { text: '作成+移動を一度に', hint: 'git switch -c feature/contact', check: (api) => onBranch(api, 'feature/contact') },
      { text: 'contact.html をコミット', hint: 'echo "<h1>Contact</h1>" > contact.html && git add . && git commit -m "お問い合わせページを追加"', check: (api) => onBranch(api, 'feature/contact') && inHead(api, 'contact.html') },
    ],
    outro: '枝分かれできた！',
  },
  {
    id: 'merge',
    chapter: 2,
    title: 'マージする',
    summary: 'Fast-forward と マージコミット',
    intro: '<p>マージ = 別ブランチを<b>取り込む</b>。</p><p>取り込む側に移動してから実行。</p>',
    setup(api) { myApp(api, 'git switch -c feature/about && echo "<h1>About</h1>" > about.html && git add . && git commit -m "Aboutページを追加" && git switch main'); },
    steps: [
      { text: 'feature/about を取り込もう', hint: 'git merge feature/about', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'ff') },
      { text: 'feature/news で news.html をコミット', hint: 'git switch -c feature/news && echo "<h1>News</h1>" > news.html && git add . && git commit -m "ニュースページを追加"', check: (api) => onBranch(api, 'feature/news') && inHead(api, 'news.html') },
      { text: 'main でも別の変更をコミット', hint: 'git switch main && echo "<p>営業中</p>" >> index.html && git commit -am "営業中の表示を追加"', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '').includes('営業中') && !api.contains(api.head(), api.repo.branches['feature/news']) },
      { text: 'feature/news をマージ', hint: 'git merge feature/news', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'merge') },
      { text: 'グラフ付きで履歴を見よう', hint: 'git log --oneline --graph', check: (api, evs) => api.has(evs, 'log') },
      { text: 'マージ済みブランチを削除', hint: 'git branch -d feature/news', check: (api) => api.repo.branches['feature/news'] === undefined },
    ],
    outro: '2種類のマージを体験！',
  },
  {
    id: 'conflict',
    chapter: 2,
    title: '競合を解決する',
    summary: '同じ行を変えたら…コンフリクト！',
    intro: '<p>同じ行を別々に変えると<b>競合</b>。</p><pre class="conflict-sample">&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD\n自分\n=======\n相手\n&gt;&gt;&gt;&gt;&gt;&gt;&gt; 相手</pre><p>直して <b>add → commit</b>。</p>',
    setup(api) {
      api.sh('mkdir my-app');
      api.w.cwd = MYAPP;
      api.sh(`git init && echo "コーヒー 400円" > menu.txt && echo "紅茶 350円" >> menu.txt && echo "ケーキ 500円" >> menu.txt && git add . && git commit -m "メニューを作成"`);
      api.w.dir.files['menu.txt'] = FILES['menu.txt'].replace('コーヒー 400円', 'コーヒー 450円');
      api.sh('git switch -c feature/price && git commit -am "コーヒーを450円に値上げ" && git switch main');
      api.w.dir.files['menu.txt'] = FILES['menu.txt'].replace('コーヒー 400円', 'コーヒー 420円');
      api.sh('git commit -am "コーヒーを420円に変更"');
    },
    steps: [
      { text: 'マージしてみよう', hint: 'git merge feature/price', check: (api, evs) => api.has(evs, 'conflict') },
      { text: '状態を確認', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '中身を見よう', hint: 'cat menu.txt', check: (api, evs) => api.has(evs, 'cat') },
      { text: '編集して印を消そう', hint: 'edit menu.txt', check: (api) => !api.markers(work(api, 'menu.txt')) },
      { text: '解決済みにしよう', hint: 'git add menu.txt', check: (api) => api.repo.conflicts.length === 0 },
      { text: 'コミットして完了', hint: 'git commit', check: (api) => !api.repo.op && api.w.objects[api.head()].parents.length === 2 },
    ],
    outro: '競合は怖くない！',
  },
  {
    id: 'push',
    chapter: 3,
    title: 'GitHub に push する',
    summary: 'remote add と push',
    intro: '<p><b>push</b> = GitHub にコミットを送る。</p>',
    setup(api) { myApp(api); },
    steps: [
      { text: 'GitHub にリポジトリを作ろう', hint: 'gh repo create my-app', check: (api) => !!api.w.remotes[MYAPP_URL] },
      { text: 'origin として登録', hint: `git remote add origin ${MYAPP_URL}`, check: (api) => api.repo.remotes.origin === MYAPP_URL },
      { text: 'push しよう', hint: 'git push -u origin main', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main && !!api.repo.upstream.main },
      { text: '変更してコミット', hint: 'echo "練習中です" >> README.md && git commit -am "READMEを更新"', check: (api) => api.repo.branches.main !== api.remote(MYAPP_URL).branches.main },
      { text: '状態を確認 (ahead)', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: 'もう一度 push', hint: 'git push', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main },
    ],
    outro: 'GitHub に保存できた！',
  },
  {
    id: 'clone-pull',
    chapter: 3,
    title: 'チーム開発: clone と pull',
    summary: '仲間の変更を取り込む',
    intro: '<p>チームに参加！</p><p><b>clone</b> でコピー、<b>pull</b> で最新を取り込む。</p>',
    setup(api) { buildTeamRemote(api.w); },
    steps: [
      { text: 'クローンしよう', hint: `git clone ${TEAM_URL}`, check: (api) => !!api.w.dirs[TEAM_DIR] },
      { text: 'フォルダに入ろう', hint: 'cd cafe-shop', check: (api) => api.cwd === TEAM_DIR },
      { text: '履歴を見よう', hint: 'git log --oneline', check: (api, evs) => api.has(evs, 'log') },
      {
        text: '最新情報を取ってこよう',
        hint: 'git fetch',
        onEnter(api) {
          api.teammatePush('main', { 'menu.txt': FILES['menu.txt'] + 'パフェ 700円\n' }, 'メニューにパフェを追加', '佐藤');
          api.chat('佐藤', 'メニューにパフェを追加して push しました！');
        },
        check: (api, evs) => api.has(evs, 'fetch'),
      },
      { text: 'origin/main を取り込もう', hint: 'git merge origin/main', check: (api) => api.contains(api.remote().branches.main, api.repo.branches.main) },
      {
        text: 'pull で一発取り込み',
        hint: 'git pull',
        onEnter(api) {
          api.teammatePush('main', { 'style.css': FILES['style.css'] + 'p { color: #333; }\n' }, '文字色を調整', '田中');
          api.chat('田中', '文字色をちょっと調整しました〜');
        },
        check: (api, evs) => api.has(evs, 'pull') && api.contains(api.remote().branches.main, api.repo.branches.main),
      },
    ],
    outro: 'fetch は見るだけ、pull は取り込む！',
  },
  {
    id: 'push-rejected',
    chapter: 3,
    title: 'push が拒否されたら',
    summary: 'rejected → pull → push',
    intro: '<p>先に push した人がいると<b>拒否</b>されます。</p><p><b>pull してから push</b>。force は禁止。</p>',
    setup(api) { teamClone(api); },
    steps: [
      { text: '自分を追記してコミット', hint: 'echo "- あなた" >> README.md && git commit -am "メンバーに追加"', check: (api) => api.repo.branches.main !== api.remote().branches.main && api.headTree()['README.md'] !== FILES['README.md'] },
      {
        text: 'push しよう',
        hint: 'git push',
        onEnter(api) {
          api.teammatePush('main', { 'style.css': FILES['style.css'] + 'h2 { color: green; }\n' }, '見出しの色を追加', '田中');
          api.chat('田中', 'style.css を更新して push しておきました！');
        },
        check: (api, evs) => api.has(evs, 'push-rejected'),
      },
      { text: '拒否！ pull しよう', hint: 'git pull', check: (api) => api.contains(api.remote().branches.main, api.repo.branches.main) },
      { text: 'もう一度 push', hint: 'git push', check: (api) => api.remote().branches.main === api.repo.branches.main },
      {
        text: 'pull --rebase も試そう',
        hint: 'echo "パフェ 700円" >> menu.txt && git commit -am "パフェを追加" && git pull --rebase && git push',
        onEnter(api) {
          api.teammatePush('main', { 'index.html': FILES['index.html'].replace('おいしいコーヒーあります', 'おいしいコーヒーと紅茶あります') }, 'キャッチコピーを変更', '佐藤');
          api.chat('佐藤', 'キャッチコピーを変えました');
        },
        check: (api, evs, st) => {
          if (api.has(evs, 'pull', (e) => e.result === 'rebase')) st.rebased = true;
          return st.rebased && api.remote().branches.main === api.repo.branches.main;
        },
      },
    ],
    outro: '拒否されたら pull → push！',
  },
  {
    id: 'stash',
    chapter: 4,
    title: 'stash で一時退避',
    summary: '作業中に割り込みが入ったら',
    intro: '<p><b>stash</b> = 作業を一時退避。</p><p><b>pop</b> で戻す。</p>',
    setup(api) {
      teamClone(api);
      api.sh('git switch -c feature/coupon');
      api.w.dir.files['app.js'] = FILES['app.js'] + '\nfunction coupon(price) {\n}\n';
      api.sh('git commit -am "クーポン機能の下準備"');
      api.w.dir.files['app.js'] = FILES['app.js'] + '\nfunction coupon(price) {\n  return price - 100; // 作業中\n}\n';
    },
    steps: [
      { text: 'main に移動してみよう', hint: 'git switch main', check: (api) => /(switch|checkout)\s+main/.test(api.lastCmd) },
      { text: '退避しよう', hint: 'git stash', check: (api) => api.repo.stash.length > 0 },
      { text: '退避一覧を見よう', hint: 'git stash list', check: (api, evs) => api.has(evs, 'stash', (e) => e.action === 'list') },
      { text: 'main に移動', hint: 'git switch main', check: (api) => onBranch(api, 'main') },
      { text: 'お知らせをコミット', hint: 'echo "<p>本日は定休日です</p>" >> index.html && git commit -am "定休日のお知らせ"', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '') !== FILES['index.html'] },
      { text: 'feature/coupon に戻ろう', hint: 'git switch feature/coupon', check: (api) => onBranch(api, 'feature/coupon') },
      { text: '作業を復元', hint: 'git stash pop', check: (api) => api.repo.stash.length === 0 && (work(api, 'app.js') || '').includes('作業中') },
    ],
    outro: '作業の中断に便利！',
  },
  {
    id: 'reset-revert',
    chapter: 4,
    title: 'reset と revert',
    summary: 'コミットを取り消す2つの方法',
    intro: '<ul><li><b>reset</b> = push 前の取り消し</li><li><b>revert</b> = push 後の取り消し</li></ul>',
    setup(api) {
      myApp(api, `echo "バグ" > bug.txt && git add . && git commit -m "間違ったコミット"`);
      api.sh(`gh repo create my-app && git remote add origin ${MYAPP_URL} && git push -u origin main`);
    },
    steps: [
      { text: '一時的なコミットを作ろう', hint: 'echo "test" > tmp.txt && git add . && git commit -m "一時的なコミット"', check: (api) => api.w.objects[api.head()].message === '一時的なコミット' },
      { text: '1つ前に戻そう (--soft)', hint: 'git reset --soft HEAD~1', check: (api) => api.w.objects[api.head()].message !== '一時的なコミット' && api.repo.index['tmp.txt'] !== undefined },
      { text: '状態を確認', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '変更を全部捨てよう', hint: 'git reset --hard HEAD', check: (api) => work(api, 'tmp.txt') === undefined && api.repo.index['tmp.txt'] === undefined },
      { text: 'push 済みを打ち消そう', hint: 'git revert HEAD', check: (api, evs) => api.has(evs, 'revert') && work(api, 'bug.txt') === undefined },
      { text: 'push しよう', hint: 'git push', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main },
      { text: 'HEAD の履歴を見よう', hint: 'git reflog', check: (api, evs) => api.has(evs, 'reflog') },
    ],
    outro: 'push 前は reset、後は revert！',
  },
  {
    id: 'rebase',
    chapter: 5,
    title: 'rebase で一直線に',
    summary: 'コミットを付け替える',
    intro: '<p><b>rebase</b> = コミットを付け替えて<b>一直線</b>に。</p>',
    setup(api) {
      myApp(api, 'git switch -c feature/login && echo "<form>login</form>" > login.html && git add . && git commit -m "ログイン画面を追加" && echo "form{}" > login.css && git add . && git commit -m "ログイン画面のCSS" && git switch main && echo "更新履歴" >> README.md && git commit -am "READMEを更新" && git switch feature/login');
    },
    steps: [
      { text: 'main に付け替えよう', hint: 'git rebase main', check: (api, evs) => api.has(evs, 'rebase', (e) => e.done) && api.contains(api.repo.branches.main, api.repo.branches['feature/login']) },
      { text: 'main でマージ (FF)', hint: 'git switch main && git merge feature/login', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'ff') },
      {
        text: 'rebase してみよう',
        hint: 'git rebase main',
        onEnter(api) {
          api.sh('git switch -c feature/title');
          api.w.dir.files['index.html'] = '<h1>My Awesome App</h1>\n';
          api.sh('git commit -am "タイトルを変更" && git switch main');
          api.w.dir.files['index.html'] = '<h1>My Great App</h1>\n';
          api.sh('git commit -am "タイトルを修正" && git switch feature/title');
          api.chat('システム', 'feature/title ブランチを準備しました');
        },
        check: (api, evs) => api.has(evs, 'conflict', (e) => e.kind === 'rebase'),
      },
      { text: 'edit で直して add', hint: 'git add index.html', check: (api) => api.repo.op && api.repo.op.type === 'rebase' && !api.repo.conflicts.length && !api.markers(work(api, 'index.html')) },
      { text: '続行しよう', hint: 'git rebase --continue', check: (api, evs) => api.has(evs, 'rebase', (e) => e.done) },
    ],
    outro: 'merge と rebase を使い分けよう！',
  },
  {
    id: 'cherry-tag',
    chapter: 5,
    title: 'cherry-pick と tag',
    summary: 'いいとこ取りとリリース',
    intro: '<ul><li><b>cherry-pick</b> = 1コミットだけコピー</li><li><b>tag</b> = コミットに名前</li></ul>',
    setup(api) {
      myApp(api, 'git switch -c experiment && echo "body{background:rainbow}" > style.css && git add . && git commit -m "実験: 背景を虹色に"');
      api.w.dir.files['index.html'] = '<h1>My App</h1>\n<p>ようこそ!</p>\n';
      api.sh('git commit -am "誤字を修正" && echo "play()" > bgm.js && git add . && git commit -m "実験: BGMを追加" && git switch main');
    },
    steps: [
      { text: 'experiment の履歴を見よう', hint: 'git log --oneline experiment', check: (api, evs) => api.has(evs, 'log') },
      { text: '「誤字を修正」だけ取り込もう', hint: 'git cherry-pick <誤字を修正のID>', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '').includes('ようこそ') && !inHead(api, 'bgm.js') },
      { text: 'v1.0 タグを付けよう', hint: 'git tag v1.0', check: (api) => !!api.repo.tags['v1.0'] },
      { text: 'タグの中身を見よう', hint: 'git show v1.0', check: (api, evs) => api.has(evs, 'show') },
    ],
    outro: 'いいとこ取り成功！',
  },
  {
    id: 'pull-request',
    chapter: 6,
    title: 'プルリクエストで開発',
    summary: 'GitHub フロー',
    intro: '<p><b>ブランチ → push → PR → マージ → pull</b></p>',
    setup(api) { teamClone(api); },
    steps: [
      { text: '作業ブランチを作ろう', hint: 'git switch -c feature/access', check: (api) => onBranch(api, 'feature/access') },
      { text: 'access.html をコミット', hint: 'echo "<h1>アクセス</h1>" > access.html && git add . && git commit -m "アクセスページを追加"', check: (api) => inHead(api, 'access.html') },
      { text: 'push しよう', hint: 'git push -u origin feature/access', check: (api) => !!api.remote().branches['feature/access'] },
      { text: 'PR を作ろう', hint: 'gh pr create --title "アクセスページを追加"', check: (api, evs) => api.has(evs, 'pr-create') },
      { text: 'PR をマージ', hint: 'gh pr merge 2', check: (api, evs) => api.has(evs, 'pr-merge') },
      { text: 'main を最新に', hint: 'git switch main && git pull', check: (api) => onBranch(api, 'main') && api.repo.branches.main === api.remote().branches.main },
      { text: 'ブランチを削除', hint: 'git branch -d feature/access', check: (api) => api.repo.branches['feature/access'] === undefined },
    ],
    outro: 'これが GitHub フロー！',
  },
  {
    id: 'gitignore',
    chapter: 6,
    title: '.gitignore',
    summary: '管理しないファイルを指定',
    intro: '<p><b>.gitignore</b> に書いたファイルは無視されます。</p>',
    setup(api) {
      myApp(api);
      Object.assign(api.w.dir.files, { 'debug.log': 'error: something\n', 'node_modules/lib.js': '// library\n', '.env': 'PASSWORD=secret123\n', 'app.js': 'console.log("app")\n' });
    },
    steps: [
      { text: '状態を確認', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '.gitignore を作ろう', hint: 'echo "*.log" > .gitignore && echo "node_modules/" >> .gitignore && echo ".env" >> .gitignore', check: (api) => ['debug.log', 'node_modules/lib.js', '.env'].every((p) => isIgnored(api.dir, p)) },
      { text: 'もう一度確認', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '全部追加してコミット', hint: 'git add . && git commit -m ".gitignoreとapp.jsを追加"', check: (api) => inHead(api, '.gitignore') && inHead(api, 'app.js') && !inHead(api, '.env') },
    ],
    outro: '最初に作っておこう！',
  },
]);

// 「見るだけ」のステップは、次のステップを先に達成したら飛ばせるようにする
function withSoftSteps(lessons) {
  for (const L of lessons) {
    for (const s of L.steps) {
      if (!s.onEnter && /^(git (status|log|diff|show|reflog|stash list|branch)$|git (log|diff|show) |cat )/.test(s.hint)) s.soft = true;
    }
  }
  return lessons;
}

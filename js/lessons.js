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
    intro: `<p><b>Git</b> はファイルの変更履歴を記録する道具です。ゲームの「セーブポイント」のように、好きなタイミングで状態を保存して、いつでも戻れます。</p>
<p>記録の流れは <b>①ファイルを編集 → ②<code>git add</code> でステージに載せる → ③<code>git commit</code> で記録</b> の3ステップ。右側の「ファイルの状態」パネルで、ファイルが移動していく様子を見てみよう。</p>`,
    setup() {},
    steps: [
      { text: 'まずは自分の名前を設定しよう。コミットに記録される名前です。', hint: 'git config --global user.name "Taro"', check: (api, evs) => api.has(evs, 'config') },
      { text: 'プロジェクト用のフォルダを作って中に入ろう。<code>&&</code> で2つのコマンドを続けて実行できます。', hint: 'mkdir my-app && cd my-app', check: (api) => api.cwd === MYAPP },
      { text: '<code>git init</code> でこのフォルダを Git リポジトリにしよう。', hint: 'git init', check: (api) => !!api.repo },
      { text: 'ファイルを作ろう。<code>echo "文字" > ファイル名</code> で書き込めます。', hint: 'echo "# My App" > README.md', check: (api) => work(api, 'README.md') !== undefined },
      { text: '<code>git status</code> で状態を確認。README.md が <span class="t-err">赤色 (Untracked = まだ追跡されていない)</span> で表示されるはず。', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '<code>git add</code> でステージングエリアに載せよう。右のパネルで「ステージ」に移動するよ。', hint: 'git add README.md', check: (api) => api.repo.index['README.md'] !== undefined },
      { text: '<code>git commit -m "メッセージ"</code> で記録！メッセージには「何をしたか」を書きます。', hint: 'git commit -m "最初のコミット"', check: (api) => !!api.head() },
      { text: '<code>git log</code> で履歴を見てみよう。コミットIDや作者、日時が記録されています。', hint: 'git log', check: (api, evs) => api.has(evs, 'log') },
    ],
    outro: 'おめでとう！最初のコミットができました。右のグラフに点(コミット)が1つ増えましたね。',
  },
  {
    id: 'record-changes',
    chapter: 1,
    title: '変更を記録する',
    summary: 'diff で変更を確認してコミット',
    intro: `<p>コミットした後にファイルを変更すると、Git は「どこが変わったか」を教えてくれます。<code>git diff</code> で変更内容を確認してからコミットするのが良い習慣です。</p>`,
    setup(api) {
      api.sh('mkdir my-app');
      api.w.cwd = MYAPP;
      api.sh('git init && echo "# My App" > README.md && git add . && git commit -m "最初のコミット"');
    },
    steps: [
      { text: 'README.md に1行追記しよう。<code>>></code> は追記、<code>></code> は上書きです。(<code>edit README.md</code> でエディタを開いてもOK)', hint: 'echo "Gitの練習アプリです" >> README.md', check: (api) => work(api, 'README.md') !== api.headTree()['README.md'] },
      { text: '<code>git diff</code> で変更点を確認。<span class="t-add">+ が追加された行</span>、<span class="t-del">- が削除された行</span>です。', hint: 'git diff', check: (api, evs) => api.has(evs, 'diff') },
      { text: '変更をステージに載せよう。', hint: 'git add README.md', check: (api) => api.repo.index['README.md'] === work(api, 'README.md') && api.repo.index['README.md'] !== api.headTree()['README.md'] },
      { text: 'ステージ済みの変更は <code>git diff --staged</code> で見られます。', hint: 'git diff --staged', check: (api, evs) => api.has(evs, 'diff', (e) => e.staged) },
      { text: 'コミットしよう。', hint: 'git commit -m "説明を追加"', check: (api) => api.w.ancestors(api.head()).size >= 2 && api.headTree()['README.md'] === work(api, 'README.md') },
      { text: '新しいファイル <b>index.html</b> を作って、add と commit までやってみよう。', hint: 'echo "<h1>My App</h1>" > index.html && git add index.html && git commit -m "トップページを追加"', check: (api) => inHead(api, 'index.html') },
      { text: '<code>git log --oneline</code> で履歴を1行ずつ表示しよう。', hint: 'git log --oneline', check: (api, evs) => api.has(evs, 'log') },
    ],
    outro: 'ファイルを変更 → diff で確認 → add → commit。これが Git の基本サイクルです！',
  },
  {
    id: 'undo',
    chapter: 1,
    title: '変更を取り消す',
    summary: 'restore と amend でやり直し',
    intro: `<p>間違えても大丈夫。Git なら簡単に元に戻せます。</p>
<ul><li><code>git restore &lt;file&gt;</code> … 作業中の変更を捨てる</li><li><code>git restore --staged &lt;file&gt;</code> … ステージから外す</li><li><code>git commit --amend</code> … 直前のコミットを修正</li></ul>`,
    setup(api) { myApp(api); },
    steps: [
      { text: 'index.html をうっかり壊してしまおう。', hint: 'echo "めちゃくちゃ" > index.html', check: (api) => work(api, 'index.html') !== api.headTree()['index.html'] },
      { text: '<code>git restore</code> で最後のコミットの状態に戻そう。', hint: 'git restore index.html', check: (api) => work(api, 'index.html') === api.headTree()['index.html'] },
      { text: 'メモファイルを作ってステージに載せよう。', hint: 'echo "パスワード1234" > memo.txt && git add memo.txt', check: (api) => api.repo.index['memo.txt'] !== undefined },
      { text: 'やっぱりコミットしたくない！ステージから外そう。(ファイル自体は残ります)', hint: 'git restore --staged memo.txt', check: (api) => api.repo.index['memo.txt'] === undefined && work(api, 'memo.txt') !== undefined },
      { text: 'メモファイル自体も削除しよう。', hint: 'rm memo.txt', check: (api) => work(api, 'memo.txt') === undefined },
      { text: 'フッターを追加してコミット…あ、メッセージがひらがなになっちゃった、という想定で。<code>-am</code> は add と commit を一度にやります (追跡済みファイルのみ)。', hint: 'echo "<footer>2026</footer>" >> index.html && git commit -am "ふったーをついか"', check: (api) => api.w.objects[api.head()].message.includes('ふったー') },
      { text: '<code>--amend</code> で直前のコミットのメッセージを修正しよう。(push する前だけ使うのがルール)', hint: 'git commit --amend -m "フッターを追加"', check: (api, evs) => api.has(evs, 'amend') && !api.w.objects[api.head()].message.includes('ふったー') },
    ],
    outro: 'restore と amend で、ちょっとしたミスはすぐ直せます。グラフを見ると amend 前のコミットは消えて、新しいコミットに置き換わっていますね。',
  },
  {
    id: 'branch',
    chapter: 2,
    title: 'ブランチを作る',
    summary: 'branch と switch で作業を枝分かれ',
    intro: `<p><b>ブランチ</b>は作業の「枝分かれ」です。main を壊さずに新機能を試したり、複数人が並行して作業できます。</p>
<p>実はブランチは「コミットを指す付箋」にすぎません。<b>HEAD</b> は「今いるブランチ」を指す印です。グラフの <span class="pill pill-branch current"><b>HEAD →</b> main</span> に注目！</p>`,
    setup(api) { myApp(api); },
    steps: [
      { text: '<code>git branch</code> でブランチ一覧を見よう。<b>*</b> が今いるブランチ。', hint: 'git branch', check: (api, evs) => api.has(evs, 'branch-list') },
      { text: '新しいブランチ <b>feature/about</b> を作ろう。', hint: 'git branch feature/about', check: (api) => api.repo.branches['feature/about'] !== undefined },
      { text: 'グラフを見ると同じコミットに2つの付箋が。<code>git switch</code> で移動しよう。', hint: 'git switch feature/about', check: (api) => onBranch(api, 'feature/about') },
      { text: 'about.html を作ってコミットしよう。feature/about だけが前に進みます。', hint: 'echo "<h1>About</h1>" > about.html && git add . && git commit -m "Aboutページを追加"', check: (api) => onBranch(api, 'feature/about') && inHead(api, 'about.html') },
      { text: 'main に戻ろう。<code>ls</code> すると about.html が消えている！(ブランチごとにファイルの状態が切り替わる)', hint: 'git switch main && ls', check: (api) => onBranch(api, 'main') },
      { text: '<code>git switch -c</code> なら作成と移動を一度にできます。', hint: 'git switch -c feature/contact', check: (api) => onBranch(api, 'feature/contact') },
      { text: 'contact.html を作ってコミット。グラフが枝分かれしたね！', hint: 'echo "<h1>Contact</h1>" > contact.html && git add . && git commit -m "お問い合わせページを追加"', check: (api) => onBranch(api, 'feature/contact') && inHead(api, 'contact.html') },
    ],
    outro: 'ブランチを使えば、main を安全に保ったまま色々な作業を並行できます。',
  },
  {
    id: 'merge',
    chapter: 2,
    title: 'マージする',
    summary: 'Fast-forward と マージコミット',
    intro: `<p><b>マージ</b>は別のブランチの変更を取り込むことです。取り込みたいブランチに <b>移動してから</b> <code>git merge &lt;相手&gt;</code> を実行します。</p>
<ul><li><b>Fast-forward</b>: main が単に遅れているだけなら、付箋を前に進めるだけ</li><li><b>3-way マージ</b>: 両方に変更があれば、2つの親を持つ「マージコミット」を作る</li></ul>`,
    setup(api) { myApp(api, 'git switch -c feature/about && echo "<h1>About</h1>" > about.html && git add . && git commit -m "Aboutページを追加" && git switch main'); },
    steps: [
      { text: 'main にいることを確認して、feature/about を取り込もう。main が前に進むだけ (Fast-forward) になるよ。', hint: 'git merge feature/about', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'ff') },
      { text: '新しいブランチ feature/news を作り、news.html をコミットしよう。', hint: 'git switch -c feature/news && echo "<h1>News</h1>" > news.html && git add . && git commit -m "ニュースページを追加"', check: (api) => onBranch(api, 'feature/news') && inHead(api, 'news.html') },
      { text: 'main に戻って、main でも別の変更をコミットしよう。これで2つのブランチが分岐します。', hint: 'git switch main && echo "<p>営業中</p>" >> index.html && git commit -am "営業中の表示を追加"', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '').includes('営業中') && !api.contains(api.head(), api.repo.branches['feature/news']) },
      { text: 'feature/news をマージ！今度は両方に変更があるので「マージコミット」が作られます。', hint: 'git merge feature/news', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'merge') },
      { text: '<code>git log --oneline --graph</code> で確認。右のグラフでも2本の線が合流しているね。', hint: 'git log --oneline --graph', check: (api, evs) => api.has(evs, 'log') },
      { text: 'マージ済みのブランチは削除して片付けよう。', hint: 'git branch -d feature/news', check: (api) => api.repo.branches['feature/news'] === undefined },
    ],
    outro: 'マージには2種類あることが分かりましたね。ブランチを削除してもコミットは残ります。',
  },
  {
    id: 'conflict',
    chapter: 2,
    title: '競合を解決する',
    summary: '同じ行を変えたら…コンフリクト！',
    intro: `<p>2つのブランチで <b>同じファイルの同じ行</b> を違う内容に変えると、Git はどちらを採用すべきか分からず <b>競合 (コンフリクト)</b> になります。</p>
<p>慌てなくて大丈夫。ファイルには次のような印が付きます:</p>
<pre class="conflict-sample">&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD
自分 (今のブランチ) の内容
=======
相手 (マージしようとしたブランチ) の内容
&gt;&gt;&gt;&gt;&gt;&gt;&gt; feature/price</pre>
<p>正しい内容に書き直して印を消し、<code>git add</code> → <code>git commit</code> で解決です。</p>`,
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
      { text: 'main と feature/price の両方でコーヒーの値段を変えてあります。マージしてみよう…', hint: 'git merge feature/price', check: (api, evs) => api.has(evs, 'conflict') },
      { text: '競合発生！<code>git status</code> で確認。<b>both modified</b> が競合中のファイルです。', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '<code>cat menu.txt</code> で中身を見よう。<span class="t-conflict">&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span> から <span class="t-conflict">=======</span> が自分(main)、そこから <span class="t-conflict">&gt;&gt;&gt;&gt;&gt;&gt;&gt;</span> までが相手の内容。', hint: 'cat menu.txt', check: (api, evs) => api.has(evs, 'cat') },
      { text: '<code>edit menu.txt</code> でエディタを開き、印を消して正しい内容にしよう (例: コーヒー 450円)。エディタの「相手を採用」ボタンも便利！', hint: 'edit menu.txt', check: (api) => !api.markers(work(api, 'menu.txt')) },
      { text: '<code>git add</code> で「解決済み」とGitに伝えよう。', hint: 'git add menu.txt', check: (api) => api.repo.conflicts.length === 0 },
      { text: '<code>git commit</code> でマージを完了！メッセージは自動で付きます。', hint: 'git commit', check: (api) => !api.repo.op && api.w.objects[api.head()].parents.length === 2 },
    ],
    outro: '競合は怖くない！落ち着いて「どちらを残すか」決めればOKです。迷ったら <code>git merge --abort</code> で中止もできます。',
  },
  {
    id: 'push',
    chapter: 3,
    title: 'GitHub に push する',
    summary: 'remote add と push',
    intro: `<p>ここまでは自分のパソコンの中 (<b>ローカル</b>) だけの話でした。チームで共有するには、GitHub などの <b>リモートリポジトリ</b> にコミットを送ります。これが <code>git push</code>。</p>
<p>右上の「☁ GitHub」タブでリモートの様子が見られます。</p>`,
    setup(api) { myApp(api); },
    steps: [
      { text: 'まず GitHub にリポジトリを作ろう。(本物の GitHub では Web 画面の「New」ボタンでも作れます)', hint: 'gh repo create my-app', check: (api) => !!api.w.remotes[MYAPP_URL] },
      { text: '作ったリポジトリを <b>origin</b> という名前でリモート登録しよう。', hint: `git remote add origin ${MYAPP_URL}`, check: (api) => api.repo.remotes.origin === MYAPP_URL },
      { text: '<code>git push -u origin main</code> で送信！<code>-u</code> で「main の送り先は origin の main」と覚えさせます。', hint: 'git push -u origin main', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main && !!api.repo.upstream.main },
      { text: '「☁ GitHub」タブを見てみよう。同じコミットが届いています。次はファイルを変更してコミットしよう。', hint: 'echo "練習中です" >> README.md && git commit -am "READMEを更新"', check: (api) => api.repo.branches.main !== api.remote(MYAPP_URL).branches.main },
      { text: '<code>git status</code> を見ると「ahead of \'origin/main\' by 1 commit」(1コミット先行) と表示されます。', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '2回目からは <code>git push</code> だけでOK！', hint: 'git push', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main },
    ],
    outro: 'これであなたのコードが GitHub に保存されました。origin/main (☁) はリモートの main の位置を表しています。',
  },
  {
    id: 'clone-pull',
    chapter: 3,
    title: 'チーム開発: clone と pull',
    summary: '仲間の変更を取り込む',
    intro: `<p>あなたはカフェのWebサイトを作るチームに参加しました！メンバーは <b>田中さん</b> と <b>佐藤さん</b>。</p>
<p>まずは <code>git clone</code> でチームのリポジトリを手元にコピーします。仲間が push した変更は <code>git fetch</code> (情報を取得) や <code>git pull</code> (取得 + 取り込み) で受け取ります。</p>`,
    setup(api) { buildTeamRemote(api.w); },
    steps: [
      { text: 'チームのリポジトリをクローンしよう。', hint: `git clone ${TEAM_URL}`, check: (api) => !!api.w.dirs[TEAM_DIR] },
      { text: 'できたフォルダに入ろう。', hint: 'cd cafe-shop', check: (api) => api.cwd === TEAM_DIR },
      { text: '<code>git log --oneline</code> で履歴を確認。田中さんと佐藤さんのコミットがあるね。', hint: 'git log --oneline', check: (api, evs) => api.has(evs, 'log') },
      {
        text: '佐藤さんから連絡が来ました。<code>git fetch</code> で GitHub の最新情報を取ってこよう。',
        hint: 'git fetch',
        onEnter(api) {
          api.teammatePush('main', { 'menu.txt': FILES['menu.txt'] + 'パフェ 700円\n' }, 'メニューにパフェを追加', '佐藤');
          api.chat('佐藤', 'メニューにパフェを追加して push しました！🍨');
        },
        check: (api, evs) => api.has(evs, 'fetch'),
      },
      { text: 'グラフを見ると ☁ origin/main だけが先に進んでいます。<code>git merge origin/main</code> で取り込もう。(fetch + merge = pull)', hint: 'git merge origin/main', check: (api) => api.contains(api.remote().branches.main, api.repo.branches.main) },
      {
        text: '田中さんも push したようです。今度は <code>git pull</code> で一発で取り込もう。',
        hint: 'git pull',
        onEnter(api) {
          api.teammatePush('main', { 'style.css': FILES['style.css'] + 'p { color: #333; }\n' }, '文字色を調整', '田中');
          api.chat('田中', '文字色をちょっと調整しました〜');
        },
        check: (api, evs) => api.has(evs, 'pull') && api.contains(api.remote().branches.main, api.repo.branches.main),
      },
    ],
    outro: 'fetch は「見てくるだけ」、pull は「見て取り込む」。仲間と同じ最新状態になれました！',
  },
  {
    id: 'push-rejected',
    chapter: 3,
    title: 'push が拒否されたら',
    summary: 'rejected → pull → push',
    intro: `<p>チーム開発でよくあるのが「<b>push が拒否される</b>」こと。あなたが作業している間に、仲間が先に push していると起こります。</p>
<p>慌てずに <code>git pull</code> で仲間の変更を取り込んでから、もう一度 push しましょう。<b>絶対に <code>git push --force</code> で上書きしてはいけません</b> (仲間の作業が消えます)。</p>`,
    setup(api) { teamClone(api); },
    steps: [
      { text: 'README.md のメンバー一覧に自分を追加してコミットしよう。', hint: 'echo "- あなた" >> README.md && git commit -am "メンバーに追加"', check: (api) => api.repo.branches.main !== api.remote().branches.main && api.headTree()['README.md'] !== FILES['README.md'] },
      {
        text: 'push しよう！',
        hint: 'git push',
        onEnter(api) {
          api.teammatePush('main', { 'style.css': FILES['style.css'] + 'h2 { color: green; }\n' }, '見出しの色を追加', '田中');
          api.chat('田中', 'style.css を更新して push しておきました！');
        },
        check: (api, evs) => api.has(evs, 'push-rejected'),
      },
      { text: '拒否されました！ GitHub にあなたの持っていないコミットがあるからです。<code>git pull</code> で取り込もう。(自動でマージコミットができます)', hint: 'git pull', check: (api) => api.contains(api.remote().branches.main, api.repo.branches.main) },
      { text: 'もう一度 push！', hint: 'git push', check: (api) => api.remote().branches.main === api.repo.branches.main },
      {
        text: '別のやり方も覚えよう。もう一度何か変更してコミットしてから、<code>git pull --rebase</code> で取り込むと、マージコミットを作らずに一直線の履歴になります。最後に push まで！',
        hint: 'echo "パフェ 700円" >> menu.txt && git commit -am "パフェを追加" && git pull --rebase && git push',
        onEnter(api) {
          api.teammatePush('main', { 'index.html': FILES['index.html'].replace('おいしいコーヒーあります', 'おいしいコーヒーと紅茶あります') }, 'キャッチコピーを変更', '佐藤');
          api.chat('佐藤', 'キャッチコピーを変えました☕');
        },
        check: (api, evs, st) => {
          if (api.has(evs, 'pull', (e) => e.result === 'rebase')) st.rebased = true;
          return st.rebased && api.remote().branches.main === api.repo.branches.main;
        },
      },
    ],
    outro: 'push が拒否されたら「pull してから push」。これを覚えておけばチーム開発は怖くありません。',
  },
  {
    id: 'stash',
    chapter: 4,
    title: 'stash で一時退避',
    summary: '作業中に割り込みが入ったら',
    intro: `<p>作業の途中で「急いでこっちを直して！」と頼まれることはよくあります。でもコミットしていない変更があると、ブランチを移動できないことも。</p>
<p><code>git stash</code> を使うと、作業中の変更を一時的に退避して、きれいな状態にできます。用事が済んだら <code>git stash pop</code> で戻します。</p>`,
    setup(api) {
      teamClone(api);
      api.sh('git switch -c feature/coupon');
      api.w.dir.files['app.js'] = FILES['app.js'] + '\nfunction coupon(price) {\n}\n';
      api.sh('git commit -am "クーポン機能の下準備"');
      api.w.dir.files['app.js'] = FILES['app.js'] + '\nfunction coupon(price) {\n  return price - 100; // 作業中\n}\n';
    },
    steps: [
      { text: 'feature/coupon でクーポン機能を作業中 (app.js を変更中) です。そこへ「main の index.html にお知らせを追加して！」と依頼が。まず <code>git switch main</code> してみよう。', hint: 'git switch main', check: (api) => /(switch|checkout)\s+main/.test(api.lastCmd) },
      { text: 'エラー！今の変更が上書きされてしまうため移動できません。<code>git stash</code> で変更を退避しよう。', hint: 'git stash', check: (api) => api.repo.stash.length > 0 },
      { text: '<code>git stash list</code> で退避した内容を確認しよう。', hint: 'git stash list', check: (api, evs) => api.has(evs, 'stash', (e) => e.action === 'list') },
      { text: '作業ディレクトリがきれいになったので、main に移動できます。', hint: 'git switch main', check: (api) => onBranch(api, 'main') },
      { text: 'お知らせを追加してコミット！', hint: 'echo "<p>本日は定休日です</p>" >> index.html && git commit -am "定休日のお知らせ"', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '') !== FILES['index.html'] },
      { text: 'feature/coupon に戻ろう。', hint: 'git switch feature/coupon', check: (api) => onBranch(api, 'feature/coupon') },
      { text: '<code>git stash pop</code> で作業を復元！', hint: 'git stash pop', check: (api) => api.repo.stash.length === 0 && (work(api, 'app.js') || '').includes('作業中') },
    ],
    outro: 'stash は「とりあえず机の引き出しにしまう」イメージ。作業を中断するときに便利です。',
  },
  {
    id: 'reset-revert',
    chapter: 4,
    title: 'reset と revert',
    summary: 'コミットを取り消す2つの方法',
    intro: `<p>コミットを取り消す方法は2つあります。</p>
<ul><li><code>git reset</code> … ブランチを過去に戻す。<b>まだ push していない</b>コミット向け。<br><small>--soft: 変更はステージに残る / (なし): 作業ディレクトリに残る / --hard: 全部消える</small></li>
<li><code>git revert</code> … 打ち消す <b>新しいコミット</b>を作る。<b>push 済み</b>のコミットはこちら。</li></ul>`,
    setup(api) {
      myApp(api, `echo "バグ" > bug.txt && git add . && git commit -m "間違ったコミット"`);
      api.sh(`gh repo create my-app && git remote add origin ${MYAPP_URL} && git push -u origin main`);
    },
    steps: [
      { text: 'ローカルだけで練習しよう。一時的なコミットを作ります。', hint: 'echo "test" > tmp.txt && git add . && git commit -m "一時的なコミット"', check: (api) => api.w.objects[api.head()].message === '一時的なコミット' },
      { text: '<code>git reset --soft HEAD~1</code> で1つ前に戻そう。<code>HEAD~1</code> は「1つ前のコミット」の意味。変更はステージに残ります。', hint: 'git reset --soft HEAD~1', check: (api) => api.w.objects[api.head()].message !== '一時的なコミット' && api.repo.index['tmp.txt'] !== undefined },
      { text: '<code>git status</code> で tmp.txt がステージに残っているのを確認しよう。', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '<code>git reset --hard HEAD</code> で変更をすべて捨てよう。(本当に消えるので普段は注意！)', hint: 'git reset --hard HEAD', check: (api) => work(api, 'tmp.txt') === undefined && api.repo.index['tmp.txt'] === undefined },
      { text: '「間違ったコミット」はもう push 済み。共有した履歴は消さずに、<code>git revert</code> で打ち消そう。', hint: 'git revert HEAD', check: (api, evs) => api.has(evs, 'revert') && work(api, 'bug.txt') === undefined },
      { text: 'グラフに「Revert ...」コミットが増えました。push して共有しよう。', hint: 'git push', check: (api) => api.remote(MYAPP_URL).branches.main === api.repo.branches.main },
      { text: 'おまけ: <code>git reflog</code> で HEAD の移動履歴を見てみよう。reset で消したコミットもここに残っています。', hint: 'git reflog', check: (api, evs) => api.has(evs, 'reflog') },
    ],
    outro: '「push 前なら reset、push 後なら revert」。これが安全なルールです。',
  },
  {
    id: 'rebase',
    chapter: 5,
    title: 'rebase で一直線に',
    summary: 'コミットを付け替える',
    intro: `<p><code>git rebase main</code> は、今のブランチのコミットを <b>main の先端に付け替える</b> コマンドです。マージコミットができず、履歴が一直線になります。</p>
<p>付け替えたコミットは <b>新しいID</b> になるので、他の人と共有しているブランチでは使わないのがルールです。</p>`,
    setup(api) {
      myApp(api, 'git switch -c feature/login && echo "<form>login</form>" > login.html && git add . && git commit -m "ログイン画面を追加" && echo "form{}" > login.css && git add . && git commit -m "ログイン画面のCSS" && git switch main && echo "更新履歴" >> README.md && git commit -am "READMEを更新" && git switch feature/login');
    },
    steps: [
      { text: 'グラフで main と feature/login が分かれているのを確認しよう。今は feature/login にいます。main の先端に付け替えよう。', hint: 'git rebase main', check: (api, evs) => api.has(evs, 'rebase', (e) => e.done) && api.contains(api.repo.branches.main, api.repo.branches['feature/login']) },
      { text: '一直線になった！ main に移動してマージすると Fast-forward になります。', hint: 'git switch main && git merge feature/login', check: (api, evs) => api.has(evs, 'merge', (e) => e.kind === 'ff') },
      {
        text: '新しく feature/title ブランチを用意しました (今そこにいます)。main でも同じ行が変更されています。rebase すると…？',
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
      { text: 'リベース中に競合！ edit で直して <code>git add</code> しよう。', hint: 'edit index.html  (直したら) git add index.html', check: (api) => api.repo.op && api.repo.op.type === 'rebase' && !api.repo.conflicts.length && !api.markers(work(api, 'index.html')) },
      { text: '<code>git rebase --continue</code> で続行！(やめたい時は --abort)', hint: 'git rebase --continue', check: (api, evs) => api.has(evs, 'rebase', (e) => e.done) },
    ],
    outro: 'merge は「合流の記録を残す」、rebase は「最初からそこで作業したかのように付け替える」。使い分けられると上級者です！',
  },
  {
    id: 'cherry-tag',
    chapter: 5,
    title: 'cherry-pick と tag',
    summary: 'いいとこ取りとリリース',
    intro: `<p><code>git cherry-pick &lt;コミットID&gt;</code> は、別ブランチの <b>特定のコミットだけ</b> を今のブランチにコピーします。</p>
<p><code>git tag v1.0</code> はコミットに名前を付ける機能。リリースしたバージョンの目印に使います。</p>`,
    setup(api) {
      myApp(api, 'git switch -c experiment && echo "body{background:rainbow}" > style.css && git add . && git commit -m "実験: 背景を虹色に"');
      api.w.dir.files['index.html'] = '<h1>My App</h1>\n<p>ようこそ!</p>\n';
      api.sh('git commit -am "誤字を修正" && echo "play()" > bgm.js && git add . && git commit -m "実験: BGMを追加" && git switch main');
    },
    steps: [
      { text: 'experiment ブランチのコミットを確認しよう。「誤字を修正」のコミットIDを探してね。', hint: 'git log --oneline experiment', check: (api, evs) => api.has(evs, 'log') },
      { text: '「誤字を修正」だけを main に取り込もう。(IDは先頭の数文字でOK)', hint: 'git cherry-pick <誤字を修正のID>', check: (api) => onBranch(api, 'main') && (api.headTree()['index.html'] || '').includes('ようこそ') && !inHead(api, 'bgm.js') },
      { text: 'リリース！今のコミットに v1.0 タグを付けよう。', hint: 'git tag v1.0', check: (api) => !!api.repo.tags['v1.0'] },
      { text: '<code>git show v1.0</code> でタグの付いたコミットを確認しよう。', hint: 'git show v1.0', check: (api, evs) => api.has(evs, 'show') },
    ],
    outro: 'cherry-pick は便利ですが、コミットがコピーされる(別IDになる)点に注意。タグは push するときに git push origin v1.0 が必要です。',
  },
  {
    id: 'pull-request',
    chapter: 6,
    title: 'プルリクエストで開発',
    summary: 'GitHub フロー',
    intro: `<p>実際のチーム開発では、main に直接 push せず <b>プルリクエスト (PR)</b> を使うのが一般的です。</p>
<ol><li>作業ブランチを作る</li><li>コミットして push</li><li>GitHub で PR を作り、レビューしてもらう</li><li>OKならマージ</li><li>ローカルの main を pull で更新</li></ol>
<p>このシミュレーターでは <code>gh</code> コマンド (GitHub CLI) で PR を操作します。</p>`,
    setup(api) { teamClone(api); },
    steps: [
      { text: '作業ブランチ feature/access を作ろう。', hint: 'git switch -c feature/access', check: (api) => onBranch(api, 'feature/access') },
      { text: 'アクセスページを作ってコミットしよう。', hint: 'echo "<h1>アクセス</h1>" > access.html && git add . && git commit -m "アクセスページを追加"', check: (api) => inHead(api, 'access.html') },
      { text: 'ブランチを GitHub に push しよう。', hint: 'git push -u origin feature/access', check: (api) => !!api.remote().branches['feature/access'] },
      { text: 'プルリクエストを作成！', hint: 'gh pr create --title "アクセスページを追加"', check: (api, evs) => api.has(evs, 'pr-create') },
      { text: '田中さんがレビューしてくれました。PR をマージしよう。', hint: 'gh pr merge 2', check: (api, evs) => api.has(evs, 'pr-merge') },
      { text: 'GitHub の main が更新されました。ローカルの main も最新にしよう。', hint: 'git switch main && git pull', check: (api) => onBranch(api, 'main') && api.repo.branches.main === api.remote().branches.main },
      { text: '用済みのブランチを削除して片付け。', hint: 'git branch -d feature/access', check: (api) => api.repo.branches['feature/access'] === undefined },
    ],
    outro: 'これが GitHub フローです！ブランチ → push → PR → マージ → pull のサイクルを回して開発します。',
  },
  {
    id: 'gitignore',
    chapter: 6,
    title: '.gitignore',
    summary: '管理しないファイルを指定',
    intro: `<p>ログファイルやライブラリ、パスワードの入った設定ファイルなど、<b>Git で管理したくないファイル</b> もあります。<code>.gitignore</code> というファイルにパターンを書くと、Git が無視してくれます。</p>
<pre>*.log          ← .log で終わるファイル全部
node_modules/  ← フォルダごと
.env           ← 特定のファイル</pre>`,
    setup(api) {
      myApp(api);
      Object.assign(api.w.dir.files, { 'debug.log': 'error: something\n', 'node_modules/lib.js': '// library\n', '.env': 'PASSWORD=secret123\n', 'app.js': 'console.log("app")\n' });
    },
    steps: [
      { text: '<code>git status</code> を見ると、コミットしたくないファイルがたくさん…', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '<code>edit .gitignore</code> で .gitignore を作り、<b>*.log</b>、<b>node_modules/</b>、<b>.env</b> の3行を書こう。(echo でもOK)', hint: 'echo "*.log" > .gitignore && echo "node_modules/" >> .gitignore && echo ".env" >> .gitignore', check: (api) => ['debug.log', 'node_modules/lib.js', '.env'].every((p) => isIgnored(api.dir, p)) },
      { text: '<code>git status</code> で確認。無視されたファイルが一覧から消えたね。', hint: 'git status', check: (api, evs) => api.has(evs, 'status') },
      { text: '<code>git add .</code> で全部追加してコミット。無視したファイルは追加されません。', hint: 'git add . && git commit -m ".gitignoreとapp.jsを追加"', check: (api) => inHead(api, '.gitignore') && inHead(api, 'app.js') && !inHead(api, '.env') },
    ],
    outro: '.gitignore はプロジェクトを始めたら最初に作るのがおすすめ。パスワードをうっかり公開する事故を防げます。',
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

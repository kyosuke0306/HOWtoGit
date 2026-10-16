# HOW to Git — 遊んで学ぶ Git シミュレーター

Git の使い方を **初心者向けに、ゲーム感覚で** 学べる Web アプリです。
ブラウザの中の疑似ターミナルで本物そっくりの Git コマンドを打ち、コミットグラフやファイルの状態がどう変わるかをリアルタイムに確認できます。

## 特徴

- **疑似ターミナル** — `git` コマンドに加え `ls` `cat` `echo > file` `edit` `cd` `mkdir` などが使えます (Tab 補完・履歴あり)
- **ブランチの可視化** — ローカル / GitHub(リモート) のコミットグラフ、HEAD・ブランチ・origin/○○・タグを色分け表示
- **ファイルの状態** — 作業ディレクトリ → ステージ → リポジトリ の3エリアを図示
- **チーム開発を再現** — 仲間 (田中さん・佐藤さん) が GitHub に push したり PR を作ったりします
- **競合 (コンフリクト)** — 行単位の 3-way マージで本物同様に競合し、エディタで解決できます

### 3つのモード

トップ画面から選びます。URL は `#/` (トップ)、`#/lessons`、`#/lesson/番号`、`#/challenge`、`#/free`。

| モード | 内容 |
|---|---|
| レッスン | 全15レッスン。init / commit から branch・merge・競合・push・pull・stash・reset/revert・rebase・cherry-pick・tag・PR・.gitignore まで順番に |
| チャレンジ | チームからランダムにミッションが届く。ライフ3つ、スコア・連続ボーナス・ハイスコアあり。「競合したら失敗」「force push したら失敗」など |
| フリー | 何でも試せる砂場。ボタンで仲間の push / ブランチ / PR を発生させられます |

### 対応している主なコマンド

`init` `clone` `config` `status` `add` `commit (-m / -a / --amend)` `diff (--staged)` `restore (--staged)` `rm` `mv`
`log (--oneline / --all / --graph)` `show` `reflog` `branch (-d / -D / -m / -a / -vv)` `switch (-c)` `checkout (-b)`
`merge (--no-ff / --squash / --abort)` `rebase (--continue / --abort / --skip)` `cherry-pick` `revert` `reset (--soft / --mixed / --hard)`
`stash (push / pop / apply / list / drop)` `tag` `remote` `fetch` `pull (--rebase)` `push (-u / --force / --delete / --tags)` `clean`
`gh repo create` `gh pr create / list / view / merge` (GitHub CLI の簡易版)

## GitHub Pages で公開する

ビルド不要の静的サイトです。

1. このリポジトリを GitHub に push
2. **Settings → Pages → Build and deployment** で Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして Save
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

## ローカルで動かす

ES Modules を使っているので、`index.html` を直接開くのではなくローカルサーバー経由で開いてください。

```sh
python3 -m http.server 8000   # → http://localhost:8000
npm test                      # シミュレーターとレッスン/ミッションの自動テスト
```

## 構成

```
index.html        画面
css/style.css     スタイル (ダーク / ライト対応、スマホ対応)
js/diff.js        行差分と 3-way マージ
js/git.js         Git シミュレーター本体 (DOM 非依存)
js/shell.js       疑似シェル・gh コマンド・補完
js/graph.js       コミットグラフの描画
js/scenario.js    チームリポジトリなどのシナリオ
js/lessons.js     レッスン定義
js/missions.js    チャレンジのミッション定義
js/docs.js        コマンド辞典・初回解説
js/icons.js       SVG アイコン
js/app.js         UI とゲーム進行
tests/            node --test によるテスト
```

進捗 (XP・クリア状況・ハイスコア) はブラウザの localStorage に保存されます。実際のファイルや GitHub には一切影響しません。

# HOW to Git — 遊んで学ぶ Git シミュレーター

Git の使い方を **初心者向けに、ゲーム感覚で** 学べる Web アプリです。
ブラウザの中の疑似ターミナルで本物そっくりの Git コマンドを打ち、コミットグラフやファイルの状態がどう変わるかをリアルタイムに確認できます。

## 特徴

- **ブランチ図が主役** — 画面の中央に常にブランチ図。コマンドを実行すると、ブランチの名札やコミットが動きます
- **2つの操作方法** — ボタンでコマンドを組み立てる (何が実行されるか文字で表示) か、PC 風キーボードで打つかを切り替え
- **グラフをタップ** — コミットや名札をタップすると、その名前がコマンドに入ります
- **チーム開発を再現** — 仲間 (田中さん・佐藤さん) が GitHub に push したり PR を作ったりします
- **本物同様の競合** — 行単位の 3-way マージで競合し、エディタで解決できます

### 3つのモード

トップ画面から選びます。URL は `#/` (トップ)、`#/stages`、`#/stage/番号`、`#/challenge`、`#/free`。

| モード | 内容 |
|---|---|
| ステージ | 全20面のパズル。「ゴール」のブランチ図と同じ形にする。少ない手数でクリアすると星3つ |
| チャレンジ | 仲間から依頼が次々に届く。依頼は「状況」だけが書かれていて、どのコマンドを使うかは自分で判断する。ライフ3つ。終わると「判断のポイント」と模範解答が出る |
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
npm test                      # シミュレーター・ステージ・ミッションの自動テスト
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
js/stages.js      ステージ (ゴールの形) の定義
js/shape.js       ブランチの形の比較
js/builder.js     ボタンでのコマンド組み立て
js/keyboard.js    スマホ用の PC 風キーボード
js/missions.js    チャレンジのミッション定義
js/docs.js        コマンド辞典・初回解説
js/icons.js       SVG アイコン
js/app.js         UI とゲーム進行
tests/            node --test によるテスト
```

進捗 (XP・クリア状況・ハイスコア) はブラウザの localStorage に保存されます。実際のファイルや GitHub には一切影響しません。

# HOW to Git — 開発メモ

- GitHub Pages (main ブランチ / ルート) で公開している静的サイト。ビルド不要。
- **修正したら公開する**: 作業ブランチで修正 → `npm run version` (キャッシュ対策のハッシュを index.html に反映) → `npm test` が通ることを確認 → PR を作成して main にマージする (オーナーの了承済み)。
- UI に絵文字は使わない。アイコンは `js/icons.js` の SVG を使う。
- スマホ優先・文字は少なく短く。

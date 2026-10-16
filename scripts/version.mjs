// キャッシュ対策: CSS/JS の内容ハッシュを index.html に書き込む
// 使い方: node scripts/version.mjs   (--check で書き込まずに検査だけ)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const hash = (p) => createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex').slice(0, 8);

const jsFiles = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).sort();
const map = Object.fromEntries(jsFiles.map((f) => [`./js/${f}`, `./js/${f}?v=${hash('js/' + f)}`]));
const block = `<script type="importmap">\n${JSON.stringify({ imports: map }, null, 2).replace(/^/gm, '  ')}\n  </script>`;

const path = new URL('index.html', root);
const before = readFileSync(path, 'utf8');
let html = before
  .replace(/<script type="importmap">[\s\S]*?<\/script>|<!-- importmap -->/, block)
  .replace(/href="css\/style\.css(\?v=\w+)?"/, `href="css/style.css?v=${hash('css/style.css')}"`)
  .replace(/src="js\/app\.js(\?v=\w+)?"/, `src="js/app.js?v=${hash('js/app.js')}"`);

if (process.argv.includes('--check')) {
  if (html !== before) {
    console.error('index.html のバージョンが古いです。node scripts/version.mjs を実行してください。');
    process.exit(1);
  }
  console.log('ok');
} else {
  writeFileSync(path, html);
  console.log('updated index.html');
}

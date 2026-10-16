// レッスン・ミッション共通のシナリオ補助
import { World, headId, currentBranch, mergeOnRemote } from './git.js';
import { Shell } from './shell.js';
import { hasConflictMarkers } from './diff.js';

export const TEAM_URL = 'https://github.com/team/cafe-shop.git';
export const TEAM_DIR = '~/cafe-shop';

export const FILES = {
  'README.md': '# Cafe Shop\nカフェのWebサイトです。\n\n## メンバー\n- 田中\n- 佐藤\n',
  'index.html': '<html>\n<head><title>Cafe Shop</title></head>\n<body>\n<h1>ようこそ Cafe Shop へ</h1>\n<p>おいしいコーヒーあります</p>\n</body>\n</html>\n',
  'menu.txt': 'コーヒー 400円\n紅茶 350円\nケーキ 500円\n',
  'style.css': 'body { font-family: sans-serif; }\nh1 { color: brown; }\n',
  'app.js': 'function total(prices) {\n  return prices.reduce((a, b) => a + b, 0);\n}\n\nfunction withTax(price) {\n  return price * 10; // 税込み価格\n}\n',
};

// チーム共有リポジトリ (GitHub 上) を作る
export function buildTeamRemote(w) {
  const r = w.createRemote(TEAM_URL, 'team');
  w.teammateCommit(TEAM_URL, 'main', { 'README.md': FILES['README.md'], 'index.html': FILES['index.html'] }, '最初のコミット', '田中');
  w.teammateCommit(TEAM_URL, 'main', { 'menu.txt': FILES['menu.txt'] }, 'メニューを追加', '佐藤');
  w.teammateCommit(TEAM_URL, 'feature/style', { 'style.css': FILES['style.css'] }, 'デザインを追加', '田中', 'main');
  w.teammateCommit(TEAM_URL, 'main', { 'app.js': FILES['app.js'] }, '合計金額の計算を追加', '佐藤');
  w.prCounter = 1;
  r.prs.push({ number: 1, title: 'デザインを追加', head: 'feature/style', base: 'main', state: 'merged', author: '田中' });
  mergeOnRemote(w, r, 'main', 'feature/style', 'Merge pull request #1 from feature/style\n\nデザインを追加', '田中');
  delete r.branches['feature/style'];
  return r;
}

const silentUi = { openEditor() {}, clear() {}, showHint() {}, showMission() {} };

export function silentRun(w, line, cwd) {
  const sh = new Shell(w, silentUi);
  const prev = w.cwd;
  if (cwd) w.cwd = cwd;
  const out = [];
  const ctx = { errorCount: 0, out: (t, c) => { out.push(typeof t === 'string' ? t : t.map((x) => x[0]).join('')); if (c === 'err') ctx.errorCount++; }, hint() {}, ev() {} };
  sh.run(line, ctx);
  if (cwd) w.cwd = prev;
  if (ctx.errorCount) console.warn('[setup]', line, out.join('\n'));
  return out.join('\n');
}

export function createApi(game) {
  const api = {
    get w() { return game.world; },
    get repo() { return game.world.repo; },
    get dir() { return game.world.dir; },
    get cwd() { return game.world.cwd; },
    get lastCmd() { return game.lastCmd || ''; },
    sh: (line, cwd) => silentRun(game.world, line, cwd),
    chat: (who, text) => game.chat(who, text),
    remote: (url = TEAM_URL) => game.world.remotes[url],
    head: () => (api.repo ? headId(api.repo) : null),
    branch: () => (api.repo ? currentBranch(api.repo) : null),
    tree: (id) => game.world.tree(id),
    headTree: () => (api.repo ? game.world.tree(headId(api.repo)) : {}),
    has: (evs, type, pred = () => true) => evs.some((e) => e.type === type && pred(e)),
    teammatePush: (branch, changes, msg, who, from) => game.world.teammateCommit(TEAM_URL, branch, changes, msg, who, from),
    remoteTree: (branch, url = TEAM_URL) => {
      const r = game.world.remotes[url];
      return r && r.branches[branch] ? game.world.tree(r.branches[branch]) : null;
    },
    contains: (a, b) => game.world.isAncestor(a, b),
    markers: hasConflictMarkers,
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    teamRepo: () => {
      const w = game.world;
      const isTeam = (d) => d && d.repo && d.repo.remotes.origin === TEAM_URL;
      if (isTeam(w.dirs[w.cwd])) return w.dirs[w.cwd];
      if (isTeam(w.dirs[TEAM_DIR])) return w.dirs[TEAM_DIR];
      return Object.values(w.dirs).find(isTeam) || null;
    },
    teamPath: () => {
      const w = game.world;
      const d = api.teamRepo();
      return d ? Object.keys(w.dirs).find((k) => w.dirs[k] === d) : null;
    },
  };
  return api;
}

export function newWorld() {
  return new World();
}

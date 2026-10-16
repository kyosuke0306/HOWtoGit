// Git シミュレーターの本体 (DOM に依存しない)
import { mergeTrees, diffLines, hasConflictMarkers } from './diff.js';

export const DEFAULT_BRANCH = 'main';

function newDir() { return { files: {}, repo: null }; }

function newRepo() {
  return {
    branches: {},
    head: { type: 'branch', name: DEFAULT_BRANCH },
    index: {},
    remotes: {},
    remoteRefs: {},
    upstream: {},
    tags: {},
    stash: [],
    op: null,
    conflicts: [],
    reflog: [],
    origHead: null,
    prevBranch: null,
  };
}

const short = (id) => (id ? id.slice(0, 7) : '0000000');
const clone = (o) => ({ ...o });
const firstLine = (s) => (s || '').split('\n')[0];

export class World {
  constructor() {
    this.objects = {};
    this.annotated = {};
    this.seq = 0;
    this.remotes = {};
    this.dirs = { '~': newDir() };
    this.cwd = '~';
    this.user = { name: 'あなた', email: 'you@example.com' };
    this.prCounter = 0;
    this.rand = Math.random;
  }

  get dir() { return this.dirs[this.cwd]; }
  get repo() { return this.findRepoDir()?.repo || null; }

  findRepoDir() {
    const d = this.dirs[this.cwd];
    return d && d.repo ? d : null;
  }

  newId() {
    let id;
    do {
      id = '';
      for (let i = 0; i < 40; i++) id += '0123456789abcdef'[Math.floor(this.rand() * 16)];
    } while (Object.keys(this.objects).some((k) => k.slice(0, 7) === id.slice(0, 7)));
    return id;
  }

  makeCommit({ parents, tree, message, author }) {
    this.seq++;
    const id = this.newId();
    const date = new Date(Date.UTC(2026, 3, 1, 0, 0) + this.seq * 7 * 60000);
    this.objects[id] = {
      id, parents: parents.filter(Boolean), tree: { ...tree }, message,
      author: author || this.user.name, date, seq: this.seq,
    };
    return id;
  }

  createRemote(url, owner = 'you') {
    if (!this.remotes[url]) {
      this.remotes[url] = { url, owner, branches: {}, tags: {}, defaultBranch: DEFAULT_BRANCH, prs: [] };
    }
    return this.remotes[url];
  }

  // 仲間がリモートに直接コミット(push)する
  teammateCommit(url, branch, changes, message, author, from) {
    const remote = this.remotes[url];
    const base = remote.branches[branch] || (from ? remote.branches[from] : null);
    const tree = base ? { ...this.objects[base].tree } : {};
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) delete tree[p]; else tree[p] = v;
    }
    const id = this.makeCommit({ parents: [base], tree, message, author });
    remote.branches[branch] = id;
    return id;
  }

  // 親コミットを元に新しいコミットを作る (ミッションの準備用)
  commitOn(parentId, changes, message, author) {
    const tree = parentId ? { ...this.objects[parentId].tree } : {};
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) delete tree[p]; else tree[p] = v;
    }
    return this.makeCommit({ parents: [parentId], tree, message, author });
  }

  ancestors(id) {
    const set = new Set();
    const stack = id ? [id] : [];
    while (stack.length) {
      const c = stack.pop();
      if (set.has(c)) continue;
      set.add(c);
      for (const p of this.objects[c].parents) stack.push(p);
    }
    return set;
  }

  isAncestor(a, b) { return !!a && !!b && this.ancestors(b).has(a); }

  mergeBase(a, b) {
    const anc = this.ancestors(a);
    let best = null;
    for (const c of this.ancestors(b)) {
      if (anc.has(c) && (!best || this.objects[c].seq > this.objects[best].seq)) best = c;
    }
    return best;
  }

  // a から到達可能で b から到達不能なコミット (古い順)
  onlyIn(a, b) {
    const ex = b ? this.ancestors(b) : new Set();
    return [...this.ancestors(a)].filter((c) => !ex.has(c)).sort((x, y) => this.objects[x].seq - this.objects[y].seq);
  }

  tree(id) { return id ? this.objects[id].tree : {}; }
}

// ---------- リポジトリの補助関数 ----------

export function headId(repo) {
  return repo.head.type === 'branch' ? repo.branches[repo.head.name] || null : repo.head.id;
}

export function currentBranch(repo) {
  return repo.head.type === 'branch' ? repo.head.name : null;
}

export function isIgnored(dir, path) {
  const gi = dir.files['.gitignore'];
  if (!gi) return false;
  return gi.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).some((pat) => {
    const dirPat = pat.endsWith('/');
    const core = pat.replace(/^\//, '').replace(/\/$/, '');
    const re = new RegExp('^' + core.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + (dirPat ? '/' : '(/|$)'));
    return re.test(path) || (!pat.includes('/') && path.split('/').some((seg) => new RegExp('^' + core.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(seg)));
  });
}

export function computeStatus(world, dir) {
  const repo = dir.repo;
  const head = world.tree(headId(repo));
  const idx = repo.index, work = dir.files;
  const conflictPaths = new Set(repo.conflicts.map((c) => c.path));
  const staged = [], unstaged = [], untracked = [];
  for (const p of [...new Set([...Object.keys(head), ...Object.keys(idx)])].sort()) {
    if (conflictPaths.has(p)) continue;
    if (head[p] === idx[p]) continue;
    staged.push({ path: p, kind: head[p] === undefined ? 'new file' : idx[p] === undefined ? 'deleted' : 'modified' });
  }
  for (const p of Object.keys(idx).sort()) {
    if (conflictPaths.has(p)) continue;
    if (work[p] === undefined) unstaged.push({ path: p, kind: 'deleted' });
    else if (work[p] !== idx[p]) unstaged.push({ path: p, kind: 'modified' });
  }
  for (const p of Object.keys(work).sort()) {
    if (idx[p] === undefined && !conflictPaths.has(p) && !isIgnored(dir, p)) untracked.push({ path: p });
  }
  return { staged, unstaged, untracked, conflicts: repo.conflicts.slice() };
}

function setHeadTo(repo, id, reflogMsg) {
  if (repo.head.type === 'branch') repo.branches[repo.head.name] = id;
  else repo.head = { type: 'detached', id };
  reflog(repo, id, reflogMsg);
}

function reflog(repo, id, msg) {
  repo.reflog.unshift({ id, msg });
  if (repo.reflog.length > 100) repo.reflog.pop();
}

function refNamesFor(world, repo, id) {
  const names = [];
  const cur = currentBranch(repo);
  if (repo.head.type === 'detached' && repo.head.id === id) names.push(['HEAD', 'head']);
  for (const [b, v] of Object.entries(repo.branches)) {
    if (v !== id) continue;
    if (b === cur) names.push(['HEAD -> ' + b, 'head']);
    else names.push([b, 'branch']);
  }
  for (const [r, v] of Object.entries(repo.remoteRefs)) if (v === id) names.push([r, 'remote']);
  for (const [t, v] of Object.entries(repo.tags)) if (v === id) names.push(['tag: ' + t, 'tag']);
  return names;
}

// ---------- リファレンス解決 ----------

export function resolveRef(world, repo, spec) {
  if (!spec) return null;
  const m = spec.match(/^(.+?)((?:[~^]\d*)*)$/);
  let base = m[1], suffix = m[2];
  let id = null;
  const reflogM = base.match(/^(?:HEAD)?@\{(\d+)\}$/);
  if (reflogM) {
    const e = repo.reflog[Number(reflogM[1])];
    id = e ? e.id : null;
  } else if (base === 'HEAD' || base === '@') id = headId(repo);
  else if (base === 'ORIG_HEAD') id = repo.origHead;
  else if (base === 'MERGE_HEAD') id = repo.op && repo.op.type === 'merge' ? repo.op.theirs : null;
  else if (repo.branches[base] !== undefined) id = repo.branches[base];
  else if (repo.branches[base.replace(/^refs\/heads\//, '')]) id = repo.branches[base.replace(/^refs\/heads\//, '')];
  else if (repo.tags[base]) id = repo.tags[base];
  else if (repo.remoteRefs[base]) id = repo.remoteRefs[base];
  else if (repo.remoteRefs[base.replace(/^(refs\/)?remotes\//, '')]) id = repo.remoteRefs[base.replace(/^(refs\/)?remotes\//, '')];
  else if (/^[0-9a-f]{4,40}$/.test(base)) {
    const hits = Object.keys(world.objects).filter((k) => k.startsWith(base));
    if (hits.length === 1) id = hits[0];
  }
  if (!id) return null;
  const ops = suffix.match(/[~^]\d*/g) || [];
  for (const op of ops) {
    const n = op.length > 1 ? Number(op.slice(1)) : 1;
    if (op[0] === '~') {
      for (let i = 0; i < n; i++) {
        id = world.objects[id].parents[0];
        if (!id) return null;
      }
    } else {
      if (n === 0) continue;
      id = world.objects[id].parents[n - 1];
      if (!id) return null;
    }
  }
  return id;
}

// ---------- 作業ツリー操作 ----------

// HEAD から target への切り替え。ローカル変更を守りつつ作業ツリーを更新
function checkoutTree(world, dir, targetId, ctx, what = 'checkout') {
  const repo = dir.repo;
  const cur = world.tree(headId(repo));
  const tgt = world.tree(targetId);
  const idx = repo.index, work = dir.files;
  const blocked = [], untrackedBlocked = [];
  const paths = [...new Set([...Object.keys(cur), ...Object.keys(tgt)])];
  for (const p of paths) {
    if (cur[p] === tgt[p]) continue;
    const dirty = idx[p] !== cur[p] || work[p] !== cur[p];
    if (dirty && !(idx[p] === tgt[p] && work[p] === tgt[p])) {
      if (cur[p] === undefined && idx[p] === undefined) untrackedBlocked.push(p);
      else blocked.push(p);
    }
  }
  if (blocked.length) {
    ctx.out(`error: Your local changes to the following files would be overwritten by ${what}:`, 'err');
    blocked.forEach((p) => ctx.out('\t' + p, 'err'));
    ctx.out(what === 'checkout'
      ? 'Please commit your changes or stash them before you switch branches.'
      : 'Please commit your changes or stash them before you merge.', 'err');
    ctx.out('Aborting', 'err');
    ctx.hint('未コミットの変更あり → commit か git stash');
    return false;
  }
  if (untrackedBlocked.length) {
    ctx.out(`error: The following untracked working tree files would be overwritten by ${what}:`, 'err');
    untrackedBlocked.forEach((p) => ctx.out('\t' + p, 'err'));
    ctx.out('Please move or remove them before you switch branches.', 'err');
    ctx.out('Aborting', 'err');
    return false;
  }
  for (const p of paths) {
    if (cur[p] === tgt[p]) continue;
    if (tgt[p] === undefined) { delete idx[p]; delete work[p]; }
    else { idx[p] = tgt[p]; work[p] = tgt[p]; }
  }
  return true;
}

function hardReset(world, dir, id) {
  const repo = dir.repo;
  const oldTracked = new Set([...Object.keys(repo.index), ...Object.keys(world.tree(headId(repo))), ...repo.conflicts.map((c) => c.path)]);
  const tgt = world.tree(id);
  for (const p of oldTracked) if (tgt[p] === undefined) delete dir.files[p];
  repo.index = { ...tgt };
  for (const [p, v] of Object.entries(tgt)) dir.files[p] = v;
  repo.conflicts = [];
}

function isDirty(world, dir) {
  const s = computeStatus(world, dir);
  return s.staged.length > 0 || s.unstaged.length > 0 || s.conflicts.length > 0;
}

// ---------- 出力の補助 ----------

function printDiff(ctx, path, oldText, newText) {
  if (oldText === newText) return;
  ctx.out(`diff --git a/${path} b/${path}`, 'bold');
  if (oldText === undefined) ctx.out('new file mode 100644', 'bold');
  if (newText === undefined) ctx.out('deleted file mode 100644', 'bold');
  ctx.out(`--- ${oldText === undefined ? '/dev/null' : 'a/' + path}`, 'bold');
  ctx.out(`+++ ${newText === undefined ? '/dev/null' : 'b/' + path}`, 'bold');
  const d = diffLines(oldText, newText);
  // 変更行の前後3行だけ表示
  const keep = new Array(d.length).fill(false);
  d.forEach((x, i) => {
    if (x.type !== 'same') for (let k = Math.max(0, i - 3); k <= Math.min(d.length - 1, i + 3); k++) keep[k] = true;
  });
  let skipped = false;
  d.forEach((x, i) => {
    if (!keep[i]) { if (!skipped) { ctx.out('@@ ... @@', 'info'); skipped = true; } return; }
    skipped = false;
    if (x.type === 'add') ctx.out('+' + x.line, 'add');
    else if (x.type === 'del') ctx.out('-' + x.line, 'del');
    else ctx.out(' ' + x.line, 'dim');
  });
}

function printTreeDiff(ctx, a, b, filter) {
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  let any = false;
  for (const p of paths) {
    if (filter && filter.length && !filter.includes(p)) continue;
    if (a[p] !== b[p]) { printDiff(ctx, p, a[p], b[p]); any = true; }
  }
  return any;
}

function printCommitHeader(world, repo, ctx, id) {
  const c = world.objects[id];
  const refs = refNamesFor(world, repo, id);
  const seg = [['commit ' + c.id.slice(0, 7), 'hash']];
  if (refs.length) {
    seg.push([' (', 'hash']);
    refs.forEach(([n, cls], i) => { seg.push([n, cls]); if (i < refs.length - 1) seg.push([', ', 'hash']); });
    seg.push([')', 'hash']);
  }
  ctx.out(seg);
  if (c.parents.length > 1) ctx.out('Merge: ' + c.parents.map(short).join(' '));
  ctx.out(`Author: ${c.author}`);
  ctx.out(`Date:   ${c.date.toISOString().replace('T', ' ').slice(0, 16)}`);
  ctx.out('');
  c.message.split('\n').forEach((l) => ctx.out('    ' + l));
  ctx.out('');
}

function onelineSeg(world, repo, id) {
  const c = world.objects[id];
  const refs = refNamesFor(world, repo, id);
  const seg = [[short(id), 'hash'], [' ', '']];
  if (refs.length) {
    seg.push(['(', 'hash']);
    refs.forEach(([n, cls], i) => { seg.push([n, cls]); if (i < refs.length - 1) seg.push([', ', 'hash']); });
    seg.push([') ', 'hash']);
  }
  seg.push([firstLine(c.message), '']);
  return seg;
}

// ---------- 引数パース ----------

function parseArgs(args, valueFlags = []) {
  const flags = {}, pos = [];
  let afterDashDash = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) { rest.push(a); continue; }
    if (a === '--') { afterDashDash = true; continue; }
    if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      flags[k] = v;
    } else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (valueFlags.includes(k) && i + 1 < args.length) flags[k] = args[++i];
      else flags[k] = true;
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      const chars = a.slice(1);
      for (let j = 0; j < chars.length; j++) {
        const k = chars[j];
        if (valueFlags.includes(k)) {
          const v = chars.slice(j + 1) || args[++i];
          if (k === 'm' && Array.isArray(flags.m)) flags.m.push(v);
          else flags[k] = k === 'm' ? [v] : v;
          break;
        }
        flags[k] = true;
      }
    } else pos.push(a);
  }
  return { flags, pos, rest };
}

function matchPaths(spec, paths) {
  if (spec === '.' || spec === '*' || spec === ':/') return paths;
  if (spec.includes('*')) {
    const re = new RegExp('^' + spec.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return paths.filter((p) => re.test(p));
  }
  return paths.filter((p) => p === spec || p.startsWith(spec.replace(/\/$/, '') + '/'));
}

// ---------- メイン ----------

export function runGit(world, args, ctx) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === 'help' || sub === '--help') return gitHelp(ctx);
  if (sub === '--version' || sub === 'version') { ctx.out('git version 2.47.0 (simulator)'); return; }
  if (sub === 'init') return gitInit(world, rest, ctx);
  if (sub === 'clone') return gitClone(world, rest, ctx);
  if (sub === 'config') return gitConfig(world, rest, ctx);

  const dir = world.findRepoDir();
  const known = ['status', 'add', 'commit', 'log', 'branch', 'checkout', 'switch', 'merge', 'diff', 'restore', 'reset', 'rm', 'mv',
    'remote', 'push', 'pull', 'fetch', 'stash', 'tag', 'rebase', 'cherry-pick', 'revert', 'show', 'reflog', 'clean'];
  if (!known.includes(sub)) {
    ctx.out(`git: '${sub}' is not a git command. See 'git --help'.`, 'err');
    return;
  }
  if (!dir) {
    ctx.out('fatal: not a git repository (or any of the parent directories): .git', 'err');
    ctx.hint('git init か git clone から始めよう');
    return;
  }
  const g = new GitCmd(world, dir, ctx);
  const fn = {
    status: g.status, add: g.add, commit: g.commit, log: g.log, branch: g.branch, checkout: g.checkout,
    switch: g.switch, merge: g.merge, diff: g.diff, restore: g.restore, reset: g.reset, rm: g.rm, mv: g.mv,
    remote: g.remote, push: g.push, pull: g.pull, fetch: g.fetch, stash: g.stash, tag: g.tag, rebase: g.rebase,
    'cherry-pick': g.cherryPick, revert: g.revert, show: g.show, reflog: g.reflog, clean: g.clean,
  }[sub];
  return fn.call(g, rest);
}

function gitHelp(ctx) {
  ctx.out('usage: git <command> [<args>]');
  ctx.out('');
  const groups = [
    ['リポジトリを始める', 'init, clone'],
    ['変更を記録する', 'status, add, commit, diff, restore, rm, mv, reset'],
    ['履歴を見る', 'log, show, reflog'],
    ['ブランチ', 'branch, switch, checkout, merge, rebase, tag'],
    ['共同作業', 'remote, fetch, pull, push'],
    ['便利技', 'stash, cherry-pick, revert, clean'],
  ];
  groups.forEach(([t, c]) => ctx.out([[t.padEnd(14, '　'), 'info'], ['  ' + c, '']]));
  ctx.out('');
  ctx.hint('詳しくは「コマンド辞典」へ');
}

function gitInit(world, args, ctx) {
  let path = world.cwd;
  if (args[0]) {
    path = world.cwd + '/' + args[0];
    if (!world.dirs[path]) world.dirs[path] = newDir();
  }
  const d = world.dirs[path];
  if (d.repo) {
    ctx.out(`Reinitialized existing Git repository in ${path}/.git/`);
    return;
  }
  d.repo = newRepo();
  ctx.out(`Initialized empty Git repository in ${path}/.git/`, 'ok');
  ctx.ev('init', { path });
}

function gitClone(world, args, ctx) {
  const { pos } = parseArgs(args);
  const url = pos[0];
  if (!url) { ctx.out('fatal: You must specify a repository to clone.', 'err'); return; }
  const remote = world.remotes[url] || world.remotes[url + '.git'];
  if (!remote) {
    ctx.out(`fatal: repository '${url}' not found`, 'err');
    return;
  }
  const name = pos[1] || url.replace(/\/$/, '').split('/').pop().replace(/\.git$/, '');
  const path = world.cwd + '/' + name;
  if (world.dirs[path] && (Object.keys(world.dirs[path].files).length || world.dirs[path].repo)) {
    ctx.out(`fatal: destination path '${name}' already exists and is not an empty directory.`, 'err');
    return;
  }
  ctx.out(`Cloning into '${name}'...`);
  const d = newDir();
  const repo = newRepo();
  d.repo = repo;
  repo.remotes.origin = remote.url;
  for (const [b, id] of Object.entries(remote.branches)) repo.remoteRefs['origin/' + b] = id;
  Object.assign(repo.tags, remote.tags);
  const def = remote.defaultBranch;
  if (remote.branches[def]) {
    repo.branches[def] = remote.branches[def];
    repo.upstream[def] = 'origin/' + def;
    repo.head = { type: 'branch', name: def };
    repo.index = { ...world.tree(remote.branches[def]) };
    d.files = { ...repo.index };
    reflog(repo, remote.branches[def], 'clone: from ' + url);
    const n = world.ancestors(remote.branches[def]).size;
    ctx.out(`remote: Enumerating objects: ${n * 3}, done.`, 'dim');
    ctx.out(`Receiving objects: 100% (${n * 3}/${n * 3}), done.`, 'dim');
  } else {
    ctx.out('warning: You appear to have cloned an empty repository.', 'warn');
  }
  world.dirs[path] = d;
  ctx.hint(`次は cd ${name}`);
  ctx.ev('clone', { url, path });
}

function gitConfig(world, args, ctx) {
  const { flags, pos } = parseArgs(args);
  if (flags.list || flags.l) {
    ctx.out('user.name=' + world.user.name);
    ctx.out('user.email=' + world.user.email);
    ctx.out('init.defaultbranch=main');
    return;
  }
  const key = pos[0];
  if (!key) { ctx.out('usage: git config [--global] <name> [<value>]', 'err'); return; }
  const map = { 'user.name': 'name', 'user.email': 'email' };
  if (!map[key]) {
    if (pos[1] === undefined) return;
    ctx.out(`(${key} を設定しました)`, 'dim');
    return;
  }
  if (pos[1] === undefined) ctx.out(world.user[map[key]]);
  else {
    world.user[map[key]] = pos.slice(1).join(' ');
    ctx.ev('config', { key });
  }
}

class GitCmd {
  constructor(world, dir, ctx) {
    this.w = world; this.dir = dir; this.repo = dir.repo; this.ctx = ctx;
  }

  get head() { return headId(this.repo); }

  needCommits() {
    if (!this.head) {
      this.ctx.out(`fatal: your current branch '${currentBranch(this.repo)}' does not have any commits yet`, 'err');
      this.ctx.hint('まだコミットがありません');
      return false;
    }
    return true;
  }

  blockedByOp() {
    if (this.repo.conflicts.length) {
      this.ctx.out('error: you need to resolve your current index first', 'err');
      this.repo.conflicts.forEach((c) => this.ctx.out('\t' + c.path, 'err'));
      this.ctx.hint('競合を直して git add → git commit');
      return true;
    }
    return false;
  }

  resolve(spec, quiet) {
    const id = resolveRef(this.w, this.repo, spec);
    if (!id && !quiet) {
      this.ctx.out(`fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.`, 'err');
    }
    return id;
  }

  // ---- status ----
  status(args) {
    const { flags } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx;
    const s = computeStatus(this.w, this.dir);
    if (flags.s || flags.short) {
      s.conflicts.forEach((c) => ctx.out([['UU', 'err'], [' ' + c.path, '']]));
      const map = {};
      s.staged.forEach((x) => (map[x.path] = { i: x.kind[0].toUpperCase().replace('N', 'A'), w: ' ' }));
      s.unstaged.forEach((x) => (map[x.path] = { i: map[x.path]?.i || ' ', w: x.kind[0].toUpperCase() }));
      Object.entries(map).sort().forEach(([p, v]) => ctx.out([[v.i, 'ok'], [v.w, 'err'], [' ' + p, '']]));
      s.untracked.forEach((x) => ctx.out([['??', 'err'], [' ' + x.path, '']]));
      return;
    }
    const b = currentBranch(repo);
    if (repo.op && repo.op.type === 'rebase') {
      ctx.out(`interactive rebase in progress; onto ${short(repo.op.onto)}`, 'warn');
      ctx.out(`You are currently rebasing branch '${repo.op.branch}'.`, 'warn');
    } else if (b) ctx.out(`On branch ${b}`);
    else ctx.out(`HEAD detached at ${short(this.head)}`, 'err');
    if (b && repo.upstream[b] && repo.remoteRefs[repo.upstream[b]] && this.head) {
      const up = repo.upstream[b];
      const upId = repo.remoteRefs[up];
      const ahead = this.w.onlyIn(this.head, upId).length;
      const behind = this.w.onlyIn(upId, this.head).length;
      if (!ahead && !behind) ctx.out(`Your branch is up to date with '${up}'.`);
      else if (ahead && !behind) {
        ctx.out(`Your branch is ahead of '${up}' by ${ahead} commit${ahead > 1 ? 's' : ''}.`);
        ctx.out('  (use "git push" to publish your local commits)', 'dim');
      } else if (!ahead && behind) {
        ctx.out(`Your branch is behind '${up}' by ${behind} commit${behind > 1 ? 's' : ''}, and can be fast-forwarded.`);
        ctx.out('  (use "git pull" to update your local branch)', 'dim');
      } else {
        ctx.out(`Your branch and '${up}' have diverged,`);
        ctx.out(`and have ${ahead} and ${behind} different commits each, respectively.`);
        ctx.out('  (use "git pull" if you want to integrate the remote branch with yours)', 'dim');
      }
    }
    if (!this.head) { ctx.out(''); ctx.out('No commits yet'); }
    if (repo.op && repo.op.type === 'merge') {
      ctx.out('');
      if (s.conflicts.length) {
        ctx.out('You have unmerged paths.', 'warn');
        ctx.out('  (fix conflicts and run "git commit")', 'dim');
        ctx.out('  (use "git merge --abort" to abort the merge)', 'dim');
      } else {
        ctx.out('All conflicts fixed but you are still merging.', 'warn');
        ctx.out('  (use "git commit" to conclude merge)', 'dim');
      }
    }
    if (repo.op && (repo.op.type === 'cherry-pick' || repo.op.type === 'revert')) {
      ctx.out('');
      ctx.out(`You are currently ${repo.op.type === 'revert' ? 'reverting' : 'cherry-picking'} commit ${short(repo.op.commit)}.`, 'warn');
      ctx.out(`  (fix conflicts and run "git ${repo.op.type} --continue")`, 'dim');
      ctx.out(`  (use "git ${repo.op.type} --abort" to cancel the operation)`, 'dim');
    }
    if (repo.op && repo.op.type === 'rebase') {
      ctx.out('  (fix conflicts and then run "git rebase --continue")', 'dim');
      ctx.out('  (use "git rebase --abort" to check out the original branch)', 'dim');
    }
    if (s.staged.length) {
      ctx.out('');
      ctx.out('Changes to be committed:');
      ctx.out('  (use "git restore --staged <file>..." to unstage)', 'dim');
      s.staged.forEach((x) => ctx.out(`\t${(x.kind + ':').padEnd(12)}${x.path}`, 'ok'));
    }
    if (s.conflicts.length) {
      ctx.out('');
      ctx.out('Unmerged paths:');
      ctx.out('  (use "git add <file>..." to mark resolution)', 'dim');
      s.conflicts.forEach((x) => ctx.out(`\t${(x.kind + ':').padEnd(16)}${x.path}`, 'err'));
    }
    if (s.unstaged.length) {
      ctx.out('');
      ctx.out('Changes not staged for commit:');
      ctx.out('  (use "git add <file>..." to update what will be committed)', 'dim');
      ctx.out('  (use "git restore <file>..." to discard changes in working directory)', 'dim');
      s.unstaged.forEach((x) => ctx.out(`\t${(x.kind + ':').padEnd(12)}${x.path}`, 'err'));
    }
    if (s.untracked.length) {
      ctx.out('');
      ctx.out('Untracked files:');
      ctx.out('  (use "git add <file>..." to include in what will be committed)', 'dim');
      s.untracked.forEach((x) => ctx.out('\t' + x.path, 'err'));
    }
    ctx.out('');
    if (!s.staged.length && !s.unstaged.length && !s.conflicts.length) {
      if (s.untracked.length) ctx.out('nothing added to commit but untracked files present (use "git add" to track)');
      else if (!this.head) ctx.out('nothing to commit (create/copy files and use "git add" to track)');
      else if (!repo.op) ctx.out('nothing to commit, working tree clean');
    } else if (!s.staged.length && s.unstaged.length) {
      ctx.out('no changes added to commit (use "git add" and/or "git commit -a")');
    }
    ctx.ev('status');
  }

  // ---- add ----
  add(args) {
    const { flags, pos, rest } = parseArgs(args);
    const specs = [...pos, ...rest];
    const repo = this.repo, work = this.dir.files, ctx = this.ctx;
    let all = flags.A || flags.all;
    if (!specs.length && !all && !flags.u) {
      ctx.out('Nothing specified, nothing added.', 'warn');
      ctx.out("hint: Maybe you wanted to say 'git add .'?", 'warn');
      return;
    }
    const candidates = [...new Set([...Object.keys(work), ...Object.keys(repo.index), ...repo.conflicts.map((c) => c.path)])].sort();
    let targets = [];
    const ignoredUntracked = (p) => repo.index[p] === undefined && isIgnored(this.dir, p);
    if (all) targets = candidates.filter((p) => !ignoredUntracked(p));
    else if (flags.u) targets = candidates.filter((p) => repo.index[p] !== undefined);
    else {
      for (const sp of specs) {
        const hit = matchPaths(sp, candidates);
        if (!hit.length) {
          ctx.out(`fatal: pathspec '${sp}' did not match any files`, 'err');
          return;
        }
        const ign = hit.filter(ignoredUntracked);
        if (ign.length && !flags.f && hit.length === 1 && sp === hit[0]) {
          ctx.out('The following paths are ignored by one of your .gitignore files:', 'err');
          ign.forEach((p) => ctx.out(p, 'err'));
          ctx.out('hint: Use -f if you really want to add them.', 'err');
          return;
        }
        targets.push(...(flags.f ? hit : hit.filter((p) => !ignoredUntracked(p))));
      }
    }
    const added = [];
    for (const p of new Set(targets)) {
      if (work[p] === undefined) delete repo.index[p];
      else {
        if (hasConflictMarkers(work[p]) && repo.conflicts.some((c) => c.path === p)) {
          ctx.out(`warning: ${p} にまだ競合マーカー (<<<<<<< ======= >>>>>>>) が残っています！`, 'warn');
        }
        repo.index[p] = work[p];
      }
      repo.conflicts = repo.conflicts.filter((c) => c.path !== p);
      added.push(p);
    }
    ctx.ev('add', { paths: added });
  }

  rm(args) {
    const { flags, pos } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx;
    if (!pos.length) { ctx.out('usage: git rm [--cached] <file>...', 'err'); return; }
    for (const sp of pos) {
      const hit = matchPaths(sp, Object.keys(repo.index));
      if (!hit.length) { ctx.out(`fatal: pathspec '${sp}' did not match any files`, 'err'); return; }
      for (const p of hit) {
        delete repo.index[p];
        if (!flags.cached) delete this.dir.files[p];
        ctx.out(`rm '${p}'`);
      }
    }
    ctx.ev('rm');
  }

  mv(args) {
    const { pos } = parseArgs(args);
    const [a, b] = pos;
    const repo = this.repo, ctx = this.ctx;
    if (!a || !b) { ctx.out('usage: git mv <source> <destination>', 'err'); return; }
    if (repo.index[a] === undefined) { ctx.out(`fatal: not under version control, source=${a}, destination=${b}`, 'err'); return; }
    this.dir.files[b] = this.dir.files[a];
    delete this.dir.files[a];
    repo.index[b] = repo.index[a];
    delete repo.index[a];
    ctx.ev('mv');
  }

  // ---- commit ----
  commit(args) {
    const { flags } = parseArgs(args, ['m']);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (repo.conflicts.length) {
      ctx.out('error: Committing is not possible because you have unmerged files.', 'err');
      ctx.out('hint: Fix them up in the work tree, and then use \'git add/rm <file>\'', 'err');
      ctx.out('hint: as appropriate to mark resolution and make a commit.', 'err');
      ctx.out('fatal: Exiting because of an unresolved conflict.', 'err');
      ctx.hint('競合を直して git add してから');
      return;
    }
    if (flags.a || flags.all) {
      for (const p of Object.keys(repo.index)) {
        if (this.dir.files[p] === undefined) delete repo.index[p];
        else repo.index[p] = this.dir.files[p];
      }
    }
    let message = flags.m ? flags.m.join('\n\n') : null;
    const op = repo.op;
    if (op && op.type === 'rebase') {
      ctx.out('error: リベース中です。競合を解決したら git add してから git rebase --continue を実行してください。', 'err');
      return;
    }
    const amend = flags.amend;
    if (!message) {
      if (op && op.message) message = op.message;
      else if (amend && this.head) message = w.objects[this.head].message;
      else {
        ctx.out('error: コミットメッセージを -m で指定してください。', 'err');
        ctx.hint('例: git commit -m "メッセージ"');
        return;
      }
    }
    const headTree = w.tree(this.head);
    const changed = JSON.stringify(sortObj(headTree)) !== JSON.stringify(sortObj(repo.index));
    if (amend) {
      if (!this.head) { ctx.out('fatal: You have nothing to amend.', 'err'); return; }
      const old = w.objects[this.head];
      const id = w.makeCommit({ parents: old.parents, tree: repo.index, message, author: w.user.name });
      repo.origHead = this.head;
      setHeadTo(repo, id, 'commit (amend): ' + firstLine(message));
      this.printCommitSummary(id, message);
      ctx.ev('commit', { id, amend: true, branch: currentBranch(repo) });
      ctx.ev('amend', { id, old: old.id });
      return;
    }
    if (!changed && !flags['allow-empty'] && !(op && op.type === 'merge')) {
      const s = computeStatus(w, this.dir);
      ctx.out(currentBranch(repo) ? `On branch ${currentBranch(repo)}` : 'HEAD detached');
      if (s.unstaged.length || s.untracked.length) {
        if (s.unstaged.length) {
          ctx.out('Changes not staged for commit:');
          s.unstaged.forEach((x) => ctx.out(`\t${(x.kind + ':').padEnd(12)}${x.path}`, 'err'));
        }
        if (s.untracked.length) {
          ctx.out('Untracked files:');
          s.untracked.forEach((x) => ctx.out('\t' + x.path, 'err'));
        }
        ctx.out('no changes added to commit (use "git add" and/or "git commit -a")');
        ctx.hint('先に git add しよう');
      } else ctx.out('nothing to commit, working tree clean');
      return;
    }
    const parents = [this.head];
    if (op && op.type === 'merge') parents.push(op.theirs);
    const id = w.makeCommit({ parents, tree: repo.index, message, author: w.user.name });
    const kind = op && op.type === 'merge' ? 'commit (merge)' : this.head ? 'commit' : 'commit (initial)';
    setHeadTo(repo, id, `${kind}: ${firstLine(message)}`);
    this.printCommitSummary(id, message, !parents[0]);
    if (op && op.type === 'merge') {
      repo.op = null;
      ctx.ev('merge', { kind: 'merge', id, theirs: op.theirs, resolved: true, branch: currentBranch(repo) });
    }
    if (op && (op.type === 'cherry-pick' || op.type === 'revert')) {
      repo.op = null;
      ctx.ev(op.type, { id, commit: op.commit, resolved: true });
    }
    ctx.ev('commit', { id, branch: currentBranch(repo), merge: parents.length > 1 });
  }

  printCommitSummary(id, message, root) {
    const repo = this.repo, w = this.w;
    const c = w.objects[id];
    const parentTree = w.tree(c.parents[0]);
    const paths = new Set([...Object.keys(parentTree), ...Object.keys(c.tree)]);
    let files = 0, ins = 0, del = 0;
    for (const p of paths) {
      if (parentTree[p] === c.tree[p]) continue;
      files++;
      diffLines(parentTree[p], c.tree[p]).forEach((d) => { if (d.type === 'add') ins++; if (d.type === 'del') del++; });
    }
    const where = currentBranch(repo) || 'detached HEAD';
    this.ctx.out([['[' + where + (root ? ' (root-commit)' : '') + ' ', ''], [short(id), 'hash'], ['] ' + firstLine(message), '']]);
    this.ctx.out(` ${files} file${files !== 1 ? 's' : ''} changed, ${ins} insertion${ins !== 1 ? 's' : ''}(+), ${del} deletion${del !== 1 ? 's' : ''}(-)`, 'dim');
  }

  // ---- log ----
  log(args) {
    const { flags, pos } = parseArgs(args, ['n']);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    let limit = Infinity;
    if (flags.n) limit = Number(flags.n);
    pos.filter((p) => /^-\d+$/.test(p)).forEach((p) => (limit = Number(p.slice(1))));
    const refs = pos.filter((p) => !/^-\d+$/.test(p));
    let ids;
    if (flags.all) {
      const tips = [headId(repo), ...Object.values(repo.branches), ...Object.values(repo.remoteRefs), ...Object.values(repo.tags)].filter(Boolean);
      const set = new Set();
      tips.forEach((t) => w.ancestors(t).forEach((x) => set.add(x)));
      ids = [...set];
    } else if (refs[0] && refs[0].includes('..')) {
      const [a, b] = refs[0].split('..');
      const ia = this.resolve(a || 'HEAD'), ib = this.resolve(b || 'HEAD');
      if (!ia || !ib) return;
      ids = w.onlyIn(ib, ia);
    } else {
      if (!refs[0] && !this.needCommits()) return;
      const start = refs[0] ? this.resolve(refs[0]) : this.head;
      if (!start) return;
      ids = [...w.ancestors(start)];
    }
    ids.sort((a, b) => w.objects[b].seq - w.objects[a].seq);
    ids = ids.slice(0, limit);
    if (!ids.length) return;
    for (const id of ids) {
      if (flags.oneline || flags.graph) {
        const seg = onelineSeg(w, repo, id);
        if (flags.graph) seg.unshift([w.objects[id].parents.length > 1 ? '*   ' : '* ', 'warn']);
        ctx.out(seg);
      } else printCommitHeader(w, repo, ctx, id);
    }
    
    ctx.ev('log');
  }

  show(args) {
    const { pos } = parseArgs(args);
    if (!pos[0] && !this.needCommits()) return;
    const id = this.resolve(pos[0] || 'HEAD');
    if (!id) return;
    const w = this.w;
    const tagName = pos[0] && this.repo.tags[pos[0]] && w.annotated[pos[0]];
    if (tagName) {
      this.ctx.out('tag ' + pos[0], 'warn');
      this.ctx.out('Tagger: ' + tagName.tagger);
      this.ctx.out('');
      this.ctx.out(tagName.message);
      this.ctx.out('');
    }
    printCommitHeader(w, this.repo, this.ctx, id);
    const c = w.objects[id];
    printTreeDiff(this.ctx, w.tree(c.parents[0]), c.tree);
    this.ctx.ev('show');
  }

  reflog(args) {
    const repo = this.repo;
    if (!repo.reflog.length) { this.ctx.out('(reflog は空です)', 'dim'); return; }
    repo.reflog.forEach((e, i) => {
      this.ctx.out([[short(e.id), 'hash'], [` HEAD@{${i}}: ${e.msg}`, '']]);
    });
    this.ctx.hint('戻すなら git reset --hard HEAD@{1}');
    this.ctx.ev('reflog');
  }

  // ---- branch ----
  branch(args) {
    const { flags, pos } = parseArgs(args, ['u']);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const cur = currentBranch(repo);
    if (flags.d || flags.D || flags.delete) {
      if (!pos.length) { ctx.out('fatal: branch name required', 'err'); return; }
      for (const name of pos) {
        if (flags.r) {
          if (!repo.remoteRefs[name]) { ctx.out(`error: remote-tracking branch '${name}' not found.`, 'err'); continue; }
          ctx.out(`Deleted remote-tracking branch ${name} (was ${short(repo.remoteRefs[name])}).`);
          delete repo.remoteRefs[name];
          continue;
        }
        if (repo.branches[name] === undefined) { ctx.out(`error: branch '${name}' not found.`, 'err'); continue; }
        if (name === cur) {
          ctx.out(`error: Cannot delete branch '${name}' checked out at '${w.cwd}'`, 'err');
          ctx.hint('別のブランチに移動してから削除');
          continue;
        }
        const id = repo.branches[name];
        const up = repo.upstream[name] ? repo.remoteRefs[repo.upstream[name]] : null;
        const merged = w.isAncestor(id, this.head) || (up && w.isAncestor(id, up));
        if (!merged && !flags.D && !(flags.d && flags.f)) {
          ctx.out(`error: the branch '${name}' is not fully merged.`, 'err');
          ctx.out(`hint: If you are sure you want to delete it, run 'git branch -D ${name}'`, 'err');
          continue;
        }
        delete repo.branches[name];
        delete repo.upstream[name];
        ctx.out(`Deleted branch ${name} (was ${short(id)}).`);
        ctx.ev('branch-delete', { name, merged });
      }
      return;
    }
    if (flags.m || flags.M) {
      let [oldN, newN] = pos.length === 1 ? [cur, pos[0]] : pos;
      if (!oldN || !newN) { ctx.out('usage: git branch -m [<old>] <new>', 'err'); return; }
      if (repo.branches[oldN] === undefined && !(oldN === cur && !this.head)) { ctx.out(`error: refname refs/heads/${oldN} not found`, 'err'); return; }
      if (repo.branches[newN] !== undefined && !flags.M) { ctx.out(`fatal: a branch named '${newN}' already exists`, 'err'); return; }
      if (repo.branches[oldN] !== undefined) repo.branches[newN] = repo.branches[oldN];
      delete repo.branches[oldN];
      if (repo.upstream[oldN]) { repo.upstream[newN] = repo.upstream[oldN]; delete repo.upstream[oldN]; }
      if (cur === oldN) repo.head = { type: 'branch', name: newN };
      ctx.ev('branch-rename', { from: oldN, to: newN });
      return;
    }
    const upTo = flags.u || flags['set-upstream-to'];
    if (upTo) {
      const b = pos[0] || cur;
      if (!repo.remoteRefs[upTo]) { ctx.out(`error: the requested upstream branch '${upTo}' does not exist`, 'err'); return; }
      repo.upstream[b] = upTo;
      ctx.out(`branch '${b}' set up to track '${upTo}'.`);
      return;
    }
    if (pos.length && !flags.a && !flags.r && !flags.v && !flags.vv && !flags.list) {
      const name = pos[0];
      if (!validBranchName(name)) { ctx.out(`fatal: '${name}' is not a valid branch name`, 'err'); return; }
      if (repo.branches[name] !== undefined) { ctx.out(`fatal: a branch named '${name}' already exists`, 'err'); return; }
      const start = pos[1] ? this.resolve(pos[1]) : this.head;
      if (!start) {
        if (!pos[1]) ctx.out(`fatal: not a valid object name: '${cur}'`, 'err');
        if (!pos[1]) ctx.hint('先にコミットが必要です');
        return;
      }
      repo.branches[name] = start;
      if (pos[1] && repo.remoteRefs[pos[1]]) {
        repo.upstream[name] = pos[1];
        ctx.out(`branch '${name}' set up to track '${pos[1]}'.`);
      }
      ctx.ev('branch-create', { name });
      ctx.hint(`移動は git switch ${name}`);
      return;
    }
    // 一覧
    const vv = args.includes('-vv');
    const verbose = flags.v || vv;
    if (!flags.r) {
      const names = Object.keys(repo.branches).sort();
      if (repo.head.type === 'detached') ctx.out([['* ', 'ok'], [`(HEAD detached at ${short(repo.head.id)})`, 'ok']]);
      if (cur && repo.branches[cur] === undefined && !names.length) return;
      for (const n of names) {
        const seg = [[n === cur ? '* ' : '  ', 'ok'], [n, n === cur ? 'ok' : '']];
        if (verbose) {
          const id = repo.branches[n];
          seg.push(['  ' + short(id), 'hash']);
          if (vv && repo.upstream[n]) {
            const up = repo.upstream[n], upId = repo.remoteRefs[up];
            let info = up;
            if (upId) {
              const a = w.onlyIn(id, upId).length, b = w.onlyIn(upId, id).length;
              const parts = [];
              if (a) parts.push('ahead ' + a);
              if (b) parts.push('behind ' + b);
              if (parts.length) info += ': ' + parts.join(', ');
            } else info += ': gone';
            seg.push([' [', ''], [info, 'remote'], [']', '']);
          }
          seg.push([' ' + firstLine(w.objects[id].message), '']);
        }
        ctx.out(seg);
      }
    }
    if (flags.a || flags.r) {
      for (const r of Object.keys(repo.remoteRefs).sort()) {
        ctx.out([['  ', ''], [(flags.a ? 'remotes/' : '') + r, 'err']]);
      }
    }
    ctx.ev('branch-list');
  }

  // ---- switch / checkout ----
  switchBranch(name, opts = {}) {
    const repo = this.repo, ctx = this.ctx;
    const cur = currentBranch(repo);
    if (name === '-') {
      if (!repo.prevBranch) { ctx.out('fatal: no previous branch', 'err'); return false; }
      name = repo.prevBranch;
    }
    if (name === cur && !opts.create) {
      ctx.out(`Already on '${name}'`);
      return true;
    }
    if (opts.create) {
      if (!validBranchName(name)) { ctx.out(`fatal: '${name}' is not a valid branch name`, 'err'); return false; }
      if (repo.branches[name] !== undefined && !opts.force) { ctx.out(`fatal: a branch named '${name}' already exists`, 'err'); return false; }
      const start = opts.start ? this.resolve(opts.start) : this.head;
      if (opts.start && !start) return false;
      if (!start) {
        // コミットがまだない場合はブランチ名だけ切り替え
        repo.head = { type: 'branch', name };
        ctx.out(`Switched to a new branch '${name}'`, 'ok');
        ctx.ev('checkout', { branch: name, created: true });
        return true;
      }
      if (this.blockedByOp()) return false;
      if (!checkoutTree(this.w, this.dir, start, ctx)) return false;
      repo.branches[name] = start;
      if (opts.start && repo.remoteRefs[opts.start]) {
        repo.upstream[name] = opts.start;
        ctx.out(`branch '${name}' set up to track '${opts.start}'.`);
      }
      this.moveHead({ type: 'branch', name }, `checkout: moving from ${cur || short(this.head)} to ${name}`);
      ctx.out(`Switched to a new branch '${name}'`, 'ok');
      ctx.ev('branch-create', { name });
      ctx.ev('checkout', { branch: name, created: true });
      return true;
    }
    if (repo.branches[name] === undefined) {
      // origin/<name> があれば追跡ブランチを自動作成
      const remoteName = Object.keys(repo.remoteRefs).find((r) => r.split('/').slice(1).join('/') === name);
      if (remoteName && !opts.noGuess) {
        if (this.blockedByOp()) return false;
        if (!checkoutTree(this.w, this.dir, repo.remoteRefs[remoteName], ctx)) return false;
        repo.branches[name] = repo.remoteRefs[remoteName];
        repo.upstream[name] = remoteName;
        this.moveHead({ type: 'branch', name }, `checkout: moving from ${cur} to ${name}`);
        ctx.out(`branch '${name}' set up to track '${remoteName}'.`);
        ctx.out(`Switched to a new branch '${name}'`, 'ok');
        ctx.ev('branch-create', { name, fromRemote: remoteName });
        ctx.ev('checkout', { branch: name });
        return true;
      }
      return null; // ブランチではない
    }
    if (this.blockedByOp()) return false;
    if (!checkoutTree(this.w, this.dir, repo.branches[name], ctx)) return false;
    this.moveHead({ type: 'branch', name }, `checkout: moving from ${cur || short(this.head)} to ${name}`);
    ctx.out(`Switched to branch '${name}'`, 'ok');
    const up = repo.upstream[name];
    if (up && repo.remoteRefs[up]) {
      const a = this.w.onlyIn(repo.branches[name], repo.remoteRefs[up]).length;
      const b = this.w.onlyIn(repo.remoteRefs[up], repo.branches[name]).length;
      if (!a && !b) ctx.out(`Your branch is up to date with '${up}'.`);
      else if (a && !b) ctx.out(`Your branch is ahead of '${up}' by ${a} commit${a > 1 ? 's' : ''}.`);
      else if (!a && b) ctx.out(`Your branch is behind '${up}' by ${b} commit${b > 1 ? 's' : ''}, and can be fast-forwarded.`);
    }
    ctx.ev('checkout', { branch: name });
    return true;
  }

  moveHead(newHead, msg) {
    const repo = this.repo;
    const cur = currentBranch(repo);
    if (cur && newHead.type === 'branch' && newHead.name !== cur) repo.prevBranch = cur;
    repo.head = newHead;
    reflog(repo, headId(repo), msg);
  }

  detach(id, spec) {
    const ctx = this.ctx;
    if (this.blockedByOp()) return false;
    if (!checkoutTree(this.w, this.dir, id, ctx)) return false;
    this.moveHead({ type: 'detached', id }, `checkout: moving to ${spec}`);
    ctx.out(`Note: switching to '${spec}'.`, 'warn');
    ctx.out('');
    ctx.out("You are in 'detached HEAD' state. You can look around, make experimental", 'warn');
    ctx.out('changes and commit them, and you can discard any commits you make in this', 'warn');
    ctx.out('state without impacting any branches by switching back to a branch.', 'warn');
    ctx.out('');
    ctx.out(`HEAD is now at ${short(id)} ${firstLine(this.w.objects[id].message)}`);
    ctx.hint('戻るには git switch main');
    ctx.ev('checkout', { detached: true, id });
    return true;
  }

  switch(args) {
    const { flags, pos } = parseArgs(args, ['c', 'C']);
    const ctx = this.ctx;
    if (flags.c || flags.C || flags.create) {
      const name = flags.c || flags.C || pos.shift();
      this.switchBranch(typeof name === 'string' ? name : pos.shift(), { create: true, start: pos[0], force: !!flags.C });
      return;
    }
    if (flags.detach || flags.d) {
      const id = this.resolve(pos[0] || 'HEAD');
      if (id) this.detach(id, pos[0] || 'HEAD');
      return;
    }
    if (!pos[0]) { ctx.out('fatal: missing branch or commit argument', 'err'); return; }
    const r = this.switchBranch(pos[0]);
    if (r === null) {
      if (this.resolve(pos[0], true)) {
        ctx.out('fatal: a branch is expected, got commit \'' + pos[0] + '\'', 'err');
        ctx.out('hint: If you want to detach HEAD at the commit, try again with the --detach option.', 'err');
      } else {
        ctx.out(`fatal: invalid reference: ${pos[0]}`, 'err');
        ctx.hint(`作るなら git switch -c ${pos[0]}`);
      }
    }
  }

  checkout(args) {
    const { flags, pos, rest } = parseArgs(args, ['b', 'B']);
    const ctx = this.ctx, repo = this.repo;
    if (flags.b || flags.B) {
      this.switchBranch(flags.b || flags.B, { create: true, start: pos[0], force: !!flags.B });
      return;
    }
    if (rest.length || (pos[0] && pos.length > 0 && pos.every((p) => p === '.' || (resolveRef(this.w, repo, p) === null && repo.branches[p] === undefined && !Object.keys(repo.remoteRefs).some((r) => r.endsWith('/' + p)))))) {
      // ファイルの復元
      const files = rest.length ? rest : pos;
      return this.restoreFiles(files, { worktree: true });
    }
    if (!pos[0]) { ctx.out('(何も指定されていません。git checkout <ブランチ名> のように使います)', 'dim'); return; }
    const r = this.switchBranch(pos[0]);
    if (r === null) {
      const id = this.resolve(pos[0], true);
      if (id) this.detach(id, pos[0]);
      else ctx.out(`error: pathspec '${pos[0]}' did not match any file(s) known to git`, 'err');
    }
  }

  // ---- restore ----
  restore(args) {
    const { flags, pos, rest } = parseArgs(args, ['s']);
    const files = [...pos, ...rest];
    if (!files.length) { this.ctx.out('fatal: you must specify path(s) to restore', 'err'); return; }
    const staged = flags.staged || flags.S;
    const worktree = flags.worktree || flags.W || !staged;
    this.restoreFiles(files, { staged, worktree, source: flags.source || flags.s });
  }

  restoreFiles(files, { staged, worktree, source }) {
    const repo = this.repo, ctx = this.ctx, w = this.w;
    let srcTree = null;
    if (source) {
      const id = this.resolve(source);
      if (!id) return;
      srcTree = w.tree(id);
    }
    const headTree = w.tree(this.head);
    const candidates = [...new Set([...Object.keys(this.dir.files), ...Object.keys(repo.index), ...Object.keys(headTree)])];
    const done = [];
    for (const sp of files) {
      const hit = matchPaths(sp, candidates).filter((p) => repo.index[p] !== undefined || headTree[p] !== undefined || (srcTree && srcTree[p] !== undefined));
      if (!hit.length) { ctx.out(`error: pathspec '${sp}' did not match any file(s) known to git`, 'err'); return; }
      for (const p of hit) {
        if (staged) {
          const v = (srcTree || headTree)[p];
          if (v === undefined) delete repo.index[p]; else repo.index[p] = v;
        }
        if (worktree) {
          const v = srcTree ? srcTree[p] : repo.index[p];
          if (v === undefined) { if (!staged) continue; delete this.dir.files[p]; }
          else this.dir.files[p] = v;
        }
        repo.conflicts = repo.conflicts.filter((c) => c.path !== p);
        done.push(p);
      }
    }
    ctx.ev('restore', { staged: !!staged, worktree: !!worktree, paths: done });
  }

  // ---- reset ----
  reset(args) {
    const { flags, pos, rest } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const mode = flags.hard ? 'hard' : flags.soft ? 'soft' : 'mixed';
    let target = 'HEAD', files = rest.slice();
    for (const p of pos) {
      if (target === 'HEAD' && !files.length && resolveRef(w, repo, p)) target = p;
      else files.push(p);
    }
    if (files.length) {
      // パス指定 = アンステージ
      this.restoreFiles(files, { staged: true, worktree: false, source: target === 'HEAD' ? null : target });
      if (!this.head && !files.length) return;
      ctx.out('Unstaged changes after reset:', 'dim');
      computeStatus(w, this.dir).unstaged.forEach((x) => ctx.out(`${x.kind[0].toUpperCase()}\t${x.path}`, 'dim'));
      return;
    }
    if (!this.head) {
      repo.index = {};
      return;
    }
    const id = this.resolve(target);
    if (!id) return;
    repo.origHead = this.head;
    if (mode === 'hard') hardReset(w, this.dir, id);
    else if (mode === 'mixed') { repo.index = { ...w.tree(id) }; repo.conflicts = []; }
    const wasOp = repo.op;
    repo.op = null;
    setHeadTo(repo, id, `reset: moving to ${target}`);
    if (mode === 'hard') ctx.out(`HEAD is now at ${short(id)} ${firstLine(w.objects[id].message)}`);
    else if (mode === 'mixed') {
      const s = computeStatus(w, this.dir);
      if (s.unstaged.length) {
        ctx.out('Unstaged changes after reset:');
        s.unstaged.forEach((x) => ctx.out(`${x.kind[0].toUpperCase()}\t${x.path}`));
      }
    }
    ctx.ev('reset', { mode, id, abortedOp: wasOp?.type });
  }

  clean(args) {
    const { flags } = parseArgs(args);
    const s = computeStatus(this.w, this.dir);
    if (!flags.f && !flags.n) {
      this.ctx.out('fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean', 'err');
      return;
    }
    for (const u of s.untracked) {
      if (flags.n) this.ctx.out('Would remove ' + u.path);
      else { delete this.dir.files[u.path]; this.ctx.out('Removing ' + u.path); }
    }
    this.ctx.ev('clean');
  }

  // ---- diff ----
  diff(args) {
    const { flags, pos, rest } = parseArgs(args);
    const repo = this.repo, w = this.w, ctx = this.ctx;
    const staged = flags.staged || flags.cached;
    const refs = [], files = rest.slice();
    for (const p of pos) {
      if (p.includes('..') || resolveRef(w, repo, p)) refs.push(p);
      else files.push(p);
    }
    let a, b;
    if (refs.length === 1 && refs[0].includes('..')) {
      const [x, y] = refs[0].split(/\.\.\.?/);
      const ix = this.resolve(x || 'HEAD'), iy = this.resolve(y || 'HEAD');
      if (!ix || !iy) return;
      a = w.tree(refs[0].includes('...') ? w.mergeBase(ix, iy) : ix); b = w.tree(iy);
    } else if (refs.length === 2) {
      a = w.tree(this.resolve(refs[0])); b = w.tree(this.resolve(refs[1]));
    } else if (refs.length === 1) {
      a = w.tree(this.resolve(refs[0]));
      b = staged ? repo.index : workTracked(this.dir, repo, w.tree(this.resolve(refs[0])));
    } else if (staged) {
      a = w.tree(this.head); b = repo.index;
    } else {
      a = { ...repo.index };
      b = {};
      for (const p of Object.keys(repo.index)) if (this.dir.files[p] !== undefined) b[p] = this.dir.files[p];
      for (const c of repo.conflicts) { a[c.path] = w.tree(this.head)[c.path]; b[c.path] = this.dir.files[c.path]; }
    }
    if (flags['name-only'] || flags.stat) {
      for (const p of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (files.length && !files.includes(p)) continue;
        if (a[p] !== b[p]) {
          if (flags.stat) {
            const d = diffLines(a[p], b[p]);
            const add = d.filter((x) => x.type === 'add').length, del = d.filter((x) => x.type === 'del').length;
            ctx.out([[` ${p} | ${add + del} `, ''], ['+'.repeat(add), 'add'], ['-'.repeat(del), 'del']]);
          } else ctx.out(p);
        }
      }
      return;
    }
    const any = printTreeDiff(ctx, a, b, files);
    if (!any && !staged && !refs.length) {
      const s = computeStatus(w, this.dir);
      if (s.staged.length) ctx.hint('ステージ済みは git diff --staged');
    }
    ctx.ev('diff', { staged: !!staged });
  }

  // ---- merge ----
  merge(args) {
    const { flags, pos } = parseArgs(args, ['m']);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (flags.abort) {
      if (!repo.op || repo.op.type !== 'merge') { ctx.out('fatal: There is no merge to abort (MERGE_HEAD missing).', 'err'); return; }
      hardReset(w, this.dir, this.head);
      repo.op = null;
      ctx.out('マージを中止して元の状態に戻しました。', 'ok');
      ctx.ev('merge-abort');
      return;
    }
    if (flags.continue) {
      if (!repo.op || repo.op.type !== 'merge') { ctx.out('fatal: There is no merge in progress (MERGE_HEAD missing).', 'err'); return; }
      return this.commit([]);
    }
    if (repo.op) {
      ctx.out('error: Merging is not possible because you have unmerged files.', 'err');
      ctx.out('hint: Fix them up in the work tree, and then use \'git add/rm <file>\'', 'err');
      ctx.out('fatal: Exiting because of an unresolved conflict.', 'err');
      return;
    }
    if (!pos[0]) {
      const b = currentBranch(repo);
      if (b && repo.upstream[b]) pos[0] = repo.upstream[b];
      else { ctx.out('fatal: No remote for the current branch.', 'err'); return; }
    }
    if (!this.needCommits()) return;
    const theirs = this.resolve(pos[0]);
    if (!theirs) return;
    this.doMerge(theirs, pos[0], { noff: flags['no-ff'], ffOnly: flags['ff-only'], squash: flags.squash, message: flags.m && flags.m.join('\n\n') });
  }

  doMerge(theirs, label, { noff, ffOnly, squash, message, via } = {}) {
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const ours = this.head;
    if (w.isAncestor(theirs, ours)) {
      ctx.out('Already up to date.');
      ctx.ev('merge', { kind: 'uptodate', theirs, via });
      return 'uptodate';
    }
    const cur = currentBranch(repo) || 'HEAD';
    if (w.isAncestor(ours, theirs) && !noff && !squash) {
      if (!checkoutTree(w, this.dir, theirs, ctx, 'merge')) return 'blocked';
      ctx.out(`Updating ${short(ours)}..${short(theirs)}`);
      ctx.out('Fast-forward', 'ok');
      this.printStat(w.tree(ours), w.tree(theirs));
      repo.origHead = ours;
      setHeadTo(repo, theirs, `merge ${label}: Fast-forward`);
      ctx.hint('Fast-forward: ブランチを前に進めただけ');
      ctx.ev('merge', { kind: 'ff', theirs, via, branch: currentBranch(repo) });
      return 'ff';
    }
    if (ffOnly) {
      ctx.out('fatal: Not possible to fast-forward, aborting.', 'err');
      return 'blocked';
    }
    const base = w.mergeBase(ours, theirs);
    const res = mergeTrees(w.tree(base), w.tree(ours), w.tree(theirs), 'HEAD', label);
    // ローカルの変更が上書きされないか確認
    const s = computeStatus(w, this.dir);
    const touched = new Set();
    for (const p of new Set([...Object.keys(res.work), ...Object.keys(w.tree(ours))])) if (res.work[p] !== w.tree(ours)[p]) touched.add(p);
    const dirty = [...s.staged, ...s.unstaged].map((x) => x.path).filter((p) => touched.has(p));
    if (dirty.length) {
      ctx.out('error: Your local changes to the following files would be overwritten by merge:', 'err');
      dirty.forEach((p) => ctx.out('\t' + p, 'err'));
      ctx.out('Please commit your changes or stash them before you merge.', 'err');
      ctx.out('Aborting', 'err');
      ctx.hint('未コミットの変更あり → commit か git stash');
      return 'blocked';
    }
    const blockedUntracked = s.untracked.map((x) => x.path).filter((p) => res.work[p] !== undefined && res.work[p] !== this.dir.files[p]);
    if (blockedUntracked.length) {
      ctx.out('error: The following untracked working tree files would be overwritten by merge:', 'err');
      blockedUntracked.forEach((p) => ctx.out('\t' + p, 'err'));
      ctx.out('Please move or remove them before you merge.', 'err');
      return 'blocked';
    }
    // 作業ツリーへ反映 (変化したパスだけ)
    applyResult(this.dir, repo, res, touched);
    repo.origHead = ours;
    const msg = message || (repo.remoteRefs[label] !== undefined ? `Merge remote-tracking branch '${label}'` : `Merge branch '${label}'`) + (cur !== 'main' && cur !== 'HEAD' ? ` into ${cur}` : '');
    if (squash) {
      ctx.out('Squash commit -- not updating HEAD');
      if (res.conflicts.length) {
        repo.conflicts = res.conflicts;
        res.conflicts.forEach((c) => ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err'));
      }
      ctx.hint('続けて git commit -m "..."');
      ctx.ev('merge', { kind: 'squash', theirs, via });
      return 'squash';
    }
    if (res.conflicts.length) {
      repo.conflicts = res.conflicts;
      repo.op = { type: 'merge', theirs, message: msg, label };
      for (const c of res.conflicts) {
        if (c.kind === 'both modified' || c.kind === 'both added') {
          ctx.out(`Auto-merging ${c.path}`);
          ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err');
        } else ctx.out(`CONFLICT (modify/delete): ${c.path} ${c.kind}.`, 'err');
      }
      ctx.out('Automatic merge failed; fix conflicts and then commit the result.', 'err');
      ctx.hint('競合！ edit ' + res.conflicts[0].path + ' で直して git add → git commit');
      ctx.ev('conflict', { kind: 'merge', paths: res.conflicts.map((c) => c.path), via });
      ctx.ev('merge', { kind: 'conflict', theirs, via });
      return 'conflict';
    }
    const id = w.makeCommit({ parents: [ours, theirs], tree: repo.index, message: msg, author: w.user.name });
    setHeadTo(repo, id, `merge ${label}: Merge made by the 'ort' strategy.`);
    ctx.out("Merge made by the 'ort' strategy.", 'ok');
    this.printStat(w.tree(ours), repo.index);
    ctx.hint('マージコミットができました');
    ctx.ev('merge', { kind: 'merge', theirs, id, via, branch: currentBranch(repo) });
    ctx.ev('commit', { id, branch: currentBranch(repo), merge: true });
    return 'merge';
  }

  printStat(a, b) {
    for (const p of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[p] === b[p]) continue;
      const d = diffLines(a[p], b[p]);
      const add = d.filter((x) => x.type === 'add').length, del = d.filter((x) => x.type === 'del').length;
      this.ctx.out([[` ${p} | ${add + del} `, ''], ['+'.repeat(Math.min(add, 30)), 'add'], ['-'.repeat(Math.min(del, 30)), 'del']]);
    }
  }

  // ---- cherry-pick / revert ----
  applyCommit(cid, type) {
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const c = w.objects[cid];
    let parent = c.parents[0];
    if (c.parents.length > 1 && type === 'revert') parent = c.parents[0];
    let base, theirs, message;
    if (type === 'revert') {
      base = w.tree(cid); theirs = w.tree(parent);
      message = `Revert "${firstLine(c.message)}"\n\nThis reverts commit ${c.id.slice(0, 7)}.`;
    } else {
      base = w.tree(parent); theirs = w.tree(cid);
      message = c.message;
    }
    const ours = w.tree(this.head);
    const res = mergeTrees(base, ours, theirs, 'HEAD', `${short(cid)} (${firstLine(c.message)})`);
    const s = computeStatus(w, this.dir);
    const touched = new Set();
    for (const p of new Set([...Object.keys(res.work), ...Object.keys(ours)])) if (res.work[p] !== ours[p]) touched.add(p);
    const dirty = [...s.staged, ...s.unstaged].map((x) => x.path).filter((p) => touched.has(p));
    if (dirty.length) {
      ctx.out(`error: your local changes would be overwritten by ${type}.`, 'err');
      ctx.out('hint: commit your changes or stash them to proceed.', 'err');
      return 'blocked';
    }
    applyResult(this.dir, repo, res, touched);
    if (res.conflicts.length) {
      repo.conflicts = res.conflicts;
      return { conflict: true, message, res };
    }
    if (JSON.stringify(sortObj(repo.index)) === JSON.stringify(sortObj(ours))) {
      return { empty: true, message };
    }
    const id = w.makeCommit({ parents: [this.head], tree: repo.index, message, author: type === 'revert' ? w.user.name : c.author });
    return { id, message };
  }

  cherryPick(args) {
    const { flags, pos } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx;
    if (flags.abort) {
      if (!repo.op || repo.op.type !== 'cherry-pick') { ctx.out('error: no cherry-pick or revert in progress', 'err'); return; }
      hardReset(this.w, this.dir, this.head); repo.op = null;
      ctx.out('cherry-pick を中止しました。', 'ok');
      return;
    }
    if (flags.continue) {
      if (!repo.op || repo.op.type !== 'cherry-pick') { ctx.out('error: no cherry-pick or revert in progress', 'err'); return; }
      return this.commit([]);
    }
    if (this.blockedByOp()) return;
    if (!pos.length) { ctx.out('usage: git cherry-pick <commit>...', 'err'); return; }
    if (!this.needCommits()) return;
    for (const spec of pos) {
      const cid = this.resolve(spec);
      if (!cid) return;
      const r = this.applyCommit(cid, 'cherry-pick');
      if (r === 'blocked') return;
      if (r.conflict) {
        repo.op = { type: 'cherry-pick', commit: cid, message: r.message };
        ctx.out(`error: could not apply ${short(cid)}... ${firstLine(r.message)}`, 'err');
        r.res.conflicts.forEach((c) => ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err'));
        ctx.out('hint: After resolving the conflicts, mark them with "git add <pathspec>" and run "git cherry-pick --continue".', 'err');
        ctx.ev('conflict', { kind: 'cherry-pick', paths: r.res.conflicts.map((c) => c.path) });
        return;
      }
      if (r.empty) { ctx.out('The previous cherry-pick is now empty, possibly due to conflict resolution.', 'warn'); continue; }
      setHeadTo(repo, r.id, `cherry-pick: ${firstLine(r.message)}`);
      this.printCommitSummary(r.id, r.message);
      ctx.ev('cherry-pick', { id: r.id, commit: cid });
      ctx.ev('commit', { id: r.id, branch: currentBranch(repo) });
    }
  }

  revert(args) {
    const { flags, pos } = parseArgs(args, ['m']);
    const repo = this.repo, ctx = this.ctx;
    if (flags.abort) {
      if (!repo.op || repo.op.type !== 'revert') { ctx.out('error: no cherry-pick or revert in progress', 'err'); return; }
      hardReset(this.w, this.dir, this.head); repo.op = null;
      ctx.out('revert を中止しました。', 'ok');
      return;
    }
    if (flags.continue) {
      if (!repo.op || repo.op.type !== 'revert') { ctx.out('error: no cherry-pick or revert in progress', 'err'); return; }
      return this.commit([]);
    }
    if (this.blockedByOp()) return;
    if (!pos.length) { ctx.out('usage: git revert <commit>...', 'err'); return; }
    for (const spec of pos) {
      const cid = this.resolve(spec);
      if (!cid) return;
      if (this.w.objects[cid].parents.length > 1 && !flags.m) {
        ctx.out(`error: commit ${short(cid)} is a merge but no -m option was given.`, 'err');
        ctx.hint('git revert -m 1 <ID> を使おう');
        return;
      }
      const r = this.applyCommit(cid, 'revert');
      if (r === 'blocked') return;
      if (r.conflict) {
        repo.op = { type: 'revert', commit: cid, message: r.message };
        ctx.out(`error: could not revert ${short(cid)}... ${firstLine(this.w.objects[cid].message)}`, 'err');
        r.res.conflicts.forEach((c) => ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err'));
        ctx.out('hint: After resolving the conflicts, mark them with "git add <pathspec>" and run "git revert --continue".', 'err');
        ctx.ev('conflict', { kind: 'revert', paths: r.res.conflicts.map((c) => c.path) });
        return;
      }
      if (r.empty) { ctx.out('nothing to commit (変更はすでに打ち消されています)', 'warn'); continue; }
      setHeadTo(repo, r.id, `revert: ${firstLine(r.message)}`);
      this.printCommitSummary(r.id, r.message);
      ctx.hint('打ち消しコミットを作りました');
      ctx.ev('revert', { id: r.id, commit: cid });
      ctx.ev('commit', { id: r.id, branch: currentBranch(repo) });
    }
  }

  // ---- rebase ----
  rebase(args) {
    const { flags, pos } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (flags.i || flags.interactive) {
      ctx.out('このシミュレーターでは対話的リベース (-i) は省略しています。', 'warn');
      return;
    }
    if (flags.abort) {
      if (!repo.op || repo.op.type !== 'rebase') { ctx.out('fatal: No rebase in progress?', 'err'); return; }
      const op = repo.op;
      repo.op = null;
      repo.branches[op.branch] = op.origHead;
      repo.head = { type: 'branch', name: op.branch };
      hardReset(w, this.dir, op.origHead);
      reflog(repo, op.origHead, 'rebase (abort): returning to refs/heads/' + op.branch);
      ctx.out('リベースを中止して元の状態に戻しました。', 'ok');
      ctx.ev('rebase-abort');
      return;
    }
    if (flags.continue || flags.skip) {
      if (!repo.op || repo.op.type !== 'rebase') { ctx.out('fatal: No rebase in progress?', 'err'); return; }
      if (flags.skip) {
        hardReset(w, this.dir, this.head);
      } else {
        if (repo.conflicts.length) {
          ctx.out('error: 競合が残っています。ファイルを直して git add してください。', 'err');
          repo.conflicts.forEach((c) => ctx.out('\t' + c.path, 'err'));
          return;
        }
        const cur = repo.op.current;
        if (JSON.stringify(sortObj(repo.index)) !== JSON.stringify(sortObj(w.tree(this.head)))) {
          const c = w.objects[cur];
          const id = w.makeCommit({ parents: [this.head], tree: repo.index, message: c.message, author: c.author });
          repo.head = { type: 'detached', id };
          reflog(repo, id, 'rebase (continue): ' + firstLine(c.message));
        }
      }
      return this.continueRebase();
    }
    if (this.blockedByOp()) return;
    let upSpec = pos[0];
    const b = currentBranch(repo);
    if (!upSpec) {
      if (b && repo.upstream[b]) upSpec = repo.upstream[b];
      else { ctx.out('fatal: There is no tracking information for the current branch.', 'err'); return; }
    }
    if (!this.needCommits()) return;
    if (!b) { ctx.out('fatal: このシミュレーターではブランチ上でリベースしてください。', 'err'); return; }
    const onto = this.resolve(upSpec);
    if (!onto) return;
    if (isDirty(w, this.dir)) {
      ctx.out('error: cannot rebase: You have unstaged changes.', 'err');
      ctx.out('error: Please commit or stash them.', 'err');
      return;
    }
    const ours = this.head;
    if (w.isAncestor(onto, ours)) {
      ctx.out(`Current branch ${b} is up to date.`);
      ctx.ev('rebase', { done: true, noop: true });
      return;
    }
    if (w.isAncestor(ours, onto)) {
      checkoutTree(w, this.dir, onto, ctx);
      repo.origHead = ours;
      setHeadTo(repo, onto, 'rebase: fast-forward');
      ctx.out(`Successfully rebased and updated refs/heads/${b}.`, 'ok');
      ctx.ev('rebase', { done: true, onto, branch: b });
      return;
    }
    const todo = w.onlyIn(ours, onto).filter((c) => w.objects[c].parents.length === 1);
    repo.origHead = ours;
    checkoutTree(w, this.dir, onto, ctx);
    repo.op = { type: 'rebase', onto, todo, branch: b, origHead: ours, current: null, ontoLabel: upSpec };
    repo.head = { type: 'detached', id: onto };
    reflog(repo, onto, `rebase (start): checkout ${upSpec}`);
    this.continueRebase();
  }

  continueRebase() {
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const op = repo.op;
    while (op.todo.length) {
      const cid = op.todo.shift();
      op.current = cid;
      const r = this.applyCommit(cid, 'cherry-pick');
      if (r === 'blocked') { op.todo.unshift(cid); return; }
      if (r.conflict) {
        ctx.out(`Auto-merging ${r.res.conflicts.map((c) => c.path).join(', ')}`);
        r.res.conflicts.forEach((c) => ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err'));
        ctx.out(`error: could not apply ${short(cid)}... ${firstLine(w.objects[cid].message)}`, 'err');
        ctx.out('hint: Resolve all conflicts manually, mark them as resolved with', 'err');
        ctx.out('hint: "git add/rm <conflicted_files>", then run "git rebase --continue".', 'err');
        ctx.out('hint: To abort and get back to the state before "git rebase", run "git rebase --abort".', 'err');
        ctx.ev('conflict', { kind: 'rebase', paths: r.res.conflicts.map((c) => c.path) });
        return;
      }
      if (r.empty) continue;
      repo.head = { type: 'detached', id: r.id };
      reflog(repo, r.id, 'rebase (pick): ' + firstLine(r.message));
    }
    repo.branches[op.branch] = this.head;
    repo.head = { type: 'branch', name: op.branch };
    repo.op = null;
    reflog(repo, this.head, `rebase (finish): returning to refs/heads/${op.branch}`);
    ctx.out(`Successfully rebased and updated refs/heads/${op.branch}.`, 'ok');
    ctx.hint('履歴が一直線になりました');
    ctx.ev('rebase', { done: true, onto: op.onto, branch: op.branch });
  }

  // ---- stash ----
  stash(args) {
    const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'push';
    const rest = sub === args[0] ? args.slice(1) : args;
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const { flags, pos } = parseArgs(rest, ['m']);
    const idxOf = (spec) => {
      if (!spec) return 0;
      const m = spec.match(/^(?:stash@\{)?(\d+)\}?$/);
      return m ? Number(m[1]) : -1;
    };
    if (sub === 'push' || sub === 'save') {
      if (!this.needCommits()) return;
      if (this.blockedByOp()) return;
      const s = computeStatus(w, this.dir);
      const includeUntracked = flags.u || flags['include-untracked'];
      if (!s.staged.length && !s.unstaged.length && !(includeUntracked && s.untracked.length)) {
        ctx.out('No local changes to save');
        if (s.untracked.length) ctx.hint('新規ファイルも含めるなら git stash -u');
        return;
      }
      const work = {};
      const tracked = new Set([...Object.keys(repo.index), ...Object.keys(w.tree(this.head))]);
      for (const p of tracked) work[p] = this.dir.files[p];
      if (includeUntracked) s.untracked.forEach((u) => (work[u.path] = this.dir.files[u.path]));
      const b = currentBranch(repo) || '(no branch)';
      const msg = flags.m ? `On ${b}: ${flags.m.join(' ')}` : `WIP on ${b}: ${short(this.head)} ${firstLine(w.objects[this.head].message)}`;
      repo.stash.unshift({ base: this.head, index: { ...repo.index }, work, message: msg, untracked: includeUntracked ? s.untracked.map((u) => u.path) : [] });
      if (includeUntracked) s.untracked.forEach((u) => delete this.dir.files[u.path]);
      hardReset(w, this.dir, this.head);
      ctx.out(`Saved working directory and index state ${msg}`, 'ok');
      ctx.hint('戻すときは git stash pop');
      ctx.ev('stash', { action: 'push' });
      return;
    }
    if (sub === 'list') {
      repo.stash.forEach((st, i) => ctx.out([[`stash@{${i}}`, 'warn'], [': ' + st.message, '']]));
      ctx.ev('stash', { action: 'list' });
      return;
    }
    if (sub === 'clear') { repo.stash = []; ctx.ev('stash', { action: 'clear' }); return; }
    const i = idxOf(pos[0]);
    if (i < 0 || !repo.stash[i]) {
      ctx.out(repo.stash.length ? `error: stash@{${pos[0]}} is not a valid reference` : 'No stash entries found.', 'err');
      return;
    }
    const st = repo.stash[i];
    if (sub === 'drop') {
      repo.stash.splice(i, 1);
      ctx.out(`Dropped stash@{${i}}`);
      ctx.ev('stash', { action: 'drop' });
      return;
    }
    if (sub === 'show') {
      const base = w.tree(st.base);
      const after = {};
      for (const [p, v] of Object.entries(st.work)) if (v !== undefined) after[p] = v;
      printTreeDiff(ctx, base, after);
      return;
    }
    if (sub === 'pop' || sub === 'apply') {
      if (this.blockedByOp()) return;
      const base = w.tree(st.base);
      const cur = w.tree(this.head);
      const s = computeStatus(w, this.dir);
      const dirtyPaths = new Set([...s.staged, ...s.unstaged].map((x) => x.path));
      const paths = Object.keys(st.work).filter((p) => st.work[p] !== base[p]);
      const blocked = paths.filter((p) => dirtyPaths.has(p) || (st.untracked.includes(p) && this.dir.files[p] !== undefined));
      if (blocked.length) {
        ctx.out('error: Your local changes to the following files would be overwritten by merge:', 'err');
        blocked.forEach((p) => ctx.out('\t' + p, 'err'));
        ctx.out('Please commit your changes or stash them before you merge.', 'err');
        ctx.out('Aborting', 'err');
        return;
      }
      const conflicts = [];
      for (const p of paths) {
        const theirs = st.work[p];
        const r = mergeTrees({ [p]: base[p] }, { [p]: cur[p] }, { [p]: theirs }, 'Updated upstream', 'Stashed changes');
        if (r.conflicts.length) conflicts.push(...r.conflicts);
        if (r.work[p] === undefined) { delete this.dir.files[p]; if (st.index[p] === undefined && !r.conflicts.length) delete repo.index[p]; }
        else this.dir.files[p] = r.work[p];
        if (!r.conflicts.length && st.index[p] !== base[p] && st.index[p] === theirs && !st.untracked.includes(p)) {
          // ステージされていた変更 (新規ファイルの追加など) は復元する
          if (base[p] === undefined) repo.index[p] = r.work[p];
        }
      }
      if (conflicts.length) {
        repo.conflicts = conflicts;
        conflicts.forEach((c) => ctx.out(`CONFLICT (content): Merge conflict in ${c.path}`, 'err'));
        ctx.out('The stash entry is kept in case you need it again.', 'warn');
        ctx.ev('conflict', { kind: 'stash', paths: conflicts.map((c) => c.path) });
        return;
      }
      this.status([]);
      if (sub === 'pop') {
        repo.stash.splice(i, 1);
        ctx.out(`Dropped refs/stash@{${i}}`, 'dim');
      }
      ctx.ev('stash', { action: sub });
      return;
    }
    ctx.out(`error: unknown subcommand: ${sub}`, 'err');
  }

  // ---- tag ----
  tag(args) {
    const { flags, pos } = parseArgs(args, ['m']);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (flags.d) {
      for (const t of pos) {
        if (!repo.tags[t]) { ctx.out(`error: tag '${t}' not found.`, 'err'); continue; }
        ctx.out(`Deleted tag '${t}' (was ${short(repo.tags[t])})`);
        delete repo.tags[t];
      }
      return;
    }
    if (!pos.length || flags.l) {
      Object.keys(repo.tags).sort().forEach((t) => ctx.out(t, 'warn'));
      return;
    }
    const name = pos[0];
    if (repo.tags[name] && !flags.f) { ctx.out(`fatal: tag '${name}' already exists`, 'err'); return; }
    if (!pos[1] && !this.needCommits()) return;
    const id = this.resolve(pos[1] || 'HEAD');
    if (!id) return;
    repo.tags[name] = id;
    if (flags.a || flags.m) w.annotated[name] = { tagger: w.user.name, message: flags.m ? flags.m.join('\n') : name };
    ctx.ev('tag', { name, id });
    ctx.hint(`送るなら git push origin ${name}`);
  }

  // ---- remote ----
  remote(args) {
    const sub = args[0];
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (!sub || sub === '-v' || sub === '--verbose') {
      for (const [n, url] of Object.entries(repo.remotes)) {
        if (sub) { ctx.out(`${n}\t${url} (fetch)`); ctx.out(`${n}\t${url} (push)`); }
        else ctx.out(n);
      }
      if (!Object.keys(repo.remotes).length && sub) ctx.hint('登録: git remote add origin <URL>');
      return;
    }
    if (sub === 'add') {
      const [, name, url] = args;
      if (!name || !url) { ctx.out('usage: git remote add <name> <url>', 'err'); return; }
      if (repo.remotes[name]) { ctx.out(`error: remote ${name} already exists.`, 'err'); return; }
      if (!/^(https:\/\/|git@)/.test(url)) {
        ctx.out(`fatal: '${url}' does not appear to be a git repository`, 'err');
        return;
      }
      const norm = normalizeUrl(url);
      if (!w.remotes[norm]) w.createRemote(norm, 'you');
      repo.remotes[name] = norm;
      ctx.ev('remote-add', { name, url: norm });
      return;
    }
    if (sub === 'remove' || sub === 'rm') {
      const name = args[1];
      if (!repo.remotes[name]) { ctx.out(`error: No such remote: '${name}'`, 'err'); return; }
      delete repo.remotes[name];
      for (const r of Object.keys(repo.remoteRefs)) if (r.startsWith(name + '/')) delete repo.remoteRefs[r];
      for (const [b, u] of Object.entries(repo.upstream)) if (u.startsWith(name + '/')) delete repo.upstream[b];
      return;
    }
    if (sub === 'set-url') {
      const [, name, url] = args;
      if (!repo.remotes[name]) { ctx.out(`error: No such remote '${name}'`, 'err'); return; }
      const norm = normalizeUrl(url);
      if (!w.remotes[norm]) w.createRemote(norm, 'you');
      repo.remotes[name] = norm;
      return;
    }
    if (sub === 'show') {
      const name = args[1] || 'origin';
      const url = repo.remotes[name];
      if (!url) { ctx.out(`fatal: '${name}' does not appear to be a git repository`, 'err'); return; }
      const r = w.remotes[url];
      ctx.out(`* remote ${name}`);
      ctx.out(`  Fetch URL: ${url}`);
      ctx.out(`  Push  URL: ${url}`);
      ctx.out(`  HEAD branch: ${r.defaultBranch}`);
      ctx.out('  Remote branches:');
      Object.keys(r.branches).forEach((b) => ctx.out(`    ${b} ${repo.remoteRefs[name + '/' + b] ? 'tracked' : 'new (next fetch will store in remotes/' + name + ')'}`));
      return;
    }
    ctx.out(`error: Unknown subcommand: ${sub}`, 'err');
  }

  getRemote(name) {
    const url = this.repo.remotes[name];
    if (!url) {
      this.ctx.out(`fatal: '${name}' does not appear to be a git repository`, 'err');
      this.ctx.out('fatal: Could not read from remote repository.', 'err');
      if (!Object.keys(this.repo.remotes).length) this.ctx.hint('登録: git remote add origin <URL>');
      return null;
    }
    return this.w.remotes[url];
  }

  // ---- fetch ----
  fetch(args) {
    const { flags, pos } = parseArgs(args);
    const names = flags.all ? Object.keys(this.repo.remotes) : [pos[0] || this.defaultRemote()];
    if (!names[0]) {
      this.ctx.out('fatal: No remote repository specified.', 'err');
      this.ctx.hint('登録: git remote add origin <URL>');
      return false;
    }
    for (const n of names) if (this.doFetch(n, { prune: flags.prune || flags.p }) === false) return false;
    this.ctx.ev('fetch');
    return true;
  }

  defaultRemote() {
    const b = currentBranch(this.repo);
    if (b && this.repo.upstream[b]) return this.repo.upstream[b].split('/')[0];
    return Object.keys(this.repo.remotes)[0];
  }

  doFetch(name, { prune, quiet } = {}) {
    const remote = this.getRemote(name);
    if (!remote) return false;
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const lines = [];
    for (const [b, id] of Object.entries(remote.branches)) {
      const key = `${name}/${b}`;
      const old = repo.remoteRefs[key];
      if (old === id) continue;
      if (!old) lines.push([` * [new branch]      ${b} -> ${key}`, 'ok']);
      else if (w.isAncestor(old, id)) lines.push([`   ${short(old)}..${short(id)}  ${b} -> ${key}`, '']);
      else lines.push([` + ${short(old)}...${short(id)} ${b} -> ${key}  (forced update)`, 'warn']);
      repo.remoteRefs[key] = id;
    }
    for (const [t, id] of Object.entries(remote.tags)) {
      if (repo.tags[t] === id) continue;
      if (!repo.tags[t]) { lines.push([` * [new tag]         ${t} -> ${t}`, 'ok']); repo.tags[t] = id; }
    }
    if (prune) {
      for (const key of Object.keys(repo.remoteRefs)) {
        if (!key.startsWith(name + '/')) continue;
        const b = key.slice(name.length + 1);
        if (!remote.branches[b]) { lines.push([` - [deleted]         (none) -> ${key}`, 'warn']); delete repo.remoteRefs[key]; }
      }
    }
    if (lines.length && !quiet) {
      ctx.out(`From ${remote.url}`, 'dim');
      lines.forEach(([t, c]) => ctx.out(t, c));
    }
    return lines.length;
  }

  // ---- pull ----
  pull(args) {
    const { flags, pos } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    if (this.blockedByOp()) return;
    const b = currentBranch(repo);
    let remoteName = pos[0], branch = pos[1];
    if (!remoteName) {
      if (!b || !repo.upstream[b]) {
        if (!Object.keys(repo.remotes).length) {
          ctx.out('fatal: No remote repository specified.', 'err');
          ctx.hint('登録: git remote add origin <URL>');
          return;
        }
        ctx.out('There is no tracking information for the current branch.', 'err');
        ctx.out('Please specify which branch you want to merge with.', 'err');
        ctx.out('', 'err');
        ctx.out(`    git pull <remote> <branch>`, 'err');
        ctx.out('', 'err');
        ctx.out('If you wish to set tracking information for this branch you can do so with:', 'err');
        ctx.out(`    git branch --set-upstream-to=origin/${b} ${b}`, 'err');
        return;
      }
      [remoteName, ...branch] = repo.upstream[b].split('/');
      branch = branch.join('/');
    }
    if (!branch) {
      if (b && repo.upstream[b] && repo.upstream[b].startsWith(remoteName + '/')) branch = repo.upstream[b].slice(remoteName.length + 1);
      else branch = b;
    }
    const remote = this.getRemote(remoteName);
    if (!remote) return;
    this.doFetch(remoteName, {});
    const key = `${remoteName}/${branch}`;
    const theirs = repo.remoteRefs[key];
    if (!theirs) { ctx.out(`fatal: couldn't find remote ref ${branch}`, 'err'); return; }
    ctx.ev('fetch');
    if (!this.head) {
      // 空のブランチに pull
      checkoutTree(w, this.dir, theirs, ctx);
      setHeadTo(repo, theirs, 'pull: initial');
      ctx.ev('pull', { result: 'ff' });
      return;
    }
    const useRebase = flags.rebase || flags.r;
    if (useRebase) {
      if (w.isAncestor(theirs, this.head)) { ctx.out('Current branch is up to date.'); ctx.ev('pull', { result: 'uptodate' }); return; }
      this.rebase([key]);
      ctx.ev('pull', { result: repo.op ? 'conflict' : 'rebase' });
      return;
    }
    if (flags['ff-only'] && !w.isAncestor(this.head, theirs) && !w.isAncestor(theirs, this.head)) {
      ctx.out('fatal: Not possible to fast-forward, aborting.', 'err');
      return;
    }
    const r = this.doMerge(theirs, key, { via: 'pull' });
    ctx.ev('pull', { result: r });
  }

  // ---- push ----
  push(args) {
    const { flags, pos } = parseArgs(args);
    const repo = this.repo, ctx = this.ctx, w = this.w;
    const setUp = flags.u || flags['set-upstream'];
    const force = flags.f || flags.force || flags['force-with-lease'];
    const b = currentBranch(repo);
    let remoteName = pos[0];
    let specs = pos.slice(1);
    if (!remoteName) {
      if (!Object.keys(repo.remotes).length) {
        ctx.out('fatal: No configured push destination.', 'err');
        ctx.out('Either specify the URL from the command-line or configure a remote repository using', 'err');
        ctx.out('    git remote add <name> <url>', 'err');
        ctx.hint('登録: git remote add origin <URL>');
        return;
      }
      if (b && repo.upstream[b]) {
        const [rn, ...rb] = repo.upstream[b].split('/');
        remoteName = rn;
        specs = [`${b}:${rb.join('/')}`];
      } else if (!flags.tags && !flags.all) {
        ctx.out(`fatal: The current branch ${b} has no upstream branch.`, 'err');
        ctx.out('To push the current branch and set the remote as upstream, use', 'err');
        ctx.out('', 'err');
        ctx.out(`    git push --set-upstream origin ${b}`, 'err');
        ctx.out('', 'err');
        ctx.hint(`初回は git push -u origin ${b}`);
        return;
      } else remoteName = this.defaultRemote();
    }
    const remote = this.getRemote(remoteName);
    if (!remote) return;
    if (flags.delete || flags.d) {
      ctx.out(`To ${remote.url}`, 'dim');
      for (const s of specs) {
        if (!remote.branches[s]) { ctx.out(`error: unable to delete '${s}': remote ref does not exist`, 'err'); continue; }
        delete remote.branches[s];
        delete repo.remoteRefs[`${remoteName}/${s}`];
        ctx.out(` - [deleted]         ${s}`, 'warn');
        ctx.ev('push-delete', { branch: s });
      }
      return;
    }
    if (!specs.length && flags.tags) specs = [];
    else if (!specs.length && flags.all) specs = Object.keys(repo.branches);
    else if (!specs.length) {
      if (!b) { ctx.out('fatal: You are not currently on a branch.', 'err'); return; }
      specs = [b];
    }
    if (flags.tags) specs.push(...Object.keys(repo.tags).filter((t) => remote.tags[t] !== repo.tags[t]).map((t) => 'tag:' + t));
    const lines = [];
    let rejected = false, anyOk = false;
    for (let spec of specs) {
      if (spec.startsWith('tag:') || (repo.tags[spec] && repo.branches[spec] === undefined)) {
        const t = spec.replace(/^tag:/, '');
        if (remote.tags[t] === repo.tags[t]) continue;
        remote.tags[t] = repo.tags[t];
        lines.push([` * [new tag]         ${t} -> ${t}`, 'ok']);
        ctx.ev('push-tag', { tag: t });
        anyOk = true;
        continue;
      }
      let [src, dst] = spec.split(':');
      if (spec.startsWith(':')) {
        dst = spec.slice(1);
        if (remote.branches[dst]) { delete remote.branches[dst]; delete repo.remoteRefs[`${remoteName}/${dst}`]; lines.push([` - [deleted]         ${dst}`, 'warn']); ctx.ev('push-delete', { branch: dst }); }
        continue;
      }
      dst = dst || src;
      if (src === 'HEAD') src = b;
      const local = resolveRef(w, repo, src);
      if (!local) {
        ctx.out(`error: src refspec ${src} does not match any`, 'err');
        ctx.out(`error: failed to push some refs to '${remote.url}'`, 'err');
        if (!this.head) ctx.hint('先に commit しよう');
        return;
      }
      const old = remote.branches[dst];
      const key = `${remoteName}/${dst}`;
      if (old === local) {
        if (setUp && repo.branches[src] !== undefined) repo.upstream[src] = key;
        repo.remoteRefs[key] = local;
        lines.push(['Everything up-to-date', '']);
        continue;
      }
      if (!old) {
        lines.push([` * [new branch]      ${src} -> ${dst}`, 'ok']);
      } else if (w.isAncestor(old, local)) {
        lines.push([`   ${short(old)}..${short(local)}  ${src} -> ${dst}`, '']);
      } else if (force) {
        lines.push([` + ${short(old)}...${short(local)} ${src} -> ${dst} (forced update)`, 'warn']);
        ctx.ev('force-push', { branch: dst, lost: w.onlyIn(old, local).length });
      } else {
        const fetchFirst = repo.remoteRefs[key] !== old;
        lines.push([` ! [rejected]        ${src} -> ${dst} (${fetchFirst ? 'fetch first' : 'non-fast-forward'})`, 'err']);
        rejected = true;
        continue;
      }
      remote.branches[dst] = local;
      repo.remoteRefs[key] = local;
      if (setUp && repo.branches[src] !== undefined) repo.upstream[src] = key;
      anyOk = true;
      ctx.ev('push', { branch: dst, src, id: local, remote: remoteName });
    }
    const n = anyOk ? 3 + Math.floor(w.rand() * 5) : 0;
    if (anyOk) {
      ctx.out(`Enumerating objects: ${n}, done.`, 'dim');
      ctx.out(`Writing objects: 100% (${n}/${n}), done.`, 'dim');
    }
    if (lines.some(([t]) => t !== 'Everything up-to-date')) ctx.out(`To ${remote.url}`, 'dim');
    lines.forEach(([t, c]) => ctx.out(t, c));
    if (setUp && anyOk) specs.filter((s) => repo.branches[s.split(':')[0]] !== undefined).forEach((s) => ctx.out(`branch '${s.split(':')[0]}' set up to track '${remoteName}/${s.split(':')[1] || s.split(':')[0]}'.`));
    if (rejected) {
      ctx.out(`error: failed to push some refs to '${remote.url}'`, 'err');
      ctx.out('hint: Updates were rejected because the remote contains work that you do not', 'err');
      ctx.out('hint: have locally. This is usually caused by another repository pushing to', 'err');
      ctx.out('hint: the same ref. If you want to integrate the remote changes, use', 'err');
      ctx.out("hint: 'git pull' before pushing again.", 'err');
      ctx.hint('先に push した人がいます → git pull してから push');
      ctx.ev('push-rejected', {});
    }
  }
}

function applyResult(dir, repo, res, touched) {
  for (const p of touched) {
    if (res.work[p] === undefined) delete dir.files[p]; else dir.files[p] = res.work[p];
    if (res.tree[p] === undefined) delete repo.index[p]; else repo.index[p] = res.tree[p];
  }
  for (const c of res.conflicts) if (c.kind === 'deleted by us') delete repo.index[c.path];
}

function workTracked(dir, repo, extra) {
  const r = {};
  for (const p of new Set([...Object.keys(repo.index), ...Object.keys(extra)])) if (dir.files[p] !== undefined) r[p] = dir.files[p];
  return r;
}

function sortObj(o) {
  const r = {};
  Object.keys(o).sort().forEach((k) => (r[k] = o[k]));
  return r;
}

function validBranchName(n) {
  return !!n && !/[\s~^:?*\[\\]|\.\.|^-|\/$|\.$|@\{/.test(n) && n !== 'HEAD';
}

export function normalizeUrl(url) {
  let u = url.trim();
  const m = u.match(/^git@github\.com:(.+)$/);
  if (m) u = 'https://github.com/' + m[1];
  if (!u.endsWith('.git')) u += '.git';
  return u;
}

// GitHub の Pull Request をリモート上でマージする
export function mergeOnRemote(world, remote, baseBranch, headBranch, message, author) {
  const b = remote.branches[baseBranch], h = remote.branches[headBranch];
  if (!b || !h) return { ok: false, reason: 'missing' };
  if (world.isAncestor(h, b)) return { ok: false, reason: 'uptodate' };
  const base = world.mergeBase(b, h);
  const res = mergeTrees(world.tree(base), world.tree(b), world.tree(h), baseBranch, headBranch);
  if (res.conflicts.length) return { ok: false, reason: 'conflict', paths: res.conflicts.map((c) => c.path) };
  const id = world.makeCommit({ parents: [b, h], tree: res.tree, message, author });
  remote.branches[baseBranch] = id;
  return { ok: true, id };
}

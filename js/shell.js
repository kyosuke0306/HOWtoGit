// 疑似ターミナルのシェル部分
import { runGit, currentBranch, headId, mergeOnRemote, resolveRef, normalizeUrl } from './git.js';
import { hasConflictMarkers } from './diff.js';

// "..." や '...' を考慮して分割。&& ; > >> は演算子
export function tokenize(line) {
  const tokens = [];
  let cur = '', quote = null, has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { cur += line[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '“' || ch === '”') {
      quote = ch === '“' ? '”' : ch === '”' ? '”' : ch; has = true; continue;
    }
    if (/\s/.test(ch)) { if (cur || has) tokens.push({ t: cur }); cur = ''; has = false; continue; }
    if (ch === '&' && line[i + 1] === '&') { if (cur || has) tokens.push({ t: cur }); tokens.push({ op: '&&' }); cur = ''; has = false; i++; continue; }
    if (ch === ';') { if (cur || has) tokens.push({ t: cur }); tokens.push({ op: ';' }); cur = ''; has = false; continue; }
    if (ch === '>') {
      if (cur || has) tokens.push({ t: cur });
      if (line[i + 1] === '>') { tokens.push({ op: '>>' }); i++; } else tokens.push({ op: '>' });
      cur = ''; has = false; continue;
    }
    cur += ch;
  }
  if (quote) return { error: '閉じていない引用符があります' };
  if (cur || has) tokens.push({ t: cur });
  // コマンド単位に分割
  const cmds = [];
  let c = { args: [], redirect: null, sep: null };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.op === '&&' || tk.op === ';') { c.sep = tk.op; cmds.push(c); c = { args: [], redirect: null, sep: null }; continue; }
    if (tk.op === '>' || tk.op === '>>') {
      const target = tokens[i + 1];
      if (!target || target.op) return { error: 'リダイレクト先のファイル名がありません' };
      c.redirect = { mode: tk.op, file: target.t };
      i++;
      continue;
    }
    c.args.push(tk.t);
  }
  if (c.args.length) cmds.push(c);
  return { cmds };
}

function resolvePath(world, p) {
  if (!p || p === '~') return '~';
  let parts = p.startsWith('~') ? p.split('/') : (world.cwd + '/' + p).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length > 1) out.pop(); continue; }
    out.push(part);
  }
  return out.join('/') || '~';
}

const SHELL_CMDS = ['git', 'ls', 'cat', 'echo', 'touch', 'rm', 'mkdir', 'cd', 'pwd', 'clear', 'help', 'edit', 'nano', 'vim', 'vi', 'code', 'history', 'gh', 'hint', 'mission', 'whoami', 'mv', 'cp', 'tree', 'date'];

export class Shell {
  constructor(world, ui) {
    this.world = world;
    this.ui = ui; // { openEditor(path), clear(), showHint(), showMission() }
    this.history = [];
  }

  prompt() {
    const w = this.world;
    const repo = w.dir && w.dir.repo;
    let br = '';
    if (repo) {
      if (repo.op && repo.op.type === 'rebase') br = ` (${repo.op.branch}|REBASE)`;
      else if (repo.op && repo.op.type === 'merge') br = ` (${currentBranch(repo) || 'HEAD'}|MERGING)`;
      else if (repo.op) br = ` (${currentBranch(repo) || 'HEAD'}|${repo.op.type.toUpperCase()})`;
      else br = ` (${currentBranch(repo) || headId(repo)?.slice(0, 7)})`;
    }
    return { user: w.user.name === 'あなた' ? 'you' : w.user.name, path: w.cwd, branch: br };
  }

  run(line, ctx) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    const parsed = tokenize(trimmed);
    if (parsed.error) { ctx.out('bash: ' + parsed.error, 'err'); return; }
    let lastOk = true;
    for (const c of parsed.cmds) {
      if (!lastOk) break;
      const before = ctx.errorCount;
      if (c.redirect) {
        const captured = [];
        const sub = { ...ctx, out: (t) => captured.push(typeof t === 'string' ? t : t.map((s) => s[0]).join('')), hint: () => {} };
        this.exec(c.args, sub);
        const file = c.redirect.file;
        const dir = this.world.dir;
        const text = captured.join('\n') + (captured.length ? '\n' : '');
        if (c.redirect.mode === '>>') dir.files[file] = (dir.files[file] || '') + text;
        else dir.files[file] = text;
        ctx.ev('file-write', { path: file });
      } else this.exec(c.args, ctx);
      lastOk = c.sep !== '&&' || ctx.errorCount === before;
    }
  }

  exec(args, ctx) {
    const [cmd, ...rest] = args;
    const w = this.world;
    const dir = w.dir;
    switch (cmd) {
      case 'git': return runGit(w, rest, ctx);
      case 'gh': return this.gh(rest, ctx);
      case 'ls': {
        const all = rest.includes('-a') || rest.includes('-la') || rest.includes('-al');
        const names = [];
        if (all) { names.push(['.', 'info'], ['..', 'info']); if (dir.repo) names.push(['.git/', 'info']); }
        for (const p of Object.keys(w.dirs)) {
          if (p !== w.cwd && p.startsWith(w.cwd + '/') && !p.slice(w.cwd.length + 1).includes('/')) names.push([p.slice(w.cwd.length + 1) + '/', 'info']);
        }
        Object.keys(dir.files).sort().forEach((f) => { if (all || !f.startsWith('.')) names.push([f, '']); });
        if (names.length) ctx.out(names.flatMap(([n, c], i) => [[n, c], [i < names.length - 1 ? '  ' : '', '']]));
        return;
      }
      case 'tree': {
        Object.keys(dir.files).sort().forEach((f) => ctx.out('├── ' + f));
        return;
      }
      case 'cat': {
        if (!rest.length) { ctx.out('cat: ファイル名を指定してください', 'err'); return; }
        for (const f of rest) {
          if (dir.files[f] === undefined) { ctx.out(`cat: ${f}: No such file or directory`, 'err'); continue; }
          const lines = dir.files[f].replace(/\n$/, '').split('\n');
          ctx.ev('cat', { path: f });
          if (dir.files[f] === '') continue;
          lines.forEach((l) => {
            if (/^(<<<<<<<|=======|>>>>>>>)/.test(l)) ctx.out(l, 'conflict');
            else ctx.out(l);
          });
        }
        return;
      }
      case 'echo': {
        let a = rest;
        let interpret = false;
        if (a[0] === '-e') { interpret = true; a = a.slice(1); }
        let text = a.join(' ');
        if (interpret) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        text.split('\n').forEach((l) => ctx.out(l));
        return;
      }
      case 'touch': {
        if (!rest.length) { ctx.out('touch: missing file operand', 'err'); return; }
        rest.forEach((f) => { if (dir.files[f] === undefined) dir.files[f] = ''; });
        ctx.ev('file-write', { path: rest[0] });
        return;
      }
      case 'rm': {
        const recursive = rest.some((a) => /^-[a-z]*r/.test(a));
        const files = rest.filter((a) => !a.startsWith('-'));
        if (!files.length) { ctx.out('rm: missing operand', 'err'); return; }
        for (const f of files) {
          const dpath = resolvePath(w, f);
          if (w.dirs[dpath] && dpath !== '~') {
            if (!recursive) { ctx.out(`rm: cannot remove '${f}': Is a directory`, 'err'); continue; }
            if (w.cwd === dpath || w.cwd.startsWith(dpath + '/')) { ctx.out(`rm: 今いるフォルダは削除できません`, 'err'); continue; }
            Object.keys(w.dirs).forEach((p) => { if (p === dpath || p.startsWith(dpath + '/')) delete w.dirs[p]; });
            continue;
          }
          const hits = f.includes('*') ? Object.keys(dir.files).filter((p) => new RegExp('^' + f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(p)) : [f];
          for (const h of hits) {
            if (dir.files[h] === undefined) { ctx.out(`rm: cannot remove '${h}': No such file or directory`, 'err'); continue; }
            delete dir.files[h];
          }
        }
        ctx.ev('file-write', {});
        return;
      }
      case 'mv': case 'cp': {
        const [a, b] = rest;
        if (!a || !b) { ctx.out(`${cmd}: missing file operand`, 'err'); return; }
        if (dir.files[a] === undefined) { ctx.out(`${cmd}: cannot stat '${a}': No such file or directory`, 'err'); return; }
        dir.files[b] = dir.files[a];
        if (cmd === 'mv') delete dir.files[a];
        ctx.ev('file-write', { path: b });
        return;
      }
      case 'mkdir': {
        const names = rest.filter((a) => !a.startsWith('-'));
        if (!names.length) { ctx.out('mkdir: missing operand', 'err'); return; }
        for (const n of names) {
          if (dir.repo) {
            ctx.out('mkdir: (このシミュレーターではリポジトリ内のフォルダ作成は省略しています。ファイル名に src/app.js のようにパスを書けます)', 'warn');
            return;
          }
          const p = resolvePath(w, n);
          if (w.dirs[p]) { ctx.out(`mkdir: cannot create directory '${n}': File exists`, 'err'); continue; }
          w.dirs[p] = { files: {}, repo: null };
        }
        ctx.ev('mkdir', {});
        return;
      }
      case 'cd': {
        const p = resolvePath(w, rest[0] || '~');
        if (!w.dirs[p]) { ctx.out(`cd: ${rest[0]}: No such file or directory`, 'err'); return; }
        w.cwd = p;
        ctx.ev('cd', { path: p });
        return;
      }
      case 'pwd': ctx.out(w.cwd.replace(/^~/, '/home/you')); return;
      case 'whoami': ctx.out(w.user.name); return;
      case 'date': ctx.out(new Date().toString()); return;
      case 'clear': this.ui.clear(); return;
      case 'history': this.history.forEach((h, i) => ctx.out(`${String(i + 1).padStart(4)}  ${h}`)); return;
      case 'hint': this.ui.showHint(); return;
      case 'mission': this.ui.showMission(); return;
      case 'edit': case 'nano': case 'vim': case 'vi': case 'code': {
        const f = rest[0];
        if (!f) { ctx.out(`${cmd}: ファイル名を指定してください (例: ${cmd} README.md)`, 'err'); return; }
        this.ui.openEditor(f);
        ctx.out(`(エディタで ${f} を開きました)`, 'dim');
        return;
      }
      case 'help': return this.help(ctx);
      default:
        ctx.out(`bash: ${cmd}: command not found`, 'err');
        if (/^(add|commit|push|pull|merge|status|log|branch|checkout|switch|init|clone)$/.test(cmd)) ctx.hint(`git ${cmd} と打とう`);
    }
  }

  help(ctx) {
    ctx.out('使えるコマンド:', 'info');
    const rows = [
      ['git <サブコマンド>', 'Git の操作 (git help で一覧)'],
      ['ls / ls -a', 'ファイル一覧'],
      ['cat <file>', 'ファイルの中身を表示'],
      ['echo "文字" > file', 'ファイルに書き込み (>> で追記)'],
      ['touch <file>', '空のファイルを作成'],
      ['edit <file>', 'エディタで編集 (nano / vim / code でもOK)'],
      ['rm <file>', 'ファイルを削除'],
      ['mkdir <dir> / cd <dir>', 'フォルダ作成 / 移動 (cd .. で戻る)'],
      ['gh repo create <名前>', 'GitHub にリポジトリを作成'],
      ['gh pr create / list / merge', 'プルリクエストの操作'],
      ['hint', '今のミッションのヒント'],
      ['clear', '画面をクリア'],
    ];
    rows.forEach(([a, b]) => ctx.out([[a.padEnd(28), 'ok'], [b, '']]));
    ctx.out('');
    ctx.hint('↑↓で履歴、Tabで補完');
  }

  // ---- GitHub CLI (簡易) ----
  gh(args, ctx) {
    const w = this.world;
    const [sub, action, ...rest] = args;
    const flags = {};
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a.startsWith('--')) {
        const k = a.slice(2);
        if (['title', 'base', 'head', 'body', 'b', 't'].includes(k) && i + 1 < rest.length) flags[k] = rest[++i];
        else flags[k] = true;
      } else if (/^-[tbBH]$/.test(a) && i + 1 < rest.length) flags[{ t: 'title', b: 'body', B: 'base', H: 'head' }[a[1]]] = rest[++i];
      else if (a.startsWith('-')) flags[a.slice(1)] = true;
      else pos.push(a);
    }
    if (sub === 'repo' && action === 'create') {
      const name = pos[0];
      if (!name) { ctx.out('usage: gh repo create <name> [--public|--private]', 'err'); return; }
      const url = `https://github.com/${userSlug(w)}/${name}.git`;
      if (w.remotes[url]) { ctx.out(`GraphQL: Name already exists on this account (createRepository)`, 'err'); return; }
      w.createRemote(url, 'you');
      ctx.out(`✓ Created repository ${userSlug(w)}/${name} on GitHub`, 'ok');
      ctx.out(`  ${url}`, 'info');
      ctx.hint(`次は git remote add origin ${url}`);
      ctx.ev('gh-repo-create', { url });
      return;
    }
    if (sub === 'auth') { ctx.out('✓ Logged in to github.com as ' + userSlug(w), 'ok'); return; }
    if (sub !== 'pr') { ctx.out('使い方: gh repo create <名前> / gh pr create / gh pr list / gh pr merge <番号>', 'warn'); return; }
    const repo = w.repo;
    if (!repo) { ctx.out('failed to run git: fatal: not a git repository', 'err'); return; }
    const url = repo.remotes.origin;
    if (!url) { ctx.out('no git remotes found', 'err'); return; }
    const remote = w.remotes[url];
    if (action === 'create') {
      const head = flags.head || currentBranch(repo);
      const base = flags.base || remote.defaultBranch;
      if (head === base) { ctx.out(`could not create pull request: head branch "${head}" is the same as base branch`, 'err'); ctx.hint('作業ブランチから作ろう'); return; }
      if (!remote.branches[head]) {
        ctx.out(`aborted: you must first push the current branch to a remote, or use the --head flag`, 'err');
        ctx.hint(`先に git push -u origin ${head}`);
        return;
      }
      if (repo.branches[head] && remote.branches[head] !== repo.branches[head] && w.isAncestor(remote.branches[head], repo.branches[head])) {
        ctx.out(`Warning: ${w.onlyIn(repo.branches[head], remote.branches[head]).length} uncommitted change(s) not pushed`, 'warn');
      }
      if (remote.prs.some((p) => p.head === head && p.state === 'open')) { ctx.out(`a pull request for branch "${head}" into branch "${base}" already exists`, 'err'); return; }
      const number = ++w.prCounter;
      const title = flags.title || flags.t || firstMsg(w, remote.branches[head]);
      remote.prs.push({ number, title, head, base, state: 'open', author: w.user.name });
      ctx.out(`Creating pull request for ${head} into ${base} in ${remote.url.replace('https://github.com/', '').replace(/\.git$/, '')}`, 'dim');
      ctx.out('');
      ctx.out(`${remote.url.replace(/\.git$/, '')}/pull/${number}`, 'info');
      const reviewer = remote.owner === 'team' ? '田中さん' : 'レビュアー';
      ctx.out(`[レビュー] ${reviewer}: 「レビューしました！LGTM マージしてOKです」`, 'ok');
      ctx.hint(`次は gh pr merge ${number}`);
      ctx.ev('pr-create', { number, head, base });
      return;
    }
    if (action === 'list') {
      const open = remote.prs.filter((p) => p.state === 'open');
      if (!open.length) { ctx.out('no open pull requests'); return; }
      ctx.out(`Showing ${open.length} of ${open.length} open pull request${open.length > 1 ? 's' : ''}`);
      open.forEach((p) => ctx.out([[`#${p.number}`.padEnd(5), 'ok'], [p.title.padEnd(30), ''], [`${p.head} → ${p.base}`, 'info'], [`  by ${p.author}`, 'dim']]));
      return;
    }
    if (action === 'view' || action === 'diff') {
      const pr = findPr(remote, pos[0], repo);
      if (!pr) { ctx.out('no pull requests found', 'err'); return; }
      ctx.out(`${pr.title} #${pr.number}`, 'bold');
      ctx.out(`${pr.state === 'open' ? 'Open' : 'Merged'} • ${pr.author} wants to merge ${pr.head} into ${pr.base}`, pr.state === 'open' ? 'ok' : 'info');
      if (remote.branches[pr.head]) {
        w.onlyIn(remote.branches[pr.head], remote.branches[pr.base]).forEach((c) => ctx.out(`  ${c.slice(0, 7)} ${firstMsg(w, c)}`, 'dim'));
      }
      return;
    }
    if (action === 'merge') {
      const pr = findPr(remote, pos[0], repo);
      if (!pr) { ctx.out('no pull requests found', 'err'); return; }
      if (pr.state !== 'open') { ctx.out(`Pull request #${pr.number} was already merged`, 'warn'); return; }
      const r = mergeOnRemote(w, remote, pr.base, pr.head, `Merge pull request #${pr.number} from ${pr.head}\n\n${pr.title}`, w.user.name);
      if (!r.ok) {
        if (r.reason === 'conflict') {
          ctx.out(`X Pull request #${pr.number} is not mergeable: the merge commit cannot be cleanly created.`, 'err');
          ctx.out(`  競合しているファイル: ${r.paths.join(', ')}`, 'err');
          ctx.hint(`${pr.head} で git merge origin/${pr.base} → 解決 → push`);
          ctx.ev('pr-conflict', { number: pr.number });
        } else ctx.out('X Pull request could not be merged.', 'err');
        return;
      }
      pr.state = 'merged';
      ctx.out(`✓ Merged pull request #${pr.number} (${pr.title})`, 'ok');
      if (flags['delete-branch'] || flags.d) {
        delete remote.branches[pr.head];
        ctx.out(`✓ Deleted branch ${pr.head}`, 'ok');
      }
      ctx.hint(`ローカルも更新: git switch ${pr.base} → git pull`);
      ctx.ev('pr-merge', { number: pr.number, head: pr.head, base: pr.base });
      return;
    }
    ctx.out('使い方: gh pr create [--title "タイトル"] / gh pr list / gh pr view <番号> / gh pr merge <番号>', 'warn');
  }

  // Tab 補完
  complete(line) {
    const w = this.world;
    const parts = line.split(/\s+/);
    const last = parts[parts.length - 1];
    let cands = [];
    if (parts.length === 1) cands = SHELL_CMDS;
    else if (parts[0] === 'git' && parts.length === 2) {
      cands = ['init', 'clone', 'status', 'add', 'commit', 'log', 'branch', 'switch', 'checkout', 'merge', 'diff', 'restore', 'reset', 'rm', 'mv', 'remote', 'push', 'pull', 'fetch', 'stash', 'tag', 'rebase', 'cherry-pick', 'revert', 'show', 'reflog', 'config', 'clean'];
    } else if (parts[0] === 'gh' && parts.length === 2) cands = ['repo', 'pr'];
    else if (parts[0] === 'gh' && parts.length === 3) cands = parts[1] === 'repo' ? ['create'] : ['create', 'list', 'view', 'merge'];
    else {
      const repo = w.dir.repo;
      cands = [...Object.keys(w.dir.files)];
      for (const p of Object.keys(w.dirs)) if (p.startsWith(w.cwd + '/') && p !== w.cwd) cands.push(p.slice(w.cwd.length + 1));
      if (repo) {
        cands.push(...Object.keys(repo.branches), ...Object.keys(repo.remoteRefs), ...Object.keys(repo.tags), ...Object.keys(repo.remotes));
        if (parts[0] === 'git' && parts[1] === 'stash') cands.push('pop', 'list', 'apply', 'drop', 'show', 'clear');
        if (parts[0] === 'git' && parts[1] === 'remote') cands.push('add', 'remove', '-v');
      }
    }
    cands = [...new Set(cands)].filter((c) => c.startsWith(last));
    return { prefix: parts.slice(0, -1).join(' ') + (parts.length > 1 ? ' ' : ''), cands, last };
  }
}

function userSlug(w) {
  return w.user.name === 'あなた' ? 'you' : w.user.name.replace(/\s+/g, '-');
}

function firstMsg(w, id) { return w.objects[id].message.split('\n')[0]; }

function findPr(remote, spec, repo) {
  if (spec) return remote.prs.find((p) => String(p.number) === String(spec).replace('#', '') || p.head === spec);
  const b = currentBranch(repo);
  return remote.prs.find((p) => p.head === b && p.state === 'open') || remote.prs.filter((p) => p.state === 'open').slice(-1)[0];
}

export { hasConflictMarkers, resolveRef, normalizeUrl };

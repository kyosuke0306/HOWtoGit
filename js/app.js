// UI とゲーム進行
import { World, computeStatus, headId, currentBranch } from './git.js';
import { Shell } from './shell.js';
import { hasConflictMarkers } from './diff.js';
import { renderGraph, localRefs, remoteRefsOf } from './graph.js';
import { STAGES, STAGE_DIR, buildStage, stageShape, stars } from './stages.js';
import { MISSIONS, FIRST_MISSION } from './missions.js';
import { createApi, buildTeamRemote, TEAM_URL, FILES } from './scenario.js';
import { COMMANDS, CONCEPTS, REF_SYNTAX, FIRST_TIME } from './docs.js';
import { icon, avatar, injectSprite } from './icons.js';
import { createKeyboard } from './keyboard.js';
import { GROUPS, DESC, baseFor, cmdOf, chipsFor, opChips } from './builder.js';

injectSprite();

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TITLES = ['Git見習い', 'コミッター', 'ブランチ使い', 'マージ職人', 'コンフリクト解決人', 'リベース名人', 'チームの要', 'Git仙人'];
const SAVE_KEY = 'howtogit-save-v1';

// ---------- セーブデータ ----------
const save = loadSave();
function loadSave() {
  const d = { xp: 0, stars: {}, best: 0, seen: {}, pad: 'build' };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) return { ...d, ...s, stars: s.stars || {} };
  } catch (e) { /* 無視 */ }
  return d;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 無視 */ }
}
function levelInfo(xp) {
  let lv = 1, need = 100, rest = xp;
  while (rest >= need) { rest -= need; lv++; need = 100 + (lv - 1) * 50; }
  return { lv, rest, need, title: TITLES[Math.min(TITLES.length - 1, lv - 1)] };
}

// ---------- ゲーム状態 ----------
const game = {
  world: null,
  shell: null,
  mode: null,
  lastCmd: '',
  graphTab: 'local',
  stage: null,
  ch: null,
  chat(who, text) { teamToast(who, text); },
};
const api = createApi(game);

function setWorld(w) {
  game.world = w;
  game.shell = new Shell(w, {
    openEditor: (f) => openEditor(f),
    clear: () => { out.innerHTML = ''; },
    showHint: () => showHint(),
    showMission: () => {},
  });
  game.graphTab = 'local';
  out.innerHTML = '';
  input.value = '';
  selCmd = null;
}

// ---------- ログ (ターミナル出力) ----------
const out = $('#term-out');
function termLine(segs, cls = '') {
  const div = document.createElement('div');
  div.className = 'line ' + (cls ? 't-' + cls : '');
  if (typeof segs === 'string') div.textContent = segs || ' ';
  else {
    segs.forEach(([t, c]) => {
      const sp = document.createElement('span');
      if (c) sp.className = 't-' + c;
      sp.textContent = t;
      div.appendChild(sp);
    });
    if (!div.textContent) div.textContent = ' ';
  }
  addCopyButtons(div);
  out.appendChild(div);
}
function termHtml(html, cls = '') {
  const div = document.createElement('div');
  div.className = 'line ' + cls;
  div.innerHTML = html;
  if (cls !== 'cmdline') addCopyButtons(div);
  out.appendChild(div);
}
function scrollTerm() { out.scrollTop = out.scrollHeight; }
// ---------- 必要なときだけ出すパネル ----------
// シート (依頼・ログ) は1枚ずつ。ブランチ図の上に重ねて表示する
function openSheet(id) {
  document.querySelectorAll('.sheet.open').forEach((el) => { if (el.id !== id) el.classList.remove('open'); });
  $('#' + id).classList.add('open');
  if (id === 'log-sheet') scrollTerm();
}
function closeSheet(id) {
  const el = $('#' + id);
  if (id === 'req-sheet' && el.classList.contains('open') && goalWithReq) { goalWithReq = false; showGoal(false); }
  el.classList.remove('open');
}
let goalWithReq = false; // 依頼と一緒に出したゴールは、依頼を閉じたら隠す
function toggleSheet(id) { $('#' + id).classList.contains('open') ? closeSheet(id) : openSheet(id); }
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeSheet(b.dataset.close)));
$('#btn-log').onclick = () => { if (!ghost()) toggleSheet('log-sheet'); };
$('#req-chip').onclick = () => { if (!ghost()) toggleSheet('req-sheet'); };

// コマンド欄 (ボタン / キーボード)
function openConsole() {
  document.body.classList.add('cmd-open');
  refit();
  closeSheet('req-sheet');
  if (save.pad === 'kb' && isTouch()) input.focus();
}
// 閉じた直後のタップが下の要素に落ちないようにする
let ghostUntil = 0;
const ghost = () => Date.now() < ghostUntil;
function closeConsole() {
  ghostUntil = Date.now() + 450;
  document.body.classList.remove('cmd-open');
  refit();
  input.blur();
}
$('#btn-cmd').onclick = () => (document.body.classList.contains('cmd-open') ? closeConsole() : openConsole());
$('#btn-cmd-close').addEventListener('pointerdown', (e) => e.preventDefault());
$('#btn-cmd-close').onclick = closeConsole;

// 実行結果を小さく表示 (タップで全部)
let bubbleTimer = null;
function showBubble(echo, errors) {
  const lines = [];
  for (let el = echo.nextElementSibling; el; el = el.nextElementSibling) {
    const t = el.textContent.trim();
    if (t) lines.push(t);
  }
  const b = $('#bubble');
  const head = `<code>${esc(game.lastCmd)}</code>`;
  const body = lines.length ? lines.slice(0, 3).map((l) => `<span>${esc(l)}</span>`).join('') : '<span class="muted">(表示なし)</span>';
  b.innerHTML = head + body + (lines.length > 3 ? `<span class="more">続きを見る ${icon('chevron')}</span>` : '');
  b.classList.toggle('err', errors > 0);
  b.classList.remove('hidden');
  b.onclick = () => {
    if (ghost()) return;
    b.classList.add('hidden');
    openSheet('log-sheet');
    requestAnimationFrame(() => { out.scrollTop = echo.offsetTop - out.offsetTop - 4; });
  };
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.classList.add('hidden'), lines.length > 3 || errors ? 9000 : 4500);
}

function promptHtml() {
  const p = game.shell.prompt();
  return `<span class="p-path">${esc(p.path.replace(/^~\//, ''))}</span><span class="p-branch">${esc(p.branch)}</span><span class="p-dollar">$</span>`;
}
function renderPrompt() { $('#prompt').innerHTML = promptHtml(); }

function runCommand(line) {
  termHtml(`${promptHtml()} <span class="t-cmd">${esc(line)}</span>`, 'cmdline');
  const echo = out.lastElementChild;
  const events = [];
  const ctx = {
    errorCount: 0,
    out(t, cls) { termLine(t, cls); if (cls === 'err') ctx.errorCount++; },
    hint(t) { termHtml(`${icon('bulb')}<span class="t-hint">${esc(t)}</span>`, 'hint-line'); },
    ev(type, data = {}) { events.push({ type, ...data }); },
  };
  try {
    game.shell.run(line, ctx);
  } catch (e) {
    console.error(e);
    termLine('シミュレーター内部エラー: ' + e.message, 'err');
  }
  game.lastCmd = line;
  explainFirstTime(line);
  afterCommand(events, line, ctx.errorCount);
  scrollTerm();
  showBubble(echo, ctx.errorCount);
}

function explainFirstTime(line) {
  const m = line.trim().match(/^(git|gh)\s*([\w-]*)/);
  if (!m) return;
  const key = m[1] === 'gh' ? 'gh' : m[2];
  if (!FIRST_TIME[key] || save.seen[key]) return;
  save.seen[key] = true;
  persist();
  termHtml(`<div class="explain">${icon('info')} ${esc(FIRST_TIME[key])}</div>`);
}

function afterCommand(events, line, errors) {
  if (game.mode === 'stage') checkStage(line, errors);
  else if (game.mode === 'challenge') checkChallenge(events);
  renderAll();
}

// ---------- 入力 ----------
const input = $('#cmd');
let histIdx = -1;

function submitInput() {
  const v = input.value;
  if (!v.trim()) return;
  input.value = '';
  histIdx = -1;
  selCmd = null;
  runCommand(v);
}
function histMove(dir) {
  const hist = game.shell.history;
  if (!hist.length) return;
  if (dir < 0) histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
  else {
    if (histIdx < 0) return;
    histIdx++;
    if (histIdx >= hist.length) { histIdx = -1; input.value = ''; updateDesc(); return; }
  }
  input.value = hist[histIdx];
  const n = input.value.length;
  input.setSelectionRange(n, n);
  updateDesc();
}
function tabComplete() {
  const r = game.shell.complete(input.value);
  if (r.cands.length === 1) input.value = r.prefix + r.cands[0] + ' ';
  else if (r.cands.length > 1) {
    let common = r.cands[0];
    for (const c of r.cands) while (!c.startsWith(common)) common = common.slice(0, -1);
    if (common.length > r.last.length) input.value = r.prefix + common;
    else { termLine(r.cands.join('   '), 'dim'); scrollTerm(); }
  }
  const n = input.value.length;
  input.setSelectionRange(n, n);
  updateDesc();
}
function insertText(t) {
  const s0 = input.selectionStart ?? input.value.length, e0 = input.selectionEnd ?? s0;
  input.value = input.value.slice(0, s0) + t + input.value.slice(e0);
  const p = s0 + t.length;
  input.setSelectionRange(p, p);
  updateDesc();
}
// 末尾に単語を足す (ボタン・グラフのタップ用)
function appendToken(tok) {
  let v = input.value;
  // 引用符の中にカーソルがあるときは中に入れる
  const pos = input.selectionStart ?? v.length;
  if (/""$/.test(v) && pos === v.length - 1) { insertText(tok); return; }
  if (v && !/\s$/.test(v)) v += ' ';
  input.value = v + tok + ' ';
  const n = input.value.length;
  input.setSelectionRange(n, n);
  updateDesc();
  renderBuilder();
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitInput(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); histMove(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); histMove(1); }
  else if (e.key === 'Tab') { e.preventDefault(); tabComplete(); }
});
input.addEventListener('input', () => { updateDesc(); renderBuilder(); });
$('#btn-enter').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
$('#btn-enter').onclick = submitInput;
$('#btn-clear').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
$('#btn-clear').onclick = () => { input.value = ''; selCmd = null; updateDesc(); renderBuilder(); };

// 入力中のコマンドの説明
function updateDesc() {
  const c = cmdOf(input.value);
  const d = c && (DESC[c] || (FIRST_TIME[c] || '').replace(/^\S+ = /, ''));
  $('#cmd-desc').innerHTML = d ? `<b>${esc(c)}</b> ${esc(d)}` : '';
}

// ---------- 入力方法: ボタン / キーボード ----------
const isTouch = () => matchMedia('(pointer: coarse)').matches;
function setPad(p) {
  save.pad = p;
  persist();
  document.body.dataset.pad = p;
  $('#btn-pad').classList.toggle('on', p === 'kb');
  $('#btn-pad').setAttribute('aria-label', p === 'kb' ? 'ボタンに切替' : 'キーボードに切替');
  if (p === 'kb') openConsole();
  if (p === 'kb' && isTouch()) { input.setAttribute('inputmode', 'none'); input.focus(); }
  else if (isTouch()) input.blur();
}
$('#btn-pad').addEventListener('pointerdown', (e) => e.preventDefault());
$('#btn-pad').onclick = () => setPad(save.pad === 'kb' ? 'build' : 'kb');
if (isTouch()) input.setAttribute('inputmode', 'none');
input.addEventListener('focus', () => {
  if (isTouch() && input.getAttribute('inputmode') === 'none' && save.pad !== 'kb') setPad('kb');
});

let clip = '';
createKeyboard($('#kb'), {
  onText: (t) => insertText(t),
  onKey: (k) => {
    const pos = input.selectionStart ?? input.value.length;
    if (k === 'ENTER') submitInput();
    else if (k === 'BS') {
      const e0 = input.selectionEnd ?? pos;
      if (e0 > pos) insertText('');
      else if (pos > 0) { input.value = input.value.slice(0, pos - 1) + input.value.slice(pos); input.setSelectionRange(pos - 1, pos - 1); updateDesc(); }
    } else if (k === 'TAB') tabComplete();
    else if (k === 'LEFT') input.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
    else if (k === 'RIGHT') input.setSelectionRange(pos + 1, pos + 1);
    else if (k === 'UP') histMove(-1);
    else if (k === 'DOWN') histMove(1);
    else if (k === 'PASTE') pasteClip();
    else if (k === 'OSKB') useOsKeyboard();
    else if (k === 'HIDE') closeConsole();
  },
});
function useOsKeyboard() {
  input.setAttribute('inputmode', 'text');
  input.blur();
  setTimeout(() => input.focus(), 50);
}
input.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== input && isTouch()) input.setAttribute('inputmode', 'none');
}, 100));
async function pasteClip() {
  let t = clip;
  if (!t && navigator.clipboard && navigator.clipboard.readText) {
    try { t = await navigator.clipboard.readText(); } catch (e) { /* 読めない環境 */ }
  }
  if (t) insertText(t.trim());
  else toast('コピーしたものがありません');
}

// ---------- ボタンでコマンドを組み立てる ----------
let selCmd = null;
function renderBuilder() {
  const el = $('#builder');
  if (!game.world) return;
  const line = input.value;
  const cur = cmdOf(line) || selCmd;
  const quick = opChips(game.world);
  const chips = cur ? chipsFor(cur, game.world, line, { urls: game.world.remotes[TEAM_URL] ? [TEAM_URL] : [] }) : [];
  const chipRow = quick.length
    ? `<div class="chips urgent">${quick.map((c, i) => `<button type="button" class="chip-btn" data-q="${i}">${esc(c.label)}</button>`).join('')}</div>`
    : chips.length ? `<div class="chips">${chips.map((c, i) => `<button type="button" class="chip-btn ${c.kind || ''}" data-c="${i}">${esc(c.label)}</button>`).join('')}</div>` : `<div class="chips empty">${cur ? 'そのまま実行できます' : 'コマンドを選ぼう (グラフもタップできる)'}</div>`;
  const usable = new Set(game.mode === 'stage' ? ['status', 'commit', 'log', 'branch', 'switch', 'merge', 'rebase', 'reset', 'revert', 'cherry-pick', 'tag', 'fetch', 'pull', 'push', 'add', 'edit', 'diff', 'stash', 'restore'] : null);
  const btns = GROUPS.flatMap(([, cmds], gi) => cmds.filter((c) => !usable.size || usable.has(c)).map((c) => `<button type="button" class="cmd-btn g${gi}${cur === c ? ' on' : ''}" data-cmd="${c}" title="${esc(DESC[c] || '')}">${esc(c)}</button>`)).join('');
  el.innerHTML = chipRow + `<div class="cmd-grid">${btns}</div>`;
  el.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => {
    selCmd = b.dataset.cmd;
    const base = baseFor(selCmd, game.world);
    input.value = base;
    const caret = base.endsWith('""') ? base.length - 1 : base.length;
    input.setSelectionRange(caret, caret);
    updateDesc();
    renderBuilder();
  }));
  el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => appendToken(chips[Number(b.dataset.c)].add)));
  el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { input.value = quick[Number(b.dataset.q)].line; updateDesc(); renderBuilder(); }));
}
function onPick(kind, val) {
  if (!input.value.trim()) {
    // 何も入力していなければ、点なら移動・名札なら切替を提案
    input.value = kind === 'commit' ? `git switch --detach ${val}` : val.includes('/') ? `git merge ${val}` : `git switch ${val}`;
    if (val === 'HEAD') input.value = '';
    updateDesc();
    renderBuilder();
    return;
  }
  appendToken(val);
}

// ---------- コピー ----------
function copyText(t) {
  clip = t;
  const done = () => toast(`${icon('check')} コピーしました`);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => { fallbackCopy(t); done(); });
  else { fallbackCopy(t); done(); }
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* 無視 */ }
  ta.remove();
}
const URL_RE = /https?:\/\/[^\s'"<>)]+[^\s'"<>).,、。]/g;
function addCopyButtons(el) {
  const urls = [...new Set(el.textContent.match(URL_RE) || [])];
  urls.forEach((u) => el.insertAdjacentHTML('beforeend', `<button type="button" class="copy-btn" data-copy="${esc(u)}" title="コピー" aria-label="${esc(u)} をコピー">${icon('copy')}</button>`));
}
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.copy-btn, .chip-btn, .cmd-btn, [data-pick]') && document.activeElement === input) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy-btn');
  if (b) { e.preventDefault(); e.stopPropagation(); copyText(b.dataset.copy); }
});

// ---------- 描画 ----------
function renderAll() {
  if (!game.world) return;
  renderPrompt();
  renderReq();
  renderBoard();
  renderBuilder();
  updateDesc();
  renderStats();
}

// ブランチ図に使える広さ (上の帯・下のボタン列のぶんを除く)
function graphFit(el) {
  const cs = getComputedStyle(el);
  return {
    w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}
// 上に重なる帯 (依頼・ゴール) の下から図を始める
function fitTop(el) {
  const top = el.getBoundingClientRect().top;
  let bottom = 0;
  for (const sel of ['.float-top', '#goal-box']) {
    const b = $(sel);
    if (!b || b.classList.contains('hidden') || !b.offsetHeight || (sel === '#goal-box' && !b.classList.contains('show'))) continue;
    if (sel === '#goal-box' && innerWidth >= 560) continue; // 広い画面ではゴールは右側
    bottom = Math.max(bottom, b.getBoundingClientRect().bottom);
  }
  el.style.paddingTop = `${Math.max(8, Math.round(bottom - top + 8))}px`;
}
let fitTimer = null;
function refit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => { if (game.world && document.body.dataset.screen === 'play') renderBoard(); }, 120);
}
window.addEventListener('resize', refit);

function renderBoard() {
  document.body.classList.toggle('has-goal', game.mode === 'stage' && !!game.stage);
  const w = game.world;
  const repo = w.repo;
  document.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('active', b.dataset.g === game.graphTab));
  // ゴール
  const box = $('#goal-box');
  if (game.mode === 'stage' && game.stage) {
    box.classList.remove('hidden');
    $('#btn-goal').classList.remove('hidden');
    document.body.classList.add('has-goal');
    const gw = game.stage.goalWorld;
    const grepo = gw.dirs[STAGE_DIR].repo;
    const refs = localRefs(grepo).filter((r) => game.stage.def.remote || r.kind !== 'remote');
    renderGraph($('#goal'), gw, refs, { key: 'goal:' + game.stage.def.id, headId: headId(grepo), compact: true });
  } else {
    box.classList.add('hidden');
    $('#btn-goal').classList.add('hidden');
    document.body.classList.remove('has-goal');
  }
  const el = $('#graph');
  fitTop(el);
  const remoteUrl = (repo && repo.remotes.origin) || (w.remotes[TEAM_URL] && game.mode !== 'stage' ? TEAM_URL : null);
  $('[data-g="remote"]').classList.toggle('hidden', !remoteUrl);
  if (!remoteUrl) game.graphTab = 'local';
  if (game.graphTab === 'local') {
    if (!repo) {
      el.innerHTML = `<div class="graph-empty">${icon('folder', 'big')}<br>まだ Git の管理外です<br><small>clone か init から</small></div>`;
    } else {
      renderGraph(el, w, localRefs(repo), { key: 'local:' + w.cwd, headId: headId(repo), onPick, fit: graphFit(el), empty: 'まだコミットがありません<br><small>add → commit で記録しよう</small>' });
    }
  } else {
    const remote = w.remotes[remoteUrl];
    renderGraph(el, w, remoteRefsOf(remote), { key: 'remote:' + remoteUrl, onPick, fit: graphFit(el), empty: '空のリポジトリです' });
    const prs = remote.prs.filter((p) => p.state === 'open');
    if (prs.length) el.insertAdjacentHTML('afterbegin', `<div class="pr-list">${prs.map((p) => `<span class="pr">${icon('pr')} #${p.number} ${esc(p.title)}</span>`).join('')}</div>`);
  }
  // 作業途中の表示
  let banner = '';
  if (repo) {
    const s = computeStatus(w, w.dir);
    if (repo.op) {
      const name = { merge: 'マージ', rebase: 'リベース', 'cherry-pick': 'チェリーピック', revert: 'リバート' }[repo.op.type];
      banner = s.conflicts.length ? `${icon('alert')} ${name}中に競合: ${s.conflicts.map((c) => esc(c.path)).join(', ')}` : `${icon('hourglass')} ${name}中 — 続行で完了`;
    } else if (repo.head.type === 'detached') banner = `${icon('link')} HEAD がブランチから離れています`;
    else if (game.mode !== 'stage' && (s.staged.length || s.unstaged.length || s.untracked.length)) {
      banner = `${icon('pencil')} 記録前の変更 ${s.staged.length + s.unstaged.length + s.untracked.length} 件${s.staged.length ? ` (ステージ ${s.staged.length})` : ''}`;
    }
    if (repo.stash.length) banner += `${banner ? '　' : ''}${icon('archive')} 退避 ${repo.stash.length}`;
  }
  $('#opbanner').innerHTML = banner ? `<div class="op">${banner}</div>` : '';
}
document.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { game.graphTab = b.dataset.g; renderBoard(); }));
$('#goal-toggle').onclick = () => $('#goal-box').classList.toggle('big');
// ゴールはふだん隠しておき、旗ボタンで出し入れする
function showGoal(on) {
  $('#goal-box').classList.toggle('show', on);
  $('#btn-goal').classList.toggle('on', on);
  refit();
}
$('#btn-goal').onclick = () => { goalWithReq = false; if (!ghost()) showGoal(!$('#goal-box').classList.contains('show')); };

function renderStats() {
  const L = levelInfo(save.xp);
  $('#lv').textContent = L.lv;
  $('#xpfill').style.width = `${(L.rest / L.need) * 100}%`;
  $('.level').title = `${L.title} ${L.rest}/${L.need} XP`;
}
function gainXp(n) {
  const before = levelInfo(save.xp).lv;
  save.xp += n;
  persist();
  const after = levelInfo(save.xp);
  if (after.lv > before) toast(`${icon('arrow-up')} Lv${after.lv} ${after.title}`);
}

// 上部のカード (ステージ / 依頼 / フリー)
function renderReq() {
  if (game.mode === 'stage') renderStageCard();
  else if (game.mode === 'challenge') renderChallengeCard();
  else if (game.mode === 'free') renderFreeCard();
}
function setChip(html) { $('#req-chip').innerHTML = html + `<span class="chip-open">${icon('chevron-down')}</span>`; }

// ---------- ステージ ----------
function startStage(idx) {
  const def = STAGES[idx];
  game.mode = 'stage';
  const w = buildStage(def);
  setWorld(w);
  game.stage = { idx, def, used: 0, done: false, hint: false, goalWorld: buildStage(def, { solved: true }) };
  game.stage.goal = stageShape(game.stage.goalWorld, def);
  termHtml(`<div class="banner">${icon('flag')} ${idx + 1}. ${esc(def.title)}</div>`);
  setScreen('play', `ステージ ${idx + 1}`);
  $('#goal-box').classList.remove('big');
  showGoal(true);
  goalWithReq = true;
  renderAll();
  closeConsole();
  openSheet('req-sheet');
}
function checkStage(line, errors) {
  const g = game.stage;
  if (!g || g.done) return;
  if (/^\s*(git|gh)\s/.test(line) && !/^\s*git\s+(status|log|show|diff|reflog|branch\s*$|stash\s+list)/.test(line) && !errors) g.used++;
  if (game.world.dirs[STAGE_DIR].repo.op) return;
  if (stageShape(game.world, g.def) === g.goal) finishStage();
}
function finishStage() {
  const g = game.stage;
  g.done = true;
  const st = stars(g.def, g.used);
  const prev = save.stars[g.def.id] || 0;
  if (st > prev) save.stars[g.def.id] = st;
  persist();
  gainXp(prev ? 5 : 20 + st * 10);
  confetti();
  const next = g.idx + 1 < STAGES.length;
  setTimeout(() => showResult({
    title: `${icon('sparkles')} クリア！`,
    body: `<div class="stars">${starHtml(st)}</div>
      <p class="muted">${g.used} 手 (目標 ${g.def.par} 手)</p>
      <div class="lesson-box"><b>${icon('info')} ポイント</b><p>${esc(g.def.learn)}</p></div>
      <div class="answer-box"><b>模範解答</b><code>${esc(g.def.solution.filter((c) => !c.startsWith('__')).join(' → '))}</code></div>`,
    actions: [[`${icon('restart')} もう一度`, () => startStage(g.idx)], next ? [`次へ ${icon('play')}`, () => go(`#/stage/${g.idx + 2}`), 'primary'] : [`${icon('gamepad')} チャレンジへ`, () => go('#/challenge'), 'primary']],
  }), 500);
}
function starHtml(n) {
  return [1, 2, 3].map((i) => `<span class="star${i <= n ? ' on' : ''}">${icon('star')}</span>`).join('');
}
function renderStageCard() {
  const g = game.stage;
  const d = g.def;
  setChip(`<span class="badge">${g.idx + 1}</span><span class="chip-text">${esc(d.goal)}</span><span class="moves">${g.used}<small>/${d.par}</small></span>`);
  $('#req').innerHTML = `
    <div class="req-head">
      <span class="badge">${g.idx + 1}/${STAGES.length}</span>
      <h2>${esc(d.title)}</h2>
      <span class="moves" title="手数">${g.used}<small>/${d.par}手</small></span>
    </div>
    <p class="req-text">${esc(d.goal)}</p>
    ${g.hint ? `<p class="req-hint">${icon('bulb')}<code>${esc(d.hint)}</code></p>` : ''}
    <div class="req-actions">
      ${g.done ? `<button class="btn primary" id="btn-next">次へ ${icon('play')}</button>` : `<button class="btn" id="btn-hint">${icon('bulb')}ヒント</button>`}
      <button class="btn icon" id="btn-restart" title="やり直す" aria-label="やり直す">${icon('restart')}</button>
      <button class="btn icon" id="btn-list" title="ステージ一覧" aria-label="ステージ一覧">${icon('list')}</button>
    </div>`;
  if ($('#btn-hint')) $('#btn-hint').onclick = showHint;
  if ($('#btn-next')) $('#btn-next').onclick = () => go(g.idx + 1 < STAGES.length ? `#/stage/${g.idx + 2}` : '#/challenge');
  $('#btn-restart').onclick = () => startStage(g.idx);
  $('#btn-list').onclick = () => go('#/stages');
}

// ---------- チャレンジ (依頼が飛んでくる) ----------
function startChallenge() {
  game.mode = 'challenge';
  const w = new World();
  setWorld(w);
  buildTeamRemote(w);
  game.ch = { n: 0, score: 0, hearts: 3, streak: 0, used: new Set(), mission: null, mem: {}, hints: 0, state: 'playing', history: [], result: null };
  setScreen('play', 'チャレンジ');
  beginMission(FIRST_MISSION);
}

function beginMission(def) {
  const c = game.ch;
  c.n++;
  c.mission = def;
  c.mem = {};
  c.hints = 0;
  c.result = null;
  const d = api.teamRepo();
  if (d && d.repo.op && def !== FIRST_MISSION) {
    game.world.cwd = api.teamPath();
    api.sh(`git ${d.repo.op.type} --abort`);
  }
  // 仲間の日常的な push (チームが動いている感)
  if (def !== FIRST_MISSION && Math.random() < 0.35) {
    const r = game.world.remotes[TEAM_URL];
    const log = game.world.tree(r.branches.main)['CHANGELOG.md'] || '# 変更履歴\n';
    const who = Math.random() < 0.5 ? '田中' : '佐藤';
    game.world.teammateCommit(TEAM_URL, 'main', { 'CHANGELOG.md': log + `- ${who}: 細かい修正 #${c.n}\n` }, '細かい修正', who);
    setTimeout(() => teamToast(who, 'ちょっと修正して push しました'), 1200);
  }
  try { if (def.setup) def.setup(api, c.mem); } catch (e) { console.error(e); }
  termHtml(`<div class="banner mission-banner">${icon('mail')} 依頼 ${c.n}: ${esc(def.title)}</div>`);
  if (def !== FIRST_MISSION && navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* 無視 */ }
  renderAll();
  closeConsole();
  openSheet('req-sheet');
  const chip = $('#req-chip');
  chip.classList.remove('arrive');
  void chip.offsetWidth;
  chip.classList.add('arrive');
}

function pickNextMission() {
  const c = game.ch;
  const recent = c.history.slice(-4);
  const ok = (m) => { try { return !m.can || m.can(api); } catch (e) { return false; } };
  let pool = MISSIONS.filter((m) => !recent.includes(m.id) && !(m.once && c.used.has(m.id)) && ok(m));
  if (!pool.length) pool = MISSIONS.filter((m) => !m.once && ok(m));
  if (!pool.length) pool = MISSIONS.filter((m) => ['pull-latest', 'feature-branch', 'release-tag', 'revert-bad', 'merge-feature', 'review-pr'].includes(m.id));
  const m = pool[Math.floor(Math.random() * pool.length)];
  c.used.add(m.id);
  c.history.push(m.id);
  return m;
}

function checkChallenge(events) {
  const c = game.ch;
  if (!c || c.state !== 'playing' || c.result) return;
  const m = c.mission;
  let res = null;
  const fp = events.find((e) => e.type === 'force-push' && e.branch === 'main' && e.lost > 0);
  if (fp && m !== FIRST_MISSION) res = { fail: `force push で仲間のコミット ${fp.lost} 件を消してしまった！` };
  if (!res && m.noConflict && events.some((e) => e.type === 'conflict')) res = { fail: 'ぶつけてしまった (競合)！' };
  if (!res) {
    try { res = m.check(api, events, c.mem); } catch (e) { console.error(e); res = null; }
  }
  if (res === 'success') missionSuccess();
  else if (res && res.fail) missionFail(res.fail);
}

function missionSuccess() {
  const c = game.ch;
  const m = c.mission;
  c.result = 'success';
  c.streak++;
  const hintRate = Math.max(0.4, 1 - c.hints * 0.15);
  const streakRate = 1 + Math.min(0.5, (c.streak - 1) * 0.1);
  const bonus = c.mem.bonus || 0;
  const pts = Math.round(m.points * hintRate * streakRate) + bonus;
  c.score += pts;
  gainXp(Math.round(pts / 3));
  if (c.score > save.best) { save.best = c.score; persist(); }
  termHtml(`<div class="banner success">${icon('check-circle')} 成功！ +${pts}</div>`);
  confetti();
  renderAll();
  setTimeout(() => resultSheet(true, pts), 700);
}

function missionFail(reason) {
  const c = game.ch;
  if (c.result) return;
  c.result = 'fail';
  c.streak = 0;
  c.hearts--;
  c.failReason = reason;
  termHtml(`<div class="banner fail">${icon('x-circle')} ${esc(reason)}</div>`);
  shake();
  if (c.hearts <= 0) c.state = 'over';
  renderAll();
  setTimeout(() => resultSheet(false), 600);
}

function resultSheet(ok, pts = 0) {
  const c = game.ch;
  const m = c.mission;
  const over = c.state === 'over';
  showResult({
    title: ok ? `${icon('check-circle')} 成功！` : `${icon('x-circle')} 失敗`,
    body: `${ok ? `<p class="big-score">+${pts}</p>` : `<p class="fail-reason">${esc(c.failReason)}</p>`}
      <div class="lesson-box"><b>${icon('info')} 判断のポイント</b><p>${m.lesson || ''}</p></div>
      ${m.answer ? `<div class="answer-box"><b>模範解答</b><code>${esc(m.answer)}</code></div>` : ''}
      ${over ? `<p class="big-score">${c.score}</p><p>${c.score >= save.best ? `${icon('trophy')} ハイスコア！` : `ベスト ${save.best}`}</p>` : ''}`,
    actions: over
      ? [[`${icon('home')} トップ`, () => go('#/')], [`${icon('restart')} もう一度`, () => startChallenge(), 'primary']]
      : [[`次の依頼 ${icon('play')}`, () => nextMission(), 'primary']],
  });
}

function nextMission() {
  const c = game.ch;
  if (!c || c.state !== 'playing') return;
  beginMission(pickNextMission());
}

function skipMission() {
  const c = game.ch;
  if (c.result) return nextMission();
  if (!confirm('この依頼をあきらめますか？ (ライフ -1)')) return;
  missionFail('あきらめた');
}

function renderChallengeCard() {
  const c = game.ch;
  const m = c.mission;
  const story = c.mem.story || m.story;
  const hints = (typeof m.hints === 'function' ? m.hints(c.mem) : m.hints) || [];
  const shown = hints.slice(0, c.hints).map((h) => `<li>${esc(h)}</li>`).join('');
  const hp = Math.max(0, c.hearts);
  setChip(`<span class="badge challenge">${c.n}</span><span class="chip-text">${esc(m.title)}</span><span class="stats-inline"><span class="hearts">${icon('heart').repeat(hp)}<span class="lost">${icon('heart').repeat(3 - hp)}</span></span><span class="score">${c.score}</span></span>`);
  $('#req').innerHTML = `
    <div class="req-head">
      <span class="badge challenge">依頼 ${c.n}</span>
      <h2>${esc(m.title)}</h2>
      <span class="stats-inline"><span class="hearts" title="ライフ">${icon('heart').repeat(hp)}<span class="lost">${icon('heart').repeat(3 - hp)}</span></span>${c.streak > 1 ? `<span class="streak">${icon('flame')}${c.streak}</span>` : ''}<span class="score">${c.score}</span></span>
    </div>
    <div class="story"><div class="avatar">${avatar(m.who, 34)}</div><div><p>${story}</p>${m.detail ? `<p class="detail muted">${m.detail}</p>` : ''}</div></div>
    ${shown ? `<ul class="hints">${shown}</ul>` : ''}
    <div class="req-actions">
      ${c.state === 'over' ? `<button class="btn primary" id="btn-retry">${icon('restart')} もう一度</button>`
        : c.result ? `<button class="btn primary" id="btn-next">次の依頼 ${icon('play')}</button>`
        : `<button class="btn" id="btn-hint" ${c.hints >= hints.length ? 'disabled' : ''}>${icon('bulb')}ヒント ${c.hints}/${hints.length}</button><button class="btn ghost" id="btn-skip">あきらめる</button>`}
    </div>`;
  $('#req').querySelectorAll('.story p, .hints li').forEach(addCopyButtons);
  if ($('#btn-hint')) $('#btn-hint').onclick = showHint;
  if ($('#btn-skip')) $('#btn-skip').onclick = skipMission;
  if ($('#btn-next')) $('#btn-next').onclick = nextMission;
  if ($('#btn-retry')) $('#btn-retry').onclick = startChallenge;
}

// ---------- フリー ----------
function startFree() {
  game.mode = 'free';
  const w = new World();
  setWorld(w);
  buildTeamRemote(w);
  termHtml(`<div class="banner">${icon('flask')} フリー: 何でも試そう</div>`);
  termLine(`git clone ${TEAM_URL}`, 'dim');
  setScreen('play', 'フリー');
  renderAll();
  closeConsole();
}
function renderFreeCard() {
  setChip(`<span class="badge free">${icon('flask')}</span><span class="chip-text">フリー: 仲間を動かす</span>`);
  $('#req').innerHTML = `
    <div class="req-head"><span class="badge free">フリー</span><h2>仲間を動かす</h2>
      <button class="btn icon" data-act="reset" title="最初から" aria-label="最初から">${icon('restart')}</button></div>
    <div class="free-actions">
      <button class="btn small" data-act="push">${icon('users')}main に push</button>
      <button class="btn small" data-act="conflict">${icon('zap')}README を変更</button>
      <button class="btn small" data-act="branch">${icon('branch')}ブランチを push</button>
      <button class="btn small" data-act="pr">${icon('pr')}PR を作成</button>
    </div>`;
  $('#req').querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => freeAction(b.dataset.act)));
}
let freeN = 0;
function freeAction(act) {
  const w = game.world;
  const r = w.remotes[TEAM_URL];
  const main = w.tree(r.branches.main);
  const who = Math.random() < 0.5 ? '田中' : '佐藤';
  freeN++;
  if (act === 'reset') return startFree();
  if (act === 'push') {
    w.teammateCommit(TEAM_URL, 'main', { 'CHANGELOG.md': (main['CHANGELOG.md'] || '# 変更履歴\n') + `- ${who}: 修正 #${freeN}\n` }, `細かい修正 #${freeN}`, who);
    teamToast(who, 'main に push しました');
  } else if (act === 'conflict') {
    const lines = (main['README.md'] || FILES['README.md']).split('\n');
    lines[1] = `カフェのWebサイトです。(${who}が更新 #${freeN})`;
    w.teammateCommit(TEAM_URL, 'main', { 'README.md': lines.join('\n') }, 'READMEの説明を更新', who);
    teamToast(who, 'README.md の2行目を変えて push しました');
  } else if (act === 'branch') {
    const b = `feature/idea-${freeN}`;
    w.teammateCommit(TEAM_URL, b, { [`idea-${freeN}.txt`]: `アイデア ${freeN}\n` }, `アイデア${freeN}を追加`, who, 'main');
    teamToast(who, `${b} を push しました`);
  } else if (act === 'pr') {
    const b = `feature/pr-${freeN}`;
    w.teammateCommit(TEAM_URL, b, { [`page-${freeN}.html`]: `<h1>Page ${freeN}</h1>\n` }, `ページ${freeN}を追加`, who, 'main');
    const n = ++w.prCounter;
    r.prs.push({ number: n, title: `ページ${freeN}を追加`, head: b, base: 'main', state: 'open', author: who });
    teamToast(who, `PR #${n} を作りました`);
  }
  renderAll();
}

// ---------- ヒント ----------
function showHint() {
  if (game.mode === 'stage' && game.stage && !game.stage.done) {
    game.stage.hint = true;
    renderReq();
  } else if (game.mode === 'challenge' && game.ch && !game.ch.result) {
    const c = game.ch;
    const hints = (typeof c.mission.hints === 'function' ? c.mission.hints(c.mem) : c.mission.hints) || [];
    if (c.hints < hints.length) c.hints++;
    renderReq();
  }
}

// ---------- ファイル (シート) ----------
function openFiles() {
  const w = game.world;
  const dir = w.dir;
  const repo = dir.repo;
  const chip = (name, cls, mark) => `<button type="button" class="chip ${cls}" data-file="${esc(name)}">${mark ? `<i>${mark}</i>` : ''}${esc(name)}</button>`;
  let html;
  if (!repo) {
    const files = Object.keys(dir.files).sort();
    html = `<div class="area"><h4>作業中</h4><div class="files">${files.map((f) => chip(f, '', '')).join('') || '<span class="empty">(空)</span>'}</div></div>`;
  } else {
    const s = computeStatus(w, dir);
    const tree = w.tree(headId(repo));
    const conf = new Set(s.conflicts.map((c) => c.path));
    const mod = new Map(s.unstaged.map((x) => [x.path, x.kind]));
    const untr = new Set(s.untracked.map((x) => x.path));
    const stg = new Map(s.staged.map((x) => [x.path, x.kind]));
    const wf = [...new Set([...Object.keys(dir.files), ...mod.keys()])].sort();
    const work = wf.map((f) => {
      if (conf.has(f)) return chip(f, 'conflict', icon('alert'));
      if (mod.get(f) === 'deleted') return chip(f, 'deleted', 'D');
      if (mod.has(f)) return chip(f, 'modified', 'M');
      if (untr.has(f)) return chip(f, 'untracked', 'U');
      if (repo.index[f] === undefined) return chip(f, 'ignored', '');
      return chip(f, '', '');
    }).join('') || '<span class="empty">(空)</span>';
    const stage = [...stg.keys()].sort().map((f) => chip(f, 'staged', stg.get(f) === 'new file' ? 'A' : stg.get(f) === 'deleted' ? 'D' : 'M')).join('') || '<span class="empty">なし</span>';
    const hid = headId(repo);
    html = `<div class="area-cols">
      <div class="area"><h4>作業中 <small>(タップで編集)</small></h4><div class="files">${work}</div></div>
      <div class="area-arrow">add</div>
      <div class="area"><h4>ステージ (次に記録するもの)</h4><div class="files">${stage}</div></div>
      <div class="area-arrow">commit</div>
      <div class="area"><h4>記録済み</h4><div class="files">${hid ? `<span class="head-info">${esc(w.objects[hid].message.split('\n')[0])}</span>` : ''}${Object.keys(tree).sort().map((f) => chip(f, 'committed', '')).join('')}</div></div>
    </div>`;
  }
  openModal(`${icon('folder')} ${esc(w.cwd)}`, html, (box) => {
    box.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { closeModal(); openEditor(b.dataset.file); }));
  });
}
$('#btn-files').onclick = openFiles;

// ---------- エディタ ----------
let editing = null;
function openEditor(file) {
  const dir = game.world.dir;
  editing = { dir, file };
  $('#editor-file').textContent = file + (dir.files[file] === undefined ? ' (新規)' : '');
  const ta = $('#editor-text');
  ta.value = dir.files[file] ?? '';
  updateEditorTools();
  $('#editor').classList.add('open');
  if (!isTouch()) setTimeout(() => ta.focus(), 30);
}
function updateEditorTools() {
  $('#conflict-tools').classList.toggle('show', hasConflictMarkers($('#editor-text').value));
}
$('#editor-text').addEventListener('input', updateEditorTools);
$('#editor-text').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveEditor(); }
  if (e.key === 'Escape') closeEditor();
});
function resolveConflicts(text, mode) {
  return text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*(\n|$)/gm, (all, ours, theirs) => (mode === 'ours' ? ours : mode === 'theirs' ? theirs : ours + theirs));
}
document.querySelectorAll('#conflict-tools [data-resolve]').forEach((b) => (b.onclick = () => {
  const ta = $('#editor-text');
  ta.value = resolveConflicts(ta.value, b.dataset.resolve);
  updateEditorTools();
}));
function saveEditor() {
  if (!editing) return;
  let v = $('#editor-text').value;
  if (v && !v.endsWith('\n')) v += '\n';
  editing.dir.files[editing.file] = v;
  const f = editing.file;
  closeEditor();
  termLine(`(${f} を保存しました)`, 'dim');
  afterCommand([{ type: 'file-write', path: f }], '', 0);
  scrollTerm();
}
function closeEditor() { $('#editor').classList.remove('open'); editing = null; }
$('#editor-save').onclick = saveEditor;
$('#editor-cancel').onclick = closeEditor;

// ---------- モーダル ----------
function openModal(title, html, onReady) {
  $('#modal-title').innerHTML = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.add('open');
  if (onReady) onReady($('#modal-body'));
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal(); });
function showResult({ title, body, actions }) {
  openModal(title, `<div class="result">${body}<div class="sheet-actions">${actions.map(([t, , cls], i) => `<button class="btn ${cls || ''}" data-i="${i}">${t}</button>`).join('')}</div></div>`, (box) => {
    box.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { closeModal(); const fn = actions[Number(b.dataset.i)][1]; if (fn) fn(); }));
  });
}

function openDocs() {
  const concepts = CONCEPTS.map(([k, v]) => `<div class="concept"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join('');
  const cmds = COMMANDS.map((g) => `<h3>${esc(g.cat)}</h3><div class="cmd-list">${g.items.map(([c, d, ex]) => `<button class="cmd-item" data-cmd="${esc(ex)}"><code>${esc(c)}</code><span>${esc(d)}</span></button>`).join('')}</div>`).join('');
  const refs = REF_SYNTAX.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join('');
  openModal(`${icon('book-open')} 辞典`, `
    <div class="docs-tabs"><button class="active" data-t="cmds">コマンド</button><button data-t="concepts">用語</button><button data-t="refs">指定方法</button></div>
    <div class="docs-pane" data-p="cmds">${cmds}</div>
    <div class="docs-pane hidden" data-p="concepts"><div class="concepts">${concepts}</div></div>
    <div class="docs-pane hidden" data-p="refs"><table class="ref-table">${refs}</table></div>`, (box) => {
    box.querySelectorAll('.docs-tabs button').forEach((b) => (b.onclick = () => {
      box.querySelectorAll('.docs-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      box.querySelectorAll('.docs-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    box.querySelectorAll('.cmd-item').forEach((b) => (b.onclick = () => {
      closeModal();
      if (document.body.dataset.screen === 'play') { input.value = b.dataset.cmd; updateDesc(); renderBuilder(); }
    }));
  });
}

// ---------- 演出 ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2700);
}
function teamToast(who, text) {
  toast(`${avatar(who, 22)}<span><b>${esc(who)}</b> ${esc(text)}</span>`);
}
function shake() {
  const el = $('#req-chip');
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
function confetti() {
  const box = $('#confetti');
  const colors = ['#3fb950', '#58a6ff', '#d29922', '#f778ba', '#bc8cff'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.3 + 's';
    box.appendChild(p);
    setTimeout(() => p.remove(), 1800);
  }
}

// ---------- 画面とルーティング ----------
// #/ トップ, #/stages ステージ一覧, #/stage/N, #/challenge, #/free
function setScreen(name, title = '') {
  document.body.dataset.screen = name;
  $('#screen-title').textContent = title;
  closeModal();
  renderStats();
}
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  let m;
  if (h === 'stages') return renderStageSelect();
  if ((m = h.match(/^stage\/(\d+)$/))) {
    const idx = Math.min(STAGES.length, Math.max(1, Number(m[1]))) - 1;
    if (!(game.mode === 'stage' && game.stage && game.stage.idx === idx)) startStage(idx);
    else setScreen('play', `ステージ ${idx + 1}`);
    return;
  }
  if (h === 'challenge') {
    if (!(game.mode === 'challenge' && game.ch && game.ch.state === 'playing')) startChallenge();
    else setScreen('play', 'チャレンジ');
    return;
  }
  if (h === 'free') {
    if (game.mode !== 'free') startFree();
    else setScreen('play', 'フリー');
    return;
  }
  renderHome();
}
window.addEventListener('hashchange', route);
$('#btn-home').onclick = () => go('#/');
$('#btn-back').onclick = () => go(game.mode === 'stage' ? '#/stages' : '#/');

function nextStageIdx() {
  const i = STAGES.findIndex((s) => !save.stars[s.id]);
  return i < 0 ? 0 : i;
}
function totalStars() { return STAGES.reduce((a, s) => a + (save.stars[s.id] || 0), 0); }

function renderHome() {
  setScreen('home');
  const done = STAGES.filter((s) => save.stars[s.id]).length;
  const L = levelInfo(save.xp);
  const playing = game.mode === 'challenge' && game.ch && game.ch.state === 'playing' && game.ch.n > 1;
  $('#home').innerHTML = `
    <div class="home-hero">
      <span class="home-logo">${icon('logo')}</span>
      <h1>HOW<em>to</em>Git</h1>
      <p>ブランチを動かして Git を覚えよう</p>
    </div>
    <div class="home-cards">
      <a class="mode-card lesson" href="#/stages">
        <span class="mode-icon">${icon('flag')}</span>
        <span class="mode-body"><b>ステージ</b><small>ゴールの形にブランチを合わせる</small>
          <span class="mode-progress"><i style="width:${(done / STAGES.length) * 100}%"></i></span></span>
        <span class="mode-meta">${icon('star')}${totalStars()}</span>
      </a>
      <a class="mode-card challenge" href="#/challenge">
        <span class="mode-icon">${icon('gamepad')}</span>
        <span class="mode-body"><b>チャレンジ</b><small>${playing ? `続きから (${game.ch.score}点)` : '仲間の依頼を判断してさばく'}</small></span>
        <span class="mode-meta">${save.best ? `${icon('trophy')}${save.best}` : ''}</span>
      </a>
      <a class="mode-card free" href="#/free">
        <span class="mode-icon">${icon('flask')}</span>
        <span class="mode-body"><b>フリー</b><small>自由に試す</small></span>
        <span class="mode-meta">${icon('chevron')}</span>
      </a>
    </div>
    <div class="home-level">
      <span>Lv<b>${L.lv}</b> ${esc(L.title)}</span>
      <span class="xpbar"><i style="width:${(L.rest / L.need) * 100}%"></i></span>
    </div>`;
}

function renderStageSelect() {
  setScreen('lessons', 'ステージ');
  const next = nextStageIdx();
  const chNames = { 1: '記録とブランチ', 2: '合流', 3: '移動と取り消し', 4: 'チーム' };
  let html = '';
  let ch = 0;
  STAGES.forEach((s, i) => {
    if (s.ch !== ch) { ch = s.ch; html += `<h3>${ch}. ${chNames[ch] || ''}</h3>`; }
    const st = save.stars[s.id] || 0;
    html += `<a class="lesson-card ${st ? 'cleared' : ''} ${i === next ? 'current' : ''}" href="#/stage/${i + 1}">
      <span class="num">${i + 1}</span><b>${esc(s.title)}</b>${st ? `<span class="mini-stars">${starHtml(st)}</span>` : i === next ? '<span class="next-tag">次</span>' : icon('chevron')}</a>`;
  });
  $('#lessons').innerHTML = `<div class="lessons-inner">${html}</div>`;
}

$('#btn-docs').onclick = openDocs;
$('#btn-theme').onclick = () => {
  const root = document.documentElement;
  const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('howtogit-theme', root.dataset.theme); } catch (e) { /* 無視 */ }
};
try { const t = localStorage.getItem('howtogit-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* 無視 */ }

// ---------- 起動 ----------
document.body.dataset.pad = save.pad === 'kb' ? 'kb' : 'build';
$('#btn-pad').classList.toggle('on', save.pad === 'kb');
route();

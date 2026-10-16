// UI とゲーム進行
import { World, computeStatus, headId, currentBranch } from './git.js';
import { Shell } from './shell.js';
import { hasConflictMarkers } from './diff.js';
import { renderGraph, localRefs, remoteRefsOf } from './graph.js';
import { LESSONS } from './lessons.js';
import { MISSIONS, FIRST_MISSION } from './missions.js';
import { createApi, buildTeamRemote, TEAM_URL, FILES } from './scenario.js';
import { COMMANDS, CONCEPTS, REF_SYNTAX, FIRST_TIME } from './docs.js';
import { icon, avatar, injectSprite } from './icons.js';
import { createKeyboard } from './keyboard.js';

injectSprite();

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TITLES = ['Git見習い', 'コミッター', 'ブランチ使い', 'マージ職人', 'コンフリクト解決人', 'リベース名人', 'チームの要', 'Git仙人'];
const SAVE_KEY = 'howtogit-save-v1';

// ---------- セーブデータ ----------
const save = loadSave();
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) return { xp: 0, completed: {}, best: 0, seen: {}, welcomed: false, ...s };
  } catch (e) { /* 無視 */ }
  return { xp: 0, completed: {}, best: 0, seen: {}, welcomed: false };
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
  mode: 'lesson',
  lastCmd: '',
  graphTab: 'local',
  lesson: null,
  ch: null,
  chat(who, text) { addChat(who, text); },
};
const api = createApi(game);

function resetWorld() {
  game.world = new World();
  game.shell = new Shell(game.world, {
    openEditor: (f) => openEditor(f),
    clear: () => { $('#term-out').innerHTML = ''; },
    showHint: () => showHint(),
    showMission: () => showMissionText(),
  });
  $('#chat').innerHTML = '';
}

// ---------- ターミナル ----------
const out = $('#term-out');
function termLine(segs, cls = '') {
  const div = document.createElement('div');
  div.className = 'line ' + (cls ? 't-' + cls : '');
  if (typeof segs === 'string') div.textContent = segs || ' ';
  else {
    segs.forEach(([t, c]) => {
      const sp = document.createElement('span');
      if (c) sp.className = 't-' + c;
      sp.textContent = t;
      div.appendChild(sp);
    });
    if (!div.textContent) div.textContent = ' ';
  }
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

function promptHtml() {
  const p = game.shell.prompt();
  return `<span class="p-user">${esc(p.user)}@howtogit:</span><span class="p-path">${esc(p.path)}</span><span class="p-branch">${esc(p.branch)}</span><span class="p-dollar">$</span>`;
}
function renderPrompt() { $('#prompt').innerHTML = promptHtml(); }

function runCommand(line, { echo = true } = {}) {
  if (echo) termHtml(`${promptHtml()} <span class="t-cmd">${esc(line)}</span>`, 'cmdline');
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
  afterCommand(events);
  scrollTerm();
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

// ---------- 入力 ----------
const input = $('#cmd');
let histIdx = -1;

function submitInput() {
  const v = input.value;
  input.value = '';
  histIdx = -1;
  if (v.trim()) runCommand(v);
  else { termHtml(promptHtml(), 'cmdline'); scrollTerm(); }
}
function histMove(dir) {
  const hist = game.shell.history;
  if (!hist.length) return;
  if (dir < 0) histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
  else {
    if (histIdx < 0) return;
    histIdx++;
    if (histIdx >= hist.length) { histIdx = -1; input.value = ''; return; }
  }
  input.value = hist[histIdx];
  const n = input.value.length;
  input.setSelectionRange(n, n);
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
}
function insertText(t) {
  const s0 = input.selectionStart ?? input.value.length, e0 = input.selectionEnd ?? s0;
  input.value = input.value.slice(0, s0) + t + input.value.slice(e0);
  const p = s0 + t.length;
  input.setSelectionRange(p, p);
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitInput(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); histMove(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); histMove(1); }
  else if (e.key === 'Tab') { e.preventDefault(); tabComplete(); }
  else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
});
$('#terminal').addEventListener('click', (e) => {
  if (e.target.closest('button') || window.getSelection().toString()) return;
  if (!isMobile()) input.focus();
});

// ---------- スマホ用キーボード ----------
const isTouch = () => matchMedia('(pointer: coarse)').matches;
let clip = '';
createKeyboard($('#kb'), {
  onText: (t) => insertText(t),
  onKey: (k) => {
    const pos = input.selectionStart ?? input.value.length;
    if (k === 'ENTER') submitInput();
    else if (k === 'BS') {
      const e0 = input.selectionEnd ?? pos;
      if (e0 > pos) insertText('');
      else if (pos > 0) { input.value = input.value.slice(0, pos - 1) + input.value.slice(pos); input.setSelectionRange(pos - 1, pos - 1); }
    }
    else if (k === 'TAB') tabComplete();
    else if (k === 'LEFT') input.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
    else if (k === 'RIGHT') input.setSelectionRange(pos + 1, pos + 1);
    else if (k === 'UP') histMove(-1);
    else if (k === 'DOWN') histMove(1);
    else if (k === 'PASTE') pasteClip();
    else if (k === 'OSKB') useOsKeyboard();
    else if (k === 'HIDE') closeKb();
  },
});
function openKb() {
  if (!isTouch() || document.body.classList.contains('kb-open')) return;
  input.setAttribute('inputmode', 'none');
  document.body.classList.add('kb-open');
  setTimeout(scrollTerm, 50);
}
let kbClosedAt = 0;
function closeKb() {
  kbClosedAt = Date.now();
  document.body.classList.remove('kb-open');
  input.blur();
}
// 日本語などを入れたいときはスマホ標準のキーボードに切り替え
function useOsKeyboard() {
  document.body.classList.remove('kb-open');
  input.setAttribute('inputmode', 'text');
  input.blur();
  setTimeout(() => input.focus(), 50);
  document.body.classList.add('typing');
}
async function pasteClip() {
  let t = clip;
  if (!t && navigator.clipboard && navigator.clipboard.readText) {
    try { t = await navigator.clipboard.readText(); } catch (e) { /* 読めない環境 */ }
  }
  if (t) insertText(t.trim());
  else toast('コピーしたものがありません');
}
if (isTouch()) input.setAttribute('inputmode', 'none');
input.addEventListener('focus', () => {
  if (isTouch() && input.getAttribute('inputmode') === 'none') openKb();
  else document.body.classList.add('typing');
});
input.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement === input) return;
  document.body.classList.remove('typing');
  if (isTouch()) input.setAttribute('inputmode', 'none');
}, 100));
// ターミナルの外をタップしたらキーボードを閉じる
document.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('kb-open')) return;
  // キーを押すと再描画でボタンが外れるため、押した時点の経路で判定する
  const inside = e.composedPath().some((n) => n.nodeType === 1 && n.matches('#terminal, .modal, .copy-btn'));
  if (!inside) closeKb();
});
$('#term-out').addEventListener('click', (e) => {
  if (Date.now() - kbClosedAt < 500) return; // 閉じた直後のタップで開き直さない
  if (isTouch() && !e.target.closest('button') && !window.getSelection().toString()) input.focus();
});

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
  if (e.target.closest('.copy-btn') && document.activeElement === input) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy-btn');
  if (b) { e.preventDefault(); e.stopPropagation(); copyText(b.dataset.copy); }
});

function insertCommand(cmd, caret) {
  input.value = cmd;
  showView('play');
  input.focus();
  const pos = caret ? cmd.length + caret : cmd.length;
  input.setSelectionRange(pos, pos);
}

document.querySelectorAll('#quick button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { if (document.body.classList.contains('kb-open')) e.preventDefault(); });
  b.addEventListener('click', () => {
    if (b.dataset.run) runCommand(b.dataset.run);
    else insertCommand(b.dataset.insert, Number(b.dataset.caret || 0));
  });
});
$('#btn-enter').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
$('#btn-enter').onclick = () => {
  submitInput();
  if (!isTouch()) input.focus();
};

// ---------- 画面切替 (スマホ) ----------
const isMobile = () => matchMedia('(max-width: 959px)').matches;
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
    if (b.dataset.view === name) b.classList.remove('dot');
  });
}
function markUpdated(name) {
  if (!isMobile()) return;
  const v = document.querySelector(`.view[data-view="${name}"]`);
  if (v && !v.classList.contains('active')) document.querySelector(`.tabbar [data-view="${name}"]`).classList.add('dot');
}
document.querySelectorAll('.tabbar [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));

// ---------- コマンド実行後の処理 ----------
function afterCommand(events) {
  if (game.mode === 'lesson') checkLesson(events);
  else if (game.mode === 'challenge') checkChallenge(events);
  renderAll();
}

// ---------- レッスン ----------
function startLesson(idx) {
  game.mode = 'lesson';
  resetWorld();
  const L = LESSONS[idx];
  game.lesson = { idx, step: 0, state: {}, done: false, hintShown: {} };
  try { L.setup(api); } catch (e) { console.error(e); }
  out.innerHTML = '';
  termHtml(`<div class="banner">${icon('book')} ${idx + 1}. ${esc(L.title)}</div>`);
  enterStep();
  showView('play');
  renderAll();
  setScreen('play', modeTitle());
  showIntro();
}

function showIntro() {
  const L = LESSONS[game.lesson.idx];
  openModal(`${icon('book')} ${game.lesson.idx + 1}. ${esc(L.title)}`, `<div class="intro-body">${L.intro}</div>
    <div class="sheet-actions"><button class="btn primary" id="btn-start">はじめる</button></div>`, (box) => {
    box.querySelector('#btn-start').onclick = closeModal;
  });
}

function enterStep() {
  const L = LESSONS[game.lesson.idx];
  const st = L.steps[game.lesson.step];
  game.lesson.state = {};
  if (st && st.onEnter) st.onEnter(api);
}

function checkLesson(events) {
  const g = game.lesson;
  if (!g || g.done) return;
  const L = LESSONS[g.idx];
  let evs = events;
  let guard = 0;
  while (g.step < L.steps.length && guard++ < 20) {
    const st = L.steps[g.step];
    let ok = false;
    try { ok = !!st.check(api, evs, g.state); } catch (e) { ok = false; }
    if (!ok && st.soft) {
      // 見るだけのステップを飛ばして、次の実作業ステップを達成していれば進める
      let j = g.step + 1;
      while (j < L.steps.length && L.steps[j].soft) j++;
      const nx = L.steps[j];
      let ok2 = false;
      if (nx && !nx.onEnter) { try { ok2 = !!nx.check(api, evs, {}); } catch (e) { ok2 = false; } }
      if (ok2) { g.step = j; ok = true; }
    }
    if (!ok) break;
    g.step++;
    flash('#mission');
    if (g.step < L.steps.length) {
      const next = L.steps[g.step];
      enterStep();
      if (next.onEnter) evs = [];
    }
  }
  if (g.step >= L.steps.length) finishLesson();
}

function finishLesson() {
  const g = game.lesson;
  g.done = true;
  const L = LESSONS[g.idx];
  const first = !save.completed[L.id];
  save.completed[L.id] = true;
  const xp = first ? 60 : 15;
  gainXp(xp);
  termHtml(`<div class="banner success">${icon('sparkles')} クリア！</div>`);
  confetti();
  showResult({
    title: `${icon('sparkles')} クリア！`,
    body: `<p>${L.outro}</p><p class="xp-gain">+${xp} XP</p>`,
    actions: g.idx + 1 < LESSONS.length
      ? [['閉じる', null], [`次へ ${icon('play')}`, () => go(`#/lesson/${g.idx + 2}`), 'primary']]
      : [['閉じる', null], [`${icon('gamepad')} チャレンジへ`, () => go('#/challenge'), 'primary']],
  });
}

function renderLessonPanel() {
  const g = game.lesson;
  const L = LESSONS[g.idx];
  const st = L.steps[g.step];
  const pct = Math.round((g.step / L.steps.length) * 100);
  const now = g.done
    ? `<p class="step-now done">${icon('check-circle')} クリア！</p>`
    : `<p class="step-now">${st.text}</p>${g.hintShown[g.step] ? `<button class="hint-cmd" data-cmd="${esc(st.hint)}">${icon('pencil')}<span>${esc(st.hint)}</span></button>` : ''}`;
  $('#mission').innerHTML = `
    <div class="m-head">
      <span class="badge">${g.idx + 1}/${LESSONS.length}</span>
      <h2>${esc(L.title)}</h2>
      <span class="muted">${Math.min(g.step + 1, L.steps.length)}/${L.steps.length}</span>
    </div>
    <div class="progress-bar"><i style="width:${g.done ? 100 : pct}%"></i></div>
    ${now}
    <div class="m-actions">
      ${g.done
        ? `<button class="btn primary" id="btn-next-lesson">${g.idx + 1 < LESSONS.length ? `次へ ${icon('play')}` : `${icon('gamepad')} チャレンジへ`}</button>`
        : `<button class="btn" id="btn-hint">${icon('bulb')} ヒント</button>`}
      <button class="btn icon" id="btn-intro" title="解説" aria-label="解説">${icon('info')}</button>
      <button class="btn icon" id="btn-lessons" title="レッスン一覧" aria-label="レッスン一覧">${icon('list')}</button>
      <button class="btn icon" id="btn-restart" title="やり直す" aria-label="やり直す">${icon('restart')}</button>
    </div>`;
  $('#btn-lessons').onclick = openLessons;
  $('#btn-intro').onclick = showIntro;
  $('#btn-restart').onclick = () => startLesson(g.idx);
  if ($('#btn-hint')) $('#btn-hint').onclick = showHint;
  if ($('#btn-next-lesson')) $('#btn-next-lesson').onclick = () => go(g.idx + 1 < LESSONS.length ? `#/lesson/${g.idx + 2}` : '#/challenge');
  $('#mission').querySelectorAll('.hint-cmd').forEach((b) => (b.onclick = () => {
    const c = b.dataset.cmd;
    insertCommand(/<[^>]*>/.test(c) && !c.startsWith('echo') ? c.replace(/<[^>]*>/g, '') : c);
  }));
}

function openLessons() { go('#/lessons'); }

// ---------- チャレンジ ----------
function startChallenge() {
  game.mode = 'challenge';
  resetWorld();
  buildTeamRemote(game.world);
  game.ch = { n: 0, score: 0, hearts: 3, streak: 0, used: new Set(), mission: null, mem: {}, hints: 0, cmds: 0, state: 'playing', history: [] };
  out.innerHTML = '';
  termHtml(`<div class="banner">${icon('gamepad')} チャレンジ: ライフ3つで挑戦！</div>`);
  showView('play');
  beginMission(FIRST_MISSION);
  focusInput();
}

function beginMission(def) {
  const c = game.ch;
  c.n++;
  c.mission = def;
  c.mem = {};
  c.hints = 0;
  c.cmds = 0;
  c.result = null;
  // 進行中の操作が残っていたら中断
  const d = api.teamRepo();
  if (d && d.repo.op && def !== FIRST_MISSION) {
    game.world.cwd = api.teamPath();
    api.sh('git ' + (d.repo.op.type === 'rebase' ? 'rebase' : d.repo.op.type === 'merge' ? 'merge' : d.repo.op.type) + ' --abort');
    addChat('システム', '前のミッションの途中だった操作は中断しました。');
  }
  // 仲間の日常的な push (チームが動いている感)
  if (def !== FIRST_MISSION && Math.random() < 0.35) {
    const r = game.world.remotes[TEAM_URL];
    const log = game.world.tree(r.branches.main)['CHANGELOG.md'] || '# 変更履歴\n';
    const who = Math.random() < 0.5 ? '田中' : '佐藤';
    game.world.teammateCommit(TEAM_URL, 'main', { 'CHANGELOG.md': log + `- ${who}: 細かい修正 #${c.n}\n` }, '細かい修正', who);
    addChat(who, 'ちょっとした修正を main に push しておきました〜');
  }
  try { if (def.setup) def.setup(api, c.mem); } catch (e) { console.error(e); }
  const story = c.mem.story || def.story;
  addChat(def.who, story.replace(/<[^>]+>/g, ''));
  termHtml(`<div class="banner mission-banner">${icon('mail')} ミッション ${c.n}: ${esc(def.title)}</div>`);
  renderAll();
}

function pickNextMission() {
  const c = game.ch;
  const recent = c.history.slice(-4);
  let pool = MISSIONS.filter((m) => !recent.includes(m.id) && !(m.once && c.used.has(m.id)));
  pool = pool.filter((m) => { try { return !m.can || m.can(api); } catch (e) { return false; } });
  if (!pool.length) pool = MISSIONS.filter((m) => { try { return !m.once && (!m.can || m.can(api)); } catch (e) { return false; } });
  if (!pool.length) pool = MISSIONS.filter((m) => ['pull-latest', 'feature-branch', 'release-tag', 'revert-bad', 'merge-feature', 'review-pr'].includes(m.id));
  const m = pool[Math.floor(Math.random() * pool.length)];
  c.used.add(m.id);
  c.history.push(m.id);
  return m;
}

function checkChallenge(events) {
  const c = game.ch;
  if (!c || c.state !== 'playing' || c.result) return;
  c.cmds++;
  const m = c.mission;
  let res = null;
  const fp = events.find((e) => e.type === 'force-push' && e.branch === 'main' && e.lost > 0);
  if (fp && m !== FIRST_MISSION) res = { fail: `force push で main の仲間のコミット ${fp.lost} 件を消してしまった！` };
  if (!res && m.noConflict && events.some((e) => e.type === 'conflict')) res = { fail: '競合を起こしてしまった！ (git merge --abort で戻しておこう)' };
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
  addChat(m.who, api.pick(['ありがとう！完璧です！', '助かりました！', 'さすが！', 'ナイス！その調子！', 'バッチリです！']));
  termHtml(`<div class="banner success">${icon('check-circle')} ミッション成功！ +${pts}点${c.streak > 1 ? ` (${icon('flame')}${c.streak}連続)` : ''}${bonus ? ` (ボーナス +${bonus})` : ''}</div>`);
  confetti();
  renderAll();
}

function missionFail(reason) {
  const c = game.ch;
  c.result = 'fail';
  c.streak = 0;
  c.hearts--;
  c.failReason = reason;
  addChat(c.mission.who, api.pick(['あちゃー…', 'うーん、次は気をつけよう！', 'ドンマイ！']));
  termHtml(`<div class="banner fail">${icon('x-circle')} ミッション失敗: ${esc(reason)}</div>`);
  shake();
  if (c.hearts <= 0) {
    c.state = 'over';
    setTimeout(gameOver, 600);
  }
  renderAll();
}

function gameOver() {
  const c = game.ch;
  const best = save.best;
  showResult({
    title: `${icon('flag')} ゲームオーバー`,
    body: `<p class="big-score">${c.score}</p><p>${c.score >= best ? `${icon('trophy')} ハイスコア！` : `ベスト ${best}`}</p>`,
    actions: [[`${icon('book')} 復習`, () => openLessons()], [`${icon('restart')} もう一度`, () => startChallenge(), 'primary']],
  });
}

function nextMission() {
  const c = game.ch;
  if (c.state !== 'playing') return;
  beginMission(pickNextMission());
}

function skipMission() {
  const c = game.ch;
  if (c.result) return nextMission();
  if (!confirm('ミッションをスキップしますか？ (ライフが1減ります)')) return;
  missionFail('スキップしました');
}

function renderChallengePanel() {
  const c = game.ch;
  const m = c.mission;
  const story = c.mem.story || m.story;
  const hints = (typeof m.hints === 'function' ? m.hints(c.mem) : m.hints) || [];
  const shown = hints.slice(0, c.hints).map((h) => `<li>${esc(h)}</li>`).join('');
  const hp = Math.max(0, c.hearts);
  let actions;
  if (c.state === 'over') actions = `<button class="btn primary" id="btn-retry">${icon('restart')} もう一度</button>`;
  else if (c.result) actions = `<button class="btn primary" id="btn-next">次へ ${icon('play')}</button>`;
  else actions = `<button class="btn" id="btn-hint" ${c.hints >= hints.length ? 'disabled' : ''}>${icon('bulb')} ヒント ${c.hints}/${hints.length}</button><button class="btn ghost" id="btn-skip">スキップ</button>`;
  const status = c.result === 'success' ? `<div class="m-result ok">${icon('check-circle')} 成功！</div>` : c.result === 'fail' ? `<div class="m-result ng">${icon('x-circle')} ${esc(c.failReason)}</div>` : '';
  $('#mission').innerHTML = `
    <div class="m-head">
      <span class="badge challenge">#${c.n}</span>
      <h2>${esc(m.title)}</h2>
      <span class="stats-inline">
        <span class="hearts" title="ライフ">${icon('heart').repeat(hp)}<span class="lost">${icon('heart').repeat(3 - hp)}</span></span>
        ${c.streak > 1 ? `<span class="streak">${icon('flame')}${c.streak}</span>` : ''}
        <span>${c.score}</span>
      </span>
    </div>
    <div class="story"><div class="avatar">${avatar(m.who, 36)}</div><div><p>${story}</p>${m.detail ? `<p class="detail muted">${m.detail}</p>` : ''}</div></div>
    ${shown ? `<ul class="hints">${shown}</ul>` : ''}
    ${status}
    <div class="m-actions">${actions}</div>`;
  $('#mission').querySelectorAll('.story p, .hints li').forEach(addCopyButtons);
  if ($('#btn-hint')) $('#btn-hint').onclick = showHint;
  if ($('#btn-skip')) $('#btn-skip').onclick = skipMission;
  if ($('#btn-next')) $('#btn-next').onclick = nextMission;
  if ($('#btn-retry')) $('#btn-retry').onclick = startChallenge;
}

// ---------- フリーモード ----------
function startFree() {
  game.mode = 'free';
  resetWorld();
  buildTeamRemote(game.world);
  out.innerHTML = '';
  termHtml(`<div class="banner">${icon('flask')} フリー: 何でも試そう</div>`);
  termLine(`git clone ${TEAM_URL}`, 'dim');
  showView('play');
  renderAll();
  focusInput();
}

function renderFreePanel() {
  $('#mission').innerHTML = `
    <div class="m-head"><span class="badge free">フリー</span><h2>仲間を動かす</h2>
      <button class="btn icon" data-act="reset" title="最初から" aria-label="最初から">${icon('restart')}</button></div>
    <div class="free-actions">
      <button class="btn" data-act="push">${icon('users')} main に push</button>
      <button class="btn" data-act="conflict">${icon('zap')} README を変更</button>
      <button class="btn" data-act="branch">${icon('branch')} ブランチを push</button>
      <button class="btn" data-act="pr">${icon('pr')} PR を作成</button>
    </div>`;
  $('#mission').querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => freeAction(b.dataset.act)));
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
    addChat(who, 'main に push しました！');
  } else if (act === 'conflict') {
    const lines = (main['README.md'] || FILES['README.md']).split('\n');
    lines[1] = `カフェのWebサイトです。(${who}が更新 #${freeN})`;
    w.teammateCommit(TEAM_URL, 'main', { 'README.md': lines.join('\n') }, 'READMEの説明を更新', who);
    addChat(who, 'README.md の2行目を書き換えて push しました。あなたも同じ行を変えると競合するかも…？');
  } else if (act === 'branch') {
    const b = `feature/idea-${freeN}`;
    w.teammateCommit(TEAM_URL, b, { [`idea-${freeN}.txt`]: `アイデア ${freeN}\n` }, `アイデア${freeN}を追加`, who, 'main');
    addChat(who, `${b} ブランチを push しました。git fetch して見てみて！`);
  } else if (act === 'pr') {
    const b = `feature/pr-${freeN}`;
    w.teammateCommit(TEAM_URL, b, { [`page-${freeN}.html`]: `<h1>Page ${freeN}</h1>\n` }, `ページ${freeN}を追加`, who, 'main');
    const n = ++w.prCounter;
    r.prs.push({ number: n, title: `ページ${freeN}を追加`, head: b, base: 'main', state: 'open', author: who });
    addChat(who, `PR #${n} を作りました。gh pr list で確認して、gh pr merge ${n} でマージしてね！`);
  }
  renderAll();
}

// ---------- ヒント ----------
function showHint() {
  if (game.mode === 'lesson' && game.lesson && !game.lesson.done) {
    const g = game.lesson;
    g.hintShown[g.step] = true;
    const st = LESSONS[g.idx].steps[g.step];
    termHtml(`${icon('bulb')}<span class="t-hint">ヒント: </span><span class="t-ok">${esc(st.hint)}</span>`, 'hint-line');
    scrollTerm();
    renderAll();
  } else if (game.mode === 'challenge' && game.ch && !game.ch.result) {
    const c = game.ch;
    const hints = (typeof c.mission.hints === 'function' ? c.mission.hints(c.mem) : c.mission.hints) || [];
    if (c.hints < hints.length) c.hints++;
    termHtml(`${icon('bulb')}<span class="t-hint">ヒント: </span>${esc(hints[c.hints - 1] || 'もうヒントはありません')}`, 'hint-line');
    scrollTerm();
    renderAll();
  } else termLine('今はヒントはありません。', 'dim');
}

function showMissionText() {
  if (game.mode === 'challenge' && game.ch) {
    const m = game.ch.mission;
    termHtml(`${icon('mail')}<span class="t-info">${esc((game.ch.mem.story || m.story).replace(/<[^>]+>/g, ''))}</span>`, 'hint-line');
  } else if (game.mode === 'lesson' && game.lesson) {
    const st = LESSONS[game.lesson.idx].steps[game.lesson.step];
    if (st) termHtml(`${icon('book')}<span class="t-info">${esc(st.text.replace(/<[^>]+>/g, ''))}</span>`, 'hint-line');
  }
}

// ---------- チャット ----------
function addChat(who, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg' + (who === 'システム' ? ' sys' : '');
  div.innerHTML = `<span class="avatar">${avatar(who, 26)}</span><div><b>${esc(who)}</b><p>${esc(text)}</p></div>`;
  const box = $('#chat');
  box.appendChild(div);
  while (box.children.length > 30) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  markUpdated('chat');
}

// ---------- 描画 ----------
let lastSig = { graph: '', files: '' };
function renderAll() {
  const w = game.world;
  const repo = w.repo;
  const gsig = repo ? JSON.stringify([repo.branches, repo.remoteRefs, repo.tags, repo.head]) : w.cwd;
  const fsig = repo ? JSON.stringify([w.dir.files, repo.index]) : JSON.stringify(w.dir.files);
  if (lastSig.graph && gsig !== lastSig.graph) markUpdated('graph');
  if (lastSig.files && fsig !== lastSig.files) markUpdated('files');
  lastSig = { graph: gsig, files: fsig };
  renderPrompt();
  if (game.mode === 'lesson' && game.lesson) renderLessonPanel();
  else if (game.mode === 'challenge' && game.ch) renderChallengePanel();
  else renderFreePanel();
  renderGraphPanel();
  renderAreas();
  renderStats();
}

function renderGraphPanel() {
  const w = game.world;
  const repo = w.repo;
  document.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('active', b.dataset.g === game.graphTab));
  const el = $('#graph');
  const remoteUrl = (repo && repo.remotes.origin) || (w.remotes[TEAM_URL] && game.mode !== 'lesson' ? TEAM_URL : null) || Object.keys(w.remotes)[0];
  $('#remote-name').textContent = remoteUrl ? remoteUrl.replace('https://github.com/', '').replace(/\.git$/, '') : '';
  if (game.graphTab === 'local') {
    if (!repo) {
      el.innerHTML = `<div class="graph-empty">${icon('folder', 'big')}<br>ここはまだ Git リポジトリではありません<br><small>git init または git clone で始めよう</small></div>`;
      return;
    }
    renderGraph(el, w, localRefs(repo), { key: 'local:' + w.cwd, headId: headId(repo), empty: 'まだコミットがありません<br><small>git add → git commit で最初のコミットを作ろう</small>' });
  } else {
    const remote = remoteUrl && w.remotes[remoteUrl];
    if (!remote) {
      el.innerHTML = `<div class="graph-empty">${icon('cloud', 'big')}<br>リモートリポジトリはまだありません<br><small>gh repo create &lt;名前&gt; で作れます</small></div>`;
      return;
    }
    const prs = remote.prs.filter((p) => p.state === 'open');
    renderGraph(el, w, remoteRefsOf(remote), { key: 'remote:' + remoteUrl, empty: '空のリポジトリです<br><small>git push で送ってみよう</small>' });
    if (prs.length) el.insertAdjacentHTML('afterbegin', `<div class="pr-list">${prs.map((p) => `<span class="pr">${icon('pr')} PR #${p.number} ${esc(p.title)} <small>${esc(p.head)} → ${esc(p.base)}</small></span>`).join('')}</div>`);
  }
}

function renderAreas() {
  const w = game.world;
  const dir = w.dir;
  const repo = dir.repo;
  const work = $('#area-work .files'), stage = $('#area-stage .files'), head = $('#area-repo .files');
  const chip = (name, cls, mark, tip) => `<button class="chip ${cls}" data-file="${esc(name)}" title="${esc(tip || '')}">${mark ? `<i>${mark}</i>` : ''}${esc(name)}</button>`;
  $('#cwd-label').textContent = w.cwd;
  if (!repo) {
    const files = Object.keys(dir.files).sort();
    work.innerHTML = files.length ? files.map((f) => chip(f, '', '', 'クリックで編集')).join('') : '<span class="empty">(空)</span>';
    stage.innerHTML = '<span class="empty">—</span>';
    head.innerHTML = '<span class="empty">Gitリポジトリではありません</span>';
    $('#opbanner').innerHTML = '';
    $('#stashinfo').textContent = '';
  } else {
    const s = computeStatus(w, dir);
    const tree = w.tree(headId(repo));
    const conf = new Set(s.conflicts.map((c) => c.path));
    const mod = new Map(s.unstaged.map((x) => [x.path, x.kind]));
    const untr = new Set(s.untracked.map((x) => x.path));
    const stg = new Map(s.staged.map((x) => [x.path, x.kind]));
    const wf = [...new Set([...Object.keys(dir.files), ...mod.keys()])].sort();
    work.innerHTML = wf.map((f) => {
      if (conf.has(f)) return chip(f, 'conflict', icon('alert'), '競合中！クリックで編集');
      if (mod.get(f) === 'deleted') return chip(f, 'deleted', 'D', '削除された (未ステージ)');
      if (mod.has(f)) return chip(f, 'modified', 'M', '変更あり (未ステージ) — git add でステージへ');
      if (untr.has(f)) return chip(f, 'untracked', 'U', '未追跡 — git add で追跡開始');
      if (repo.index[f] === undefined) return chip(f, 'ignored', '', '.gitignore で無視されています');
      return chip(f, '', '', '変更なし');
    }).join('') || '<span class="empty">(空)</span>';
    const sf = [...new Set([...Object.keys(repo.index), ...stg.keys()])].sort();
    stage.innerHTML = sf.map((f) => {
      const k = stg.get(f);
      if (k === 'new file') return chip(f, 'staged', 'A', '新規ファイル (コミット待ち)');
      if (k === 'modified') return chip(f, 'staged', 'M', '変更 (コミット待ち)');
      if (k === 'deleted') return chip(f, 'staged deleted', 'D', '削除 (コミット待ち)');
      return chip(f, 'same', '', 'HEAD と同じ');
    }).join('') || '<span class="empty">(空)</span>';
    const hid = headId(repo);
    const hf = Object.keys(tree).sort();
    head.innerHTML = (hid ? `<div class="head-info"><code>${hid.slice(0, 7)}</code> ${esc(w.objects[hid].message.split('\n')[0])}</div>` : '<span class="empty">まだコミットなし</span>') + hf.map((f) => chip(f, 'committed', '', '記録済み')).join('');
    // 進行中の操作
    let banner = '';
    if (repo.op) {
      const name = { merge: 'マージ', rebase: 'リベース', 'cherry-pick': 'チェリーピック', revert: 'リバート' }[repo.op.type];
      banner = s.conflicts.length
        ? `${icon('alert')} ${name}中に競合 (${s.conflicts.map((c) => esc(c.path)).join(', ')}) — ファイルを直して git add → ${repo.op.type === 'merge' ? 'git commit' : `git ${repo.op.type} --continue`}`
        : `${icon('hourglass')} ${name}中 — 競合は解決済み。${repo.op.type === 'merge' ? 'git commit' : `git ${repo.op.type} --continue`} で完了`;
    } else if (s.conflicts.length) banner = `${icon('alert')} 競合中: ${s.conflicts.map((c) => esc(c.path)).join(', ')}`;
    else if (repo.head.type === 'detached') banner = `${icon('link')} detached HEAD — ブランチ上にいません (git switch &lt;ブランチ&gt; で戻る)`;
    $('#opbanner').innerHTML = banner ? `<div class="op">${banner}</div>` : '';
    $('#stashinfo').innerHTML = repo.stash.length ? `${icon('archive')} stash: ${repo.stash.length}件 <small>(${esc(repo.stash[0].message)})</small>` : '';
  }
  document.querySelectorAll('.area .chip').forEach((b) => {
    const area = b.closest('.area').id;
    b.onclick = () => {
      const f = b.dataset.file;
      if (area === 'area-work' && dir.files[f] !== undefined) openEditor(f);
      else viewFile(area, f);
    };
  });
}

function viewFile(area, f) {
  const w = game.world;
  const repo = w.dir.repo;
  let content;
  if (area === 'area-stage') content = repo.index[f];
  else if (area === 'area-repo') content = w.tree(headId(repo))[f];
  else content = w.dir.files[f];
  const label = { 'area-stage': 'ステージ上の', 'area-repo': 'HEAD (最新コミット) の', 'area-work': '' }[area];
  openModal(`${icon('eye')} ${label}${f}`, `<pre class="file-view">${esc(content ?? '(削除)')}</pre>`);
}

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

// ---------- エディタ ----------
let editing = null;
function openEditor(file) {
  const dir = game.world.dir;
  editing = { dir, file };
  const content = dir.files[file] ?? '';
  $('#editor-file').textContent = file + (dir.files[file] === undefined ? ' (新規)' : '');
  const ta = $('#editor-text');
  ta.value = content;
  updateEditorTools();
  $('#editor').classList.add('open');
  setTimeout(() => ta.focus(), 30);
}
function updateEditorTools() {
  const has = hasConflictMarkers($('#editor-text').value);
  $('#conflict-tools').classList.toggle('show', has);
}
$('#editor-text').addEventListener('input', updateEditorTools);
$('#editor-text').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveEditor(); }
  if (e.key === 'Escape') closeEditor();
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const p = t.selectionStart; t.value = t.value.slice(0, p) + '  ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = p + 2; }
});
function resolveConflicts(text, mode) {
  return text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*(\n|$)/gm, (all, ours, theirs) => {
    if (mode === 'ours') return ours;
    if (mode === 'theirs') return theirs;
    return ours + theirs;
  });
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
  afterCommand([{ type: 'file-write', path: f }]);
  scrollTerm();
}
function closeEditor() {
  $('#editor').classList.remove('open');
  editing = null;
  focusInput();
}
$('#editor-save').onclick = saveEditor;
$('#editor-cancel').onclick = closeEditor;

// ---------- モーダル ----------
function openModal(title, html, onReady) {
  $('#modal-title').innerHTML = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.add('open');
  if (onReady) onReady($('#modal-body'));
}
function closeModal() { $('#modal').classList.remove('open'); focusInput(); }
function focusInput() { if (!isMobile()) input.focus(); }
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
    <div class="docs-pane" data-p="cmds"><p class="muted">タップで入力欄へ</p>${cmds}</div>
    <div class="docs-pane hidden" data-p="concepts">${flowSvg()}<div class="concepts">${concepts}</div></div>
    <div class="docs-pane hidden" data-p="refs"><table class="ref-table">${refs}</table></div>`, (box) => {
    box.querySelectorAll('.docs-tabs button').forEach((b) => (b.onclick = () => {
      box.querySelectorAll('.docs-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      box.querySelectorAll('.docs-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    box.querySelectorAll('.cmd-item').forEach((b) => (b.onclick = () => { closeModal(); insertCommand(b.dataset.cmd); }));
  });
}

function flowSvg() {
  return `<div class="flow">
    <span>${icon('folder')} 作業中</span><code>add</code>
    <span>${icon('clipboard')} ステージ</span><code>commit</code>
    <span>${icon('box')} ローカル</span><code>push</code>
    <span>${icon('cloud')} GitHub</span></div>`;
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
function flash(sel) {
  const el = $(sel);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}
function shake() {
  const el = $('#mission');
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
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
    setTimeout(() => p.remove(), 1800);
  }
}

// ---------- 画面とルーティング ----------
// #/ トップ, #/lessons レッスン一覧, #/lesson/N レッスン, #/challenge, #/free
function setScreen(name, title = '') {
  document.body.dataset.screen = name;
  $('#screen-title').textContent = title;
  renderStats();
  if (name !== 'play') closeModal();
}
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function modeTitle() {
  if (game.mode === 'lesson' && game.lesson) return `レッスン ${game.lesson.idx + 1}`;
  if (game.mode === 'challenge') return 'チャレンジ';
  if (game.mode === 'free') return 'フリー';
  return '';
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  let m;
  if (h === 'lessons') return renderLessonSelect();
  if ((m = h.match(/^lesson\/(\d+)$/))) {
    const idx = Math.min(LESSONS.length, Math.max(1, Number(m[1]))) - 1;
    if (!(game.mode === 'lesson' && game.lesson && game.lesson.idx === idx)) startLesson(idx);
    return enterPlay();
  }
  if (h === 'challenge') {
    if (!(game.mode === 'challenge' && game.ch && game.ch.state === 'playing')) startChallenge();
    return enterPlay();
  }
  if (h === 'free') {
    if (game.mode !== 'free') startFree();
    return enterPlay();
  }
  renderHome();
}
function enterPlay() {
  setScreen('play', modeTitle());
  showView('play');
  renderAll();
  focusInput();
}
window.addEventListener('hashchange', route);
$('#btn-home').onclick = () => go('#/');

function nextLessonIdx() {
  const i = LESSONS.findIndex((l) => !save.completed[l.id]);
  return i < 0 ? 0 : i;
}

function renderHome() {
  setScreen('home');
  const done = LESSONS.filter((l) => save.completed[l.id]).length;
  const L = levelInfo(save.xp);
  const playing = game.mode === 'challenge' && game.ch && game.ch.state === 'playing' && game.ch.n > 1;
  $('#home').innerHTML = `
    <div class="home-hero">
      <span class="home-logo">${icon('logo')}</span>
      <h1>HOW<em>to</em>Git</h1>
      <p>Git をゲームで学ぼう</p>
    </div>
    <div class="home-cards">
      <a class="mode-card lesson" href="#/lessons">
        <span class="mode-icon">${icon('book')}</span>
        <span class="mode-body"><b>レッスン</b><small>基本を順番に</small>
          <span class="mode-progress"><i style="width:${(done / LESSONS.length) * 100}%"></i></span></span>
        <span class="mode-meta">${done}/${LESSONS.length}</span>
      </a>
      <a class="mode-card challenge" href="#/challenge">
        <span class="mode-icon">${icon('gamepad')}</span>
        <span class="mode-body"><b>チャレンジ</b><small>${playing ? `続きから (${game.ch.score}点)` : 'ミッションに挑戦'}</small></span>
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

function renderLessonSelect() {
  setScreen('lessons', 'レッスン');
  const next = nextLessonIdx();
  const chNames = { 1: 'ひとりで記録', 2: 'ブランチとマージ', 3: 'チーム開発', 4: '取り消し', 5: '履歴を操る', 6: '実践' };
  let html = '';
  let ch = 0;
  LESSONS.forEach((l, i) => {
    if (l.chapter !== ch) { ch = l.chapter; html += `<h3>${ch}. ${chNames[ch] || ''}</h3>`; }
    html += `<a class="lesson-card ${save.completed[l.id] ? 'cleared' : ''} ${i === next ? 'current' : ''}" href="#/lesson/${i + 1}">
      <span class="num">${save.completed[l.id] ? icon('check') : i + 1}</span><b>${esc(l.title)}</b>${i === next ? '<span class="next-tag">次</span>' : icon('chevron')}</a>`;
  });
  $('#lessons').innerHTML = `<div class="lessons-inner">${html}</div>`;
}

document.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { game.graphTab = b.dataset.g; renderGraphPanel(); }));
$('#btn-docs').onclick = openDocs;
$('#btn-theme').onclick = () => {
  const root = document.documentElement;
  const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('howtogit-theme', root.dataset.theme); } catch (e) { /* 無視 */ }
};
try { const t = localStorage.getItem('howtogit-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* 無視 */ }

// ---------- 起動 ----------
route();

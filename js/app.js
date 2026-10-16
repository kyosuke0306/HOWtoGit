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
  out.appendChild(div);
}
function scrollTerm() { out.scrollTop = out.scrollHeight; }

function promptHtml() {
  const p = game.shell.prompt();
  return `<span class="p-user">${esc(p.user)}@howtogit</span>:<span class="p-path">${esc(p.path)}</span><span class="p-branch">${esc(p.branch)}</span><span class="p-dollar">$</span>`;
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
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = input.value;
    input.value = '';
    histIdx = -1;
    if (v.trim()) runCommand(v);
    else { termHtml(promptHtml(), 'cmdline'); scrollTerm(); }
    return;
  }
  const hist = game.shell.history;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!hist.length) return;
    histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
    input.value = hist[histIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (histIdx < 0) return;
    histIdx++;
    if (histIdx >= hist.length) { histIdx = -1; input.value = ''; } else input.value = hist[histIdx];
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const r = game.shell.complete(input.value);
    if (r.cands.length === 1) input.value = r.prefix + r.cands[0] + ' ';
    else if (r.cands.length > 1) {
      let common = r.cands[0];
      for (const c of r.cands) while (!c.startsWith(common)) common = common.slice(0, -1);
      if (common.length > r.last.length) input.value = r.prefix + common;
      else { termLine(r.cands.join('   '), 'dim'); scrollTerm(); }
    }
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    out.innerHTML = '';
  }
});
$('#terminal').addEventListener('click', (e) => { if (!window.getSelection().toString() && !e.target.closest('button')) input.focus(); });

function insertCommand(cmd) {
  input.value = cmd;
  input.focus();
}

document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => runCommand(b.dataset.cmd)));

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
  termHtml(`<div class="banner">${icon('book')} レッスン ${idx + 1}: ${esc(L.title)}</div>`);
  termLine('ヒントが欲しいときは hint と入力するか、「ヒント」ボタンを押してね。', 'dim');
  enterStep();
  setModeButtons();
  renderAll();
  input.focus();
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
  termHtml(`<div class="banner success">${icon('sparkles')} レッスンクリア！ ${esc(L.outro)}</div>`);
  confetti();
  showResult({
    title: `${icon('sparkles')} レッスンクリア！`,
    body: `<p>${L.outro}</p><p class="xp-gain">+${xp} XP</p>`,
    actions: g.idx + 1 < LESSONS.length
      ? [[`次のレッスンへ ${icon('play')}`, () => startLesson(g.idx + 1), 'primary'], ['このまま触ってみる', null]]
      : [[`${icon('gamepad')} チャレンジモードへ`, () => startChallenge(), 'primary'], ['このまま触ってみる', null]],
  });
}

function renderLessonPanel() {
  const g = game.lesson;
  const L = LESSONS[g.idx];
  const steps = L.steps.map((s, i) => {
    const cls = i < g.step ? 'done' : i === g.step ? 'current' : 'todo';
    const hint = i === g.step && g.hintShown[i] ? `<button class="hint-cmd" data-cmd="${esc(s.hint)}" title="クリックで入力欄に貼り付け"><code>${esc(s.hint)}</code></button>` : '';
    return `<li class="${cls}"><span class="mark">${i < g.step ? icon('check') : i + 1}</span><div>${s.text}${hint}</div></li>`;
  }).join('');
  $('#mission').innerHTML = `
    <div class="m-head">
      <span class="badge">レッスン ${g.idx + 1}/${LESSONS.length}</span>
      <h2>${esc(L.title)}</h2>
      <button class="btn small" id="btn-lessons">${icon('list')} 一覧</button>
    </div>
    <details class="intro" ${g.step === 0 ? 'open' : ''}><summary>解説を読む</summary>${L.intro}</details>
    <ol class="steps">${steps}</ol>
    <div class="m-actions">
      ${g.done ? `<button class="btn primary" id="btn-next-lesson">${g.idx + 1 < LESSONS.length ? `次のレッスンへ ${icon('play')}` : `${icon('gamepad')} チャレンジへ`}</button>` : `<button class="btn" id="btn-hint">${icon('bulb')} ヒント</button>`}
      <button class="btn ghost" id="btn-restart">${icon('restart')} やり直す</button>
    </div>`;
  $('#btn-lessons').onclick = openLessons;
  $('#btn-restart').onclick = () => startLesson(g.idx);
  if ($('#btn-hint')) $('#btn-hint').onclick = showHint;
  if ($('#btn-next-lesson')) $('#btn-next-lesson').onclick = () => (g.idx + 1 < LESSONS.length ? startLesson(g.idx + 1) : startChallenge());
  $('#mission').querySelectorAll('.hint-cmd').forEach((b) => (b.onclick = () => insertCommand(b.dataset.cmd.includes('<') ? b.dataset.cmd.replace(/<[^>]*>/g, '') : b.dataset.cmd)));
  const cur = $('#mission .steps li.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function openLessons() {
  const byCh = {};
  LESSONS.forEach((l, i) => (byCh[l.chapter] = byCh[l.chapter] || []).push([l, i]));
  const chNames = { 1: 'ひとりで記録する', 2: 'ブランチとマージ', 3: 'GitHub とチーム開発', 4: '取り消しと退避', 5: '履歴を操る', 6: '実践テクニック' };
  const html = Object.entries(byCh).map(([ch, ls]) => `
    <h3>第${ch}章 ${chNames[ch] || ''}</h3>
    <div class="lesson-grid">${ls.map(([l, i]) => `
      <button class="lesson-card ${save.completed[l.id] ? 'cleared' : ''}" data-i="${i}">
        <span class="num">${i + 1}</span><b>${esc(l.title)}</b><small>${esc(l.summary)}</small>
        ${save.completed[l.id] ? `<span class="clear-mark">${icon('check')} クリア</span>` : ''}
      </button>`).join('')}</div>`).join('');
  openModal(`${icon('list')} レッスン一覧`, `<p class="muted">上から順番に進めるのがおすすめ。クリアするとXPがもらえます。</p>${html}`, (box) => {
    box.querySelectorAll('.lesson-card').forEach((b) => (b.onclick = () => { closeModal(); startLesson(Number(b.dataset.i)); }));
  });
}

// ---------- チャレンジ ----------
function startChallenge() {
  game.mode = 'challenge';
  resetWorld();
  buildTeamRemote(game.world);
  game.ch = { n: 0, score: 0, hearts: 3, streak: 0, used: new Set(), mission: null, mem: {}, hints: 0, cmds: 0, state: 'playing', history: [] };
  out.innerHTML = '';
  termHtml(`<div class="banner">${icon('gamepad')} チャレンジモード: チームから次々とミッションが届きます。ライフ ${icon('heart', 'heart')} が0になったら終了！</div>`);
  termLine('ミッションの説明は左上のカード、ヒントは「ヒント」ボタンか hint コマンドで。', 'dim');
  setModeButtons();
  beginMission(FIRST_MISSION);
  input.focus();
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
    body: `<p class="big-score">${c.score} 点</p><p>クリアしたミッション: ${c.history.length ? c.n - 1 : 0}${c.score >= best ? `<br>${icon('trophy')} ハイスコア更新！` : `<br>ハイスコア: ${best} 点`}</p>
      <p class="muted">失敗したコマンドの意味は「コマンド辞典」やレッスンで復習しよう。</p>`,
    actions: [[`${icon('restart')} もう一度挑戦`, () => startChallenge(), 'primary'], [`${icon('book')} レッスンで復習`, () => openLessons()]],
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
  let actions;
  if (c.state === 'over') actions = `<button class="btn primary" id="btn-retry">${icon('restart')} もう一度挑戦</button>`;
  else if (c.result) actions = `<button class="btn primary" id="btn-next">次のミッションへ ${icon('play')}</button>`;
  else actions = `<button class="btn" id="btn-hint" ${c.hints >= hints.length ? 'disabled' : ''}>${icon('bulb')} ヒント (${c.hints}/${hints.length})</button><button class="btn ghost" id="btn-skip">スキップ (ライフ -1)</button>`;
  const status = c.result === 'success' ? `<div class="m-result ok">${icon('check-circle')} 成功！</div>` : c.result === 'fail' ? `<div class="m-result ng">${icon('x-circle')} 失敗: ${esc(c.failReason)}</div>` : '';
  $('#mission').innerHTML = `
    <div class="m-head">
      <span class="badge challenge">ミッション ${c.n}</span>
      <h2>${esc(m.title)}</h2>
      <span class="pts">${m.points}pt</span>
    </div>
    <div class="story"><div class="avatar">${avatar(m.who, 40)}</div><div class="bubble"><b>${esc(m.who)}</b><p>${story}</p>${m.detail ? `<p class="detail">${m.detail}</p>` : ''}</div></div>
    ${shown ? `<ul class="hints">${shown}</ul>` : ''}
    ${status}
    <div class="m-actions">${actions}</div>`;
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
  termHtml(`<div class="banner">${icon('flask')} フリーモード: 自由にコマンドを試せる砂場です。</div>`);
  termLine(`チームのリポジトリ: git clone ${TEAM_URL}    自分のプロジェクト: mkdir my-app && cd my-app && git init`, 'dim');
  setModeButtons();
  renderAll();
  input.focus();
}

function renderFreePanel() {
  $('#mission').innerHTML = `
    <div class="m-head"><span class="badge free">フリー</span><h2>砂場モード</h2></div>
    <p class="muted">何をしてもOK！仲間の動きを起こしてチーム開発を体験しよう。</p>
    <div class="free-actions">
      <button class="btn" data-act="push">${icon('users')} 仲間が main に push</button>
      <button class="btn" data-act="conflict">${icon('zap')} 仲間が README を変更 (競合の種)</button>
      <button class="btn" data-act="branch">${icon('branch')} 仲間がブランチを push</button>
      <button class="btn" data-act="pr">${icon('pr')} 仲間が PR を作成</button>
      <button class="btn ghost" data-act="reset">${icon('restart')} 最初から</button>
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
  $('#chat-card').classList.add('has-msg');
}

// ---------- 描画 ----------
function renderAll() {
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
  $('#lv-title').textContent = L.title;
  $('#xpfill').style.width = `${(L.rest / L.need) * 100}%`;
  $('#xp-text').textContent = `${L.rest}/${L.need}`;
  const st = $('#game-stats');
  if (game.mode === 'challenge' && game.ch) {
    const c = game.ch;
    st.innerHTML = `<span class="hearts" title="ライフ">${icon('heart').repeat(Math.max(0, c.hearts))}<span class="lost">${icon('heart').repeat(3 - Math.max(0, c.hearts))}</span></span><span class="score">${c.score}<small>点</small></span>${c.streak > 1 ? `<span class="streak">${icon('flame')}${c.streak}</span>` : ''}<span class="best">BEST ${save.best}</span>`;
  } else if (game.mode === 'lesson') {
    const n = Object.keys(save.completed).filter((k) => LESSONS.some((l) => l.id === k)).length;
    st.innerHTML = `<span class="progress">${icon('book')} ${n}/${LESSONS.length} クリア</span>`;
  } else st.innerHTML = '';
}

function gainXp(n) {
  const before = levelInfo(save.xp).lv;
  save.xp += n;
  persist();
  const after = levelInfo(save.xp);
  if (after.lv > before) toast(`${icon('arrow-up')} レベルアップ！ Lv${after.lv} 「${after.title}」`);
  else toast(`+${n} XP`);
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
  input.focus();
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
function closeModal() { $('#modal').classList.remove('open'); input.focus(); }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal(); });

function showResult({ title, body, actions }) {
  openModal(title, `<div class="result">${body}<div class="result-actions">${actions.map(([t, , cls], i) => `<button class="btn ${cls || ''}" data-i="${i}">${t}</button>`).join('')}</div></div>`, (box) => {
    box.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { closeModal(); const fn = actions[Number(b.dataset.i)][1]; if (fn) fn(); }));
  });
}

function openDocs() {
  const concepts = CONCEPTS.map(([k, v]) => `<div class="concept"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join('');
  const cmds = COMMANDS.map((g) => `<h3>${esc(g.cat)}</h3><table class="cmd-table">${g.items.map(([c, d, ex]) => `<tr><td><code>${esc(c)}</code></td><td>${esc(d)}<br><button class="try" data-cmd="${esc(ex)}">${icon('play')} ${esc(ex)}</button></td></tr>`).join('')}</table>`).join('');
  const refs = REF_SYNTAX.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join('');
  openModal(`${icon('book-open')} コマンド辞典`, `
    <div class="docs-tabs"><button class="active" data-t="concepts">用語</button><button data-t="cmds">コマンド</button><button data-t="refs">コミットの指定</button></div>
    <div class="docs-pane" data-p="concepts"><div class="concepts">${concepts}</div>${flowSvg()}</div>
    <div class="docs-pane hidden" data-p="cmds"><p class="muted">${icon('play')} を押すと入力欄に貼り付けます。</p>${cmds}</div>
    <div class="docs-pane hidden" data-p="refs"><table class="cmd-table">${refs}</table></div>`, (box) => {
    box.querySelectorAll('.docs-tabs button').forEach((b) => (b.onclick = () => {
      box.querySelectorAll('.docs-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      box.querySelectorAll('.docs-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    box.querySelectorAll('.try').forEach((b) => (b.onclick = () => { closeModal(); insertCommand(b.dataset.cmd); }));
  });
}

function flowSvg() {
  return `<div class="flow">
    <div class="flow-box">${icon('folder', 'big')}<b>作業ディレクトリ</b></div><div class="flow-arrow">git add →<br><small>← git restore --staged</small></div>
    <div class="flow-box">${icon('clipboard', 'big')}<b>ステージ</b></div><div class="flow-arrow">git commit →</div>
    <div class="flow-box">${icon('box', 'big')}<b>ローカル<br>リポジトリ</b></div><div class="flow-arrow">git push →<br><small>← git fetch / pull</small></div>
    <div class="flow-box remote">${icon('cloud', 'big')}<b>リモート<br>(GitHub)</b></div></div>`;
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

// ---------- モード切替 ----------
function setModeButtons() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === game.mode));
}
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
  const m = b.dataset.mode;
  if (m === 'lesson') openLessons();
  else if (m === 'challenge') {
    if (game.mode === 'challenge' && game.ch && game.ch.state === 'playing' && !confirm('チャレンジを最初からやり直しますか？')) return;
    startChallenge();
  } else startFree();
}));
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
function firstUncleared() {
  const i = LESSONS.findIndex((l) => !save.completed[l.id]);
  return i < 0 ? 0 : i;
}
startLesson(firstUncleared());
if (!save.welcomed) {
  save.welcomed = true;
  persist();
  openModal(`${icon('logo')} HOW to Git へようこそ！`, `
    <div class="welcome">
      <p>このアプリは、<b>Git の使い方をゲーム感覚で学べる</b>シミュレーターです。本物の Git と同じようなコマンドを、ブラウザの中の疑似ターミナルで打ってみましょう。</p>
      <div class="modes-intro">
        <div><b>${icon('book')} レッスン</b><p>基本から順番に。ステップごとに解説付き。</p></div>
        <div><b>${icon('gamepad')} チャレンジ</b><p>チームからランダムにミッションが届く！競合や force push に注意。</p></div>
        <div><b>${icon('flask')} フリー</b><p>何でも試せる砂場。仲間の push も起こせます。</p></div>
      </div>
      <p>右側には <b>コミットグラフ</b> と <b>ファイルの状態</b> がリアルタイムに表示されます。コマンドを打つたびにどう変化するか見てみよう！</p>
      <p class="muted">※ 実際のファイルやGitHubには一切影響しません。安心して失敗してください。</p>
    </div>`);
}

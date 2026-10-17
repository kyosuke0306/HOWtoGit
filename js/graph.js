// コミットグラフの描画 (縦向き、新しいコミットが上)
import { icon } from './icons.js';

export const LANE_COLORS = ['#3fb950', '#58a6ff', '#d29922', '#bc8cff', '#f778ba', '#39c5cf', '#ff7b72', '#a5d6ff'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// refs: [{name, id, kind: 'branch'|'remote'|'tag'|'head', current}]
export function layout(world, refs) {
  const tips = refs.map((r) => r.id).filter(Boolean);
  const all = new Set();
  tips.forEach((t) => world.ancestors(t).forEach((c) => all.add(c)));
  const ids = [...all].sort((a, b) => world.objects[b].seq - world.objects[a].seq);
  const row = {};
  ids.forEach((id, i) => (row[id] = i));

  // first-parent をたどってチェーン(レーン候補)を作る
  const chainOf = {};
  const chains = [];
  const startChain = (tip) => {
    if (chainOf[tip] !== undefined) return;
    const chain = { ids: [], idx: chains.length };
    let c = tip;
    while (c && chainOf[c] === undefined) {
      chainOf[c] = chain.idx;
      chain.ids.push(c);
      c = world.objects[c].parents[0];
    }
    chains.push(chain);
  };
  refs.forEach((r) => r.id && startChain(r.id));
  ids.forEach((id) => startChain(id));

  // 各チェーンが占有する行の範囲
  const children = {};
  ids.forEach((id) => world.objects[id].parents.forEach((p) => (children[p] = children[p] || []).push(id)));
  for (const ch of chains) {
    let lo = Infinity, hi = -Infinity;
    for (const id of ch.ids) {
      lo = Math.min(lo, row[id]); hi = Math.max(hi, row[id]);
      const p = world.objects[id].parents[0];
      if (p && row[p] !== undefined) hi = Math.max(hi, row[p]);
      for (const k of children[id] || []) if (world.objects[k].parents[0] !== id) lo = Math.min(lo, row[k]);
    }
    ch.lo = lo; ch.hi = hi;
  }
  // 区間が重ならないように列を割り当て
  const cols = [];
  for (const ch of chains) {
    let c = 0;
    while (cols[c] && cols[c].some(([a, b]) => !(ch.hi < a || ch.lo > b))) c++;
    (cols[c] = cols[c] || []).push([ch.lo, ch.hi]);
    ch.col = c;
  }
  const nodes = ids.map((id) => ({ id, row: row[id], col: chains[chainOf[id]].col, color: LANE_COLORS[chains[chainOf[id]].col % LANE_COLORS.length] }));
  const byId = {};
  nodes.forEach((n) => (byId[n.id] = n));
  const edges = [];
  for (const n of nodes) {
    world.objects[n.id].parents.forEach((p, i) => {
      if (byId[p]) edges.push({ from: n, to: byId[p], merge: i > 0 });
    });
  }
  return { nodes, edges, byId, cols: Math.max(1, cols.length) };
}

const DIMS = { full: { row: 38, col: 26, pad: 18, r: 7 }, compact: { row: 28, col: 20, pad: 14, r: 6 } };

function edgePath(e, D) {
  const x1 = D.pad + e.from.col * D.col, y1 = D.pad + e.from.row * D.row;
  const x2 = D.pad + e.to.col * D.col, y2 = D.pad + e.to.row * D.row;
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  if (!e.merge) {
    // 分岐: 子のレーンを下りて、親の直前でカーブ
    const yb = y2 - D.row;
    return `M${x1},${y1} L${x1},${yb} C${x1},${yb + D.row * 0.6} ${x2},${y2 - D.row * 0.4} ${x2},${y2}`;
  }
  // マージ: 子のすぐ下でカーブして、親のレーンを下る
  const ya = y1 + D.row;
  return `M${x1},${y1} C${x1},${y1 + D.row * 0.6} ${x2},${ya - D.row * 0.4} ${x2},${ya} L${x2},${y2}`;
}

const prevIds = new Map();

// 動いた要素をなめらかに移動させる (FLIP)
function measure(container) {
  const base = container.getBoundingClientRect();
  const m = new Map();
  container.querySelectorAll('[data-flip]').forEach((el) => {
    const r = el.getBoundingClientRect();
    m.set(el.dataset.flip, { x: r.left - base.left + container.scrollLeft, y: r.top - base.top + container.scrollTop });
  });
  return m;
}
function animateFrom(container, before) {
  if (!before.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const after = measure(container);
  container.querySelectorAll('[data-flip]').forEach((el) => {
    const a = before.get(el.dataset.flip), b = after.get(el.dataset.flip);
    if (!b) return;
    if (!a) {
      if (el.dataset.flip.startsWith('ref:')) el.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'ease-out' });
      return;
    }
    const dx = a.x - b.x, dy = a.y - b.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

// refs: [{name, id, kind: 'branch'|'remote'|'tag'|'head', current}]
// 画面に合わせた大きさ: 縦は行数、横は列数とラベル分から倍率を決める
function fitDims(base, fit, rows, cols) {
  const byH = fit.h / (base.pad * 2 + Math.max(rows - 1, 0.6) * base.row);
  const byW = (fit.w * 0.5) / (base.pad * 2 + Math.max(cols - 1, 0) * base.col);
  const k = Math.max(1, Math.min(byH, byW, 6));
  return { row: base.row * k, col: base.col * k, pad: base.pad * k, r: base.r * Math.min(k, 2.6), k: Math.min(k, 3) };
}

// 文字を右の余白いっぱいまで大きくする (はみ出すなら縮める)
function fitText(container, avail, D, z = 1, real = avail) {
  const inner = container.firstElementChild;
  let need = 0;
  for (const row of inner.querySelectorAll('.graph-row')) {
    const last = row.lastElementChild;
    if (last) need = Math.max(need, last.getBoundingClientRect().right - row.getBoundingClientRect().left + 14);
  }
  if (!need) return;
  const max = Math.min(4 * z, D.row / 30);
  const k = Math.max(0.8, Math.min(max, D.k * (avail * 0.94) / need));
  inner.style.setProperty('--gk', k.toFixed(3));
  // 余った横幅は左右に分けて、図を真ん中に置く
  const off = Math.max(0, (real - need * k / D.k) / 2 - 8);
  if (off > 0) {
    const lines = inner.querySelector('.graph-lines'), rows = inner.querySelector('.graph-rows');
    lines.style.left = `${off}px`;
    rows.style.left = `${parseFloat(rows.style.left) + off}px`;
  }
}

// opts: key, headId, compact, fit {w, h}, onPick(kind, value), empty
export function renderGraph(container, world, refs, opts = {}) {
  const key = opts.key || 'g';
  let D = opts.compact ? DIMS.compact : DIMS.full;
  if (!refs.some((r) => r.id)) {
    container.innerHTML = `<div class="graph-empty">${opts.empty || 'まだコミットがありません'}</div>`;
    prevIds.set(key, new Set());
    return;
  }
  const before = prevIds.has(key) && !opts.noAnim ? measure(container) : new Map();
  const L = layout(world, refs);
  const z = opts.zoom || 1; // 利用者の拡大縮小
  if (opts.fit) D = fitDims(D, opts.fit, L.nodes.length, L.cols);
  if (opts.fit && z !== 1) D = { row: D.row * z, col: D.col * z, pad: D.pad * z, r: D.r * z, k: D.k * z };
  const old = prevIds.get(key) || new Set();
  const width = D.pad * 2 + (L.cols - 1) * D.col;
  const height = D.pad * 2 + (L.nodes.length - 1) * D.row;
  const headId = opts.headId;
  let svg = `<svg class="graph-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  for (const e of L.edges) {
    const color = e.merge ? e.to.color : e.from.col >= e.to.col ? e.from.color : e.to.color;
    svg += `<path d="${edgePath(e, D)}" stroke="${color}" class="edge${e.merge ? ' merge' : ''}"/>`;
  }
  for (const n of L.nodes) {
    const c = world.objects[n.id];
    const x = D.pad + n.col * D.col, y = D.pad + n.row * D.row;
    const isNew = old.size && !old.has(n.id);
    const cls = ['node', isNew ? 'pop' : ''].join(' ');
    if (n.id === headId) svg += `<circle cx="${x}" cy="${y}" r="${D.r + 5}" class="head-ring"/>`;
    if (c.parents.length > 1) svg += `<circle cx="${x}" cy="${y}" r="${D.r}" fill="var(--bg-raised)" stroke="${n.color}" stroke-width="3" class="${cls}"/>`;
    else svg += `<circle cx="${x}" cy="${y}" r="${D.r}" fill="${n.color}" class="${cls}"/>`;
  }
  svg += '</svg>';

  const refsAt = {};
  refs.forEach((r) => { if (r.id) (refsAt[r.id] = refsAt[r.id] || []).push(r); });
  const easy = world.easy;
  let rows = '';
  for (const n of L.nodes) {
    const c = world.objects[n.id];
    const pills = (refsAt[n.id] || []).map((r) => {
      const k = `${key}:${r.kind}:${r.name}`;
      if (r.kind === 'head') return `<button type="button" class="pill pill-head" data-flip="ref:${k}" data-pick="ref" data-val="HEAD">HEAD</button>`;
      if (r.kind === 'branch') return `<button type="button" class="pill pill-branch${r.current ? ' current' : ''}" data-flip="ref:${k}" data-pick="ref" data-val="${esc(r.name)}">${r.current ? '<b>HEAD</b>' : ''}${esc(r.name)}</button>`;
      if (r.kind === 'remote') return `<button type="button" class="pill pill-remote" data-flip="ref:${k}" data-pick="ref" data-val="${esc(r.name)}">${icon('cloud')}${esc(r.name)}</button>`;
      if (r.kind === 'tag') return `<button type="button" class="pill pill-tag" data-flip="ref:${k}" data-pick="ref" data-val="${esc(r.name)}">${icon('tag')}${esc(r.name)}</button>`;
      return '';
    }).join('');
    const label = c.message.split('\n')[0];
    const isNew = old.size && !old.has(n.id);
    const pickVal = easy && /^C\d+'*$/.test(label) ? label : c.id.slice(0, 7);
    rows += `<div class="graph-row${isNew ? ' row-new' : ''}${n.id === headId ? ' row-head' : ''}" style="top:${D.pad + n.row * D.row - D.row / 2}px;height:${D.row}px" data-flip="row:${key}:${n.id}">`
      + `<button type="button" class="commit-btn" data-pick="commit" data-val="${esc(pickVal)}">`
      + (easy ? `<span class="cname">${esc(label)}</span>` : `<span class="hash">${c.id.slice(0, 7)}</span><span class="msg">${esc(label)}</span>`)
      + `</button>${pills}</div>`;
  }
  container.innerHTML = `<div class="graph-inner${opts.compact ? ' compact' : ''}" style="height:${height}px;--gk:${(D.k || 1).toFixed(3)}"><div class="graph-lines" style="width:${width}px">${svg}</div><div class="graph-rows" style="left:${width + 2}px">${rows}</div></div>`;
  container.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (b && opts.onPick) opts.onPick(b.dataset.pick, b.dataset.val);
  };
  if (opts.fit) fitText(container, opts.fit.w * z - width - 2, D, z, opts.fit.w - width - 2);
  animateFrom(container, before);
  prevIds.set(key, new Set(L.nodes.map((n) => n.id)));
}

export function localRefs(repo) {
  const refs = [];
  const cur = repo.head.type === 'branch' ? repo.head.name : null;
  const names = Object.keys(repo.branches);
  names.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));
  for (const n of names) refs.push({ name: n, id: repo.branches[n], kind: 'branch', current: n === cur });
  if (repo.head.type === 'detached') refs.push({ name: 'HEAD', id: repo.head.id, kind: 'head' });
  for (const [n, id] of Object.entries(repo.remoteRefs)) refs.push({ name: n, id, kind: 'remote' });
  for (const [n, id] of Object.entries(repo.tags)) refs.push({ name: n, id, kind: 'tag' });
  return refs;
}

export function remoteRefsOf(remote) {
  const refs = [];
  const names = Object.keys(remote.branches).sort((a, b) => (a === remote.defaultBranch ? -1 : b === remote.defaultBranch ? 1 : 0));
  for (const n of names) refs.push({ name: n, id: remote.branches[n], kind: 'branch' });
  for (const [n, id] of Object.entries(remote.tags)) refs.push({ name: n, id, kind: 'tag' });
  return refs;
}

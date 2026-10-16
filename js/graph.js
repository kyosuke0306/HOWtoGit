// コミットグラフの描画 (縦向き、新しいコミットが上)

const ROW_H = 34;
const COL_W = 22;
const PAD = 16;
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

function edgePath(e) {
  const x1 = PAD + e.from.col * COL_W, y1 = PAD + e.from.row * ROW_H;
  const x2 = PAD + e.to.col * COL_W, y2 = PAD + e.to.row * ROW_H;
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  if (!e.merge) {
    // 分岐: 子のレーンを下りて、親の直前でカーブ
    const yb = y2 - ROW_H;
    return `M${x1},${y1} L${x1},${yb} C${x1},${yb + ROW_H * 0.6} ${x2},${y2 - ROW_H * 0.4} ${x2},${y2}`;
  }
  // マージ: 子のすぐ下でカーブして、親のレーンを下る
  const ya = y1 + ROW_H;
  return `M${x1},${y1} C${x1},${y1 + ROW_H * 0.6} ${x2},${ya - ROW_H * 0.4} ${x2},${ya} L${x2},${y2}`;
}

let prevIds = new Map();

export function renderGraph(container, world, refs, opts = {}) {
  const key = opts.key || 'g';
  if (!refs.some((r) => r.id)) {
    container.innerHTML = `<div class="graph-empty">${opts.empty || 'まだコミットがありません'}</div>`;
    prevIds.set(key, new Set());
    return;
  }
  const L = layout(world, refs);
  const old = prevIds.get(key) || new Set();
  const width = PAD * 2 + (L.cols - 1) * COL_W;
  const height = PAD * 2 + (L.nodes.length - 1) * ROW_H;
  const headId = opts.headId;
  let svg = `<svg class="graph-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  for (const e of L.edges) {
    const color = e.merge ? e.to.color : e.from.col >= e.to.col ? e.from.color : e.to.color;
    svg += `<path d="${edgePath(e)}" stroke="${color}" class="edge${e.merge ? ' merge' : ''}"/>`;
  }
  for (const n of L.nodes) {
    const c = world.objects[n.id];
    const x = PAD + n.col * COL_W, y = PAD + n.row * ROW_H;
    const isNew = old.size && !old.has(n.id);
    const cls = ['node', isNew ? 'pop' : '', n.id === headId ? 'is-head' : ''].join(' ');
    if (n.id === headId) svg += `<circle cx="${x}" cy="${y}" r="10" class="head-ring"/>`;
    if (c.parents.length > 1) svg += `<circle cx="${x}" cy="${y}" r="7" fill="var(--bg-panel)" stroke="${n.color}" stroke-width="3" class="${cls}"/>`;
    else svg += `<circle cx="${x}" cy="${y}" r="6" fill="${n.color}" class="${cls}"/>`;
  }
  svg += '</svg>';

  const refsAt = {};
  refs.forEach((r) => { if (r.id) (refsAt[r.id] = refsAt[r.id] || []).push(r); });
  let rows = '';
  for (const n of L.nodes) {
    const c = world.objects[n.id];
    const pills = (refsAt[n.id] || []).map((r) => {
      if (r.kind === 'head') return `<span class="pill pill-head">HEAD</span>`;
      if (r.kind === 'branch') return `<span class="pill pill-branch${r.current ? ' current' : ''}">${r.current ? '<b>HEAD →</b> ' : ''}${esc(r.name)}</span>`;
      if (r.kind === 'remote') return `<span class="pill pill-remote">☁ ${esc(r.name)}</span>`;
      if (r.kind === 'tag') return `<span class="pill pill-tag">🏷 ${esc(r.name)}</span>`;
      return '';
    }).join('');
    const parentTree = c.parents[0] ? world.objects[c.parents[0]].tree : {};
    const changed = [...new Set([...Object.keys(parentTree), ...Object.keys(c.tree)])].filter((p) => parentTree[p] !== c.tree[p]);
    const tip = `${c.id.slice(0, 7)} ${c.message}\n作者: ${c.author}\n変更: ${changed.join(', ') || '(なし)'}${c.parents.length > 1 ? '\n(マージコミット)' : ''}`;
    const isNew = old.size && !old.has(n.id);
    rows += `<div class="graph-row${isNew ? ' row-new' : ''}${n.id === headId ? ' row-head' : ''}" style="top:${PAD + n.row * ROW_H - ROW_H / 2}px" title="${esc(tip)}">`
      + `${pills}<span class="hash">${c.id.slice(0, 7)}</span><span class="msg">${esc(c.message.split('\n')[0])}</span><span class="author">${esc(c.author)}</span></div>`;
  }
  container.innerHTML = `<div class="graph-inner" style="height:${height}px"><div class="graph-lines" style="width:${width}px">${svg}</div><div class="graph-rows" style="left:${width + 4}px">${rows}</div></div>`;
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

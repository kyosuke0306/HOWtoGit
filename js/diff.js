// 行単位の差分 (LCS) と 3-way マージ (diff3) の実装

function lcsTable(a, b) {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  return t;
}

// a の各行が b のどの行に対応するか (対応なしは -1)
function matchLines(a, b) {
  const t = lcsTable(a, b);
  const match = new Array(a.length).fill(-1);
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { match[i] = j; i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return match;
}

export function splitLines(text) {
  if (text === undefined || text === null || text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : '';
}

// 差分: [{type:'same'|'add'|'del', line}]
export function diffLines(oldText, newText) {
  const a = splitLines(oldText), b = splitLines(newText);
  const t = lcsTable(a, b);
  const res = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { res.push({ type: 'same', line: a[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) { res.push({ type: 'del', line: a[i] }); i++; }
    else { res.push({ type: 'add', line: b[j] }); j++; }
  }
  while (i < a.length) res.push({ type: 'del', line: a[i++] });
  while (j < b.length) res.push({ type: 'add', line: b[j++] });
  return res;
}

const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

// 3-way マージ。戻り値 {text, conflicts}
export function merge3(baseText, oursText, theirsText, oursLabel = 'HEAD', theirsLabel = 'theirs') {
  const base = splitLines(baseText), ours = splitLines(oursText), theirs = splitLines(theirsText);
  const mo = matchLines(base, ours), mt = matchLines(base, theirs);
  const out = [];
  let conflicts = 0;
  let i = 0, o = 0, t = 0;
  while (i < base.length || o < ours.length || t < theirs.length) {
    if (i < base.length && mo[i] === o && mt[i] === t) {
      out.push(base[i]); i++; o++; t++;
      continue;
    }
    let k = i;
    // 次に「両方と一致し、かつ現在位置以降」の安定行を探す
    while (k < base.length && !(mo[k] >= o && mt[k] >= t)) k++;
    const oEnd = k < base.length ? mo[k] : ours.length;
    const tEnd = k < base.length ? mt[k] : theirs.length;
    const b = base.slice(i, k), oc = ours.slice(o, oEnd), tc = theirs.slice(t, tEnd);
    if (eq(oc, b)) out.push(...tc);
    else if (eq(tc, b)) out.push(...oc);
    else if (eq(oc, tc)) out.push(...oc);
    else {
      conflicts++;
      out.push('<<<<<<< ' + oursLabel, ...oc, '=======', ...tc, '>>>>>>> ' + theirsLabel);
    }
    i = k; o = oEnd; t = tEnd;
  }
  return { text: joinLines(out), conflicts };
}

export function hasConflictMarkers(text) {
  return /^(<<<<<<< |=======$|>>>>>>> )/m.test(text || '');
}

// ツリー同士の 3-way マージ
export function mergeTrees(baseT, oursT, theirsT, oursLabel, theirsLabel) {
  const tree = {}, work = {}, conflicts = [];
  const paths = new Set([...Object.keys(baseT), ...Object.keys(oursT), ...Object.keys(theirsT)]);
  for (const p of [...paths].sort()) {
    const b = baseT[p], o = oursT[p], t = theirsT[p];
    let val;
    if (o === t) val = o;
    else if (b === o) val = t;
    else if (b === t) val = o;
    else if (o === undefined || t === undefined) {
      // 片方が削除・片方が変更
      conflicts.push({ path: p, kind: o === undefined ? 'deleted by us' : 'deleted by them' });
      const keep = o === undefined ? t : o;
      work[p] = keep;
      if (o !== undefined) tree[p] = o;
      continue;
    } else {
      const r = merge3(b ?? '', o, t, oursLabel, theirsLabel);
      if (r.conflicts) {
        conflicts.push({ path: p, kind: b === undefined ? 'both added' : 'both modified' });
        work[p] = r.text;
        tree[p] = o;
        continue;
      }
      val = r.text;
    }
    if (val !== undefined) { tree[p] = val; work[p] = val; }
  }
  return { tree, work, conflicts };
}

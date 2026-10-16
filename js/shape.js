// ブランチの「形」を比べる (コミットIDや中身は無視して、つながりとラベルだけを見る)
import { headId } from './git.js';

// refs: [[名前, コミットID], ...]
function signature(world, refs) {
  const num = new Map();
  const order = [];
  const visit = (id) => {
    if (!id || num.has(id)) return;
    num.set(id, num.size);
    order.push(id);
    for (const p of world.objects[id].parents) visit(p);
  };
  const sorted = refs.filter(([, id]) => id).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  sorted.forEach(([, id]) => visit(id));
  const nodes = order.map((id) => world.objects[id].parents.map((p) => num.get(p)).join(',')).join('|');
  const labels = sorted.map(([n, id]) => `${n}=${num.get(id)}`).join(';');
  return `${nodes}#${labels}`;
}

// 比べる対象: ローカルブランチ・HEAD、必要ならリモート追跡ブランチとリモートの実際の状態
export function repoShape(world, repo, { remote = false } = {}) {
  const refs = Object.entries(repo.branches).map(([n, id]) => ['b:' + n, id]);
  refs.push(['HEAD', headId(repo)]);
  if (repo.head.type === 'branch') refs.push(['HEAD->' + repo.head.name, headId(repo)]);
  Object.entries(repo.tags).forEach(([n, id]) => refs.push(['tag:' + n, id]));
  if (remote) {
    Object.entries(repo.remoteRefs).forEach(([n, id]) => refs.push(['t:' + n, id]));
    for (const [name, url] of Object.entries(repo.remotes)) {
      const r = world.remotes[url];
      if (r) Object.entries(r.branches).forEach(([n, id]) => refs.push([`r:${name}/${n}`, id]));
    }
  }
  return signature(world, refs);
}

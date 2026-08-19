/* ============================================================
   BLOCKS — 街区 ＝ 道路網の「面」
   ------------------------------------------------------------
   平面グラフの面を辿って多角形にする。街区の形は道路が決める。
   （分割で作った多角形に道路を描き足すのとは、ここが決定的に違う）
   ============================================================ */
const Blocks = (() => {

  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  function extract(net) {
    const { nodes, adj, edges } = net;
    const sorted = adj.map((list, v) =>
      list.slice().sort((p, q) =>
        Math.atan2(nodes[p].y - nodes[v].y, nodes[p].x - nodes[v].x) -
        Math.atan2(nodes[q].y - nodes[v].y, nodes[q].x - nodes[v].x)));
    const pos = sorted.map(list => {
      const m = new Map();
      list.forEach((u, i) => m.set(u, i));
      return m;
    });
    const visited = sorted.map(l => new Uint8Array(l.length));
    const faceOf = sorted.map(l => new Int32Array(l.length).fill(-1));
    const faces = [];

    for (let v = 0; v < nodes.length; v++) {
      for (let i = 0; i < sorted[v].length; i++) {
        if (visited[v][i]) continue;
        const ids = [];
        let cv = v, ci = i, guard = 0;
        const fi = faces.length;
        while (guard++ < 20000) {
          if (visited[cv][ci]) break;
          visited[cv][ci] = 1;
          faceOf[cv][ci] = fi;
          ids.push(cv);
          const nv = sorted[cv][ci];
          const j = pos[nv].get(cv);
          if (j === undefined) break;
          const deg = sorted[nv].length;
          cv = nv; ci = (j - 1 + deg) % deg;
          if (cv === v && ci === i) break;
        }
        if (ids.length < 3) { faces.push(null); continue; }
        const pts = ids.map(id => nodes[id]);
        const area = polyArea(pts);
        faces.push({ pts, area, ids });
      }
    }

    // 面積が正の面が街区。最大の面（外側の面）は捨てる
    let maxAbs = 0;
    for (const f of faces) if (f && Math.abs(f.area) > maxAbs) maxAbs = Math.abs(f.area);
    const blocks = [];
    faces.forEach((f, i) => {
      if (!f) return;
      if (Math.abs(f.area) >= maxAbs * 0.98) { f.outer = true; return; }
      if (f.area <= 0) return;
      let cx = 0, cy = 0;
      for (const p of f.pts) { cx += p.x; cy += p.y; }
      f.c = { x: cx / f.pts.length, y: cy / f.pts.length };
      f.index = i;
      blocks.push(f);
    });

    // 辺 → 両側の面
    const edgeFaces = edges.map(e => {
      const i = pos[e.a].get(e.b), j = pos[e.b].get(e.a);
      return [i === undefined ? -1 : faceOf[e.a][i], j === undefined ? -1 : faceOf[e.b][j]];
    });

    return { faces, blocks, edgeFaces };
  }

  /* --- 土地利用の割り当て --- */
  function classify(res, F, cfg, rnd) {
    const bay = cfg.bay;
    for (const b of res.blocks) {
      b.g = F.sdfAt(b.c.x, b.c.y) > 0;                 // 文字の内側の街区か
      // 湾は文字の街区を食わない（文字と水域が溶けて読めなくなるのを防ぐ）
      b.inBay = bay ? (pointInPoly(b.c.x, b.c.y, bay) && !b.g) : false;
      b.tone = rnd();
      b.water = b.inBay;
      b.park = false;
    }
    // 公園（文字の外側にだけ置く）
    const seeds = [];
    for (let i = 0; i < cfg.parks; i++) seeds.push({ x: rnd(), y: rnd(), r: 0.03 + rnd() * 0.06 });
    for (const b of res.blocks) {
      if (b.water) continue;
      if (seeds.some(s => Math.hypot(b.c.x - s.x, b.c.y - s.y) < s.r)) b.park = !b.g;
    }
    // 可読性のチャンネル：文字の領域を水面 / 緑地にする
    if (cfg.channel === 'water') for (const b of res.blocks) { if (b.g) { b.water = true; b.park = false; } }
    if (cfg.channel === 'green') for (const b of res.blocks) { if (b.g) { b.park = true; b.water = false; } }
    // 面ごとの属性を配列に（辺の描画判定用）
    const faceWater = new Uint8Array(res.faces.length);
    for (const b of res.blocks) if (b.water) faceWater[b.index] = 1;
    res.faceWater = faceWater;
    return res;
  }

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  return { extract, classify, polyArea, pointInPoly };
})();

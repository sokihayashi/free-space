/* ============================================================
   NETWORK — 道路網を「成長」させる
   ------------------------------------------------------------
   Parish & Müller 型のエージェント成長。
   区間を提案 → 既存ノードへスナップ / 既存道路と交差したら交差点を作る
   → 近すぎるなら棄却、というローカル制約を通してから確定する。
   提案の長さと方位は Field からしか読まないので、
   文字は「そこだけ街区割りが違う地区」として道路網の中に発生する。
   ============================================================ */
const Network = (() => {

  const TAU = Math.PI * 2;

  class Hash {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
    cellOf(x, y) { return [Math.floor(x / this.cell), Math.floor(y / this.cell)]; }
    put(x, y, id) {
      const [cx, cy] = this.cellOf(x, y), k = this.key(cx, cy);
      let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); }
      a.push(id);
    }
    around(x, y, out) {
      out.length = 0;
      const [cx, cy] = this.cellOf(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = this.m.get(this.key(cx + dx, cy + dy));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
      return out;
    }
  }

  function segInt(p0, p1, q0, q1) {
    const r = { x: p1.x - p0.x, y: p1.y - p0.y };
    const s = { x: q1.x - q0.x, y: q1.y - q0.y };
    const d = r.x * s.y - r.y * s.x;
    if (Math.abs(d) < 1e-12) return null;
    const t = ((q0.x - p0.x) * s.y - (q0.y - p0.y) * s.x) / d;
    const u = ((q0.x - p0.x) * r.y - (q0.y - p0.y) * r.x) / d;
    if (t < 1e-6 || t > 1 || u < 1e-6 || u > 1 - 1e-6) return null;
    return { t, x: p0.x + r.x * t, y: p0.y + r.y * t };
  }

  function grow(F, cfg, rnd) {
    const LO = -0.07, HI = 1.07;
    // 街区は「字画を解像できる細かさ」かつ「街区として妥当な大きさ」でなければならない。
    // 太い字形でも街区が巨大化しないよう、絶対値でも上限をかける。
    const gIn = Math.min(0.011, Math.max(0.0045, F.T * cfg.grainIn));
    const gOut = Math.min(0.030, gIn * cfg.grainRatio);
    const cell = Math.max(gIn, gOut) * 1.15;

    /* --- 場 --- */
    const grainAt = (x, y) => {
      const sd = F.sdfAt(x, y);
      const t = Field.smoothstep(-F.T * 0.18, F.T * 0.18, sd);   // 文字の縁で切り替わる
      const g = gOut + (gIn - gOut) * t;
      const wob = 1 + 0.20 * Math.sin(x * 8.3 + cfg.phase) * Math.sin(y * 7.1 - cfg.phase);
      return g * wob;
    };
    const orientAt = (x, y) => {
      if (F.sdfAt(x, y) > 0) {
        const c = F.compAt(x, y);
        return F.compAngle[c < 0 ? 0 : c % F.compAngle.length];
      }
      let best = 0, bd = 1e9;
      for (const d of F.districts) {
        const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
        if (dd < bd) { bd = dd; best = d.a; }
      }
      return best + 0.20 * Math.sin(x * 3.1 + y * 2.7 + cfg.phase);
    };

    /* --- グラフ --- */
    const nodes = [];
    const adj = [];
    const edges = [];
    const eKey = new Map();
    const nHash = new Hash(cell);
    const eHash = new Hash(cell);

    const addNode = (x, y) => {
      const id = nodes.length;
      nodes.push({ x, y });
      adj.push([]);
      nHash.put(x, y, id);
      return id;
    };
    const isAdj = (a, b) => adj[a].indexOf(b) >= 0;
    const connect = (a, b, rank) => {
      if (a === b || isAdj(a, b)) return -1;
      const id = edges.length;
      edges.push({ a, b, rank });
      adj[a].push(b); adj[b].push(a);
      eKey.set(a < b ? a + ',' + b : b + ',' + a, id);
      const A = nodes[a], B = nodes[b];
      eHash.put(A.x, A.y, id);
      eHash.put(B.x, B.y, id);
      eHash.put((A.x + B.x) / 2, (A.y + B.y) / 2, id);
      return id;
    };

    const buf = [];
    const nearestNode = (x, y, r) => {
      nHash.around(x, y, buf);
      let best = -1, bd = r * r;
      for (const id of buf) {
        const d = (nodes[id].x - x) ** 2 + (nodes[id].y - y) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    };

    const ebuf = [];
    const firstHit = (from, p0, p1) => {
      eHash.around((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, ebuf);
      let best = null;
      for (const id of ebuf) {
        const e = edges[id];
        if (e.a === from || e.b === from) continue;
        const h = segInt(p0, p1, nodes[e.a], nodes[e.b]);
        if (h && (!best || h.t < best.t)) { best = h; best.e = id; }
      }
      return best;
    };

    // 交差点を作る（既存の道路を 2 本に割る）
    const splitEdge = (id, x, y) => {
      const e = edges[id];
      const nid = addNode(x, y);
      const a = e.a, b = e.b, rank = e.rank;
      // 元の辺を a-nid に付け替え、nid-b を新設
      adj[a].splice(adj[a].indexOf(b), 1);
      adj[b].splice(adj[b].indexOf(a), 1);
      eKey.delete(a < b ? a + ',' + b : b + ',' + a);
      edges[id] = { a, b: nid, rank };
      adj[a].push(nid); adj[nid].push(a);
      eKey.set(a < nid ? a + ',' + nid : nid + ',' + a, id);
      const A = nodes[a];
      eHash.put((A.x + x) / 2, (A.y + y) / 2, id);
      connect(nid, b, rank);
      return nid;
    };

    /* --- 提案キュー --- */
    const RANK_LEN = [3.1, 1.9, 1.0];
    const RANK_BRANCH = [0.9, 0.62, 0.30];
    const queue = [];
    const push = (from, ang, rank) => { if (queue.length < 400000) queue.push({ from, ang, rank }); };

    // 方位場に最も沿う 4 方向のうち、進行方向に近いものを選ぶ
    const alignedAngle = (x, y, prev) => {
      const base = orientAt(x, y);
      let best = base, bd = 9;
      for (let k = 0; k < 4; k++) {
        const a = base + k * Math.PI / 2;
        let d = Math.abs(((a - prev + Math.PI) % TAU + TAU) % TAU - Math.PI);
        if (d < bd) { bd = d; best = a; }
      }
      return best;
    };

    const step = (job) => {
      const from = job.from;
      const P = nodes[from];
      const g = grainAt(P.x, P.y);
      const len = g * RANK_LEN[job.rank] * (0.85 + rnd() * 0.3);
      const ang = job.ang + (rnd() - 0.5) * 0.10;
      const q = { x: P.x + Math.cos(ang) * len, y: P.y + Math.sin(ang) * len };
      if (q.x < LO || q.x > HI || q.y < LO || q.y > HI) return;

      const snapR = grainAt(q.x, q.y) * 0.66;
      let to = -1, done = false;

      const near = nearestNode(q.x, q.y, snapR);
      const hit = firstHit(from, P, q);

      if (hit && (near < 0 || Math.hypot(hit.x - P.x, hit.y - P.y) < Math.hypot(nodes[near] ? nodes[near].x - P.x : 9, nodes[near] ? nodes[near].y - P.y : 9))) {
        to = splitEdge(hit.e, hit.x, hit.y);
        done = true;
      } else if (near >= 0) {
        if (near === from || isAdj(from, near)) return;       // 近すぎる → 棄却（密度の上限）
        to = near; done = true;                                // 既存交差点へ接続（袋小路を作らない）
      } else {
        to = addNode(q.x, q.y);
      }
      if (to < 0) return;
      const TN = nodes[to];
      if (Math.hypot(TN.x - P.x, TN.y - P.y) < g * 0.34) return;   // 破片になる短い区間は作らない
      if (connect(from, to, job.rank) < 0) return;
      if (done) return;

      const N = nodes[to];
      const fwd = alignedAngle(N.x, N.y, ang);
      push(to, fwd, job.rank);
      const br = RANK_BRANCH[job.rank];
      const childRank = Math.min(2, job.rank + (rnd() < 0.55 ? 1 : 0));
      if (rnd() < br) push(to, fwd + Math.PI / 2, childRank);
      if (rnd() < br) push(to, fwd - Math.PI / 2, childRank);
    };

    /* --- 文字の境界を道路として先に敷く ---
       上から輪郭線を描くのではなく、成長前のグラフに実在する道路として入れる。
       以降の街路はこれにスナップ・分割されるので、街区は境界をまたがない。 */
    if (cfg.boundary) {
      for (const loop of cfg.boundary) {
        let prev = -1, first = -1;
        for (const p of loop) {
          if (p.x < LO || p.x > HI || p.y < LO || p.y > HI) { prev = -1; continue; }
          const id = addNode(p.x, p.y);
          if (first < 0) first = id;
          if (prev >= 0) connect(prev, id, 1);
          prev = id;
        }
        if (prev >= 0 && first >= 0 && prev !== first) connect(prev, first, 1);
      }
    }

    /* --- 種まき：幹線 --- */
    for (let i = 0; i < cfg.arterials; i++) {
      const x = 0.5 + (rnd() - 0.5) * 1.0, y = 0.5 + (rnd() - 0.5) * 1.0;
      const id = addNode(Math.max(LO, Math.min(HI, x)), Math.max(LO, Math.min(HI, y)));
      const a = orientAt(nodes[id].x, nodes[id].y);
      for (let k = 0; k < 4; k++) push(id, a + k * Math.PI / 2, 0);
    }

    /* --- 方位に沿った格子で種を撒く ---
       軸に平行なグリッドで撒くと網が乱れるので、その場所の基準方位の
       回転座標系で撒く。結果、文字の内側は「計画的な細かい碁盤」、
       外側は「粗い街区」になり、面としての明度差が生まれる。 */
    const seedLattice = (angle, spacing, accept, box) => {
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const cx = box ? (box.x0 + box.x1) / 2 : 0.5;
      const cy = box ? (box.y0 + box.y1) / 2 : 0.5;
      const R = box ? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + spacing : 1.15;
      let count = 0;
      for (let u = -R; u <= R; u += spacing) {
        for (let v = -R; v <= R; v += spacing) {
          const ju = u + (rnd() - 0.5) * spacing * 0.22, jv = v + (rnd() - 0.5) * spacing * 0.22;
          const x = cx + ju * ca - jv * sa, y = cy + ju * sa + jv * ca;
          if (x < LO || x > HI || y < LO || y > HI) continue;
          if (!accept(x, y)) continue;
          if (nearestNode(x, y, spacing * 0.9) >= 0) continue;
          const id = addNode(x, y);
          for (let k = 0; k < 4; k++) push(id, angle + k * Math.PI / 2, 2);
          count++;
        }
      }
      return count;
    };

    const nearestDistrict = (x, y) => {
      let bi = 0, bd = 1e9;
      F.districts.forEach((d, i) => {
        const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      });
      return bi;
    };

    let guard = 0;
    const run = () => {
      while (queue.length && edges.length < cfg.maxEdges && guard++ < cfg.maxSteps) step(queue.shift());
    };
    run();

    // 文字の内側：成分ごとに一貫した細かい碁盤
    if (F.compBox) {
      F.compBox.forEach((box, ci) => {
        if (box.n < 40) return;
        const ang = F.compAngle[ci % F.compAngle.length];
        seedLattice(ang, gIn * 0.98, (x, y) => F.sdfAt(x, y) > gIn * 0.15 && F.compAt(x, y) === ci, box);
      });
      run();
    }
    // 文字の外側：区ごとの粗い街区
    F.districts.forEach((d, di) => {
      seedLattice(d.a, gOut * 0.98, (x, y) => F.sdfAt(x, y) <= 0 && nearestDistrict(x, y) === di, null);
    });
    run();

    // 取り残しの充填
    for (let pass = 0; pass < 2; pass++) {
      let seeded = 0;
      const S = 170;
      for (let iy = 0; iy < S; iy++) for (let ix = 0; ix < S; ix++) {
        const x = (ix + 0.5) / S, y = (iy + 0.5) / S;
        const g = grainAt(x, y);
        if (nearestNode(x, y, g * 1.05) >= 0) continue;
        const id = addNode(x, y);
        const a = orientAt(x, y);
        for (let k = 0; k < 4; k++) push(id, a + k * Math.PI / 2, 2);
        seeded++;
      }
      if (!seeded) break;
      run();
    }

    return { nodes, adj, edges, eKey, gIn, gOut, grainAt, orientAt };
  }

  return { grow };
})();

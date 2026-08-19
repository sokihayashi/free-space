/* ============================================================
   FIELD — アップロードされた字形から「地図の生成条件」を作る
   ------------------------------------------------------------
   文字は線ではなく面。ここで作るのは
     inside : その地点が文字の内側か
     dist   : 文字の縁からの符号付き距離
     grain  : そこに作るべき街区の大きさ（可読性の主チャンネル）
     orient : そこでの道路の基準方位
   道路網はこの場だけを見て成長するので、
   文字は「マスク」ではなく「都市計画の条件」として地図に入る。
   ============================================================ */
const Field = (() => {

  function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* --- 素材を白・不透明のマスクとして描く（アンチエイリアス保持）--- */
  function renderMask(size, src, opt) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    if (!src) return c;

    const m = opt.margin * size, avail = size - 2 * m;
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    const sc = Math.min(avail / iw, avail / ih) * opt.scale;
    const w = iw * sc, h = ih * sc;
    const bx = (size - w) / 2, by = (size - h) / 2 + opt.offsetY * size;
    ctx.drawImage(src, bx, by, w, h);

    const img = ctx.getImageData(0, 0, size, size);
    const px = img.data;
    const thr = opt.threshold;
    for (let i = 0; i < size * size; i++) {
      const a = px[i * 4 + 3] / 255;
      let cov;
      if (opt.useAlpha) cov = a;
      else {
        const lum = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
        cov = 1 - smoothstep(thr - 0.07, thr + 0.07, lum * a + (1 - a));
      }
      if (opt.srcInvert) cov = 1 - cov;
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
      px[i * 4 + 3] = Math.round(clamp(cov, 0, 1) * 255);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* --- チャンファー距離変換 --- */
  function edt(flag, n) {
    const INF = 1e9, A = 1, B = 1.4142136;
    const D = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) D[i] = flag[i] ? 0 : INF;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x; let d = D[i];
      if (x > 0) d = Math.min(d, D[i - 1] + A);
      if (y > 0) d = Math.min(d, D[i - n] + A);
      if (x > 0 && y > 0) d = Math.min(d, D[i - n - 1] + B);
      if (x < n - 1 && y > 0) d = Math.min(d, D[i - n + 1] + B);
      D[i] = d;
    }
    for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x; let d = D[i];
      if (x < n - 1) d = Math.min(d, D[i + 1] + A);
      if (y < n - 1) d = Math.min(d, D[i + n] + A);
      if (x < n - 1 && y < n - 1) d = Math.min(d, D[i + n + 1] + B);
      if (x > 0 && y < n - 1) d = Math.min(d, D[i + n - 1] + B);
      D[i] = d;
    }
    return D;
  }

  /* --- 連結成分（1 文字 ＝ 1 つの街区パターンを持たせるため）--- */
  function components(bin, n) {
    const comp = new Int32Array(n * n).fill(-1);
    const boxes = [];
    let k = 0;
    const st = [];
    for (let i = 0; i < n * n; i++) {
      if (!bin[i] || comp[i] >= 0) continue;
      comp[i] = k; st.length = 0; st.push(i);
      const box = { x0: 9, y0: 9, x1: -9, y1: -9, n: 0 };
      while (st.length) {
        const c = st.pop(), cx = c % n, cy = (c / n) | 0;
        const fx = cx / (n - 1), fy = cy / (n - 1);
        if (fx < box.x0) box.x0 = fx; if (fx > box.x1) box.x1 = fx;
        if (fy < box.y0) box.y0 = fy; if (fy > box.y1) box.y1 = fy;
        box.n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ax = cx + dx, ay = cy + dy;
          if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
          const j = ay * n + ax;
          if (bin[j] && comp[j] < 0) { comp[j] = k; st.push(j); }
        }
      }
      boxes.push(box);
      k++;
    }
    return { comp, count: k, boxes };
  }

  /* --- 等値線（level=0 ＝ 文字の境界）を閉ループとして取り出す --- */
  function contourLoops(D, n, level) {
    const S = 1 / (n - 1);
    const segs = [];
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = D[y * n + x], b = D[y * n + x + 1], c = D[(y + 1) * n + x + 1], d = D[(y + 1) * n + x];
        const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const I = (p, q) => (level - p) / (q - p);
        const T = [(x + I(a, b)) * S, y * S];
        const R = [(x + 1) * S, (y + I(b, c)) * S];
        const B = [(x + I(d, c)) * S, (y + 1) * S];
        const L = [x * S, (y + I(a, d)) * S];
        const put = (p, q) => segs.push([p, q]);
        switch (idx) {
          case 1: case 14: put(L, B); break;
          case 2: case 13: put(B, R); break;
          case 3: case 12: put(L, R); break;
          case 4: case 11: put(T, R); break;
          case 6: case 9:  put(T, B); break;
          case 7: case 8:  put(L, T); break;
          case 5: put(L, T); put(B, R); break;
          case 10: put(T, R); put(L, B); break;
        }
      }
    }
    // 端点でつないで連続した線にする
    const key = p => Math.round(p[0] * 1e6) + '_' + Math.round(p[1] * 1e6);
    const map = new Map();
    segs.forEach((s, i) => {
      for (const p of s) {
        const k = key(p);
        let a = map.get(k); if (!a) { a = []; map.set(k, a); }
        a.push(i);
      }
    });
    const used = new Uint8Array(segs.length);
    const loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const pts = [segs[i][0], segs[i][1]];
      for (let dir = 0; dir < 2; dir++) {
        let guard = 0;
        while (guard++ < 40000) {
          const end = dir ? pts[0] : pts[pts.length - 1];
          const cand = map.get(key(end));
          if (!cand) break;
          let nx = -1;
          for (const j of cand) if (!used[j]) { nx = j; break; }
          if (nx < 0) break;
          used[nx] = 1;
          const s = segs[nx];
          const other = (key(s[0]) === key(end)) ? s[1] : s[0];
          if (dir) pts.unshift(other); else pts.push(other);
        }
      }
      if (pts.length > 3) loops.push(pts.map(p => ({ x: p[0], y: p[1] })));
    }
    return loops;
  }

  /* Ramer–Douglas–Peucker：曲線を直線の連なりにする（＝道路にする） */
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    let maxD = -1, idx = 0;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
    return [a, b];
  }

  /* 閉ループはそのまま RDP にかけると退化するので、最遠点で 2 つに割ってから簡略化する */
  function simplifyLoop(pts, eps) {
    if (pts.length < 5) return pts.slice();
    const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6;
    if (!closed) return rdp(pts, eps);
    let fi = 0, fd = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
      if (d > fd) { fd = d; fi = i; }
    }
    const A = rdp(pts.slice(0, fi + 1), eps);
    const B = rdp(pts.slice(fi), eps);
    return A.slice(0, -1).concat(B.slice(0, -1));
  }

  /* --- 場の構築 --- */
  function build(src, opt, rnd) {
    const n = 384;
    const mask = renderMask(n, src, opt);
    const px = mask.getContext('2d').getImageData(0, 0, n, n).data;
    const inA = new Uint8Array(n * n), outA = new Uint8Array(n * n);
    let ink = 0;
    for (let i = 0; i < n * n; i++) {
      const on = px[i * 4 + 3] > 127;
      inA[i] = on ? 1 : 0; outA[i] = on ? 0 : 1; ink += on ? 1 : 0;
    }
    const dOut = edt(inA, n), dIn = edt(outA, n);
    const D = new Float32Array(n * n);
    let T = 0.001;
    for (let i = 0; i < n * n; i++) {
      D[i] = (inA[i] ? dIn[i] : -dOut[i]) / n;
      if (D[i] > T) T = D[i];
    }
    const { comp, count, boxes } = components(inA, n);

    // 成分ごとの方位（1 文字ごとに街路パターンが揃う）
    const compAngle = [];
    for (let i = 0; i < Math.max(1, count); i++) compAngle.push(rnd() * Math.PI);

    // 区（文字の外側）の方位
    const districts = [];
    for (let i = 0; i < 9; i++) {
      districts.push({ x: rnd(), y: rnd(), a: rnd() * Math.PI });
    }

    const sdfAt = (x, y) => {
      const fx = clamp(x * (n - 1), 0, n - 1.001), fy = clamp(y * (n - 1), 0, n - 1.001);
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      const a = D[iy * n + ix], b = D[iy * n + ix + 1], c = D[(iy + 1) * n + ix], d = D[(iy + 1) * n + ix + 1];
      return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
    const compAt = (x, y) => {
      const ix = clamp(Math.round(x * (n - 1)), 0, n - 1), iy = clamp(Math.round(y * (n - 1)), 0, n - 1);
      return comp[iy * n + ix];
    };

    return {
      n, mask, D, T, ink: ink / (n * n), sdfAt, compAt, compAngle, districts, compBox: boxes,
      inside: (x, y) => sdfAt(x, y) > 0,
      // 文字の境界を「直線の連なり」として返す。これを道路網に植えることで
      // 街区が境界をまたがなくなり、文字の縁が街路の線になる。
      boundary: (eps) => contourLoops(D, n, 0).map(l => simplifyLoop(l, eps)).filter(l => l.length > 2)
    };
  }

  return { build, renderMask, edt, smoothstep, clamp };
})();

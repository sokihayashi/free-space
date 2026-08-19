/* ============================================================
   STATION MAP — typographic city-map generator
   文字（画像 / SVG / テキスト）を「東京的な地図」に変換する p5.js スケッチ
   ------------------------------------------------------------
   考え方:
     1. 入力画像を 2 値マスク（グリフ = 陸地）にする
     2. マスクから符号付き距離場(SDF)を作る → 等深線・駅配置に使う
     3. 陸地の中だけに街路グリッド・幹線・川・公園を描く
        （canvas の destination-in 合成でグリフ形にクリップ）
     4. その上に八方位（octolinear）の路線図と駅マーカーを重ねる
     5. 陸と海のトーン差 + ハローで、サムネイルでも文字が読める
   ============================================================ */

const BASE = 1400;                 // 設計基準サイズ（全ての定数は 1400px 基準）

/* ---------- パレット ------------------------------------------------ */
const PALETTES = {
  paper: {
    name: 'PAPER TOKYO',
    sea:      '#EFE8DC',
    seaLine:  'rgba(120,105,84,0.20)',
    seaDot:   'rgba(120,105,84,0.28)',
    land:     '#16263F',
    landAlt:  '#1B2E4A',
    street:   'rgba(239,232,220,0.30)',
    arterial: 'rgba(239,232,220,0.50)',
    park:     '#2B5B47',
    river:    '#EFE8DC',
    ink:      '#16263F',
    inkSoft:  'rgba(22,38,63,0.55)',
    halo:     'rgba(22,38,63,0.45)',
    marker:   '#EFE8DC',
    markerIn: '#16263F',
    city:     { street: '#F0EAE0', block: ['#1B2E4A', '#16263F', '#22395A'],
                accent: ['#F2A93B', '#E8843A', '#F5C77E'],
                water: '#C3D6DE', accentWater: '#F5C77E',
                park: '#2E6B52', accentPark: '#A8382A' }
  },
  night: {
    name: 'NIGHT HUB',
    sea:      '#0B1220',
    seaLine:  'rgba(255,255,255,0.10)',
    seaDot:   'rgba(255,255,255,0.14)',
    land:     '#F2ECDF',
    landAlt:  '#E9E1D0',
    street:   'rgba(11,18,32,0.20)',
    arterial: 'rgba(11,18,32,0.34)',
    park:     '#C9D9C0',
    river:    '#0B1220',
    ink:      '#F2ECDF',
    inkSoft:  'rgba(242,236,223,0.55)',
    halo:     'rgba(0,0,0,0.55)',
    marker:   '#0B1220',
    markerIn: '#F2ECDF',
    city:     { street: '#0B1220', block: ['#F2ECDF', '#E6DECD', '#FBF6EC'],
                accent: ['#0E2E4E', '#00A7DB', '#123B5C'],
                water: '#13293D', accentWater: '#0E4A63',
                park: '#C6D8C0', accentPark: '#0E8F86' }
  },
  riso: {
    name: 'RISO BLUE',
    sea:      '#F5F0E8',
    seaLine:  'rgba(0,120,191,0.22)',
    seaDot:   'rgba(0,120,191,0.30)',
    land:     '#0078BF',
    landAlt:  '#0F6AA6',
    street:   'rgba(245,240,232,0.30)',
    arterial: 'rgba(245,240,232,0.62)',
    park:     '#00A95C',
    river:    '#F5F0E8',
    ink:      '#0B2B45',
    inkSoft:  'rgba(11,43,69,0.55)',
    halo:     'rgba(11,43,69,0.35)',
    marker:   '#F5F0E8',
    markerIn: '#0B2B45',
    city:     { street: '#F5F0E8', block: ['#0078BF', '#0F6AA6', '#1487D1'],
                accent: ['#FF8FCB', '#FF48B0', '#FFB8DE'],
                water: '#BFE0F2', accentWater: '#FFC9E4',
                park: '#00A95C', accentPark: '#FF9F1C' }
  },
  blueprint: {
    name: 'BLUEPRINT',
    sea:      '#DCE6EC',
    seaLine:  'rgba(20,60,95,0.22)',
    seaDot:   'rgba(20,60,95,0.25)',
    land:     '#0E2E4E',
    landAlt:  '#123A61',
    street:   'rgba(150,215,255,0.32)',
    arterial: 'rgba(190,235,255,0.55)',
    park:     '#17624C',
    river:    '#DCE6EC',
    ink:      '#0E2E4E',
    inkSoft:  'rgba(14,46,78,0.55)',
    halo:     'rgba(14,46,78,0.40)',
    marker:   '#DCE6EC',
    markerIn: '#0E2E4E',
    city:     { street: '#DCE6EC', block: ['#0E2E4E', '#123A61', '#0A2440'],
                accent: ['#E9B44C', '#F0C86A', '#D89A2E'],
                water: '#A9C4D4', accentWater: '#F5DFA8',
                park: '#17624C', accentPark: '#C08A2A' }
  }
};

/* 東京メトロ / JR のライン色を借用（路線図らしさの近道） */
const LINE_COLORS = [
  '#F62E36', // 丸ノ内線
  '#FF9500', // 銀座線
  '#00A7DB', // 東西線
  '#00BB85', // 千代田線
  '#C1A470', // 有楽町線
  '#8F76D6', // 半蔵門線
  '#00AC9B', // 南北線
  '#9ACD32', // 山手線
  '#E85298'  // 京王/私鉄っぽいピンク
];

/* ---------- 状態 ---------------------------------------------------- */
const state = {
  mode: 'district',   // 'district' 街区の色で文字 / 'transit' 文字が路線 / 'coast' 文字が陸地
  octo: 0.7,         // 八方位化の強さ（0 = 素の骨格、1 = 完全な路線図）
  lineW: 1.0,         // 路線の太さ倍率
  plate: true,        // 文字のシルエットを地に薄く敷く
  extend: true,       // 終点を場外へ延長して地図とつなげる
  seed: 7,
  palette: 'paper',
  density: 1.2,       // 街路密度
  railCount: 3,
  margin: 0.08,       // 図郭の内側に確保する余白（固定）
  scale: 1.0,         // 文字の拡大率（1 = 余白いっぱいに収める）
  offsetY: 0,         // 上下位置
  threshold: 0.55,    // 画像の 2 値化しきい値
  srcInvert: false,   // 画像の明暗反転（白文字/黒背景の素材用）
  invert: false,      // 地図反転（文字が「海」になる）
  railsOnLand: true,
  water: true,        // 湾をつくる
  densityFollowsGlyph: true,  // 街区の密度を文字に従わせる
  glyphRoad: true,    // 文字の輪郭を道路として描く
  subPlate: true,     // 副題を駅名標のようなプレートに載せる
  bg: 0.55,          // 路線図モードで背景の街をどれだけ引かせるか（1 = ほぼ無地）
  frame: true,
  compass: true,
  grain: true,
  contours: true,
  subtitle: 'TOKYO CONTENT STATION',
  caption: '35°41′22″N  139°45′01″E',
  text: '東京\nコンテンツ\nステーション',
  font: '700 100px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
  lineGap: 0.92
};

let srcEl = null;      // HTMLImageElement（画像 / SVG 共通）
let srcUsesAlpha = false;
let sdf = null;        // { D:Float32Array, n:int }  正=陸 / 負=海（正規化単位）
let plan = null;       // 生成された地図の設計図（正規化座標）
let grainTile = null;
let out = null;        // 表示用オフスクリーン（BASE px）
let dirty = true;

/* ---------- 乱数 ----------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(1);
const rr = (a = 1, b = 0) => b + (a - b) * rnd();
const ri = (a, b) => Math.floor(rr(b + 1, a));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const lerp2 = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ============================================================
   1. マスク生成
   ============================================================ */
function fitRect(size) {
  const m = state.margin * size;
  const avail = size - 2 * m;
  let iw, ih;
  if (srcEl) { iw = srcEl.naturalWidth || srcEl.width; ih = srcEl.naturalHeight || srcEl.height; }
  else { iw = 1; ih = 1; }
  const sc = Math.min(avail / iw, avail / ih) * state.scale;
  const w = iw * sc, h = ih * sc;
  return { x: (size - w) / 2, y: (size - h) / 2 + state.offsetY * size, w, h };
}

/* グリフを白・不透明で描いた RGBA canvas を返す（アンチエイリアス保持） */
function renderMask(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);

  let box;
  if (srcEl) {
    box = fitRect(size);
    ctx.drawImage(srcEl, box.x, box.y, box.w, box.h);
  } else {
    box = drawTextGlyph(ctx, size);
  }

  const img = ctx.getImageData(0, 0, size, size);
  const px = img.data;
  const thr = state.threshold;
  const useAlpha = srcEl ? srcUsesAlpha : true;
  const x0 = Math.floor(box.x) - 1, x1 = Math.ceil(box.x + box.w) + 1;
  const y0 = Math.floor(box.y) - 1, y1 = Math.ceil(box.y + box.h) + 1;

  for (let y = 0; y < size; y++) {
    const inRowBox = (y >= y0 && y <= y1);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let cov;
      const a = px[i + 3] / 255;
      if (useAlpha) {
        cov = a;
      } else {
        // 透明部分は「白紙」とみなす
        const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        const l = lum * a + (1 - a);
        cov = smoothstep(thr + 0.07, thr - 0.07, l);   // 暗い = 文字
      }
      if (state.srcInvert) {
        cov = (inRowBox && x >= x0 && x <= x1) ? 1 - cov : 0;
      }
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
      px[i + 3] = Math.round(clamp(cov, 0, 1) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  if (state.invert) {
    const c2 = document.createElement('canvas');
    c2.width = c2.height = size;
    const g2 = c2.getContext('2d');
    g2.fillStyle = '#fff';
    g2.fillRect(0, 0, size, size);
    g2.globalCompositeOperation = 'destination-out';
    g2.drawImage(c, 0, 0);
    return c2;
  }
  return c;
}

/* テキスト入力モード：複数行を箱いっぱいに収める */
function drawTextGlyph(ctx, size) {
  const lines = (state.text || '').split('\n').filter(s => s.length);
  if (!lines.length) return { x: 0, y: 0, w: 0, h: 0 };
  const m = state.margin * size;
  const avail = size - 2 * m;
  const probe = 100;
  ctx.font = state.font.replace(/\d+px/, probe + 'px');
  let maxW = 1;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const lh = probe * state.lineGap;
  const totalH = lh * lines.length;
  const sc = Math.min(avail / maxW, avail / totalH) * state.scale;
  const fs = probe * sc;
  ctx.font = state.font.replace(/\d+px/, fs.toFixed(1) + 'px');
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = fs * state.lineGap;
  const cy = size / 2 + state.offsetY * size;
  const y0 = cy - (step * (lines.length - 1)) / 2;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], size / 2, y0 + step * i);
  const bw = maxW * sc, bh = totalH * sc;
  return { x: (size - bw) / 2, y: cy - bh / 2, w: bw, h: bh };
}

/* ============================================================
   2. 符号付き距離場（チャンファー距離変換）
   ============================================================ */
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

function buildSDF(n = 384) {
  const mask = renderMask(n);
  const px = mask.getContext('2d').getImageData(0, 0, n, n).data;
  const inA = new Uint8Array(n * n), outA = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const on = px[i * 4 + 3] > 127;
    inA[i] = on ? 1 : 0;
    outA[i] = on ? 0 : 1;
  }
  const dOut = edt(inA, n);   // 各セル → 最寄りの陸
  const dIn = edt(outA, n);   // 各セル → 最寄りの海
  const D = new Float32Array(n * n);
  let mx = 0;
  for (let i = 0; i < n * n; i++) {
    D[i] = (inA[i] ? dIn[i] : -dOut[i]) / n;
    if (D[i] > mx) mx = D[i];
  }
  // グリフの「太さ」= 陸の最大内接半径。以降の閾値はすべてこれに対する相対値
  sdf = { D, n, max: mx || 0.001 };
}

/* グリフの「太さ」の代表値。反転時に陸が広大になるので上限を設ける */
function glyphT() {
  return clamp(sdf ? sdf.max : 0.02, 0.008, 0.045);
}

function sdfAt(nx, ny) {
  if (!sdf) return -1;
  const n = sdf.n;
  const fx = clamp(nx * (n - 1), 0, n - 1.001);
  const fy = clamp(ny * (n - 1), 0, n - 1.001);
  const x = Math.floor(fx), y = Math.floor(fy);
  const tx = fx - x, ty = fy - y;
  const D = sdf.D;
  const a = D[y * n + x], b = D[y * n + x + 1], c = D[(y + 1) * n + x], d = D[(y + 1) * n + x + 1];
  return lerp2(lerp2(a, b, tx), lerp2(c, d, tx), ty);
}

/* マーチングスクエアで等値線セグメントを取り出す（正規化座標） */
function contourSegments(level) {
  if (!sdf) return [];
  const { D, n } = sdf, segs = [];
  const S = 1 / (n - 1);
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const a = D[y * n + x], b = D[y * n + x + 1], c = D[(y + 1) * n + x + 1], d = D[(y + 1) * n + x];
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const I = (p, q) => (level - p) / (q - p);
      const T = [(x + I(a, b)) * S, y * S];
      const R = [(x + 1) * S, (y + I(b, c)) * S];
      const Bm = [(x + I(d, c)) * S, (y + 1) * S];
      const L = [x * S, (y + I(a, d)) * S];
      switch (idx) {
        case 1: case 14: segs.push([L, Bm]); break;
        case 2: case 13: segs.push([Bm, R]); break;
        case 3: case 12: segs.push([L, R]); break;
        case 4: case 11: segs.push([T, R]); break;
        case 6: case 9:  segs.push([T, Bm]); break;
        case 7: case 8:  segs.push([L, T]); break;
        case 5: segs.push([L, T]); segs.push([Bm, R]); break;
        case 10: segs.push([T, R]); segs.push([L, Bm]); break;
      }
    }
  }
  return segs;
}

/* ============================================================
   3. 設計図（plan）の生成 — すべて正規化座標 0..1
   ============================================================ */

/* Sutherland–Hodgman で半平面クリップ → ボロノイセル */
function clipHalfPlane(poly, p, q) {
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const dx = q.x - p.x, dy = q.y - p.y;
  const inside = v => (v[0] - mx) * dx + (v[1] - my) * dy <= 0;
  const inter = (u, v) => {
    const du = (u[0] - mx) * dx + (u[1] - my) * dy;
    const dv = (v[0] - mx) * dx + (v[1] - my) * dy;
    const t = du / (du - dv);
    return [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
  };
  const outp = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
    const ci = inside(cur), pi = inside(prv);
    if (ci) { if (!pi) outp.push(inter(prv, cur)); outp.push(cur); }
    else if (pi) outp.push(inter(prv, cur));
  }
  return outp;
}

function voronoiCells(seeds) {
  const bounds = [[-0.2, -0.2], [1.2, -0.2], [1.2, 1.2], [-0.2, 1.2]];
  return seeds.map((s, i) => {
    let poly = bounds;
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      poly = clipHalfPlane(poly, s, seeds[j]);
      if (poly.length < 3) break;
    }
    return poly;
  });
}

/* Mitchell の best-candidate — 陸の内側に均等な点を撒く
   （細いグリフでも点が採れるよう、棄却された試行は数えない） */

/* 八方位（水平/垂直/45°）で A→B を結ぶ */
function octoPath(a, b, diagFirst) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  if (adx < 1e-6 || ady < 1e-6) return [a, b];
  let mid;
  if (adx > ady) {
    mid = diagFirst
      ? { x: a.x + sx * ady, y: b.y }              // 斜め → 水平
      : { x: b.x - sx * ady, y: a.y };             // 水平 → 斜め
  } else {
    mid = diagFirst
      ? { x: b.x, y: a.y + sy * adx }              // 斜め → 垂直
      : { x: a.x, y: b.y - sy * adx };             // 垂直 → 斜め
  }
  return [a, mid, b];
}


/* ============================================================
   4. 描画
   ============================================================ */
function polyPath(ctx, poly, size) {
  ctx.beginPath();
  ctx.moveTo(poly[0][0] * size, poly[0][1] * size);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0] * size, poly[i][1] * size);
  ctx.closePath();
}

function polyBounds(poly) {
  let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
  for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 };
}

/* 回転した平行線群（街路） */

function strokePolyline(ctx, pts, size, weight, color, cap = 'round') {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x * size, pts[0].y * size);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * size, pts[i].y * size);
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}


/* --- 等深線（海側）--- */
function drawContours(ctx, size, U, P) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 1; k <= 14; k++) {
    const level = -0.0085 * k;
    const segs = contourSegments(level);
    if (!segs.length) continue;
    ctx.globalAlpha = clamp(1.0 - k * 0.055, 0.10, 1);
    ctx.strokeStyle = P.seaLine;
    ctx.lineWidth = (k === 1 ? 2.0 : k === 2 ? 1.4 : 1.0) * U;
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s[0][0] * size, s[0][1] * size);
      ctx.lineTo(s[1][0] * size, s[1][1] * size);
    }
    ctx.stroke();
  }
  ctx.restore();
}




/* --- 文字（トラッキング付き）--- */
function trackedWidth(g, str, fs, track) {
  g.push();
  g.textFont('DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace');
  g.textSize(fs);
  let w = 0;
  for (const c of [...str]) w += g.textWidth(c) + track;
  g.pop();
  return w - track;
}

function tracked(g, str, cx, y, fs, track, color, align = 'center', halo = 0, haloColor = null) {
  if (halo > 0) {
    const hc = haloColor || PALETTES[state.palette].sea;
    const ctx = g.drawingContext;
    ctx.save();
    ctx.shadowColor = hc;
    ctx.shadowBlur = halo;
    for (let i = 0; i < 5; i++) tracked(g, str, cx, y, fs, track, hc, align, 0);
    ctx.restore();
  }
  g.push();
  g.textFont('DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace');
  g.textSize(fs);
  g.textAlign(g.LEFT, g.BASELINE);
  g.fill(color);
  g.noStroke();
  const chars = [...str];
  let w = 0;
  for (const c of chars) w += g.textWidth(c) + track;
  w -= track;
  let x = align === 'center' ? cx - w / 2 : (align === 'right' ? cx - w : cx);
  for (const c of chars) { g.text(c, x, y); x += g.textWidth(c) + track; }
  g.pop();
  return w;
}

/* --- 地図の“装備品”：枠・方位・注記 ---
   反転モードでは周囲が「陸」になるので、注記の色とハローを入れ替える  */
/* 実際に描かれた画素の明るさを見て、その場所で読める色を選ぶ */
function regionLum(ctx, x, y, w, h) {
  x = clamp(Math.floor(x), 0, ctx.canvas.width - 1);
  y = clamp(Math.floor(y), 0, ctx.canvas.height - 1);
  w = clamp(Math.floor(w), 1, ctx.canvas.width - x);
  h = clamp(Math.floor(h), 1, ctx.canvas.height - y);
  const d = ctx.getImageData(x, y, w, h).data;
  let sum = 0, n = 0;
  const stride = 4 * Math.max(1, Math.floor(d.length / 4 / 4000));
  for (let i = 0; i < d.length; i += stride) { sum += relLum([d[i], d[i + 1], d[i + 2]]); n++; }
  return sum / Math.max(1, n);
}

function inkFor(ctx, P, x, y, w, h) {
  const C = P.city;
  const cands = [P.ink, C.street, C.block[0], C.accent[0]];
  const bl = regionLum(ctx, x, y, w, h);
  let ink = P.ink, best = -1;
  for (const cand of cands) {
    const cl = relLum(parseColor(cand));
    const ratio = (Math.max(cl, bl) + 0.05) / (Math.min(cl, bl) + 0.05);
    if (ratio > best) { best = ratio; ink = cand; }
  }
  const il = relLum(parseColor(ink));
  // ハローは注記と反対の明度側を選ぶ
  let bg = C.street, bd = -1;
  for (const cand of cands) {
    const cl = relLum(parseColor(cand));
    const ratio = (Math.max(cl, il) + 0.05) / (Math.min(cl, il) + 0.05);
    if (ratio > bd) { bd = ratio; bg = cand; }
  }
  return { ink, bg };
}

function furnitureColors(P) {
  return { ink: P.ink, bg: P.city.street };
}

function drawFurniture(g, size, U, P) {
  const ctx = g.drawingContext;
  const F = inkFor(ctx, P, 0, 0, size, size);

  if (state.frame) {
    const m = 34 * U;
    ctx.save();
    ctx.shadowColor = F.bg;
    ctx.shadowBlur = 6 * U;
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = F.ink;
    ctx.lineWidth = 1.6 * U;
    ctx.strokeRect(m, m, size - 2 * m, size - 2 * m);
    ctx.lineWidth = 1.1 * U;
    ctx.beginPath();
    const step = (size - 2 * m) / 24;
    for (let i = 1; i < 24; i++) {
      const t = m + step * i, L = (i % 4 === 0 ? 9 : 5) * U;
      ctx.moveTo(t, m); ctx.lineTo(t, m + L);
      ctx.moveTo(t, size - m); ctx.lineTo(t, size - m - L);
      ctx.moveTo(m, t); ctx.lineTo(m + L, t);
      ctx.moveTo(size - m, t); ctx.lineTo(size - m - L, t);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (state.compass) {
    const cx = size - 92 * U, cy = 92 * U, r = 21 * U;
    const FC = inkFor(ctx, P, cx - 40 * U, cy - 40 * U, 80 * U, 80 * U);
    ctx.save();
    ctx.shadowColor = FC.bg;
    ctx.shadowBlur = 10 * U;
    ctx.strokeStyle = FC.ink;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.5 * U;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.55); ctx.lineTo(cx - r * 0.42, cy + r * 0.5);
    ctx.lineTo(cx, cy + r * 0.16); ctx.lineTo(cx + r * 0.42, cy + r * 0.5);
    ctx.closePath();
    ctx.fillStyle = FC.ink; ctx.fill();
    ctx.restore();
  }

  if (state.caption) {
    const m = 34 * U;
    const FB = inkFor(ctx, P, m, size - m - 46 * U, size - 2 * m, 44 * U);
    ctx.save();
    ctx.globalAlpha = 0.7;
    tracked(g, state.caption, m + 16 * U, size - m - 18 * U, 15 * U, 1.6 * U, FB.ink, 'left', 12 * U, FB.bg);
    const bx = size - m - 16 * U, by = size - m - 22 * U, bw = 108 * U;
    ctx.shadowColor = FB.bg;
    ctx.shadowBlur = 10 * U;
    ctx.strokeStyle = FB.ink; ctx.lineWidth = 1.4 * U;
    ctx.beginPath();
    ctx.moveTo(bx - bw, by); ctx.lineTo(bx, by);
    ctx.moveTo(bx - bw, by - 4 * U); ctx.lineTo(bx - bw, by + 4 * U);
    ctx.moveTo(bx, by - 4 * U); ctx.lineTo(bx, by + 4 * U);
    ctx.moveTo(bx - bw / 2, by - 3 * U); ctx.lineTo(bx - bw / 2, by + 3 * U);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.7;
    tracked(g, '1 km', bx, by + 20 * U, 13 * U, 1.4 * U, FB.ink, 'right', 12 * U, FB.bg);
    ctx.restore();
  }

  if (state.subtitle) {
    const y = size - 96 * U, fs = 30 * U, tr = 9 * U;
    if (state.subPlate) {
      const w = trackedWidth(g, state.subtitle, fs, tr);
      const padX = 34 * U, padT = 26 * U, padB = 20 * U;
      ctx.save();
      ctx.fillStyle = P.ink;
      ctx.fillRect(size / 2 - w / 2 - padX, y - fs * 0.80 - padT * 0.35,
                   w + padX * 2, fs * 1.05 + padT * 0.35 + padB * 0.35);
      ctx.restore();
      tracked(g, state.subtitle, size / 2, y, fs, tr, P.city.street, 'center');
    } else {
      const FS = inkFor(ctx, P, size * 0.15, y - 34 * U, size * 0.7, 46 * U);
      tracked(g, state.subtitle, size / 2, y, fs, tr, FS.ink, 'center', 26 * U, FS.bg);
    }
  }
}

/* --- 紙の粒子 --- */
function makeGrain() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 118 + Math.random() * 60;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
}


function applyGrain(ctx, size) {
  if (!state.grain) return;
  if (!grainTile) makeGrain();
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = ctx.createPattern(grainTile, 'repeat');
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/* ============================================================
   5. p5 のライフサイクル / UI
   ============================================================ */
function setup() {
  const c = createCanvas(BASE, BASE);
  c.parent('canvas-holder');
  pixelDensity(1);
  noLoop();
  makeGrain();
  bindUI();
  rebuildAll();
}

function draw() {
  if (out) image(out, 0, 0, width, height);
}

function rebuildAll() {
  buildSDF(384);
  buildPlan();
  rerender();
}

function rerender() {
  if (out) out.remove();
  out = renderCover(BASE);
  redraw();
  updateThumb();
  updateReadout();
}

/* --- サムネイル（可読性チェック）--- */
function updateThumb() {
  const t = document.getElementById('thumb');
  if (!t || !out) return;
  const ctx = t.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, t.width, t.height);
  ctx.drawImage(out.canvas, 0, 0, t.width, t.height);
}

function parseColor(c) {
  const d = document.createElement('canvas').getContext('2d');
  d.fillStyle = '#000'; d.fillStyle = c;
  const m = d.fillStyle;
  if (m.startsWith('#')) {
    return [parseInt(m.slice(1, 3), 16), parseInt(m.slice(3, 5), 16), parseInt(m.slice(5, 7), 16)];
  }
  const n = m.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2]];
}
function relLum(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function updateReadout() {
  const P = PALETTES[state.palette];
  const fg = state.mode === 'district' ? P.city.accent[0]
           : state.mode === 'transit' ? '#00A7DB' : P.city.block[0];
  const bgc = state.mode === 'coast' ? P.city.water : P.city.block[0];
  const a = relLum(parseColor(fg)), b = relLum(parseColor(bgc));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const el = document.getElementById('contrast');
  if (!el) return;
  const v = ratio.toFixed(1);
  let verdict = 'サムネでも十分に読める';
  if (ratio < 4.5) verdict = 'やや弱い — 小さいサイズで潰れやすい';
  if (ratio < 3) verdict = '要注意 — カバー用途には不足';
  const lbl = state.mode === 'district' ? '文字の街区 / 周囲の街区'
            : state.mode === 'transit' ? '路線 / 街' : '陸 / 海';
  el.textContent = `${lbl} コントラスト比 ${v}:1 — ${verdict}`;
  el.className = 'readout ' + (ratio >= 7 ? 'ok' : ratio >= 4.5 ? 'warn' : 'bad');
}

/* --- 素材の読み込み --- */
function detectAlpha(el) {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, n, n);
  ctx.drawImage(el, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data;
  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
  return clear / (n * n) > 0.02;
}

function loadSource(file) {
  const isSVG = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = () => {
    let url;
    if (isSVG) {
      let txt = String(reader.result);
      // width/height が無い SVG は viewBox から補う（そのままだと描画サイズ 0 になる）
      if (!/<svg[^>]*\swidth=/i.test(txt)) {
        const vb = txt.match(/viewBox\s*=\s*["']([\d.\-\s]+)["']/i);
        if (vb) {
          const p = vb[1].trim().split(/[\s,]+/).map(Number);
          txt = txt.replace(/<svg/i, `<svg width="${p[2]}" height="${p[3]}"`);
        } else {
          txt = txt.replace(/<svg/i, '<svg width="1000" height="1000"');
        }
      }
      url = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
    } else {
      url = String(reader.result);
    }
    const el = new Image();
    el.onload = () => {
      srcEl = el;
      srcUsesAlpha = detectAlpha(el);
      const ai = document.getElementById('srcinvert');
      if (ai) ai.disabled = srcUsesAlpha;
      document.getElementById('srcname').textContent = file.name;
      document.body.classList.add('has-src');
      rebuildAll();
    };
    el.onerror = () => alert('この画像を読み込めませんでした: ' + file.name);
    el.src = url;
  };
  if (isSVG) reader.readAsText(file); else reader.readAsDataURL(file);
}

/* --- 書き出し --- */
function exportPNG(px) {
  const btn = document.getElementById('save' + px);
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '書き出し中…'; }
  setTimeout(() => {
    const g = renderCover(px);
    g.canvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `station-map-${px}-seed${state.seed}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      g.remove();
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    }, 'image/png');
  }, 30);
}

/* --- UI 配線 --- */
function bindUI() {
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

  on('file', 'change', e => { if (e.target.files[0]) loadSource(e.target.files[0]); });
  const holder = document.body;
  holder.addEventListener('dragover', e => { e.preventDefault(); holder.classList.add('drag'); });
  holder.addEventListener('dragleave', () => holder.classList.remove('drag'));
  holder.addEventListener('drop', e => {
    e.preventDefault(); holder.classList.remove('drag');
    if (e.dataTransfer.files[0]) loadSource(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', e => {
    for (const it of e.clipboardData.items) {
      if (it.type.startsWith('image/')) { loadSource(it.getAsFile()); break; }
    }
  });

  on('cleartext', 'click', () => {
    srcEl = null;
    $('srcname').textContent = 'テキストモード';
    $('file').value = '';
    const ai = $('srcinvert'); if (ai) ai.disabled = true;
    document.body.classList.remove('has-src');
    rebuildAll();
  });

  on('text', 'input', e => { state.text = e.target.value; if (!srcEl) rebuildAll(); });
  on('font', 'change', e => {
    state.font = e.target.value;
    if (!srcEl) rebuildAll();
  });
  on('subtitle', 'input', e => { state.subtitle = e.target.value; rerender(); });

  on('seed', 'input', e => { state.seed = +e.target.value; buildPlan(); rerender(); });
  on('dice', 'click', () => {
    state.seed = Math.floor(Math.random() * 9999);
    $('seed').value = state.seed;
    buildPlan(); rerender();
  });
  on('palette', 'change', e => { state.palette = e.target.value; rerender(); });
  on('mode', 'change', e => {
    state.mode = e.target.value;
    document.body.className = document.body.className.replace(/mode-\w+/g, '') + ' mode-' + state.mode;
    buildPlan(); rerender();
  });

  const slider = (id, key, after) => on(id, 'input', e => {
    state[key] = +e.target.value;
    const lab = $(id + '-val');
    if (lab) lab.textContent = e.target.value;
    (after || rerender)();
  });
  slider('density', 'density', () => { buildPlan(); rerender(); });
  slider('rails', 'railCount', () => { buildPlan(); rerender(); });
  slider('scale', 'scale', () => rebuildAll());
  slider('octo', 'octo', () => { buildPlan(); rerender(); });
  slider('linew', 'lineW');
  slider('bg', 'bg');
  slider('offsety', 'offsetY', () => rebuildAll());
  slider('threshold', 'threshold', () => rebuildAll());

  const toggle = (id, key, after) => on(id, 'change', e => {
    state[key] = e.target.checked;
    (after || rerender)();
  });
  toggle('srcinvert', 'srcInvert', () => rebuildAll());
  toggle('invert', 'invert', () => rebuildAll());
  toggle('railsonland', 'railsOnLand');
  toggle('water', 'water', () => { buildPlan(); rerender(); });
  toggle('extend', 'extend');
  toggle('contours', 'contours');
  toggle('glyphroad', 'glyphRoad');
  toggle('subplate', 'subPlate');
  toggle('follow', 'densityFollowsGlyph', () => { buildPlan(); rerender(); });
  toggle('frame', 'frame');
  toggle('compass', 'compass');
  toggle('grain', 'grain');
  toggle('contours', 'contours');

  on('save1400', 'click', () => exportPNG(1400));
  on('save3000', 'click', () => exportPNG(3000));
}

/* ============================================================
   6. TRANSIT モード — 文字そのものを「路線」にする
   ------------------------------------------------------------
   マスクを塗り分けるのではなく、
     細線化(Zhang-Suen) → 骨格グラフ → 折れ線 → 八方位化
   で文字を路線ポリラインに変換し、全面の街地図の上に載せる。
   文字は「地図の中の路線網」として存在するので、
   ステンシルではなくグラフィックとして地図に組み込まれる。
   ============================================================ */

/* --- Zhang-Suen 細線化 --- */
function thinZS(bin, n) {
  const idx = (x, y) => y * n + x;
  let changed = true, guard = 0;
  const toClear = [];
  while (changed && guard++ < 80) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < n - 1; y++) {
        for (let x = 1; x < n - 1; x++) {
          if (!bin[idx(x, y)]) continue;
          const p2 = bin[idx(x, y - 1)], p3 = bin[idx(x + 1, y - 1)], p4 = bin[idx(x + 1, y)],
                p5 = bin[idx(x + 1, y + 1)], p6 = bin[idx(x, y + 1)], p7 = bin[idx(x - 1, y + 1)],
                p8 = bin[idx(x - 1, y)], p9 = bin[idx(x - 1, y - 1)];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toClear.push(idx(x, y));
        }
      }
      if (toClear.length) { changed = true; for (const i of toClear) bin[i] = 0; }
    }
  }
  return bin;
}

/* --- 骨格を折れ線に追跡 --- */
const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function traceSkeleton(bin, n) {
  const idx = (x, y) => y * n + x;
  const deg = new Uint8Array(n * n);
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    if (!bin[idx(x, y)]) continue;
    let d = 0;
    for (const [dx, dy] of NB) if (bin[idx(x + dx, y + dy)]) d++;
    deg[idx(x, y)] = d;
  }
  const visited = new Uint8Array(n * n);
  const polys = [];

  const walk = (sx, sy, dx0, dy0) => {
    const pts = [[sx, sy]];
    let x = sx + dx0, y = sy + dy0;
    let px = sx, py = sy, guard = 0;
    while (guard++ < n * 4) {
      pts.push([x, y]);
      visited[idx(x, y)] = 1;
      if (deg[idx(x, y)] !== 2) break;             // 分岐 or 端点に到達
      let nx = -1, ny = -1;
      for (const [dx, dy] of NB) {
        const ax = x + dx, ay = y + dy;
        if (!bin[idx(ax, ay)]) continue;
        if (ax === px && ay === py) continue;
        nx = ax; ny = ay; break;
      }
      if (nx < 0) break;
      px = x; py = y; x = nx; y = ny;
    }
    return pts;
  };

  // 端点・分岐点から出発
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = idx(x, y);
    if (!bin[i] || deg[i] === 2) continue;
    for (const [dx, dy] of NB) {
      const ax = x + dx, ay = y + dy;
      if (!bin[idx(ax, ay)] || visited[idx(ax, ay)]) continue;
      polys.push(walk(x, y, dx, dy));
    }
    visited[i] = 1;
  }
  // 閉ループ（O や 口 など、分岐点を持たない成分）
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = idx(x, y);
    if (!bin[i] || visited[i] || deg[i] !== 2) continue;
    for (const [dx, dy] of NB) {
      const ax = x + dx, ay = y + dy;
      if (bin[idx(ax, ay)]) { const p = walk(x, y, dx, dy); p.push([x, y]); polys.push(p); break; }
    }
  }
  return polys;
}

/* --- Ramer–Douglas–Peucker --- */
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = -1, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}

/* --- 八方位化：各区間に 45° の肘を入れる（amount で原形とブレンド）--- */
function octoRoute(pts, amount) {
  if (pts.length < 2) return pts.map(p => ({ x: p[0], y: p[1] }));
  const out = [{ x: pts[0][0], y: pts[0][1] }];
  for (let i = 1; i < pts.length; i++) {
    const a = { x: pts[i - 1][0], y: pts[i - 1][1] };
    const b = { x: pts[i][0], y: pts[i][1] };
    const seg = octoPath(a, b, (i % 2) === 0);
    if (seg.length === 3) {
      const m = seg[1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      out.push({ x: lerp2(mid.x, m.x, amount), y: lerp2(mid.y, m.y, amount) });
    }
    out.push(b);
  }
  return out;
}

/* --- 文字 → 路線網 --- */
function buildGlyphNetwork() {
  const N = 384;
  const mask = renderMask(N);
  const px = mask.getContext('2d').getImageData(0, 0, N, N).data;
  const bin = new Uint8Array(N * N);
  let ink = 0;
  for (let i = 0; i < N * N; i++) { bin[i] = px[i * 4 + 3] > 127 ? 1 : 0; ink += bin[i]; }
  if (!ink) return { lines: [], nodes: [] };

  // 細線化の前に連結成分（＝1文字）を求めておく
  const comp = new Int32Array(N * N).fill(-1);
  let nComp = 0;
  const stack = [];
  for (let i = 0; i < N * N; i++) {
    if (!bin[i] || comp[i] >= 0) continue;
    comp[i] = nComp; stack.length = 0; stack.push(i);
    while (stack.length) {
      const c = stack.pop(), cx = c % N, cy = (c / N) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ax = cx + dx, ay = cy + dy;
        if (ax < 0 || ay < 0 || ax >= N || ay >= N) continue;
        const j = ay * N + ax;
        if (bin[j] && comp[j] < 0) { comp[j] = nComp; stack.push(j); }
      }
    }
    nComp++;
  }

  thinZS(bin, N);
  let polys = traceSkeleton(bin, N);

  // グリッド座標 → 正規化 + 細かいヒゲを除去
  const S = 1 / (N - 1);
  const norm = [];
  for (const p of polys) {
    let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (L * S < 0.011) continue;                 // 細線化のヒゲ
    const c0 = comp[Math.round(p[0][1]) * N + Math.round(p[0][0])];
    const arr = p.map(q => [q[0] * S, q[1] * S]);
    arr.comp = c0 < 0 ? 0 : c0;
    norm.push(arr);
  }

  // 平滑化 → 簡略化 → 八方位化
  const lines = [];
  const colors = LINE_COLORS.slice();
  for (let i = colors.length - 1; i > 0; i--) { const j = ri(0, i); [colors[i], colors[j]] = [colors[j], colors[i]]; }
  norm.sort((a, b) => b.length - a.length);
  norm.forEach((p, i) => {
    const sm = [];
    for (let k = 0; k < p.length; k++) {
      const a = p[Math.max(0, k - 2)], b = p[k], c = p[Math.min(p.length - 1, k + 2)];
      sm.push([(a[0] + b[0] * 2 + c[0]) / 4, (a[1] + b[1] * 2 + c[1]) / 4]);
    }
    sm.comp = p.comp;
    const simp = rdp(sm, 0.0065);
    // 同じ区間を 2〜3 本の色違いの線が並走する（実際の路線図の密度感）
    const r = rnd();
    const k = r < 0.34 ? 1 : (r < 0.74 ? 2 : 3);
    const cs = [];
    for (let j = 0; j < k; j++) cs.push(colors[(i * 2 + j + p.comp) % colors.length]);
    lines.push({ pts: octoRoute(simp, state.octo), colors: cs, color: cs[0], comp: p.comp });
  });

  // 端点・分岐点＝駅
  const nodes = [];
  const key = p => p.x.toFixed(3) + ',' + p.y.toFixed(3);
  const seen = new Map();
  for (const l of lines) {
    for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) {
      const k = key(p);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  for (const l of lines) {
    for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) {
      const k = key(p);
      if (nodes.some(n => n.key === k)) continue;
      nodes.push({ key: k, x: p.x, y: p.y, n: seen.get(k) });
    }
    // 途中駅：一定間隔で打つ
    let acc = 0;
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      let t = 0;
      while (acc + d - t > 0.26) {
        const need = 0.26 - acc;
        t += need; acc = 0;
        const q = { x: a.x + (b.x - a.x) * (t / d), y: a.y + (b.y - a.y) * (t / d) };
        const k = key(q);
        if (!nodes.some(nn => nn.key === k)) nodes.push({ key: k, x: q.x, y: q.y, n: 1, minor: true });
      }
      acc += d - t;
    }
  }
  // 近すぎる駅をまとめる（主要駅を優先）
  nodes.sort((a, b) => (a.minor ? 1 : 0) - (b.minor ? 1 : 0));
  const kept = [];
  for (const nd of nodes) {
    if (kept.some(k => Math.hypot(k.x - nd.x, k.y - nd.y) < 0.045)) continue;
    kept.push(nd);
  }
  return { lines, nodes: kept };
}


/* マスクを任意色で塗ったキャンバスを返す */
let _tintCache = null;
function tintMask(mask, size, color) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0, size, size);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, size, size);
  return c;
}

/* --- 文字＝路線の描画 ---------------------------------------
   骨格を 2〜3 本の並走線に展開し、分岐に白いカプセル（乗換駅）、
   終端に丸（終着駅）を置く。路線図の語彙で文字を組み立てる。   */

/* 折れ線の平行オフセット（マイター接合） */
function offsetPolyline(pts, d) {
  if (Math.abs(d) < 1e-9 || pts.length < 2) return pts;
  const nrm = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
    return { x: -dy / L, y: dx / L };
  };
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const n1 = i > 0 ? nrm(pts[i - 1], pts[i]) : nrm(pts[0], pts[1]);
    const n2 = i < pts.length - 1 ? nrm(pts[i], pts[i + 1]) : n1;
    let nx = n1.x + n2.x, ny = n1.y + n2.y;
    const L = Math.hypot(nx, ny) || 1e-9;
    nx /= L; ny /= L;
    const cosA = Math.max(0.4, nx * n1.x + ny * n1.y);
    out.push({ x: pts[i].x + nx * d / cosA, y: pts[i].y + ny * d / cosA });
  }
  return out;
}

function localAngle(pts, x, y) {
  let best = 0, bestD = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = (mx - x) ** 2 + (my - y) ** 2;
    if (d < bestD) { bestD = d; best = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return best;
}

function drawGlyphTransit(ctx, size, U, P, net) {
  const T = glyphT();
  const W = clamp(T * 2 * BASE * 0.78, 10, 70) * state.lineW * U;   // 線束の総幅
  const C = P.city;

  const bundle = l => {
    const k = l.colors.length;
    const w = (W / (k * 1.12)) * (l.feeder ? 0.55 : 1);
    const gap = w * 1.12;
    const paths = [];
    for (let j = 0; j < k; j++) {
      const off = (j - (k - 1) / 2) * gap / size;
      paths.push({ pts: offsetPolyline(l.pts, off), color: l.colors[j], w });
    }
    return paths;
  };

  const feeders = (state.extend && net.feeders) ? net.feeders : [];
  const all = feeders.concat(net.lines);   // 連絡線と文字の路線は同じ 1 つの網

  /* 旧・場外延長（連絡線に置き換え済み） */
  if (false) {
    const cands = [];
    for (const l of net.lines) {
      const pts = l.pts;
      if (pts.length < 2) continue;
      for (const end of [0, 1]) {
        const a = end ? pts[pts.length - 2] : pts[1];
        const b = end ? pts[pts.length - 1] : pts[0];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const out = Math.cos(ang) * (b.x - 0.5) + Math.sin(ang) * (b.y - 0.5);
        if (out <= 0.08) continue;
        cands.push({ b, ang, l, out });
      }
    }
    cands.sort((p, q) => q.out - p.out);
    ctx.save();
    ctx.globalAlpha = 0.3;
    for (const c of cands.slice(0, 4)) {
      const snap = Math.round(c.ang / (Math.PI / 4)) * (Math.PI / 4);
      const L = 0.05 + c.out * 0.18;
      const far = { x: c.b.x + Math.cos(snap) * L, y: c.b.y + Math.sin(snap) * L };
      const w = W / (c.l.colors.length * 1.12);
      strokePolyline(ctx, [c.b, far], size, w + 5 * U, C.street);
      strokePolyline(ctx, [c.b, far], size, w, c.l.colors[0]);
    }
    ctx.restore();
  }

  /* ケーシング（背景色の縁）→ 本線。連絡線も同じ規則で描く */
  for (const l of all) {
    for (const b of bundle(l)) strokePolyline(ctx, b.pts, size, b.w + 6 * U, C.street);
  }
  for (const l of all) {
    for (const b of bundle(l)) strokePolyline(ctx, b.pts, size, b.w, b.color);
  }

  /* 駅 */
  const ink = P.ink;
  for (const nd of net.nodes) {
    const x = nd.x * size, y = nd.y * size;
    if (nd.minor) {
      const r = W * 0.16;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.street; ctx.fill();
      ctx.lineWidth = Math.max(1.5 * U, W * 0.09); ctx.strokeStyle = ink; ctx.stroke();
    } else if (nd.n >= 2) {
      // 乗換駅：白いカプセル
      const line = all.find(l => l.pts.some(p => Math.abs(p.x - nd.x) < 1e-6 && Math.abs(p.y - nd.y) < 1e-6));
      const ang = line ? localAngle(line.pts, nd.x, nd.y) : 0;
      const hw = W * 0.58, hh = W * 0.28, r = hh;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r);
      else ctx.arc(0, 0, hh, 0, Math.PI * 2);
      ctx.fillStyle = C.street; ctx.fill();
      ctx.lineWidth = Math.max(2 * U, W * 0.13); ctx.strokeStyle = ink; ctx.stroke();
      ctx.restore();
    } else {
      // 終着駅：丸
      const r = W * 0.24;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.street; ctx.fill();
      ctx.lineWidth = Math.max(2 * U, W * 0.14); ctx.strokeStyle = ink; ctx.stroke();
    }
  }
}

/* ============================================================
   7. CITY ENGINE — 実際の街区のような密度を作る
   ------------------------------------------------------------
   区（ボロノイ）→ 凸多角形の再帰分割 → 街区(block) + 街路(cut)
   分割の深さがそのまま道路の階層（幹線 → 路地）になる。
   文字は「街区の色が切り替わる領域」として地図に組み込む
   （街路網は文字の内外で連続する ＝ ステンシルではない）。
   ============================================================ */

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
function polyCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

/* 凸多角形を直線（点 c・法線 n）で 2 分割し、切断線分も返す */
function splitPoly(poly, cx, cy, nx, ny) {
  const A = [], B = [], hits = [];
  const side = p => (p[0] - cx) * nx + (p[1] - cy) * ny;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    (sp <= 0 ? A : B).push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      A.push(m); B.push(m); hits.push(m);
    }
  }
  if (A.length < 3 || B.length < 3 || hits.length < 2) return null;
  return { a: A, b: B, cut: [hits[0], hits[1]] };
}

/* 街の密度場：中心ほど細かい街区 */
function cityDensity(x, y, c) {
  const d = Math.hypot(x - c.x, y - c.y);
  const core = Math.exp(-(d * d) / 0.16);
  const wave = 0.5 + 0.5 * Math.sin(x * 11.3 + c.p) * Math.sin(y * 9.7 - c.p);
  // 文字の内側ほど街区が細かくなる ＝ 文字が「都心の密度」として地図の構造に入る
  const g = state.densityFollowsGlyph ? smoothstep(-0.035, 0.006, sdfAt(x, y)) : 0;
  return 0.34 + 0.9 * core + 0.28 * wave + 1.5 * g;
}

function subdivide(poly, depth, ctxOpt, blocks, cuts) {
  const area = polyArea(poly);
  const c = polyCentroid(poly);
  const dens = cityDensity(c[0], c[1], ctxOpt.core);
  const minArea = ctxOpt.base / dens;
  if (depth >= ctxOpt.maxDepth || area < minArea) {
    blocks.push({ poly, depth, c, area });
    return;
  }
  // 分割方向：常に「長い方の軸」に直交して切る（街区が短冊にならない）
  const a1 = ctxOpt.angle, a2 = ctxOpt.angle + Math.PI / 2;
  const ext = a => {
    const nx = Math.cos(a), ny = Math.sin(a);
    let lo = 1e9, hi = -1e9;
    for (const p of poly) { const v = p[0] * nx + p[1] * ny; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo;
  };
  const e1 = ext(a1), e2 = ext(a2);
  let ang = e1 >= e2 ? a1 : a2;
  const r = rnd();
  if (r > 0.94) ang += rr(0.5, -0.5);           // ときどき斜めの道
  // 分割位置（長辺方向なら中央寄り）
  const t = rr(0.60, 0.40);
  const nx = Math.cos(ang), ny = Math.sin(ang);
  let lo = 1e9, hi = -1e9;
  for (const p of poly) { const s = p[0] * nx + p[1] * ny; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  const s = lo + (hi - lo) * t;
  const res = splitPoly(poly, nx * s, ny * s, nx, ny);
  if (!res) { blocks.push({ poly, depth, c, area }); return; }
  cuts.push({ seg: res.cut, depth });
  subdivide(res.a, depth + 1, ctxOpt, blocks, cuts);
  subdivide(res.b, depth + 1, ctxOpt, blocks, cuts);
}

/* 水域（湾・川）を作る：ブロックはここから除かれ、岸は埠頭のようにギザギザになる */
function makeWater() {
  const corner = ri(0, 3);
  const cxy = [[1.05, 1.05], [-0.05, 1.05], [1.05, -0.05], [-0.05, -0.05]][corner];
  const poly = [];
  const R = rr(0.62, 0.42);
  for (let i = 0; i <= 26; i++) {
    const t = (i / 26) * Math.PI * 2;
    const wob = 1 + 0.30 * Math.sin(t * 3 + rr(6)) + 0.16 * Math.sin(t * 5.3);
    poly.push([cxy[0] + Math.cos(t) * R * wob, cxy[1] + Math.sin(t) * R * wob * 0.92]);
  }
  return poly;
}
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildCity() {
  const dens = state.density;
  const core = { x: rr(0.66, 0.34), y: rr(0.66, 0.34), p: rr(6) };
  const nDist = Math.round(clamp(16 * dens, 6, 30));
  const seeds = [];
  for (let i = 0; i < nDist; i++) {
    let best = null, bestD = -1;
    for (let t = 0; t < 14; t++) {
      const p = { x: rr(1.15, -0.15), y: rr(1.15, -0.15) };
      let d = 1e9;
      for (const q of seeds) d = Math.min(d, (q.x - p.x) ** 2 + (q.y - p.y) ** 2);
      if (d > bestD) { bestD = d; best = p; }
    }
    seeds.push(best);
  }
  const cells = voronoiCells(seeds);

  const water = state.water ? makeWater() : null;
  const blocks = [], cuts = [];
  const base = (0.000105 / clamp(dens, 0.5, 2.2));
  cells.forEach((poly, i) => {
    if (poly.length < 3) return;
    subdivide(poly, 0, { angle: rr(Math.PI), base, maxDepth: 15, core }, blocks, cuts);
  });

  // 水域内のブロック・街路を落とす（岸線が街区の形で刻まれる）
  const keep = [];
  for (const b of blocks) {
    if (water && pointInPoly(b.c[0], b.c[1], water)) continue;
    keep.push(b);
  }
  const keepCuts = water
    ? cuts.filter(c => !pointInPoly((c.seg[0][0] + c.seg[1][0]) / 2, (c.seg[0][1] + c.seg[1][1]) / 2, water))
    : cuts;

  // 公園・緑地：まとまった数ブロックを緑に
  const parkSeeds = [];
  for (let i = 0; i < Math.round(7 * dens); i++) parkSeeds.push({ x: rr(1), y: rr(1), r: rr(0.075, 0.028) });
  for (const b of keep) {
    b.park = parkSeeds.some(p => Math.hypot(b.c[0] - p.x, b.c[1] - p.y) < p.r);
    b.tone = Math.floor(rnd() * 3);
    b.hue = Math.floor(rnd() * 3);
  }

  // 幹線（都市を貫く長い道）
  const highways = [];
  for (let i = 0; i < Math.round(3 * dens) + 2; i++) {
    let a = rr(Math.PI * 2);
    let p = { x: rr(1.1, -0.1), y: rr(1.1, -0.1) };
    const pts = [p];
    for (let s = 0; s < 120; s++) {
      a += rr(0.10, -0.10);
      p = { x: p.x + Math.cos(a) * 0.015, y: p.y + Math.sin(a) * 0.015 };
      pts.push(p);
      if (p.x < -0.12 || p.x > 1.12 || p.y < -0.12 || p.y > 1.12) break;
    }
    highways.push(pts);
  }

  return { blocks: keep, cuts: keepCuts, water, highways, core };
}

/* 文字の輪郭を 1 本の道路として描く（マスクの縁ではなく地図の要素にする）*/
function drawGlyphRoad(ctx, size, U, P, wMul = 1) {
  const segs = contourSegments(0);
  if (!segs.length) return;
  const C = P.city;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.street;
  ctx.lineWidth = 5.2 * U * wMul;
  ctx.beginPath();
  for (const sg of segs) {
    ctx.moveTo(sg[0][0] * size, sg[0][1] * size);
    ctx.lineTo(sg[1][0] * size, sg[1][1] * size);
  }
  ctx.stroke();
  ctx.restore();
}

/* --- 街の描画（tone: 'base' | 'accent'）--- */
function drawCity(ctx, size, U, P, city, tone) {
  const C = P.city;
  const fills = tone === 'accent' ? C.accent : C.block;
  ctx.fillStyle = C.street;
  ctx.fillRect(0, 0, size, size);

  if (city.water) {
    ctx.fillStyle = tone === 'accent' ? C.accentWater : C.water;
    ctx.beginPath();
    ctx.moveTo(city.water[0][0] * size, city.water[0][1] * size);
    for (let i = 1; i < city.water.length; i++) ctx.lineTo(city.water[i][0] * size, city.water[i][1] * size);
    ctx.closePath(); ctx.fill();
  }

  for (const b of city.blocks) {
    ctx.fillStyle = b.park
      ? (tone === 'accent' ? C.accentPark : C.park)
      : fills[b.hue % fills.length];
    const p = b.poly;
    ctx.beginPath();
    ctx.moveTo(p[0][0] * size, p[0][1] * size);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * size, p[i][1] * size);
    ctx.closePath();
    ctx.fill();
  }

  // 街路（分割の深さ ＝ 道路の階層）
  ctx.strokeStyle = C.street;
  ctx.lineCap = 'round';
  for (let d = 14; d >= 0; d--) {
    let any = false;
    ctx.beginPath();
    for (const c of city.cuts) {
      if (c.depth !== d) continue;
      any = true;
      ctx.moveTo(c.seg[0][0] * size, c.seg[0][1] * size);
      ctx.lineTo(c.seg[1][0] * size, c.seg[1][1] * size);
    }
    if (!any) continue;
    ctx.lineWidth = clamp(5.4 - d * 0.62, 0.85, 5.4) * U;
    ctx.stroke();
  }

  // 幹線（水域の上には引かない）
  for (const h of city.highways) {
    let run = [];
    for (const p of h) {
      const wet = city.water && pointInPoly(p.x, p.y, city.water);
      if (wet) { if (run.length > 1) strokePolyline(ctx, run, size, 3.4 * U, C.street); run = []; }
      else run.push(p);
    }
    if (run.length > 1) strokePolyline(ctx, run, size, 3.4 * U, C.street);
  }
}

/* ============================================================
   8. 設計図の生成 / 全体の描画
   ============================================================ */
/* 文字の路線網から生える連絡線。
   文字を「地図の上に置いた図」ではなく「網の密な部分」にするための接続。 */
function buildFeeders(net) {
  if (!net || !net.lines.length) return [];
  const terms = [];
  for (const l of net.lines) {
    const pts = l.pts;
    if (pts.length < 2) continue;
    for (const end of [0, 1]) {
      const a = end ? pts[pts.length - 2] : pts[1];
      const b = end ? pts[pts.length - 1] : pts[0];
      terms.push({ p: b, ang: Math.atan2(b.y - a.y, b.x - a.x), color: l.colors[0] });
    }
  }
  if (!terms.length) return [];
  const feeders = [];
  const n = clamp(state.railCount, 0, 9);
  const usedT = new Set();
  for (let i = 0; i < n; i++) {
    // 起点：まだ使っていない終端
    let ti = -1;
    for (let k = 0; k < 40; k++) { const c = ri(0, terms.length - 1); if (!usedT.has(c)) { ti = c; break; } }
    if (ti < 0) ti = ri(0, terms.length - 1);
    usedT.add(ti);
    const t = terms[ti];

    const pts = [t.p];
    let joinsAnother = rnd() < 0.45 && terms.length > 4;
    if (joinsAnother) {
      // 別の文字の終端まで走る＝語をまたいで網がつながる
      let bestJ = -1, bestD = 1e9;
      for (let k = 0; k < terms.length; k++) {
        if (k === ti || usedT.has(k)) continue;
        const d = Math.hypot(terms[k].p.x - t.p.x, terms[k].p.y - t.p.y);
        if (d > 0.12 && d < bestD) { bestD = d; bestJ = k; }
      }
      if (bestJ >= 0) { usedT.add(bestJ); pts.push(terms[bestJ].p); }
      else joinsAnother = false;
    }
    if (!joinsAnother) {
      // 場外へ抜ける：外向きに 1〜2 回折れてから画面の外へ
      const snap = Math.round(t.ang / (Math.PI / 4)) * (Math.PI / 4);
      let p = { x: t.p.x + Math.cos(snap) * rr(0.12, 0.05), y: t.p.y + Math.sin(snap) * rr(0.12, 0.05) };
      pts.push(p);
      const turns = 1;
      let a = snap;
      for (let k = 0; k < turns; k++) {
        a += (rnd() < 0.5 ? 1 : -1) * (Math.PI / 4) * ri(1, 2);
        const L = rr(0.30, 0.14);
        p = { x: p.x + Math.cos(a) * L, y: p.y + Math.sin(a) * L };
        pts.push(p);
      }
    }
    const path = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const seg = octoPath(pts[k - 1], pts[k], rnd() < 0.5);
      for (let j = 1; j < seg.length; j++) path.push(seg[j]);
    }
    feeders.push({ pts: path, colors: [t.color], color: t.color, feeder: true });
  }
  return feeders;
}

function buildBackgroundLines() {
  const lines = [];
  const n = clamp(state.railCount, 0, 9);
  for (let i = 0; i < n; i++) {
    const th = (i / Math.max(1, n)) * Math.PI + rr(0.4, -0.4);
    const dir = { x: Math.cos(th), y: Math.sin(th) };
    const pts = [];
    for (let k = 0; k < 6; k++) pts.push({ x: rr(1.08, -0.08), y: rr(1.08, -0.08) });
    pts.sort((a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y));
    const path = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const seg = octoPath(pts[k - 1], pts[k], rnd() < 0.5);
      for (let j = 1; j < seg.length; j++) path.push(seg[j]);
    }
    lines.push({ path });
  }
  return lines;
}

function buildPlan() {
  rnd = mulberry32(state.seed * 2654435761 % 2147483647);
  const city = buildCity();
  const net = state.mode === 'transit' ? buildGlyphNetwork() : null;
  if (net) {
    const feeders = buildFeeders(net);
    // 連絡線の折れ点にも同じ規則で駅を置く（様式に差をつけない）
    for (const f of feeders) {
      for (let i = 1; i < f.pts.length - 1; i += 2) {
        const q = f.pts[i];
        if (net.nodes.some(nd => Math.hypot(nd.x - q.x, nd.y - q.y) < 0.05)) continue;
        if (q.x < -0.02 || q.x > 1.02 || q.y < -0.02 || q.y > 1.02) continue;
        net.nodes.push({ key: 'f' + i + q.x.toFixed(3), x: q.x, y: q.y, n: 1, minor: true });
      }
    }
    net.feeders = feeders;
  }
  plan = { city, net };
}

/* マスクの外側に色のリングを落として、文字の輪郭を締める */
function edgeHalo(ctx, mask, size, color, blur, times = 2) {
  ctx.save();
  ctx.shadowOffsetX = size * 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  for (let i = 0; i < times; i++) ctx.drawImage(mask, -size * 2, 0, size, size);
  ctx.restore();
}

function renderCover(size) {
  const P = PALETTES[state.palette];
  const C = P.city;
  const U = size / BASE;
  const g = createGraphics(size, size);
  g.pixelDensity(1);
  const ctx = g.drawingContext;
  const mask = renderMask(size);
  const city = plan.city;

  if (state.mode === 'coast') {
    /* --- 文字＝陸地。街路網は陸の上だけに存在し、外は水 --- */
    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, size, size);
    if (state.contours) drawContours(ctx, size, U, P);
    edgeHalo(ctx, mask, size, C.water, 14 * U, 2);
    const lg = createGraphics(size, size);
    lg.pixelDensity(1);
    drawCity(lg.drawingContext, size, U, P, city, 'base');
    lg.drawingContext.globalCompositeOperation = 'destination-in';
    lg.drawingContext.drawImage(mask, 0, 0, size, size);
    ctx.drawImage(lg.canvas, 0, 0, size, size);
    lg.remove();
  } else {
    /* --- 全面が街。文字はその一部として現れる --- */
    drawCity(ctx, size, U, P, city, 'base');

    if (state.mode === 'district') {
      // 文字の領域だけ街区の色を差し替える（街路網は内外で連続）
      const ag = createGraphics(size, size);
      ag.pixelDensity(1);
      drawCity(ag.drawingContext, size, U, P, city, 'accent');
      ag.drawingContext.globalCompositeOperation = 'destination-in';
      ag.drawingContext.drawImage(mask, 0, 0, size, size);
      ctx.drawImage(ag.canvas, 0, 0, size, size);
      ag.remove();
      if (state.glyphRoad) drawGlyphRoad(ctx, size, U, P);   // 文字の境界＝環状道路
    }

    if (state.mode === 'transit') {
      ctx.save();
      ctx.globalAlpha = state.bg;
      ctx.fillStyle = C.street;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
      if (state.glyphRoad) drawGlyphRoad(ctx, size, U, P, 0.7);
      if (plan.net) drawGlyphTransit(ctx, size, U, P, plan.net);
    }
  }

  drawFurniture(g, size, U, P);
  applyGrain(ctx, size);
  return g;
}

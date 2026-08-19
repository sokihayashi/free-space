/* ============================================================
   STATION MAP — 文字を「都市計画の条件」にして地図を生成する
   ------------------------------------------------------------
   入力は面（塗り）としての字形。それをマスクとして使うのではなく、
   道路網を成長させるときの grain（街区の大きさ）と orient（方位）を
   切り替える領域として使う。結果として文字は
   「そこだけ街区割りが違う地区」＝地図の構造そのものになる。
   小さいサイズで読めるのは、線の密度差が生む面の明度差による。
   ============================================================ */

const BASE = 1400;

const state = {
  seed: 7,
  palette: 'paper',
  channel: 'grain',      // grain | water | green
  scale: 1.0,
  offsetY: 0,
  margin: 0.08,
  threshold: 0.55,
  srcInvert: false,
  useAlpha: true,

  grainIn: 0.25,         // 文字の内側の街区サイズ（字画の太さ T に対する比）
  grainRatio: 2.8,       // 外側は内側の何倍か ＝ 明度差の主因
  arterials: 5,
  roadW: 1.0,
  bay: true,
  boundaryRoad: true,
  parks: 6,
  builtIn: 0.86,         // 文字の内側の建蔽率
  builtOut: 1.0,
  grain: true,
  caption: 'TOKYO CONTENTS STATION'
};

let srcEl = null;
let model = null;
let out = null;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 画像が来るまでのプレースホルダ（実運用では必ず画像を渡す） */
function placeholder() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 620;
  const x = c.getContext('2d');          // 背景は透明（アルファをそのまま字形として使う）
  x.fillStyle = '#000';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const lines = ['東京', 'コンテンツ', 'ステーション'];
  x.font = '700 175px "Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';
  lines.forEach((l, i) => x.fillText(l, 600, 120 + i * 190));
  const img = new Image();
  img.src = c.toDataURL();
  return img;
}

function buildModel() {
  const rnd = mulberry32((state.seed * 2654435761) % 2147483647);
  const F = Field.build(srcEl, {
    margin: state.margin, scale: state.scale, offsetY: state.offsetY,
    threshold: state.threshold, srcInvert: state.srcInvert, useAlpha: state.useAlpha
  }, rnd);

  // 文字を水域にするモードでは、別の湾があると読めなくなるので作らない
  const bay = (state.bay && state.channel !== 'water') ? makeBay(rnd) : null;

  const gIn = Math.min(0.011, Math.max(0.0045, F.T * state.grainIn));
  const net = Network.grow(F, {
    boundary: state.boundaryRoad ? F.boundary(gIn * 0.55) : null,
    grainIn: state.grainIn,
    grainRatio: state.grainRatio,
    arterials: state.arterials,
    phase: rnd() * 10,
    maxEdges: 60000,
    maxSteps: 900000,
    fillPasses: 4
  }, rnd);

  const blk = Blocks.classify(Blocks.extract(net), F, {
    bay, parks: state.parks, channel: state.channel
  }, rnd);

  model = { F, net, blk, bay };
}

function makeBay(rnd) {
  const corner = Math.floor(rnd() * 4);
  const c = [[1.05, 1.05], [-0.05, 1.05], [1.05, -0.05], [-0.05, -0.05]][corner];
  const R = 0.4 + rnd() * 0.25;
  const ph = rnd() * 6;
  const poly = [];
  for (let i = 0; i <= 30; i++) {
    const t = (i / 30) * Math.PI * 2;
    const w = 1 + 0.30 * Math.sin(t * 3 + ph) + 0.15 * Math.sin(t * 5.2 - ph);
    poly.push([c[0] + Math.cos(t) * R * w, c[1] + Math.sin(t) * R * w * 0.95]);
  }
  return poly;
}

function renderCover(size) {
  const g = createGraphics(size, size);
  g.pixelDensity(1);
  Render.draw(g.drawingContext, size, model, state);
  return g;
}

/* --- p5 --- */
function setup() {
  const c = createCanvas(BASE, BASE);
  c.parent('canvas-holder');
  pixelDensity(1);
  noLoop();
  srcEl = placeholder();
  srcEl.onload = () => { rebuild(); };
  UI.bind();
}

function draw() { if (out) image(out, 0, 0, width, height); }

function rebuild() {
  const t0 = performance.now();
  buildModel();
  const t1 = performance.now();
  rerender();
  UI.stats(model, t1 - t0, performance.now() - t1);
}

function rerender() {
  if (out) out.remove();
  out = renderCover(BASE);
  redraw();
  UI.legibility(out.canvas, model.F);
}

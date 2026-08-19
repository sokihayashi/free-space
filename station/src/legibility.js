/* ============================================================
   LEGIBILITY — 小さくした時に文字が読めるかを実測する
   ------------------------------------------------------------
   出力を 112px（ポッドキャストアプリの表示サイズ）に落とし、
   グレースケールで「文字の領域」と「それ以外」の平均輝度差を測る。
   色に頼っていないことの検証を兼ねる。
   ============================================================ */
const Legibility = (() => {
  const S = 112;

  function measure(sourceCanvas, F) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;

    const m = document.createElement('canvas');
    m.width = m.height = S;
    const mc = m.getContext('2d', { willReadFrequently: true });
    mc.drawImage(F.mask, 0, 0, S, S);
    const md = mc.getImageData(0, 0, S, S).data;

    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (let i = 0; i < S * S; i++) {
      const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      const a = md[i * 4 + 3];
      if (a > 200) { inSum += l; inN++; }
      else if (a < 40) { outSum += l; outN++; }
    }
    if (!inN || !outN) return { dL: 0, inL: 0, outL: 0, thumb: c };
    const inL = inSum / inN, outL = outSum / outN;
    return { dL: Math.abs(inL - outL), inL, outL, thumb: c };
  }

  return { measure, S };
})();

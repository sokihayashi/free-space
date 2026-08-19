/* ============================================================
   RENDER — 街区を「市街地の面」として塗る（Nolli 図法）
   ------------------------------------------------------------
   街区の多角形を、接する道路の幅だけ内側にオフセットして塗る。
   道路は線として描かず、街区と街区の「すき間」として現れる。
   したがって面のトーンは街区の細かさが直接決める：
     細かい街区 → すき間が多い → 明るい
     大きい街区 → すき間が少ない → 暗い
   文字はこのトーン差だけで読める（色を使っていない）。
   ============================================================ */
const Render = (() => {

  const PALETTES = {
    paper: { name:'PAPER', paper:'#F2EDE4', ink:'#16233A', ink2:'#1E3050',
             water:'#0E1A2B', park:'#3F6B4F', accent:'#D4451F' },
    mono:  { name:'MONO',  paper:'#FFFFFF', ink:'#111111', ink2:'#2A2A2A',
             water:'#000000', park:'#8A8A8A', accent:'#000000' },
    night: { name:'NIGHT', paper:'#101826', ink:'#EDE5D6', ink2:'#D9CFBC',
             water:'#233448', park:'#7FA98A', accent:'#E0533A' },
    riso:  { name:'RISO',  paper:'#F5F0E8', ink:'#0078BF', ink2:'#1D8CD0',
             water:'#0B2B45', park:'#00A95C', accent:'#FF48B0' }
  };

  // 道路の幅（1400px 基準）— そのまま街区どうしのすき間になる
  const RANK_GAP = [9.0, 5.2, 2.9];

  function clipHalf(poly, qx, qy, nx, ny) {
    const out = [];
    const side = p => (p.x - qx) * nx + (p.y - qy) * ny;
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
      const sc = side(cur), sp = side(prv);
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc);
          out.push({ x: prv.x + (cur.x - prv.x) * t, y: prv.y + (cur.y - prv.y) * t });
        }
        out.push(cur);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        out.push({ x: prv.x + (cur.x - prv.x) * t, y: prv.y + (cur.y - prv.y) * t });
      }
    }
    return out;
  }

  /* 各辺を、その辺に接する道路の幅の半分だけ内側へ寄せる */
  function insetBlock(b, dists) {
    let poly = b.pts;
    const c = b.c;
    for (let i = 0; i < b.pts.length; i++) {
      const a = b.pts[i], q = b.pts[(i + 1) % b.pts.length];
      const dx = q.x - a.x, dy = q.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      let nx = -dy / L, ny = dx / L;
      if ((c.x - a.x) * nx + (c.y - a.y) * ny < 0) { nx = -nx; ny = -ny; }
      const d = dists[i];
      poly = clipHalf(poly, a.x + nx * d, a.y + ny * d, nx, ny);
      if (poly.length < 3) return null;
    }
    return poly;
  }

  function fillPoly(ctx, poly, size) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x * size, poly[0].y * size);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x * size, poly[i].y * size);
    ctx.closePath();
    ctx.fill();
  }

  function draw(ctx, size, model, st) {
    const P = PALETTES[st.palette];
    const U = size / 1400;
    const { net, blk } = model;

    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, size, size);

    const gap = r => (RANK_GAP[r] * st.roadW * 0.5) / 1400;
    const dbuf = [];

    for (const b of blk.blocks) {
      // 水面は道路のすき間を作らない（岸線が街区の縁そのものになる）
      if (b.water) {
        ctx.fillStyle = P.water;
        fillPoly(ctx, b.pts, size);
        continue;
      }
      dbuf.length = 0;
      for (let i = 0; i < b.ids.length; i++) {
        const a = b.ids[i], q = b.ids[(i + 1) % b.ids.length];
        const id = net.eKey.get(a < q ? a + ',' + q : q + ',' + a);
        dbuf.push(gap(id === undefined ? 2 : net.edges[id].rank));
      }
      let poly = insetBlock(b, dbuf);
      if (!poly) continue;
      const k = b.g ? st.builtIn : st.builtOut;          // 建蔽率（面のトーンの第 2 軸）
      if (k < 0.999) poly = poly.map(p => ({ x: b.c.x + (p.x - b.c.x) * k, y: b.c.y + (p.y - b.c.y) * k }));
      ctx.fillStyle = b.park ? P.park : (b.tone < 0.22 ? P.ink2 : P.ink);
      fillPoly(ctx, poly, size);
    }

    if (st.grain) applyGrain(ctx, size);
    if (st.caption) drawCaption(ctx, size, U, P, st);
  }

  function drawCaption(ctx, size, U, P, st) {
    const txt = st.caption;
    ctx.save();
    ctx.font = `${Math.round(26 * U)}px "DM Mono", ui-monospace, Menlo, monospace`;
    const chars = [...txt], tr = 8 * U;
    let w = 0;
    for (const c of chars) w += ctx.measureText(c).width + tr;
    w -= tr;
    const y = size - 74 * U, padX = 30 * U, padY = 19 * U, h = 26 * U + padY * 2;
    ctx.fillStyle = P.ink;
    ctx.fillRect(size / 2 - w / 2 - padX, y - h + padY * 0.55, w + padX * 2, h);
    ctx.fillStyle = P.paper;
    let x = size / 2 - w / 2;
    for (const c of chars) { ctx.fillText(c, x, y); x += ctx.measureText(c).width + tr; }
    ctx.restore();
  }

  let grainTile = null;
  function applyGrain(ctx, size) {
    if (!grainTile) {
      const n = 256, c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d'), img = g.createImageData(n, n);
      for (let i = 0; i < n * n; i++) {
        const v = 120 + Math.random() * 56;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grainTile = c;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = ctx.createPattern(grainTile, 'repeat');
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  return { draw, PALETTES };
})();

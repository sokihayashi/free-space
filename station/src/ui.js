/* ============================================================
   UI — 素材の読み込み / パラメータ / 書き出し / 可読性メーター
   ============================================================ */
const UI = (() => {
  const $ = id => document.getElementById(id);

  function detectAlpha(el) {
    const n = 128;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, n, n);
    x.drawImage(el, 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear++;
    return clear / (n * n) > 0.02;
  }

  function loadSource(file) {
    const isSVG = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
    const r = new FileReader();
    r.onload = () => {
      let url;
      if (isSVG) {
        let t = String(r.result);
        if (!/<svg[^>]*\swidth=/i.test(t)) {
          const vb = t.match(/viewBox\s*=\s*["']([\d.\-\s,]+)["']/i);
          const p = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 1000, 1000];
          t = t.replace(/<svg/i, `<svg width="${p[2]}" height="${p[3]}"`);
        }
        url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
      } else url = String(r.result);

      const el = new Image();
      el.onload = () => {
        srcEl = el;
        state.useAlpha = detectAlpha(el);
        if ($('srcname')) $('srcname').textContent = file.name;
        if ($('threshold')) $('threshold').disabled = state.useAlpha;
        rebuild();
      };
      el.onerror = () => alert('読み込めませんでした: ' + file.name);
      el.src = url;
    };
    if (isSVG) r.readAsText(file); else r.readAsDataURL(file);
  }

  function bind() {
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

    on('file', 'change', e => e.target.files[0] && loadSource(e.target.files[0]));
    document.body.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
    document.body.addEventListener('dragleave', () => document.body.classList.remove('drag'));
    document.body.addEventListener('drop', e => {
      e.preventDefault(); document.body.classList.remove('drag');
      if (e.dataTransfer.files[0]) loadSource(e.dataTransfer.files[0]);
    });
    window.addEventListener('paste', e => {
      for (const it of e.clipboardData.items)
        if (it.type.startsWith('image/')) { loadSource(it.getAsFile()); break; }
    });

    const slider = (id, key, heavy) => on(id, 'input', e => {
      state[key] = +e.target.value;
      const l = $(id + '-val'); if (l) l.textContent = e.target.value;
      heavy ? rebuild() : rerender();
    });
    const select = (id, key, heavy) => on(id, 'change', e => {
      state[key] = e.target.value;
      heavy ? rebuild() : rerender();
    });
    const toggle = (id, key, heavy) => on(id, 'change', e => {
      state[key] = e.target.checked;
      heavy ? rebuild() : rerender();
    });

    slider('scale', 'scale', true);
    slider('offsety', 'offsetY', true);
    slider('threshold', 'threshold', true);
    slider('grainin', 'grainIn', true);
    slider('grainratio', 'grainRatio', true);
    slider('arterials', 'arterials', true);
    slider('parks', 'parks', true);
    slider('roadw', 'roadW', false);
    toggle('srcinvert', 'srcInvert', true);
    toggle('bay', 'bay', true);
    toggle('boundaryroad', 'boundaryRoad', true);
    slider('builtin', 'builtIn', false);
    toggle('grain', 'grain', false);
    select('channel', 'channel', true);
    select('palette', 'palette', false);
    on('caption', 'input', e => { state.caption = e.target.value; rerender(); });
    on('seed', 'input', e => { state.seed = +e.target.value; rebuild(); });
    on('dice', 'click', () => { state.seed = Math.floor(Math.random() * 9999); $('seed').value = state.seed; rebuild(); });
    on('save1400', 'click', () => save(1400));
    on('save3000', 'click', () => save(3000));
  }

  function save(px) {
    const b = $('save' + px);
    b.disabled = true; const lab = b.textContent; b.textContent = '書き出し中…';
    setTimeout(() => {
      const g = renderCover(px);
      g.canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `station-map-${px}-seed${state.seed}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        g.remove();
        b.disabled = false; b.textContent = lab;
      }, 'image/png');
    }, 30);
  }

  function stats(m, tBuild, tDraw) {
    const el = $('stats');
    if (!el) return;
    el.textContent = `街区 ${m.blk.blocks.length.toLocaleString()} / 道路 ${m.net.edges.length.toLocaleString()} 区間`
      + ` · 生成 ${Math.round(tBuild)}ms`;
  }

  function legibility(canvas, F) {
    const res = Legibility.measure(canvas, F);
    const t = $('thumb');
    if (t) {
      const c = t.getContext('2d');
      c.clearRect(0, 0, t.width, t.height);
      c.drawImage(res.thumb, 0, 0, t.width, t.height);
    }
    const el = $('dl');
    if (!el) return;
    const v = res.dL.toFixed(3);
    let verdict = '十分に読める', cls = 'ok';
    if (res.dL < 0.18) { verdict = 'やや弱い'; cls = 'warn'; }
    if (res.dL < 0.10) { verdict = '読めない — 粒度比か文字サイズを上げる'; cls = 'bad'; }
    el.textContent = `112px での明度差 ΔL ${v} — ${verdict}`;
    el.className = 'readout ' + cls;
  }

  return { bind, stats, legibility, loadSource };
})();

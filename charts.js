// Gráficos propios sobre <canvas> (sin librerías externas, funcionan sin conexión).
(function () {
  const registry = [];

  function themeColors(theme) {
    if (theme === "light") return { grid: "#e6ebf0", axis: "#5d6b78", text: "#1b2733", bg: "#ffffff" };
    if (theme === "dark") return { grid: "#27333d", axis: "#9aa9b6", text: "#e6edf3", bg: "#182128" };
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return { grid: g("--grid"), axis: g("--axis"), text: g("--text"), bg: g("--panel") };
  }

  function niceTicks(min, max, n) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const t = [];
    for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(6));
    return t;
  }

  function setup(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function frame(ctx, cfg, W, H, tc, ticksData) {
    const m = { l: 54, r: 14, t: 26, b: 40 };
    const ticks = niceTicks(ticksData.min, ticksData.max, 5);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const px = (i, n, bars) => bars ? m.l + (W - m.l - m.r) * (i + 0.5) / n : m.l + (n <= 1 ? 0 : (W - m.l - m.r) * i / (n - 1));
    const py = (v) => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = "11px system-ui,sans-serif"; ctx.textBaseline = "middle";
    ctx.strokeStyle = tc.grid; ctx.fillStyle = tc.axis; ctx.lineWidth = 1;
    ticks.forEach((t) => {
      const y = Math.round(py(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(+t.toFixed(2), m.l - 6, y);
    });
    if (cfg.yTitle) {
      ctx.save(); ctx.translate(12, (m.t + H - m.b) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.fillStyle = tc.axis; ctx.fillText(cfg.yTitle, 0, 0); ctx.restore();
    }
    return { m, px, py, y0, y1 };
  }

  function xLabels(ctx, cfg, W, H, f, bars, tc) {
    const n = cfg.xLabels.length;
    const maxLabels = Math.max(2, Math.floor((W - f.m.l - f.m.r) / 62));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    ctx.fillStyle = tc.axis; ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = 0; i < n; i += every) ctx.fillText(cfg.xLabels[i], f.px(i, n, bars), H - f.m.b + 8);
    ctx.textBaseline = "middle";
  }

  function draw(entry, theme) {
    const { canvas, kind, cfg } = entry;
    const W = entry.W || canvas.clientWidth || 600, H = entry.H || canvas.clientHeight || 300;
    const ctx = setup(canvas, W, H);
    const tc = themeColors(theme);
    const all = cfg.series.flatMap((s) => s.values).filter((v) => v != null);
    let min = Math.min(...all), max = Math.max(...all);
    if (kind === "bar") min = Math.min(0, min);
    else { const pad = (max - min) * 0.06 || 1; min -= pad; max += pad; }
    const f = frame(ctx, cfg, W, H, tc, { min, max });
    entry.f = f; entry.W = W; entry.H = H;
    const n = cfg.xLabels.length;

    if (kind === "line") {
      cfg.series.forEach((s) => {
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
        let pen = false;
        s.values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          const x = f.px(i, n), y = f.py(v);
          pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
        });
        ctx.stroke();
        if (n <= 60) s.values.forEach((v, i) => {
          if (v == null) return;
          ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(f.px(i, n), f.py(v), 2.6, 0, 7); ctx.fill();
        });
      });
      (cfg.markers || []).forEach((mk) => {
        const s = cfg.series[mk.s]; const x = f.px(mk.i, n), y = f.py(s.values[mk.i]);
        ctx.fillStyle = tc.bg; ctx.strokeStyle = s.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = tc.text; ctx.font = "bold 11px system-ui,sans-serif"; ctx.textAlign = x > W - 80 ? "right" : "left";
        ctx.fillText(mk.label, x + (x > W - 80 ? -8 : 8), y + (mk.below ? 12 : -12));
      });
    } else {
      const ns = cfg.series.length;
      const slot = (W - f.m.l - f.m.r) / n, bw = Math.max(3, Math.min(34, slot * 0.7 / ns));
      cfg.series.forEach((s, si) => {
        ctx.fillStyle = s.color;
        s.values.forEach((v, i) => {
          if (v == null) return;
          const x = f.px(i, n, true) - (bw * ns) / 2 + si * bw, y = f.py(v), y0 = f.py(Math.max(0, f.y0));
          ctx.fillRect(x, Math.min(y, y0), bw - 1, Math.abs(y0 - y));
        });
      });
    }
    ctx.font = "11px system-ui,sans-serif";
    xLabels(ctx, cfg, W, H, f, kind === "bar", tc);
    if (cfg.xTitle) { ctx.fillStyle = tc.axis; ctx.textAlign = "center"; ctx.fillText(cfg.xTitle, (f.m.l + W - f.m.r) / 2, H - 6); }
  }

  function fmt(v) { return v == null ? "—" : v.toLocaleString("es-CR", { maximumFractionDigits: 2 }); }

  function attachTooltip(entry, wrap) {
    const tip = wrap.querySelector(".tip");
    const { canvas, kind, cfg } = entry;
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, n = cfg.xLabels.length, f = entry.f;
      if (!f) return;
      let i;
      if (kind === "bar") i = Math.floor((x - f.m.l) / ((entry.W - f.m.l - f.m.r) / n));
      else i = Math.round(((x - f.m.l) / (entry.W - f.m.l - f.m.r)) * (n - 1));
      if (i < 0 || i >= n) { tip.style.display = "none"; return; }
      tip.innerHTML = "<b>" + (cfg.tipLabels ? cfg.tipLabels[i] : cfg.xLabels[i]) + "</b><br>" + cfg.series.map((s) =>
        '<span style="color:' + s.color + '">●</span> ' + s.name + ": " + fmt(s.real ? s.real[i] : s.values[i]) + " " + (s.unit || cfg.unit || "")).join("<br>");
      tip.style.display = "block";
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(4, x + 12), entry.W - tw - 4) + "px";
      tip.style.top = Math.max(4, e.clientY - r.top - 40) + "px";
    });
    canvas.addEventListener("mouseleave", () => (tip.style.display = "none"));
  }

  window.Charts = {
    /** Crea un gráfico dentro de `container`. kind: "line" | "bar". */
    create(container, kind, cfg, title) {
      const card = document.createElement("div");
      card.className = "card chart-card";
      card.innerHTML = "<h3></h3><div class='chart-wrap'><canvas></canvas><div class='tip'></div></div><div class='legend'></div>";
      card.querySelector("h3").textContent = title;
      card.querySelector(".legend").innerHTML = cfg.series.map((s) => "<span><i style='background:" + s.color + "'></i>" + s.name + "</span>").join("");
      if (cfg.note) { const p = document.createElement("p"); p.className = "note"; p.textContent = cfg.note; card.appendChild(p); }
      container.appendChild(card);
      const entry = { canvas: card.querySelector("canvas"), kind, cfg, title };
      attachTooltip(entry, card.querySelector(".chart-wrap"));
      registry.push(entry);
      draw(entry, null);
      return entry;
    },
    clear() { registry.length = 0; },
    redrawAll() { registry.forEach((e) => { e.W = e.H = 0; draw(e, null); }); },
    /** Imagen JPEG del gráfico en tema claro (para el PDF). */
    toJpeg(entry) {
      const c = document.createElement("canvas");
      const tmp = { canvas: c, kind: entry.kind, cfg: entry.cfg, W: 900, H: 380 };
      draw(tmp, "light");
      return { data: c.toDataURL("image/jpeg", 0.92), w: 900, h: 380 };
    },
  };
  window.addEventListener("resize", () => window.Charts.redrawAll());
})();

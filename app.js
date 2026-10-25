(function () {
  "use strict";
  const NOMBRES = { temperatura: "Temperatura", humedad: "Humedad relativa", viento: "Velocidad del viento" };
  const STATS = { prom: "Promedio", max: "Máximo", min: "Mínimo", sd: "Desviación estándar" };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let DB = {};              // variable -> [{fecha, hora, v}]
  let UNIDAD = {};          // variable -> unidad
  let RANGO = { min: "", max: "" };
  let ULTIMO = null;        // último resultado (para exportar)

  const fmt = (v, d = 1) => (v == null || isNaN(v) ? "—" : v.toLocaleString("es-CR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const corta = (f) => f.slice(8, 10) + "/" + f.slice(5, 7);
  const color = (v) => getComputedStyle(document.documentElement).getPropertyValue("--c-" + v).trim() || "#0b7a75";

  // ---------- Carga de datos (Firebase o archivo local) ----------
  function desdeRegistros(regs) {
    const db = {}, un = {};
    regs.forEach((r) => { (db[r.variable] = db[r.variable] || []).push({ fecha: r.fecha, hora: r.hora, v: Number(r.valor) }); un[r.variable] = r.unidad; });
    return { db, un };
  }
  async function desdeFirebase(url) {
    const base = url.replace(/\/$/, "");
    const [m, meta] = await Promise.all([fetch(base + "/mediciones.json"), fetch(base + "/meta.json")]);
    if (!m.ok) throw new Error("HTTP " + m.status);
    const arbol = await m.json(); const metaJ = meta.ok ? await meta.json() : null;
    if (!arbol) throw new Error("La base está vacía");
    const regs = [];
    Object.keys(arbol).forEach((variable) => Object.keys(arbol[variable]).forEach((fecha) =>
      Object.keys(arbol[variable][fecha]).forEach((h) => regs.push({ fecha, hora: h.slice(0, 2) + ":" + h.slice(2), variable, valor: arbol[variable][fecha][h],
        unidad: (metaJ && metaJ.unidades && metaJ.unidades[variable]) || "" }))));
    return regs;
  }
  // Aplica un conjunto de registros (de cualquier fuente) a la app.
  function aplicarDatos(regs) {
    const { db, un } = desdeRegistros(regs);
    Object.values(db).forEach((a) => a.sort((x, y) => (x.fecha + x.hora < y.fecha + y.hora ? -1 : 1)));
    DB = db; UNIDAD = un;
    const fechas = Object.values(db).flat().map((p) => p.fecha).sort();
    RANGO = { min: fechas[0], max: fechas[fechas.length - 1] };
    ["#f-dia", "#f-desde", "#f-hasta"].forEach((s) => { $(s).min = RANGO.min; $(s).max = RANGO.max; });
    const txt = "Datos disponibles del " + RANGO.min + " al " + RANGO.max + ".";
    $("#rango-hint").textContent = txt; $("#rango-hint2").textContent = txt;
    $("#ext-hint").textContent = "Se analiza todo el registro: " + RANGO.min + " al " + RANGO.max + ".";
    const previas = new Set(vars());
    const lista = $("#dd-lista"); lista.innerHTML = "";
    Object.keys(DB).forEach((v) => {
      const l = document.createElement("label");
      l.innerHTML = '<input type="checkbox" name="var" value="' + v + '"' + (previas.has(v) ? " checked" : "") + "> " + (NOMBRES[v] || v) + " (" + (UNIDAD[v] || "") + ")";
      lista.appendChild(l);
    });
    validar();
  }

  // Fuente simulada: Firebase (si está configurada) o archivo local.
  async function cargar() {
    const badge = $("#fuente"); badge.classList.remove("warn");
    let regs = null;
    if (window.FIREBASE_URL) {
      try { regs = await desdeFirebase(window.FIREBASE_URL); badge.textContent = "Fuente: Firebase (nube)"; }
      catch (e) { badge.textContent = "Firebase no disponible (" + e.message + ") · usando archivo local"; badge.classList.add("warn"); }
    }
    if (!regs) { regs = window.DATOS_LOCALES || []; if (!window.FIREBASE_URL) badge.textContent = "Fuente: datos simulados (archivo local)"; }
    if (!regs.length) { badge.textContent = "Sin datos"; badge.classList.add("warn"); return; }
    aplicarDatos(regs);
  }

  // ---------- Clima real (Open-Meteo) con actualización automática ----------
  let FUENTE = "real", UBIC = null, TIMER = null, ACTUAL = null, ULT_ACT = 0, CFG = null;
  const VARS_API = { temperature_2m: "temperatura", relative_humidity_2m: "humedad", wind_speed_10m: "viento" };
  const coordenadas = () => UBIC || ESTACION;
  const hhmm = () => new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });

  async function cargarReal() {
    const badge = $("#fuente"), c = coordenadas();
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + c.lat.toFixed(4) + "&longitude=" + c.lon.toFixed(4) +
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m" +
      "&past_days=14&forecast_days=1&timezone=auto&wind_speed_unit=kmh";
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(), ahora = j.current.time, regs = [];
      j.hourly.time.forEach((t, i) => {
        if (t > ahora) return;   // se descartan las horas futuras (pronóstico)
        Object.keys(VARS_API).forEach((k) => {
          const v = j.hourly[k][i];
          if (v != null) regs.push({ fecha: t.slice(0, 10), hora: t.slice(11, 16), variable: VARS_API[k], valor: v, unidad: (j.hourly_units && j.hourly_units[k]) || "" });
        });
      });
      if (!regs.length) throw new Error("sin datos");
      const cu = j.current_units || {}, un = {}, val = {};
      Object.keys(VARS_API).forEach((k) => { val[VARS_API[k]] = j.current[k]; un[VARS_API[k]] = cu[k] || (j.hourly_units && j.hourly_units[k]) || ""; });
      ACTUAL = { hora: ahora, val, un, coord: c, esUsuario: !!UBIC };
      ULT_ACT = Date.now();
      aplicarDatos(regs);
      badge.classList.remove("warn"); badge.textContent = "Clima real · actualizado " + hhmm();
      $("#pie").hidden = false;
      pintarActual(); recalcular();
      return true;
    } catch (e) {
      badge.classList.add("warn");
      badge.textContent = Object.keys(DB).length ? "Sin conexión con el servicio de clima · se muestran los últimos datos" : "Sin conexión con el servicio de clima";
      return false;
    }
  }

  function pintarActual() {
    const box = $("#actual");
    if (FUENTE !== "real" || !ACTUAL) { box.innerHTML = ""; return; }
    const a = ACTUAL, lugar = a.esUsuario ? "Mi ubicación (" + a.coord.lat.toFixed(3) + ", " + a.coord.lon.toFixed(3) + ")" : ESTACION.nombre;
    box.innerHTML = '<div class="card" style="margin-bottom:14px"><div class="res-head"><div><h2>Condiciones actuales</h2><p>' + lugar + " · dato de las " + a.hora.slice(11, 16) +
      ' · se actualiza solo cada 10 minutos</p></div><div class="btns"><button type="button" class="icon-btn" id="b-act">Actualizar ahora</button></div></div><div class="summary" style="margin:0">' +
      ["temperatura", "humedad", "viento"].map((v) => '<div class="sum" style="--vc:' + color(v) + '"><h3>' + NOMBRES[v] + "</h3><dl><dt>Ahora</dt><dd>" + fmt(a.val[v]) + " " + a.un[v] + "</dd></dl></div>").join("") + "</div></div>";
    $("#b-act").onclick = cargarReal;
  }

  // Si ya hay una consulta en pantalla, se recalcula con los datos nuevos (con los mismos parámetros).
  function recalcular() {
    if (!CFG) return;
    try { mostrar(calcular(CFG), true); } catch (e) { /* los datos nuevos no cubren esa consulta: se deja el resultado anterior */ }
  }

  function programar() {
    clearInterval(TIMER); TIMER = null;
    if (FUENTE === "real") TIMER = setInterval(cargarReal, 10 * 60 * 1000);
  }

  async function cambiarFuente(f) {
    FUENTE = f; programar(); ACTUAL = null; CFG = null; ULTIMO = null;
    $("#actual").innerHTML = ""; $("#pie").hidden = f !== "real";
    $("#results").innerHTML = '<div class="card empty" id="vacio">Elija el tipo de consulta, las variables y las fechas, y presione «Calcular y graficar».</div>';
    try { localStorage.setItem("fuente", f); } catch (e) { /* sin almacenamiento */ }
    if (f === "real") {
      if (!(await cargarReal()) && !Object.keys(DB).length) { await cargar(); const b = $("#fuente"); b.textContent = "Sin conexión: usando datos simulados"; b.classList.add("warn"); }
    } else { DB = {}; await cargar(); }
  }

  // ---------- Formulario y validaciones ----------
  const tipo = () => $('input[name="tipo"]:checked').value;
  const vars = () => $$('input[name="var"]:checked').map((i) => i.value);
  const statsSel = () => $$("[data-stat]").filter((i) => i.checked).map((i) => i.dataset.stat);

  function revisarFecha(input, etiqueta, errs) {
    input.classList.remove("invalid");
    if (input.validity.badInput) { errs.push(etiqueta + ": la fecha escrita no es válida."); input.classList.add("invalid"); return null; }
    if (!input.value) { errs.push("Seleccione " + etiqueta + "."); return null; }
    if (RANGO.min && (input.value < RANGO.min || input.value > RANGO.max)) {
      errs.push(etiqueta[0].toUpperCase() + etiqueta.slice(1) + " debe estar entre " + RANGO.min + " y " + RANGO.max + "."); input.classList.add("invalid"); return null;
    }
    return input.value;
  }

  function validar() {
    const errs = [], t = tipo();
    $("#fs-dia").hidden = t !== "hora"; $("#fs-rango").hidden = t !== "dia"; $("#fs-ext").hidden = t !== "extremos";
    // En el histórico, máximo y mínimo son la consulta misma.
    $$("[data-stat]").forEach((i) => { if (t === "extremos" && (i.dataset.stat === "max" || i.dataset.stat === "min")) { i.checked = true; i.disabled = true; } else i.disabled = false; });
    const vs = vars();
    $("#dd-resumen").textContent = vs.length ? vs.map((v) => NOMBRES[v] || v).join(", ") : "Seleccione una o más variables";
    if (!vs.length) errs.push("Seleccione al menos una variable.");
    if (t === "hora") revisarFecha($("#f-dia"), "el día a consultar", errs);
    if (t === "dia") {
      const d = revisarFecha($("#f-desde"), "la fecha inicial", errs), h = revisarFecha($("#f-hasta"), "la fecha final", errs);
      if (d && h && d > h) { errs.push("La fecha inicial no puede ser posterior a la final."); $("#f-desde").classList.add("invalid"); $("#f-hasta").classList.add("invalid"); }
    }
    if (!statsSel().length) errs.push("Active al menos una estadística.");
    $("#errores").innerHTML = errs.map((e) => "<li>" + e + "</li>").join("");
    $("#ejecutar").disabled = errs.length > 0 || !Object.keys(DB).length;
    return !errs.length;
  }

  // ---------- Cálculo ----------
  function filtrarAtipicos(pts, activo) {
    if (!activo || pts.length < 8) return { kept: pts, removed: 0, ok: pts.map(() => true) };
    const s = pts.map((p) => p.v).sort((a, b) => a - b);
    const q = (p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
    const q1 = q(0.25), q3 = q(0.75), lo = q1 - 1.5 * (q3 - q1), hi = q3 + 1.5 * (q3 - q1);
    const ok = pts.map((p) => p.v >= lo && p.v <= hi);
    return { kept: pts.filter((_, i) => ok[i]), removed: ok.filter((x) => !x).length, ok };
  }
  function estad(pts) {
    const n = pts.length; if (!n) return null;
    const vals = pts.map((p) => p.v), mean = vals.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    let mx = pts[0], mn = pts[0]; pts.forEach((p) => { if (p.v > mx.v) mx = p; if (p.v < mn.v) mn = p; });
    return { n, prom: mean, sd, max: mx, min: mn };
  }
  const media = (a) => (a.length ? a.reduce((x, p) => x + p.v, 0) / a.length : null);

  const leerForm = () => ({ t: tipo(), vs: vars(), sts: statsSel(), atip: $("#f-atip").checked, d: $("#f-dia").value, desde: $("#f-desde").value, hasta: $("#f-hasta").value });

  function calcular(cfg) {
    cfg = cfg || leerForm();
    const t = cfg.t, vs = cfg.vs, sts = cfg.sts, atip = cfg.atip;
    let f0, f1, titulo;
    if (t === "hora") { f0 = f1 = cfg.d; titulo = "Promedio por hora · " + f0; }
    else if (t === "dia") { f0 = cfg.desde; f1 = cfg.hasta; titulo = "Promedio por día · " + f0 + " a " + f1; }
    else { f0 = RANGO.min; f1 = RANGO.max; titulo = "Máximo y mínimo histórico · " + f0 + " a " + f1; }

    const porVar = vs.map((v) => {
      const raw = DB[v].filter((p) => p.fecha >= f0 && p.fecha <= f1);
      const fl = filtrarAtipicos(raw, atip);
      const e = estad(fl.kept);
      let labels, xl, tip, vals;
      if (t === "hora") {
        labels = xl = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00"); tip = labels;
        vals = labels.map((_, h) => media(fl.kept.filter((p) => +p.hora.slice(0, 2) === h)));
      } else if (t === "dia") {
        const dias = [...new Set(raw.map((p) => p.fecha))];
        labels = dias; xl = dias.map(corta); tip = dias;
        vals = dias.map((d) => media(fl.kept.filter((p) => p.fecha === d)));
      } else {
        labels = raw.map((p) => p.fecha + " " + p.hora); tip = labels; xl = raw.map((p) => corta(p.fecha) + " " + p.hora.slice(0, 2) + "h");
        vals = raw.map((p, i) => (fl.ok[i] ? p.v : null));
      }
      return { v, nombre: NOMBRES[v] || v, unidad: UNIDAD[v] || "", raw, e, removed: fl.removed, labels, xl, tip, vals, ok: fl.ok };
    });
    return { t, vs, sts, titulo, f0, f1, atip, porVar };
  }

  // ---------- Presentación ----------
  function tabla(r) {
    if (r.t === "extremos") {
      const h = ["Variable"]; if (r.sts.includes("prom")) h.push("Promedio"); h.push("Máximo", "Fecha y hora del máximo", "Mínimo", "Fecha y hora del mínimo"); if (r.sts.includes("sd")) h.push("Desv. estándar");
      const rows = r.porVar.map((p) => { const row = [p.nombre + " (" + p.unidad + ")"]; if (r.sts.includes("prom")) row.push(fmt(p.e.prom)); row.push(fmt(p.e.max.v), p.e.max.fecha + " " + p.e.max.hora, fmt(p.e.min.v), p.e.min.fecha + " " + p.e.min.hora); if (r.sts.includes("sd")) row.push(fmt(p.e.sd, 2)); return row; });
      return { h, rows };
    }
    const h = [r.t === "hora" ? "Hora" : "Fecha", ...r.porVar.map((p) => p.nombre + " (" + p.unidad + ")")];
    const rows = r.porVar[0].labels.map((l, i) => [l, ...r.porVar.map((p) => fmt(p.vals[i]))]);
    return { h, rows };
  }

  function lineaComparacion(r) {
    const base = r.porVar[0];
    const series = r.porVar.map((p) => {
      const ok = p.vals.filter((x) => x != null), mn = Math.min(...ok), mx = Math.max(...ok);
      return { name: p.nombre, color: color(p.v), unit: p.unidad, real: p.vals, values: p.vals.map((x) => (x == null ? null : mx === mn ? 50 : ((x - mn) / (mx - mn)) * 100)) };
    });
    return { xLabels: base.xl, tipLabels: base.tip, series, yTitle: "Escala normalizada (%)", note: "Cada variable se escala entre su mínimo (0) y su máximo (100) para poder compararlas aunque tengan unidades distintas. Al pasar el cursor se ven los valores reales." };
  }

  function mostrar(r, sinScroll) {
    ULTIMO = r; Charts.clear();
    const cont = $("#results"); cont.innerHTML = "";
    const cab = document.createElement("div"); cab.className = "card";
    cab.innerHTML = '<div class="res-head"><div><h2></h2><p></p></div><div class="btns"><button type="button" class="icon-btn" id="b-csv">Exportar CSV</button><button type="button" class="icon-btn" id="b-pdf">Exportar PDF</button></div></div>';
    $("h2", cab).textContent = r.titulo;
    const removed = r.porVar.reduce((a, p) => a + p.removed, 0);
    $("p", cab).textContent = r.porVar.map((p) => p.nombre).join(", ") + (r.atip ? " · valores atípicos excluidos: " + removed : " · con todos los valores");
    // panel resumen
    const sum = document.createElement("div"); sum.className = "summary"; sum.style.marginTop = "12px";
    r.porVar.forEach((p) => {
      const d = document.createElement("div"); d.className = "sum"; d.style.setProperty("--vc", color(p.v));
      let dl = "";
      const mk = (k, val, extra) => '<dt>' + STATS[k] + '</dt><dd>' + val + " " + p.unidad + (extra ? "<small>" + extra + "</small>" : "") + "</dd>";
      if (r.sts.includes("prom")) dl += mk("prom", fmt(p.e.prom));
      if (r.sts.includes("max")) dl += mk("max", fmt(p.e.max.v), corta(p.e.max.fecha) + " " + p.e.max.hora);
      if (r.sts.includes("min")) dl += mk("min", fmt(p.e.min.v), corta(p.e.min.fecha) + " " + p.e.min.hora);
      if (r.sts.includes("sd")) dl += mk("sd", fmt(p.e.sd, 2));
      d.innerHTML = "<h3>" + p.nombre + "</h3><dl>" + dl + "</dl>";
      sum.appendChild(d);
    });
    cab.appendChild(sum); cont.appendChild(cab);

    const chartsInfo = [];
    r.porVar.forEach((p) => {
      const base = { xLabels: p.xl, tipLabels: p.tip, unit: p.unidad, yTitle: p.unidad };
      const s = [{ name: p.nombre, color: color(p.v), values: p.vals }];
      if (r.t === "hora") chartsInfo.push(Charts.create(cont, "line", { ...base, series: s, xTitle: "Hora del día" }, p.nombre + ": promedio por hora"));
      if (r.t === "dia") {
        chartsInfo.push(Charts.create(cont, "line", { ...base, series: s }, p.nombre + ": evolución del promedio diario"));
        chartsInfo.push(Charts.create(cont, "bar", { ...base, series: s }, p.nombre + ": comparación entre días"));
      }
      if (r.t === "extremos") {
        const idx = (pt) => p.raw.findIndex((q) => q.fecha === pt.fecha && q.hora === pt.hora);
        const marks = [{ s: 0, i: idx(p.e.max), label: "Máx " + fmt(p.e.max.v) }, { s: 0, i: idx(p.e.min), label: "Mín " + fmt(p.e.min.v), below: true }];
        chartsInfo.push(Charts.create(cont, "line", { ...base, series: s, markers: marks }, p.nombre + ": historial completo con extremos"));
      }
    });
    if (r.porVar.length > 1) {
      if (r.t === "extremos") { /* se compara el historial completo */ }
      chartsInfo.push(Charts.create(cont, "line", lineaComparacion(r), "Comparación entre variables"));
    }
    r.charts = chartsInfo;

    const tb = tabla(r), tc = document.createElement("div"); tc.className = "card";
    tc.innerHTML = '<h3 style="margin:0 0 8px;font-size:14px">Datos de la consulta</h3><div class="tbl-wrap"><table><thead><tr>' + tb.h.map((x) => "<th>" + x + "</th>").join("") + "</tr></thead><tbody>" +
      tb.rows.map((row) => "<tr>" + row.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    cont.appendChild(tc);
    $("#b-csv").onclick = exportarCSV; $("#b-pdf").onclick = exportarPDF;
    if (!sinScroll) cab.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Exportación ----------
  function descargar(blob, nombre) {
    if (window.AndroidBridge) {   // app Android: el WebView no descarga blobs, se guarda por el puente nativo
      const fr = new FileReader();
      fr.onload = () => window.AndroidBridge.guardar(nombre, blob.type || "application/octet-stream", String(fr.result).split(",")[1]);
      fr.readAsDataURL(blob); return;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const nombreArchivo = (r, ext) => "consulta_" + r.t + "_" + r.f0 + (r.f1 !== r.f0 ? "_a_" + r.f1 : "") + "." + ext;
  function lineasEstad(r) {
    const out = [];
    r.porVar.forEach((p) => r.sts.forEach((k) => {
      const val = k === "max" ? p.e.max.v : k === "min" ? p.e.min.v : p.e[k];
      const cuando = k === "max" ? p.e.max.fecha + " " + p.e.max.hora : k === "min" ? p.e.min.fecha + " " + p.e.min.hora : "";
      out.push([p.nombre, STATS[k], fmt(val, k === "sd" ? 2 : 1), p.unidad, cuando]);
    }));
    return out;
  }
  function exportarCSV() {
    const r = ULTIMO; if (!r) return;
    const q = (c) => '"' + String(c).replace(/"/g, '""') + '"';
    const tb = tabla(r);
    const lines = [["Consulta", r.titulo], ["Valores atípicos", r.atip ? "excluidos" : "incluidos"], [], tb.h, ...tb.rows, [], ["Variable", "Estadística", "Valor", "Unidad", "Fecha y hora"], ...lineasEstad(r)];
    descargar(new Blob(["﻿" + lines.map((l) => l.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), nombreArchivo(r, "csv"));
  }
  function exportarPDF() {
    const r = ULTIMO; if (!r) return;
    const pdf = new Pdf();
    pdf.text("Consulta de variables ambientales - TEC San Carlos (Santa Clara)", 14, true);
    pdf.text(r.titulo, 11, true); pdf.gap(2);
    pdf.text("Variables: " + r.porVar.map((p) => p.nombre).join(", ") + ". Valores atípicos: " + (r.atip ? "excluidos (IQR 1,5)" : "incluidos") + ". Generado: " + new Date().toLocaleString("es-CR"), 9);
    pdf.gap(6); pdf.text("Estadísticas", 11, true);
    pdf.row(["Variable", "Estadística", "Valor", "Unidad", "Fecha y hora"], 9, true);
    lineasEstad(r).forEach((l) => pdf.row(l, 9));
    pdf.gap(8);
    (r.charts || []).forEach((c) => { const im = Charts.toJpeg(c); pdf.need(((595.28 - 80) * im.h) / im.w + 30); pdf.text(c.title, 10, true); pdf.image(im, im.w, im.h); });
    pdf.gap(4); pdf.text("Datos de la consulta", 11, true);
    const tb = tabla(r); pdf.row(tb.h, 8, true); tb.rows.slice(0, 120).forEach((row) => pdf.row(row, 8));
    descargar(pdf.build(), nombreArchivo(r, "pdf"));
  }


  // ---------- Ubicación del usuario ----------
  const ESTACION = { nombre: "TEC San Carlos (Santa Clara)", lat: 10.3651, lon: -84.5108 }; // aproximada
  function distanciaKm(a, b, c, d) {
    const r = Math.PI / 180, dLa = (c - a) * r, dLo = (d - b) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function ubicar() {
    const box = $("#ubic"), btn = $("#b-ubic");
    const error = (m) => { box.innerHTML = '<p class="err"></p>'; $(".err", box).textContent = m; btn.disabled = false; btn.textContent = "Obtener mi ubicación"; };
    if (!navigator.geolocation) return error("Este dispositivo o navegador no permite obtener la ubicación.");
    if (window.isSecureContext === false) return error("La ubicación solo funciona en una página segura (https) o en la app instalada.");
    btn.disabled = true; btn.textContent = "Buscando ubicación…"; box.textContent = "";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: la, longitude: lo, accuracy } = pos.coords;
      const km = distanciaKm(la, lo, ESTACION.lat, ESTACION.lon);
      box.innerHTML = '<dl><dt>Latitud</dt><dd>' + la.toFixed(5) + '</dd><dt>Longitud</dt><dd>' + lo.toFixed(5) + '</dd><dt>Precisión</dt><dd>± ' + Math.round(accuracy) + ' m</dd>' +
        '<dt>Lugar</dt><dd id="u-lugar">consultando…</dd><dt>Distancia a la estación</dt><dd>' + (km < 1 ? Math.round(km * 1000) + " m" : fmt(km, 1) + " km") + '</dd></dl>' +
        '<p class="hint" style="margin:6px 0 0"><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + la + '&mlon=' + lo + '#map=16/' + la + '/' + lo + '">Ver en el mapa</a> · Estación: ' + ESTACION.nombre + '</p>';
      btn.disabled = false; btn.textContent = "Actualizar mi ubicación";
      UBIC = { lat: la, lon: lo }; if (FUENTE === "real") cargarReal();   // el clima real pasa a ser el de donde está
      try {   // nombre del lugar: requiere internet (OpenStreetMap Nominatim); si falla, quedan las coordenadas
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
        const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=" + la + "&lon=" + lo, { signal: ctl.signal });
        const j = await r.json(); $("#u-lugar").textContent = j.display_name || "no disponible";
      } catch (e) { const u = $("#u-lugar"); if (u) u.textContent = "sin conexión (solo coordenadas)"; }
    }, (e) => error(e.code === 1 ? "Permiso de ubicación denegado. Actívelo en la configuración del navegador o del teléfono." : e.code === 2 ? "No se pudo determinar la ubicación." : "Se agotó el tiempo esperando la ubicación."),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  // ---------- Tema ----------
  function aplicarTema(oscuro) {
    document.documentElement.dataset.theme = oscuro ? "dark" : "light";
    const b = $("#tema"); b.textContent = oscuro ? "Modo claro" : "Modo oscuro"; b.setAttribute("aria-pressed", String(oscuro));
    try { localStorage.setItem("tema", oscuro ? "dark" : "light"); } catch (e) { /* sin almacenamiento */ }
    Charts.redrawAll();
  }

  // ---------- Inicio ----------
  document.addEventListener("DOMContentLoaded", () => {
    let guardado = null; try { guardado = localStorage.getItem("tema"); } catch (e) { /* ignorar */ }
    const oscuro = guardado ? guardado === "dark" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    aplicarTema(oscuro);
    $("#b-ubic").onclick = ubicar;
    $("#tema").onclick = () => aplicarTema(document.documentElement.dataset.theme !== "dark");
    $("#form").addEventListener("input", validar);
    $("#form").addEventListener("change", validar);
    $("#form").addEventListener("submit", (e) => { e.preventDefault(); if (validar()) { CFG = leerForm(); mostrar(calcular(CFG)); } });
    let fs = "real"; try { fs = localStorage.getItem("fuente") || "real"; } catch (e) { /* ignorar */ }
    $("#fuente-sel").value = fs;
    $("#fuente-sel").onchange = (e) => cambiarFuente(e.target.value);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && FUENTE === "real" && Date.now() - ULT_ACT > 5 * 60 * 1000) cargarReal(); });
    cambiarFuente(fs);
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();

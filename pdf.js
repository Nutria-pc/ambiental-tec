// Generador mínimo de PDF (A4, texto Helvetica + imágenes JPEG), sin librerías externas.
(function () {
  const PW = 595.28, PH = 841.89, MX = 40;

  function latin1(str) {
    const map = { "–": "-", "—": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "≥": ">=", "≤": "<=", "→": "->", "●": "*" };
    const out = [];
    for (const ch of str) {
      const c = map[ch] || ch;
      for (const x of c) { const code = x.charCodeAt(0); out.push(code < 256 ? code : 63); }
    }
    return out;
  }
  const esc = (arr) => arr.map((c) => (c === 40 || c === 41 || c === 92 ? [92, c] : [c])).flat();
  const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

  class Pdf {
    constructor() { this.pages = []; this.images = []; this.newPage(); }
    newPage() { this.cur = { ops: [], imgs: [] }; this.pages.push(this.cur); this.y = PH - 50; }
    need(h) { if (this.y - h < 45) this.newPage(); }
    text(str, size = 10, bold = false, indent = 0) {
      const lines = this.wrap(str, size, PW - 2 * MX - indent, bold);
      lines.forEach((ln) => {
        this.need(size + 4);
        this.y -= size + 3;
        this.cur.ops.push({ t: "text", x: MX + indent, y: this.y, size, bold, bytes: esc(latin1(ln)) });
      });
    }
    wrap(str, size, width, bold) {
      const cw = size * (bold ? 0.56 : 0.52), max = Math.max(10, Math.floor(width / cw));
      const out = [];
      String(str).split("\n").forEach((par) => {
        let line = "";
        par.split(" ").forEach((w) => {
          if ((line + " " + w).trim().length > max) { out.push(line); line = w; } else line = (line + " " + w).trim();
        });
        out.push(line);
      });
      return out;
    }
    gap(h) { this.y -= h; }
    row(cols, size = 9, bold = false) {   // fila de tabla con columnas de ancho fijo
      this.need(size + 5); this.y -= size + 3;
      const w = (PW - 2 * MX) / cols.length;
      cols.forEach((c, i) => this.cur.ops.push({ t: "text", x: MX + i * w, y: this.y, size, bold, bytes: esc(latin1(String(c).slice(0, Math.floor(w / (size * 0.5))))) }));
    }
    image(jpeg, w, h) {
      const base = jpeg.data.split(",")[1], bin = atob(base), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dw = PW - 2 * MX, dh = dw * h / w;
      this.need(dh + 8);
      this.y -= dh + 4;
      this.images.push({ data: arr, w, h });
      const name = "Im" + this.images.length;
      this.cur.imgs.push(name);
      this.cur.ops.push({ t: "img", name, x: MX, y: this.y, w: dw, h: dh });
      this.y -= 8;
    }
    build() {
      const chunks = [], offs = []; let len = 0;
      const push = (u8) => { chunks.push(u8); len += u8.length; };
      const obj = (n, parts) => { offs[n] = len; push(bytes(n + " 0 obj\n")); parts.forEach((p) => push(typeof p === "string" ? bytes(p) : p)); push(bytes("\nendobj\n")); };
      // objetos: 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, luego imágenes, luego (página, contenido)*
      const nImg = this.images.length, firstImg = 5, firstPage = firstImg + nImg;
      push(bytes("%PDF-1.4\n"));
      obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
      obj(2, ["<< /Type /Pages /Count " + this.pages.length + " /Kids [" + this.pages.map((_, i) => (firstPage + i * 2) + " 0 R").join(" ") + "] >>"]);
      obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]);
      obj(4, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
      this.images.forEach((im, i) => obj(firstImg + i, ["<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.data.length + " >>\nstream\n", im.data, "\nendstream"]));
      this.pages.forEach((pg, i) => {
        const pn = firstPage + i * 2, cn = pn + 1;
        let s = "";
        pg.ops.forEach((o) => {
          if (o.t === "text") s += "BT /" + (o.bold ? "F2" : "F1") + " " + o.size + " Tf " + o.x.toFixed(2) + " " + o.y.toFixed(2) + " Td (" + String.fromCharCode(...o.bytes) + ") Tj ET\n";
          else s += "q " + o.w.toFixed(2) + " 0 0 " + o.h.toFixed(2) + " " + o.x.toFixed(2) + " " + o.y.toFixed(2) + " cm /" + o.name + " Do Q\n";
        });
        const content = Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 255));
        const xo = pg.imgs.map((n) => "/" + n + " " + (firstImg + Number(n.slice(2)) - 1) + " 0 R").join(" ");
        obj(pn, ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Contents " + cn + " 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << " + xo + " >> >> >>"]);
        obj(cn, ["<< /Length " + content.length + " >>\nstream\n", content, "\nendstream"]);
      });
      const total = firstPage + this.pages.length * 2, xref = len;
      let x = "xref\n0 " + total + "\n0000000000 65535 f \n";
      for (let n = 1; n < total; n++) x += String(offs[n]).padStart(10, "0") + " 00000 n \n";
      push(bytes(x + "trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF"));
      const out = new Uint8Array(len); let p = 0;
      chunks.forEach((c) => { out.set(c, p); p += c.length; });
      return new Blob([out], { type: "application/pdf" });
    }
  }
  window.Pdf = Pdf;
})();

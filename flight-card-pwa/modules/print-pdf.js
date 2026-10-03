// Print cards → PDF → iOS share sheet.
//
// Why this exists: from the Home Screen app on the pilot's iPad, the web
// page's own print command (window.print) opens nothing. A link to a separate
// print page doesn't escape either — anything inside the app's scope opens in
// the app's own chrome-less window. What does work from a Home Screen app is
// the system share sheet, and for a PDF that sheet offers Print (plus Save to
// Files, AirDrop, Mail). So build the PDF here and hand it over.
//
// How: the browser lays the sheet out exactly as it would for printing, using
// the same sheetsHtml() and app.css. html2canvas photographs ONE card at
// 300 dpi — every card on a sheet is identical markup — and that image is
// placed four times on an A4 canvas, the bottom pair turned 180° here rather
// than trusting the renderer's transform support. Each A4 canvas becomes one
// JPEG page in a minimal hand-written PDF.

const H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const PAGE_W_PX = 2480;                                  // A4 width at 300 dpi
const PAGE_H_PX = Math.round(PAGE_W_PX * 297 / 210);     // 3508

let h2cLoading = null;
function loadRenderer() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!h2cLoading) {
    h2cLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = H2C_URL;
      s.async = true;
      s.onload = () => (window.html2canvas
        ? resolve(window.html2canvas)
        : reject(new Error('The PDF renderer failed to start')));
      s.onerror = () => {
        h2cLoading = null;   // let the next tap retry
        reject(new Error('Couldn’t load the PDF renderer — check the connection'));
      };
      document.head.appendChild(s);
    });
  }
  return h2cLoading;
}

// ---------- The PDF itself ----------
//
// One A4 page per JPEG, the image stretched to the full page. JPEG goes in
// as-is (DCTDecode), so there's no image encoding to get wrong here — only
// object offsets, which the xref table must list to the byte.
export function jpegPdf(pages) {
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const offs = [];
  const put = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    len += b.length;
  };
  const PW = 595.28, PH = 841.89;              // A4 in PDF points
  const n = pages.length;
  const total = 2 + 3 * n;                     // catalog, pages, then 3 per page

  // The second line's high bytes mark the file as binary for old tools.
  put('%PDF-1.4\n%âãÏÓ\n');
  const obj = (num, body) => { offs[num] = len; put(`${num} 0 obj\n${body}\nendobj\n`); };

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);

  pages.forEach((pg, i) => {
    const pageNum = 3 + 3 * i, imgNum = pageNum + 1, cNum = pageNum + 2;
    obj(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}]`
      + ` /Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${cNum} 0 R >>`);
    offs[imgNum] = len;
    put(`${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h}`
      + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`
      + ` /Length ${pg.bytes.length} >>\nstream\n`);
    put(pg.bytes);
    put('\nendstream\nendobj\n');
    const draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;   // ASCII: chars == bytes
    obj(cNum, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });

  const xrefAt = len;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let k = 1; k <= total; k++) xref += String(offs[k]).padStart(10, '0') + ' 00000 n \n';
  put(xref);
  put(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- Sheet → A4 JPEG ----------
async function renderSheet(sheet, html2canvas) {
  const sr = sheet.getBoundingClientRect();
  const cards = [...sheet.children].filter(el => el.classList.contains('pr-card'));
  if (!cards.length) throw new Error('Nothing to print');
  const k = PAGE_W_PX / sr.width;

  // Photograph the first card, which is never the rotated one.
  const card = await html2canvas(cards[0], {
    scale: k, backgroundColor: '#ffffff', logging: false,
    // In the clone html2canvas renders from, bring the off-screen host back
    // into view: some engines paint nothing for an element far off-screen.
    onclone: (doc) => {
      const h = doc.getElementById('pr-pdf-host');
      if (h) { h.style.left = '0px'; h.style.top = '0px'; }
    },
  });

  const page = document.createElement('canvas');
  page.width = PAGE_W_PX;
  page.height = PAGE_H_PX;
  const g = page.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);
  for (const c of cards) {
    const r = c.getBoundingClientRect();     // a 180° turn about the centre keeps the box
    const x = (r.left - sr.left) * k, y = (r.top - sr.top) * k;
    const w = r.width * k, h = r.height * k;
    // Follow the stylesheet, not a hard-coded index: whichever cards the CSS
    // turns upside down get turned here.
    const turned = getComputedStyle(c).transform !== 'none';
    if (!turned) {
      g.drawImage(card, x, y, w, h);
    } else {
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(Math.PI);
      g.drawImage(card, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }
  const blob = await new Promise((res, rej) =>
    page.toBlob(b => (b ? res(b) : rej(new Error('Couldn’t encode the page'))), 'image/jpeg', 0.92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // iPad Safari caps total canvas memory; give these back straight away.
  page.width = page.height = 0;
  card.width = card.height = 0;
  return { bytes, w: PAGE_W_PX, h: PAGE_H_PX };
}

// Markup in (sheetsHtml output: one sheet, or two for both sides), PDF bytes out.
export async function buildCardsPdf(sheetsMarkup) {
  const html2canvas = await loadRenderer();
  try { await document.fonts?.ready; } catch { /* older engines */ }
  const host = document.createElement('div');
  host.id = 'pr-pdf-host';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  host.innerHTML = sheetsMarkup;
  document.body.appendChild(host);
  try {
    const pages = [];
    for (const sheet of host.querySelectorAll('.pr-sheet')) {
      pages.push(await renderSheet(sheet, html2canvas));
    }
    return jpegPdf(pages);
  } finally {
    host.remove();
  }
}

// Hand the PDF to the share sheet. Rejects with the browser's own error so the
// caller can tell "user closed the sheet" (AbortError) from "the tap's
// permission ran out while the PDF was being made" (NotAllowedError).
export async function sharePdf(bytes, name = 'flight-cards.pdf') {
  const file = new File([bytes], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Flight cards' });
    return 'shared';
  }
  // Never fall back to a download inside a Home Screen app: navigating there
  // is exactly what trapped the pilot on a page with no way back.
  if (navigator.standalone === true) {
    throw new Error('This iPad won’t share files from the app');
  }
  // Desktop browsers without file sharing: a plain download.
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

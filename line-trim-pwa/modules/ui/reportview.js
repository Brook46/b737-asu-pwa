// ui/reportview.js — the check report inside the app: its own screen, so it works
// the same in a browser tab and in a Home-Screen web app (where opening a
// generated page in a new tab is unreliable). The report is a self-contained page
// shown in a frame; Print prints just that frame, Save file keeps a copy.

import { $, el, clear, toast } from './dom.js?v=15';
import { icon } from './icons.js?v=15';
import { reportHtml, saveReport } from '../report.js?v=15';

export function renderReport(root, ctx) {
  const s = ctx.session;
  if (!s) { ctx.goto('wings'); return; }
  clear(root);
  const wrap = el(`<div>
    <div class="report-bar">
      <button class="btn ghost sm" id="back">${icon.back} Results</button>
      <span class="grow"></span>
      <button class="btn sm" id="save">${icon.download} Save file</button>
      <button class="btn primary sm" id="print">${icon.share} Print / PDF</button>
    </div>
    <iframe class="report-frame" id="frame" title="Check report"></iframe>
  </div>`);
  root.appendChild(wrap);
  const frame = $('#frame', wrap);
  frame.srcdoc = reportHtml(s, { embedded: true });
  // grow the frame to its content so the page scrolls, not the frame
  frame.addEventListener('load', () => {
    const fit = () => { try { frame.style.height = `${frame.contentDocument.documentElement.scrollHeight + 8}px`; } catch {} };
    fit(); setTimeout(fit, 300);
  });
  $('#back', wrap).addEventListener('click', () => ctx.goto('result'));
  $('#save', wrap).addEventListener('click', () => { saveReport(s); toast('Report saved — open it in any browser to print'); });
  $('#print', wrap).addEventListener('click', () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { saveReport(s); toast('Printing isn\'t available here — saved the report instead'); }
  });
}

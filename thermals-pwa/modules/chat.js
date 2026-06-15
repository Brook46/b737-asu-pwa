// chat.js — group chat for today's room. Text, photos, and voice notes ride the
// same WebSocket as presence (broadcast by the DayRoom DO). Media is sent inline
// as a compressed data URL — fine for the short clips a flying crew shares; the
// per-pilot WhatsApp button stays the path for anything bigger.

import { esc, ago } from './ui.js';

let onSend = () => {};
let onSendMedia = () => {};
let myId = null;
const log = [];

export function init({ onSendMessage, onSendMedia: onMedia, selfId }) {
  onSend = onSendMessage || onSend;
  onSendMedia = onMedia || onSendMedia;
  myId = selfId || null;

  const form = document.getElementById('chat-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = (input.value || '').trim();
    if (!text) return;
    onSend(text);
    input.value = '';
  });

  // Photo: pick → downscale/compress → send as a JPEG data URL.
  const photoBtn = document.getElementById('chat-photo-btn');
  const photoInput = document.getElementById('chat-photo');
  photoBtn?.addEventListener('click', () => photoInput?.click());
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    try { onSendMedia({ type: 'image', data: await compressImage(file) }); }
    catch (err) { console.warn('photo failed', err); }
  });

  // Voice: tap to start, tap again to stop + send.
  const voiceBtn = document.getElementById('chat-voice-btn');
  voiceBtn?.addEventListener('click', () => toggleVoice(voiceBtn));
}

export function setSelfId(id) { myId = id; }

// Append a received message and repaint.
export function add(msg) {
  if (!msg || (!msg.text && !msg.media)) return;
  log.push(msg);
  if (log.length > 200) log.shift();
  render();
  markUnread();
}

function render() {
  const host = document.getElementById('chat-log');
  if (!host) return;
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
  host.innerHTML = log.map((m) => {
    const mine = m.from && m.from === myId ? ' is-mine' : '';
    return `<div class="chat-msg${mine}">
      <span class="chat-meta"><b style="color:${esc(m.color || '#9ab')}">${esc(m.nick || 'Pilot')}</b> · ${ago(m.ts)}</span>
      ${bodyHTML(m)}
    </div>`;
  }).join('');
  if (nearBottom) host.scrollTop = host.scrollHeight;
}

function bodyHTML(m) {
  if (m.media && typeof m.media.data === 'string') {
    if (m.media.type === 'image' && m.media.data.startsWith('data:image/')) {
      return `<img class="chat-img" src="${m.media.data}" alt="photo">`;
    }
    if (m.media.type === 'audio' && m.media.data.startsWith('data:audio/')) {
      return `<audio class="chat-audio" controls preload="metadata" src="${m.media.data}"></audio>`;
    }
  }
  return `<span class="chat-text">${esc(m.text)}</span>`;
}

function markUnread() {
  const panel = document.getElementById('panel-chat');
  if (panel && panel.classList.contains('hidden')) {
    document.getElementById('tab-chat')?.classList.add('has-unread');
  }
}
export function clearUnread() {
  document.getElementById('tab-chat')?.classList.remove('has-unread');
}

// ---------- media helpers ----------

// Downscale to <=1024px and JPEG-compress so a phone photo becomes ~50-150KB,
// small enough to relay over the WebSocket.
function compressImage(file, maxDim = 1024, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

let rec = null;
async function toggleVoice(btn) {
  if (rec && rec.state === 'recording') { rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return; // unsupported
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      btn.classList.remove('recording');
      rec = null;
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      if (blob.size > 800000) return; // keep voice notes short
      onSendMedia({ type: 'audio', data: await blobToDataURL(blob) });
    };
    rec.start();
    btn.classList.add('recording');
  } catch (err) {
    console.warn('mic unavailable', err);
    rec = null;
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

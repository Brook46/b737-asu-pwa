// chat.js — group chat for today's room. Messages ride the same WebSocket as
// presence (broadcast by the DayRoom DO). The per-pilot WhatsApp button on the
// roster card is the "DM" path; this is the shared channel.

import { esc, ago } from './ui.js';

let onSend = () => {};
let myId = null;
const log = [];

export function init({ onSendMessage, selfId }) {
  onSend = onSendMessage || onSend;
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
}

export function setSelfId(id) { myId = id; }

// Append a received message and repaint.
export function add(msg) {
  if (!msg || !msg.text) return;
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
      <span class="chat-text">${esc(m.text)}</span>
    </div>`;
  }).join('');
  if (nearBottom) host.scrollTop = host.scrollHeight;
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

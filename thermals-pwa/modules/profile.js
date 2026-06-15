// profile.js — the local pilot's profile: editor + local cache.
//
// All fields are visible to everyone sharing the day (the agreed trust model),
// so the editor copy is upfront about that. The profile is pushed to the room
// on join and whenever it changes (presence.js subscribes via onProfile).

import { COLORS } from '../config.js';
import { toast, esc } from './ui.js';

const KEY = 'thermals.profile';
const subs = new Set();

const BLANK = {
  nickname: '',
  color: COLORS[4],
  phone: '',            // E.164, doubles as WhatsApp target + identity
  bloodType: '',
  vehicle: '',          // free text: "Red VW van, ABC-123"
  emergency: '',        // emergency contact name + number
  links: '',            // enrichment: XContest / Instagram / etc, one per line
};

let profile = load();

function load() {
  try { return { ...BLANK, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...BLANK }; }
}

export function getProfile() { return { ...profile }; }
export function isComplete() { return !!(profile.nickname && profile.color); }
export function onProfile(fn) { subs.add(fn); return () => subs.delete(fn); }

export function saveProfile(patch) {
  profile = { ...profile, ...patch };
  localStorage.setItem(KEY, JSON.stringify(profile));
  subs.forEach((fn) => fn(getProfile()));
}

const BLOOD_TYPES = ['', 'O−', 'O+', 'A−', 'A+', 'B−', 'B+', 'AB−', 'AB+'];

// Render the editor form into #profile-form. Wires inputs straight to save.
export function renderEditor() {
  const host = document.getElementById('profile-form');
  if (!host) return;
  const p = profile;
  host.innerHTML = `
    <label class="field">
      <span>Nickname</span>
      <input id="pf-nick" type="text" maxlength="24" placeholder="e.g. Thermal Cat" value="${esc(p.nickname)}">
    </label>

    <div class="field">
      <span>Colour</span>
      <div id="pf-colors" class="color-row">
        ${COLORS.map((c) => `<button type="button" class="swatch${c === p.color ? ' is-on' : ''}"
            data-color="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join('')}
      </div>
    </div>

    <label class="field">
      <span>Phone (for WhatsApp + sign-in)</span>
      <input id="pf-phone" type="tel" inputmode="tel" placeholder="+972 5x xxx xxxx" value="${esc(p.phone)}">
    </label>

    <label class="field">
      <span>Blood type</span>
      <select id="pf-blood">
        ${BLOOD_TYPES.map((b) => `<option value="${b}"${b === p.bloodType ? ' selected' : ''}>${b || '—'}</option>`).join('')}
      </select>
    </label>

    <label class="field">
      <span>Vehicle</span>
      <input id="pf-vehicle" type="text" placeholder="Red VW van · ABC-123" value="${esc(p.vehicle)}">
    </label>

    <label class="field">
      <span>Emergency contact</span>
      <input id="pf-emerg" type="text" placeholder="Name + phone" value="${esc(p.emergency)}">
    </label>

    <label class="field">
      <span>Links (one per line)</span>
      <textarea id="pf-links" rows="2" placeholder="XContest / Instagram / …">${esc(p.links)}</textarea>
    </label>

    <p class="field-note">Everyone flying with you today can see all of these. Keep it to what helps the crew find or help you.</p>
  `;

  const bind = (id, key) =>
    host.querySelector(id)?.addEventListener('input', (e) => saveProfile({ [key]: e.target.value }));
  bind('#pf-nick', 'nickname');
  bind('#pf-phone', 'phone');
  bind('#pf-blood', 'bloodType');
  bind('#pf-vehicle', 'vehicle');
  bind('#pf-emerg', 'emergency');
  bind('#pf-links', 'links');

  host.querySelectorAll('.swatch').forEach((b) =>
    b.addEventListener('click', () => {
      saveProfile({ color: b.dataset.color });
      host.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('is-on', s === b));
    }));
}

// Normalise a phone string to a wa.me-friendly digits-only form.
export function waNumber(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

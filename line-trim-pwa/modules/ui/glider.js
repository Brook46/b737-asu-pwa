// ui/glider.js — which glider this check is: model and size, plus the serial
// number and owner the pilot types in. Shown on the measure and results screens,
// saved with the check, carried into history and every export.
//
// The last serial/owner used for a model + size is remembered (prefs.gliders) and
// offered on the next check of that model, visibly — a pilot with two of the same
// wing can see it and change it.

import { el, esc, classBadge } from './dom.js?v=10';
import { icon } from './icons.js?v=10';
import { prefs } from '../store.js?v=10';

const keyOf = s => `${s.gliderId}|${s.sizeKey}`;

/** The serial/owner remembered for this model + size, if any. */
export function rememberedGlider(gliderId, sizeKey) {
  return prefs.get().gliders?.[`${gliderId}|${sizeKey}`] || { serial: '', owner: '' };
}

function remember(s) {
  const all = { ...(prefs.get().gliders || {}) };
  if (s.serial || s.owner) all[keyOf(s)] = { serial: s.serial || '', owner: s.owner || '' };
  prefs.set({ gliders: all });
}

/** "SN 1234 · Dana" — or '' when neither is set. */
export function gliderIdentity(s) {
  return [s.serial ? `SN ${s.serial}` : '', s.owner || ''].filter(Boolean).join(' · ');
}

/**
 * The card: badge, "Brand Model · size", serial and owner, and an Edit button
 * that opens the two fields in place. onChange(s) runs after a save.
 */
export function gliderCard(s, { onChange, compact = false } = {}) {
  const card = el(`<div class="glider-card${compact ? ' compact' : ''}"></div>`);
  function view() {
    const who = gliderIdentity(s);
    card.innerHTML = `
      <div class="glider-main">${classBadge(s.wingClass || '')}
        <div class="glider-name"><b>${esc(s.brand)} ${esc(s.model)}</b><span>size ${esc(s.sizeKey)}${who ? ` · ${esc(who)}` : ''}</span></div>
        <button class="btn ghost sm" type="button" data-edit>${who ? `${icon.edit} Edit` : `${icon.plus} Serial &amp; owner`}</button>
      </div>`;
    card.querySelector('[data-edit]').addEventListener('click', edit);
  }
  function edit() {
    card.innerHTML = `
      <div class="glider-main">${classBadge(s.wingClass || '')}
        <div class="glider-name"><b>${esc(s.brand)} ${esc(s.model)}</b><span>size ${esc(s.sizeKey)}</span></div></div>
      <form class="glider-form">
        <label class="field"><span>Serial number</span>
          <input class="input" name="serial" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="from the label in the wing" value="${esc(s.serial || '')}"></label>
        <label class="field"><span>Owner</span>
          <input class="input" name="owner" autocomplete="name" placeholder="name" value="${esc(s.owner || '')}"></label>
        <div class="row"><button class="btn primary sm" type="submit">${icon.check} Save</button>
          <button class="btn ghost sm" type="button" data-cancel>Cancel</button></div>
      </form>`;
    const f = card.querySelector('form');
    f.serial.focus();
    card.querySelector('[data-cancel]').addEventListener('click', view);
    f.addEventListener('submit', e => {
      e.preventDefault();
      s.serial = f.serial.value.trim();
      s.owner = f.owner.value.trim();
      remember(s);
      view();
      onChange?.(s);
    });
  }
  view();
  return card;
}

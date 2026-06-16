// icons.js — per-state SVG glyphs, tinted to each pilot's colour.
//
// The same glyph set is used in three places: the map marker (DOM node), the
// roster list (inline SVG string), and the state selector buttons. So we expose
// both a raw-path lookup and helpers that wrap it.

// Each glyph is authored on a 24×24 viewBox, strokeable with currentColor and
// a filled accent via .fill. Designed to read at ~22px.
const GLYPHS = {
  // Paraglider: arched canopy, riser lines, pilot beneath.
  paraglider: `
    <path d="M2 9 Q12 2 22 9" />
    <path d="M2 9 L12 9 L22 9" />
    <line x1="3.5" y1="9" x2="10.5" y2="15" />
    <line x1="12"  y1="9" x2="12"   y2="15" />
    <line x1="20.5" y1="9" x2="13.5" y2="15" />
    <circle cx="12" cy="17" r="2" class="fill" />`,
  // Car: simple side profile with two wheels.
  car: `
    <path d="M3 14 L4.5 9.5 Q5 8.5 6 8.5 L18 8.5 Q19 8.5 19.5 9.5 L21 14 L21 17 L3 17 Z" class="fill-soft" />
    <circle cx="7.5" cy="17" r="2" class="fill" />
    <circle cx="16.5" cy="17" r="2" class="fill" />`,
  // Bus: tall box, windows, two wheels.
  bus: `
    <rect x="4" y="4" width="16" height="13" rx="2" class="fill-soft" />
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="9" y1="4" x2="9" y2="9" />
    <line x1="15" y1="4" x2="15" y2="9" />
    <circle cx="8" cy="18.5" r="1.8" class="fill" />
    <circle cx="16" cy="18.5" r="1.8" class="fill" />`,
  // Thumb up: classic hitchhiking gesture.
  thumb: `
    <path d="M7 11 L7 20 L4 20 L4 11 Z" class="fill-soft" />
    <path d="M7 11 L10.5 4 Q11 3 12 3.4 Q13 3.8 12.6 5 L11.5 9 L18 9 Q20 9 19.6 11 L18.4 17 Q18 19 16 19 L7 19 Z" class="fill" />`,
  // Retrieve: a car with a "coming back for you" return arrow.
  retrieve: `
    <path d="M3 15 L4.5 11 Q5 10 6 10 L18 10 Q19 10 19.5 11 L21 15 L21 17 L3 17 Z" class="fill-soft" />
    <circle cx="7.5" cy="17.5" r="1.7" class="fill" />
    <circle cx="16.5" cy="17.5" r="1.7" class="fill" />
    <path d="M8.5 6.5 Q12 3.5 15.5 6.5" />
    <path d="M15.5 6.5 L15.4 4 M15.5 6.5 L13 6.9" />`,
  // On the ground: a walking person, mid-stride.
  walk: `
    <circle cx="12.5" cy="4" r="2.3" class="fill" />
    <path d="M12.5 6.5 L11 12" />
    <path d="M11 12 L8.5 19" />
    <path d="M11 12 L14.5 15.5 L14.5 20" />
    <path d="M12 8 L8.5 9.5" />
    <path d="M12 8 L15.5 10.5" />`,
  // Landed & chilling: a beer mug with foam.
  beer: `
    <path d="M6.5 9 L6.5 19 Q6.5 20.5 8 20.5 L13 20.5 Q14.5 20.5 14.5 19 L14.5 9 Z" class="fill-soft" />
    <path d="M14.5 11 L17.5 11 Q18.5 11 18.5 12 L18.5 15 Q18.5 16 17.5 16 L14.5 16" />
    <path d="M6 9 Q5.5 6.5 8 6.5 Q8.5 5 10.5 5.2 Q12 4 13.5 5.4 Q15.5 5.6 14.8 7.2 Q15.6 8.6 14 9 Z" class="fill" />
    <line x1="9" y1="12" x2="9" y2="18" />
    <line x1="11.8" y1="12" x2="11.8" y2="18" />`,
  // Idle fallback.
  dot: `<circle cx="12" cy="12" r="5" class="fill" />`,
};

// Resolve a state id (FLYING…) or a glyph name (paraglider…) to a glyph name.
function glyphName(stateOrGlyph) {
  if (GLYPHS[stateOrGlyph]) return stateOrGlyph;
  const map = {
    FLYING: 'paraglider', WALKING: 'walk', DRIVING: 'car', RETRIEVE: 'retrieve',
    BUS: 'bus', HITCHHIKING: 'thumb', BEER: 'beer', GROUNDED: 'walk',
  };
  return map[stateOrGlyph] || 'walk';
}

// Inline <svg> string for a glyph, styled in the given colour.
export function glyphSVG(stateOrGlyph, color = 'currentColor', size = 22) {
  const name = glyphName(stateOrGlyph);
  return `<svg class="glyph glyph-${name}" viewBox="0 0 24 24" width="${size}" height="${size}"
     fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"
     stroke-linejoin="round" style="--c:${color}">${GLYPHS[name]}</svg>`;
}

function seatBadge(state, seats) {
  return (state === 'RETRIEVE' && seats > 0) ? `<span class="seat-badge">${seats}</span>` : '';
}

// Build a DOM node for a MapLibre HTML marker: a coloured teardrop pin holding
// the state glyph (a seat count badge when offering a retrieve ride), with an
// optional nickname label below.
export function markerEl(state, color, nickname, seats = 0) {
  const wrap = document.createElement('div');
  wrap.className = 'pilot-marker';
  // A missing/invalid colour makes --pilot-color invalid, which renders the pin
  // transparent — always fall back to a solid colour.
  wrap.style.setProperty('--pilot-color', color || '#29b6f6');
  wrap.innerHTML = `
    <div class="pilot-pin">${glyphSVG(state, '#fff', 24)}${seatBadge(state, seats)}</div>
    ${nickname ? `<div class="pilot-tag">${nickname}</div>` : ''}`;
  return wrap;
}

// Update an existing marker node in place (cheaper than recreating).
export function updateMarkerEl(el, state, color, nickname, seats = 0) {
  if (!el) return;
  el.style.setProperty('--pilot-color', color || '#29b6f6');
  const pin = el.querySelector('.pilot-pin');
  if (pin) pin.innerHTML = glyphSVG(state, '#fff', 24) + seatBadge(state, seats);
  const tag = el.querySelector('.pilot-tag');
  if (tag && nickname != null) tag.textContent = nickname;
}

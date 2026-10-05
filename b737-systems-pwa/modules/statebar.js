// statebar.js — the airplane's state under the phase buttons, editable:
// altitude and speed (sliders), flaps, gear, speed brake, autobrake, parking
// brake, engines, APU, external power and external air. Every control writes
// the same system state the overhead panels and levers do, so the schematics,
// the 3D airplane and the cockpit all follow.
//
// items: [{ key, label, kind: 'range'|'step'|'cycle'|'toggle', show(env) → bool,
//           get() → value, text(v) → string, set(v), min, max, step, opts }]

export function createStateBar(el, items, onChange) {
  el.innerHTML = '';
  const rows = [];
  for (const it of items) {
    const w = document.createElement('div');
    w.className = `sb-item sb-${it.kind}`;
    w.dataset.key = it.key;
    const lab = document.createElement('span');
    lab.className = 'sb-l';
    lab.textContent = it.label;
    w.append(lab);
    let val, input;
    if (it.kind === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.setAttribute('aria-label', it.label);
      input.addEventListener('input', () => { it.set(+input.value); onChange(); });
      val = document.createElement('output');
      w.append(input, val);
    } else if (it.kind === 'step') {
      const dn = document.createElement('button'); dn.className = 'sb-b'; dn.textContent = '−'; dn.setAttribute('aria-label', `${it.label} down`);
      const up = document.createElement('button'); up.className = 'sb-b'; up.textContent = '+'; up.setAttribute('aria-label', `${it.label} up`);
      val = document.createElement('output');
      dn.addEventListener('click', () => { it.set(Math.max(0, it.get() - 1)); onChange(); });
      up.addEventListener('click', () => { it.set(Math.min(it.opts.length - 1, it.get() + 1)); onChange(); });
      w.append(dn, val, up);
    } else {
      val = document.createElement('button');
      val.className = 'sb-v';
      val.addEventListener('click', () => {
        if (it.kind === 'toggle') it.set(!it.get());
        else it.set((it.get() + 1) % it.opts.length);
        onChange();
      });
      w.append(val);
    }
    el.append(w);
    rows.push({ it, w, val, input });
  }
  function update(env) {
    for (const { it, w, val, input } of rows) {
      const vis = it.show ? it.show(env) : true;
      w.hidden = !vis;
      if (!vis) continue;
      const v = it.get();
      if (input) {
        if (it.range) { const [mn, mx, st] = it.range(env); input.min = mn; input.max = mx; input.step = st; }
        if (document.activeElement !== input) input.value = v;
        input.disabled = !!it.locked?.(env);
      }
      val.textContent = it.text ? it.text(v, env) : it.opts ? it.opts[v] : String(v);
      w.classList.toggle('on', it.kind === 'toggle' && !!v);
    }
  }
  return { update };
}

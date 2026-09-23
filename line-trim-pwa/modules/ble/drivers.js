// ble/drivers.js — pluggable Web Bluetooth laser-meter adapters.
//
// A driver:
//   { id, label, needsBluetooth, requestOptions(), async attach(device, hooks) }
// attach() wires up notifications and returns an async cleanup fn.
// hooks: { onReading(mm, meta), onLog(text) }

// Nordic UART Service — used by many cheap BLE distance meters and DIY ESP32 rigs.
const NUS      = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX   = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify (device -> app)

// FNIRSI IR40 — 16-bit UUIDs. Protocol per MultiMote/fnirsi-ir40-webtool.
const IR40_SERVICE = 0xee01;
const IR40_NOTIFY  = 0xee02;   // device -> app
const IR40_WRITE   = 0xee03;   // app -> device

// Other services worth trying to peek at when sniffing an unknown meter.
const SNIFF_SERVICES = [
  IR40_SERVICE,
  '02a6c0d0-0451-4000-b000-fb3210111989', '00005301-0000-0041-5253-534f46540000',
  '3ab10100-f831-4395-b29d-570977d5bf94',
  NUS,
  0xffe0, 0xfff0,                       // HM-10 / common serial bridges
  '0000fe59-0000-1000-8000-00805f9b34fb',
  'battery_service', 'device_information',
];

function decodeText(dataView) {
  try { return new TextDecoder().decode(dataView).trim(); } catch { return ''; }
}
function hex(dataView) {
  // honour byteOffset/byteLength — a characteristic's DataView is often a
  // window onto a larger buffer, and ignoring that logs neighbouring bytes
  return [...new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)]
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
}

/** Pull a millimetre distance out of an ASCII frame like "1.234 m" / "1234mm" / "  1.23". */
export function parseAsciiDistance(text) {
  const m = /(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft)?/i.exec(text);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  switch ((m[2] || '').toLowerCase()) {
    case 'mm': return Math.round(v);
    case 'cm': return Math.round(v * 10);
    case 'm':  return Math.round(v * 1000);
    case 'in': return Math.round(v * 25.4);
    case 'ft': return Math.round(v * 304.8);
    default:   return Math.round(v < 20 ? v * 1000 : v); // bare number: <20 => metres
  }
}

/**
 * FNIRSI IR40 frame parser.
 *
 * Frames are `00 <len> <record>…` where each record is `02 <tag> <width> <4-byte
 * big-endian value>`:
 *    tag 01  measurement type: 0 = linear, 3 = rectangle
 *    tag 05  the result — distance for a linear measure, AREA for a rectangle
 *    tag 06  display unit: 0 = m, 1 = ft, 2 = in
 * The value is thousandths of the display unit, so in metric it is already
 * millimetres. Only linear measurements are a line length, so rectangle and
 * area frames are ignored rather than mistaken for a distance.
 */
export function parseIr40Frame(dataView) {
  const b = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  if (b.length < 9 || b[0] !== 0x00) return null;

  const rec = {};
  for (let i = 2; i + 6 < b.length; i++) {
    if (b[i] !== 0x02) continue;
    const tag = b[i + 1];
    rec[tag] = (b[i + 3] << 24 | b[i + 4] << 16 | b[i + 5] << 8 | b[i + 6]) >>> 0;
    i += 6;
  }
  if (rec[0x05] == null) return null;              // no result field
  if (rec[0x01] != null && rec[0x01] !== 0) return null;  // not a linear measure

  const raw = rec[0x05];
  switch (rec[0x06]) {
    case 1:  return { mm: Math.round(raw / 1000 * 304.8), unit: 'ft' };
    case 2:  return { mm: Math.round(raw / 1000 * 25.4),  unit: 'in' };
    default: return { mm: raw, unit: 'm' };
  }
}


// ---- Bosch GLM / PLR "C" (Bluetooth LE) -------------------------------------
// Two service UUIDs across generations: GLM 50 C (02a6c0d0-…) and PLR 30/40/50 C,
// GLM 50-27 C/CG and newer (00005301-…-534f46540000). Same MT protocol on both.
// Source: Bosch "MT protocol LRF command set" 2.5.0 (via PointerEvent/bosch-plr-demo)
// and an independent ESP32 implementation (ketan) agreeing on the byte layout.
const BOSCH_SVC_OLD  = '02a6c0d0-0451-4000-b000-fb3210111989';
const BOSCH_CHR_OLD  = '02a6c0d1-0451-4000-b000-fb3210111989';
const BOSCH_SVC_NEW  = '00005301-0000-0041-5253-534f46540000';
const BOSCH_CHR_NEW  = '00004301-0000-0041-5253-534f46540000';
// "AutoSyncEnable": the meter sends an Exchange Data Container on every measurement.
const BOSCH_AUTOSYNC = [0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a];

/**
 * Bosch Exchange Data Container: C0 55 <len> DevModeRef DevStatus ID(2) Result(f32 LE) …
 * DevMode = DevModeRef >> 2. Only 1 (single distance) and 2 (continuous distance)
 * carry a length in Result; area, volume, angle and error containers are ignored,
 * so an area can never be recorded as a line length. Result is always metres.
 */
export function parseBoschFrame(dataView) {
  const b = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  if (b.length < 11 || b[0] !== 0xc0 || b[1] !== 0x55) return null;
  const devMode = b[3] >> 2;
  if (devMode !== 1 && devMode !== 2) return { ignored: true, devMode };
  const m = new DataView(b.buffer, b.byteOffset + 7, 4).getFloat32(0, true);
  if (!Number.isFinite(m) || m <= 0) return null;
  return { mm: Math.round(m * 1000), devMode, ref: ['front', 'tripod', 'rear', 'pin'][b[3] & 3], id: b[5] | (b[6] << 8) };
}

// ---- Leica DISTO (Bluetooth Smart) -------------------------------------------
// Service 3ab10100-f831-4395-b29d-570977d5bf94. DISTANCE (…0101) notifies an f32
// LE in metres on most models; the D2 family only has BASIC_MEASUREMENT_VALUES
// (…010d), a 20-byte packet with the distance at 0 and a per-measurement counter
// in the low 14 bits of the last word. Source: the MIT-licensed `disto` crate,
// verified on a DISTO D2G.
const DISTO_SVC   = '3ab10100-f831-4395-b29d-570977d5bf94';
const DISTO_DIST  = '3ab10101-f831-4395-b29d-570977d5bf94';
const DISTO_BASIC = '3ab1010d-f831-4395-b29d-570977d5bf94';

export function parseDistoDistance(dataView) {
  if (dataView.byteLength < 4) return null;
  const m = dataView.getFloat32(0, true);
  return Number.isFinite(m) && m > 0 ? { mm: Math.round(m * 1000) } : null;
}
export function parseDistoBasic(dataView) {
  if (dataView.byteLength < 20) return null;
  const m = dataView.getFloat32(0, true);
  const counter = dataView.getUint16(18, true) & 0x3fff;
  return Number.isFinite(m) && m > 0 ? { mm: Math.round(m * 1000), counter } : null;
}

const IR40_CONTINUOUS_ON  = [0x00, 0x07, 0x02, 0x08, 0x0e, 0x00, 0x00, 0x00, 0x01];
const IR40_CONTINUOUS_OFF = [0x00, 0x07, 0x02, 0x08, 0x0e, 0x00, 0x00, 0x00, 0x00];

async function subscribe(characteristic, handler) {
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', handler);
  return async () => {
    try { characteristic.removeEventListener('characteristicvaluechanged', handler); } catch {}
    try { await characteristic.stopNotifications(); } catch {}
  };
}

export const DRIVERS = {
  manual: {
    id: 'manual',
    label: 'Manual entry (no device)',
    needsBluetooth: false,
    requestOptions: null,
    async attach() { return async () => {}; },
  },

  mock: {
    id: 'mock',
    label: 'Mock laser (desk testing)',
    needsBluetooth: false,
    requestOptions: null,
    // Behaves like a real laser on a rig: 5 Hz, ±1 mm jitter while held on a
    // line for ~3 s, then a second of wandering while it's re-aimed. Enough to
    // exercise steady-reading capture and re-arming without hardware.
    async attach(_device, { onReading, onLog, aim }) {
      onLog?.('mock: 5 Hz stream, holds each line ~3 s, then moves');
      const pick = () => { const a = aim?.(); return a == null ? 6500 + Math.round(Math.random() * 1100) : Math.round(a + (Math.random() - 0.5) * 30); };
      let base = pick(), t = 0;
      const timer = setInterval(() => {
        t++;
        const phase = t % 20;                       // 0..14 held, 15..19 moving
        if (phase === 19) base = pick();            // re-aimed at the next line
        const mm = phase < 15
          ? base + Math.round((Math.random() - 0.5) * 2)
          : base + Math.round((Math.random() - 0.5) * 400);
        onReading?.(mm, { source: 'mock' });
      }, 200);
      return async () => clearInterval(timer);
    },
  },

  ir40: {
    id: 'ir40',
    label: 'FNIRSI IR40 laser rangefinder',
    needsBluetooth: true,
    // Two filters (OR): match by advertised service, or by name for units that
    // don't advertise it. optionalServices keeps access when matched by name.
    requestOptions: {
      filters: [{ services: [IR40_SERVICE] }, { namePrefix: 'fnirsi' }, { namePrefix: 'FNIRSI' }],
      optionalServices: [IR40_SERVICE],
    },
    async attach(device, { onReading, onLog }) {
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(IR40_SERVICE);
      const notify = await svc.getCharacteristic(IR40_NOTIFY);
      let write = null;
      try { write = await svc.getCharacteristic(IR40_WRITE); } catch { /* read-only is fine */ }

      let warnedUnit = false;
      const off = await subscribe(notify, ev => {
        const parsed = parseIr40Frame(ev.target.value);
        if (!parsed) { onLog?.(`rx (ignored): ${hex(ev.target.value)}`); return; }
        if (parsed.unit !== 'm' && !warnedUnit) {
          warnedUnit = true;
          onLog?.(`device is displaying ${parsed.unit} — converting, but set it to metres for best resolution`);
        }
        onLog?.(`measure ${parsed.mm} mm (${parsed.unit})`);
        onReading?.(parsed.mm, { source: 'ir40', unit: parsed.unit });
      });

      // Continuous mode: the meter streams while you line the beam up, so a
      // reading is already waiting when you press Capture.
      if (write) {
        try {
          await write.writeValue(new Uint8Array(IR40_CONTINUOUS_ON));
          onLog?.('continuous measurement started');
        } catch (e) { onLog?.('could not start continuous mode: ' + e.message); }
      }

      return async () => {
        if (write) {
          try { await write.writeValue(new Uint8Array(IR40_CONTINUOUS_OFF)); } catch {}
        }
        await off();
      };
    },
  },

  bosch: {
    id: 'bosch',
    label: 'Bosch GLM / PLR (C models)',
    needsBluetooth: true,
    requestOptions: {
      filters: [{ services: [BOSCH_SVC_NEW] }, { services: [BOSCH_SVC_OLD] },
                { namePrefix: 'Bosch' }, { namePrefix: 'GLM' }, { namePrefix: 'PLR' }],
      optionalServices: [BOSCH_SVC_NEW, BOSCH_SVC_OLD],
    },
    async attach(device, { onReading, onLog }) {
      const server = await device.gatt.connect();
      let svc, chr;
      try { svc = await server.getPrimaryService(BOSCH_SVC_NEW); chr = await svc.getCharacteristic(BOSCH_CHR_NEW); }
      catch { svc = await server.getPrimaryService(BOSCH_SVC_OLD); chr = await svc.getCharacteristic(BOSCH_CHR_OLD); }
      let lastId = null, warnedRef = null;
      const off = await subscribe(chr, ev => {
        const r = parseBoschFrame(ev.target.value);
        if (!r) return;
        if (r.ignored) { onLog?.(`ignored a non-distance measurement (mode ${r.devMode}) — set the meter to single distance`); return; }
        if (r.devMode === 1 && r.id === lastId) return;          // same measurement re-sent
        lastId = r.id;
        if (r.ref !== warnedRef) { warnedRef = r.ref; onLog?.(`measuring from the ${r.ref} of the meter — calibrate the zero offset to match your rig`); }
        onReading?.(r.mm, { source: 'bosch', ref: r.ref });
      });
      await chr.writeValue(new Uint8Array(BOSCH_AUTOSYNC));
      onLog?.('Bosch: auto-sync on — press the measure button on the meter');
      return off;
    },
  },

  leica: {
    id: 'leica',
    label: 'Leica DISTO',
    needsBluetooth: true,
    requestOptions: {
      filters: [{ services: [DISTO_SVC] }, { namePrefix: 'DISTO' }, { namePrefix: 'Disto' }],
      optionalServices: [DISTO_SVC],
    },
    async attach(device, { onReading, onLog }) {
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(DISTO_SVC);
      let chr = null, basic = false;
      try { chr = await svc.getCharacteristic(DISTO_DIST); }
      catch { chr = await svc.getCharacteristic(DISTO_BASIC); basic = true; }
      // A DISTO can replay its PREVIOUS measurement when you subscribe. With the
      // basic packet the per-measurement counter tells new from old; the first
      // packet only sets the baseline.
      let lastCounter = null;
      const off = await subscribe(chr, ev => {
        if (basic) {
          const r = parseDistoBasic(ev.target.value);
          if (!r) return;
          if (lastCounter === null) { lastCounter = r.counter; onLog?.(`DISTO: ready (ignoring the stored ${r.mm} mm)`); return; }
          if (r.counter === lastCounter) return;
          lastCounter = r.counter;
          onReading?.(r.mm, { source: 'leica' });
        } else {
          const r = parseDistoDistance(ev.target.value);
          if (r) onReading?.(r.mm, { source: 'leica' });
        }
      });
      onLog?.(`DISTO: listening on ${basic ? 'basic measurement' : 'distance'} — press the measure button`);
      return off;
    },
  },

  'mock-shot': {
    id: 'mock-shot',
    label: 'Mock laser — button presses (desk testing)',
    needsBluetooth: false,
    requestOptions: null,
    // Like a Bosch / Leica / IR40 in single mode: one reading every ~2.5 s.
    // Aims near the line on screen, with the odd mis-aimed shot thrown in.
    async attach(_device, { onReading, onLog, aim }) {
      onLog?.('mock: one reading per "press", every ~2.5 s');
      const shot = () => {
        const t = aim?.();
        if (t == null || Math.random() < 0.15) return 6500 + Math.round(Math.random() * 1100);
        return Math.round(t + (Math.random() - 0.5) * 30);
      };
      const timer = setInterval(() => onReading?.(shot(), { source: 'mock' }), 2500);
      return async () => clearInterval(timer);
    },
  },

  'nordic-uart': {
    id: 'nordic-uart',
    label: 'BLE meter — Nordic UART (generic / ESP32)',
    needsBluetooth: true,
    requestOptions: { acceptAllDevices: true, optionalServices: [NUS] },
    async attach(device, { onReading, onLog }) {
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(NUS);
      const tx = await svc.getCharacteristic(NUS_TX);
      onLog?.('nordic-uart: subscribed to TX characteristic.');
      let buf = '';
      const off = await subscribe(tx, ev => {
        const chunk = decodeText(ev.target.value);
        onLog?.(`rx: ${chunk || hex(ev.target.value)}`);
        buf = (buf + chunk).slice(-64);
        const mm = parseAsciiDistance(buf);
        if (mm != null) { onReading?.(mm, { source: 'nordic-uart' }); buf = ''; }
      });
      return off;
    },
  },

  sniff: {
    id: 'sniff',
    label: 'Identify unknown meter (sniff notifications)',
    needsBluetooth: true,
    requestOptions: { acceptAllDevices: true, optionalServices: SNIFF_SERVICES },
    async attach(device, { onReading, onLog }) {
      const server = await device.gatt.connect();
      const cleanups = [];
      let services = [];
      try { services = await server.getPrimaryServices(); } catch (e) { onLog?.('getPrimaryServices failed: ' + e.message); }
      onLog?.(`sniff: ${services.length} service(s) visible (Web Bluetooth only exposes whitelisted UUIDs).`);
      for (const svc of services) {
        let chars = [];
        try { chars = await svc.getCharacteristics(); } catch { continue; }
        for (const ch of chars) {
          if (!ch.properties.notify && !ch.properties.indicate) continue;
          try {
            const off = await subscribe(ch, ev => {
              const txt = decodeText(ev.target.value);
              onLog?.(`${svc.uuid.slice(0, 8)}/${ch.uuid.slice(0, 8)}  ${txt || ''}  [${hex(ev.target.value)}]`);
              const mm = parseAsciiDistance(txt);
              if (mm != null) onReading?.(mm, { source: 'sniff', char: ch.uuid });
            });
            cleanups.push(off);
            onLog?.(`listening on ${svc.uuid.slice(0, 8)}/${ch.uuid.slice(0, 8)}`);
          } catch {}
        }
      }
      if (!cleanups.length) onLog?.('No notifiable characteristics found on whitelisted services.');
      return async () => { for (const c of cleanups) await c(); };
    },
  },
};

// real meters first, desk-testing mocks last
export const DRIVER_LIST = ['manual', 'ir40', 'bosch', 'leica', 'nordic-uart', 'sniff', 'mock-shot', 'mock']
  .map(id => DRIVERS[id]);

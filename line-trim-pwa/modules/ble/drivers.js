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
    async attach(_device, { onReading, onLog }) {
      onLog?.('mock: 5 Hz stream, holds each line ~3 s, then moves');
      let base = 7000 + Math.round(Math.random() * 600), t = 0;
      const timer = setInterval(() => {
        t++;
        const phase = t % 20;                       // 0..14 held, 15..19 moving
        if (phase === 15) base = 6500 + Math.round(Math.random() * 1100);
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

export const DRIVER_LIST = Object.values(DRIVERS);

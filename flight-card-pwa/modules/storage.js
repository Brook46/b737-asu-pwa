// storage.js — localStorage-backed state for Flight Card.
//
// Schema (single key "fc.state" v2):
// {
//   v: 2,
//   template: { sections: [{ id, name, items: [{ id, label }] }] },
//   speeches: [{ id, name, body }],
//   current:  { id, started, dataCard:{}, ticks:{ itemId: ts }, notes:{ itemId: string } },
//   history:  [ same shape as current, latest first, capped to HISTORY_MAX ]
// }

import { flipName } from './roster.js';

const KEY = 'fc.state';
// v7: per-leg dataCard/ticks/notes. Each leg in current.legs[] owns its own
// bag of data, so switching legs swaps fuel / SOB / ATIS / TO performance /
// checklist with it. Top-level current.dataCard/ticks/notes stays as the
// fallback "single-flight" store when there are no legs at all.
// v8: default checklist reseeded — Preflight moved into Papers and Perf,
// items reordered to match how the documents stack actually gets walked
// on the flight deck. The migrate() path replaces .template on any
// version bump so the new default takes effect on existing installs.
// v9: PA library rewritten — QRH-style Welcome / Delay / Turbulence /
// Top of descent / Diversion / Welcome home. Migrate force-reseeds
// .speeches when crossing v9 so existing installs pick up the new set.
// v10: PA library re-shuffled at the user's request — Welcome kept,
// Top of descent / Turbulence / Diversion / Welcome home removed,
// Go around / Emergency / Ditching / Smoke-fire / Malfunction / Delays
// added. Reseed triggers again on this bump.
// v11: Welcome body rewritten in the new El Al house style, and a new
// "IOE" PA added (delivered by the First Officer). Migration patches the
// existing Welcome in-place and inserts IOE after it so any user-renamed
// PAs survive — no full reseed.
// v12: crew names flipped from El Al's "SURNAME FIRSTNAME" convention to
// the everyday "FIRSTNAME SURNAME" order. Future syncs flip at the parse
// boundary (roster.js); v11→v12 also runs flipName over every stored
// crew name (legs + active dataCard) so the existing data is consistent
// with what new syncs will produce.
// v13: new top-level fc.state.crew registry — { [CANONICAL_NAME]:
// { nickname, phone, flights } } — backs nickname-aware PA tokens, the
// WhatsApp deep-link, and the "last flight with X" popover. v12→v13
// migration walks every stored leg's crew fields (cpt/fo/cc1..cc5) and
// pre-seeds empty entries so the analytics flight-count is accurate.
// Also drops the 3h crew/flight_time merge lock — calendar always wins
// going forward.
// v14: per-leg logbook fields land in dataCard: block_time (scheduled,
// pinned at first sync), actual_flight_time (HH:MM, GPS or manual),
// to_role / ldg_role (PF / PM / ''), max_g (peak landing G). Migration
// seeds block_time = current flight_time on every existing leg so the
// logbook export has consistent block numbers from day one.
const VERSION = 14;
const HISTORY_MAX = 20;

// Fields whose values are tied to the leg's *identity* (route, schedule,
// flight number, tail). When new legs come in from a roster, these get
// seeded into the leg's dataCard so the data card reads from a single
// source of truth and the user's manual edits per-leg are preserved.
const LEG_IDENTITY_KEYS = ['flight','tail','dep','arr','flight_time','ctot'];

const DEFAULT_TEMPLATE = {
  sections: [
    { id: 's-cabin', name: 'Cabin', items: [
      { id: 'i-waste', label: 'Water waste' },
      { id: 'i-2c',    label: '2C' },
    ]},
    // Preflight moved here — it's a paperwork item, not a phase-of-flight
    // checklist. Order matches how a B737NG pilot actually walks the
    // documents stack on the flight deck.
    { id: 's-papers', name: 'Papers and performance', items: [
      { id: 'i-preflight',  label: 'Preflight' },
      { id: 'i-atl',        label: 'ATL' },
      { id: 'i-notoc',      label: 'NOTOC' },
      { id: 'i-clearance',  label: 'Clearance' },
      { id: 'i-ls',         label: 'LS' },
      { id: 'i-opt',        label: 'OPT' },
    ]},
    { id: 's-chk', name: 'Checklist', items: [
      { id: 'i-before-start',   label: 'Before start' },
      { id: 'i-cabin-ready',    label: 'Cabin ready' },
      { id: 'i-before-takeoff', label: 'Before takeoff' },
    ]},
  ],
};

// PA library — bilingual, ordered for the typical phase-of-flight sequence
// a 737NG pilot reads them in. The wording leans on the QRH "Passenger
// Announcements" supplement (welcome / turbulence / diversion / descent /
// landing) rather than ad-libbed phrasing, so it's something the user can
// read off the iPad and have it sound like a real airline PA.
const DEFAULT_SPEECHES = [
  {
    id: 'sp-welcome', name: 'Welcome',
    bodyEn:
`Dear passengers good @tod, welcome on board El Al flight to @arr. This is the Captain my name is @cpt. Joining me on the flight deck today is First Officer @fo. Our Inflight Service Manager,@PU, and the cabin crew will do everything they can to ensure you have a safe and enjoyable flight. Our flight time today is expected to be @flighttime, and the weather along our route is mostly fair. For your safety, we highly recommend keeping your seat belt fastened whenever you are seated. On behalf of El Al and the entire crew, I wish you a pleasant flight, and thank you for choosing to fly with us.`,
    bodyHe:
`נוסעות‏ ונוסעים יקרים @tod טוב, ברוכים הבאים לטיסת אל על ל@arr. כאן הקברניט,שמי @cpt. ויחד איתי בתא הטייסים היום עמיתי הקצין הראשון, @fo. מנהלת השירות בטיסה, @PU, וצוות הדיילים יעשו הכל כדי להבטיח לכם טיסה נעימה ובטוחה. זמן הטיסה המשוער היום הוא @flighttime, ומזג האוויר בנתיב צפוי להיות נוח ברובו. למען בטיחותכם, אנו ממליצים לחגור את חגורות הבטיחות לאורך הטיסה כשהנכם ישובים. בשם חברת אל על והצוות כולו, אני מאחל לכם טיסה נעימה ותודה שבחרתם איתנו.`
  },
  {
    // IOE — delivered by the First Officer (e.g. during Initial Operating
    // Experience), so the speaker line names the FO first and the captain
    // second. Same variable tokens as Welcome so the data-card fill-ins
    // (@cpt / @fo / @PU / @tod / @arr / @flighttime) work unchanged.
    id: 'sp-ioe', name: 'IOE',
    bodyEn:
`Dear passengers good @tod, welcome on board El Al flight to @arr.
This is First Officer @fo. With me on the flight deck is Captain @cpt.
Our Service Manager,@PU, and the cabin crew will do everything they can to ensure you have a safe and enjoyable flight.
Our flight time today is expected to be @flighttime, The weather along our route is mostly fair.
On behalf of El Al and the entire crew, thank you for choosing to fly with us.
Wish you all a pleasant flight.`,
    bodyHe:
`נוסעות‏ ונוסעים יקרים @tod טוב, ברוכים הבאים לטיסתנו ל@arr. כאן קצין הראשון, @fo. יחד איתי בתא הטייסים היום עמיתי הקברניט, @cpt.
מנהלת השירות בטיסתינו, @PU וצוות הדיילים יעשו הכל כדי להבטיח לכם טיסה בטוחה ונעימה.
זמן הטיסה הצפוי היום הוא @flighttime, ומזג האוויר בנתיב צפוי להיות נאה.
בשם חברת אל על והצוות כולו, אני מאחל לכם טיסה טובה.
ותודה שבחרתם איתנו.`
  },
  {
    id: 'sp-goaround', name: 'Go around',
    bodyEn:
`Ladies and gentlemen, this is Captain @cpt. We've performed a go-around. This is a standard manoeuvre that we use whenever the approach doesn't meet our criteria for a safe landing — it is not an emergency.

We're climbing away from the runway and will set up for another approach. Expected landing time is approximately @time local. The cabin crew will keep you updated. Please remain seated with your seatbelt fastened.`,
    bodyHe:
`גבירותיי ורבותיי, מדבר הקפטן @cpt. ביצענו "Go Around" — מהלך תקני שאנו מבצעים בכל פעם שהגישה אינה עומדת בקריטריונים שלנו לנחיתה בטוחה. זה אינו מצב חירום.

אנו מטפסים מהמסלול ונערך לגישה נוספת. שעת הנחיתה הצפויה בסביבות @time שעה מקומית. צוות הקבינה ימשיך לעדכן. נא להישאר חגורים במקומותיכם.`
  },
  {
    id: 'sp-emergency', name: 'Emergency',
    bodyEn:
`Attention. Attention. This is the captain.

We have an emergency on board and will be making an emergency landing in approximately [X] minutes. Listen carefully to the cabin crew and follow their instructions at all times.

When you hear me call "BRACE, BRACE" — assume the brace position the cabin crew has shown you, and stay in it until the aircraft comes to a complete stop. After landing, leave everything behind and follow the cabin crew's evacuation commands.

Cabin crew, prepare the cabin for emergency landing.`,
    bodyHe:
`שימו לב. שימו לב. מדבר הקפטן.

יש לנו מצב חירום במטוס ואנו עומדים לבצע נחיתת חירום בעוד כ-[X] דקות. הקשיבו היטב לצוות הקבינה ופעלו לפי הוראותיו בכל עת.

כאשר תשמעו אותי קורא "BRACE, BRACE" — קחו את עמדת ה־Brace שצוות הקבינה הראה לכם, והישארו בה עד שהמטוס יעצור לחלוטין. לאחר הנחיתה, השאירו הכל מאחור ופעלו לפי הוראות הפינוי של הצוות.

צוות, הכינו את הקבינה לנחיתת חירום.`
  },
  {
    id: 'sp-ditching', name: 'Ditching',
    bodyEn:
`Attention. Attention. This is the captain.

We will be ditching — landing on water — in approximately [X] minutes. Listen carefully to the cabin crew and follow their instructions at all times.

Put on your life vest NOW. Do NOT inflate it inside the aircraft — only after you have left the aircraft. The cabin crew will help anyone who needs assistance.

When you hear me call "BRACE, BRACE" — assume the brace position and stay in it until the aircraft comes to a complete stop on the water. After landing, leave everything behind, follow the cabin crew to the exits, and board the life rafts.

Cabin crew, prepare the cabin for ditching.`,
    bodyHe:
`שימו לב. שימו לב. מדבר הקפטן.

אנו עומדים לבצע נחיתה במים — Ditching — בעוד כ-[X] דקות. הקשיבו היטב לצוות הקבינה ופעלו לפי הוראותיו בכל עת.

לבשו את חגורת ההצלה עכשיו. אל תנפחו אותה בתוך המטוס — רק לאחר היציאה ממנו. צוות הקבינה יסייע לכל מי שזקוק לעזרה.

כאשר תשמעו אותי קורא "BRACE, BRACE" — קחו את עמדת ה־Brace והישארו בה עד שהמטוס יעצור לחלוטין על המים. לאחר הנחיתה, השאירו הכל מאחור, פעלו לפי הוראות צוות הקבינה ליציאות, ועלו לרפסודות ההצלה.

צוות, הכינו את הקבינה ל־Ditching.`
  },
  {
    id: 'sp-smokefire', name: 'Smoke / fire',
    bodyEn:
`Attention. Attention. This is the captain.

We have smoke / fire on board. We are descending and will land as soon as possible. Listen carefully to the cabin crew and follow their instructions at all times.

If you are in or near smoke, breathe through a wet cloth and stay low. Remain in your seats with your seatbelt fastened. The cabin crew will help anyone who needs assistance.

When you hear me call "BRACE, BRACE" — assume the brace position and stay in it until the aircraft comes to a complete stop. After landing, leave everything behind and follow the cabin crew's evacuation commands.

Cabin crew, prepare the cabin for landing.`,
    bodyHe:
`שימו לב. שימו לב. מדבר הקפטן.

יש עשן / אש במטוס. אנו יורדים וננחת בהקדם האפשרי. הקשיבו היטב לצוות הקבינה ופעלו לפי הוראותיו בכל עת.

אם אתם נמצאים בתוך עשן או בקרבתו, נשמו דרך בד רטוב והישארו במצב נמוך. הישארו במקומותיכם חגורים. צוות הקבינה יסייע לכל מי שזקוק לעזרה.

כאשר תשמעו אותי קורא "BRACE, BRACE" — קחו את עמדת ה־Brace והישארו בה עד שהמטוס יעצור לחלוטין. לאחר הנחיתה, השאירו הכל מאחור ופעלו לפי הוראות הפינוי של הצוות.

צוות, הכינו את הקבינה לנחיתה.`
  },
  {
    id: 'sp-malfunction', name: 'Malfunction',
    bodyEn:
`Ladies and gentlemen, this is Captain @cpt. We've encountered a technical issue with the aircraft. There is no immediate danger, but as a precaution we'll be returning to @dep / diverting to [alternate].

Expected landing time is approximately @time local. Ground services will be standing by on arrival. Please follow the cabin crew's instructions and remain seated with your seatbelt fastened. We will update you as soon as we have more information.`,
    bodyHe:
`גבירותיי ורבותיי, מדבר הקפטן @cpt. נתקלנו בתקלה טכנית במטוס. אין סכנה מיידית, אך מטעמי זהירות אנו חוזרים ל-@dep / מטים את הטיסה ל-[שדה חלופי].

שעת הנחיתה הצפויה בסביבות @time שעה מקומית. צוות הקרקע יהיה מוכן לסייע עם הנחיתה. נא לפעול לפי הוראות צוות הקבינה ולהישאר חגורים במקומותיכם. נעדכן אתכם ברגע שיהיה לנו מידע נוסף.`
  },
  {
    id: 'sp-delays', name: 'Delays',
    bodyEn:
`Ladies and gentlemen, this is Captain @cpt. We've been informed of a delay due to [ATC slot / weather / inbound aircraft / technical]. Our revised departure / landing time is approximately @time local. We apologise for the inconvenience and we'll proceed as soon as we're cleared.

Please remain seated with your seatbelt fastened. The cabin crew will keep you updated as soon as we have more information.`,
    bodyHe:
`גבירותיי ורבותיי, מדבר הקפטן @cpt. קיבלנו עדכון על עיכוב בגלל [תור המראה / מזג אוויר / מטוס נכנס / תקלה טכנית]. שעת ההמראה / הנחיתה המעודכנת היא בסביבות @time שעה מקומית. אנו מתנצלים על אי הנוחות ונמשיך ברגע שנקבל אישור.

נא להישאר חגורים במקומותיכם. צוות הקבינה ימשיך לעדכן אתכם ברגע שיהיה מידע נוסף.`
  },
];

function newFlightRecord() {
  return {
    id: makeFlightId(),
    started: Date.now(),
    dataCard: {},
    ticks: {},
    notes: {},
    legs: [],
    legIndex: 0,
  };
}
function makeFlightId() {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function freshState() {
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: clone(DEFAULT_SPEECHES),
    current: newFlightRecord(),
    history: [],
    // Crew registry: { [CANONICAL_NAME]: { nickname, phone, flights } }.
    // Keyed by the uppercased canonical name the calendar produces (e.g.
    // "YUVAL KOLAN"). Populated by appendLegs() as new legs land + by the
    // v12→v13 migration for existing legs.
    crew: {},
  };
}

let cache = null;

function read() {
  if (cache) return cache;
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { raw = null; }
  if (!raw) { cache = freshState(); return cache; }
  try {
    const parsed = JSON.parse(raw);
    cache = migrate(parsed);
  } catch {
    cache = freshState();
  }
  // Defensive defaults
  cache.template = cache.template || clone(DEFAULT_TEMPLATE);
  cache.speeches = Array.isArray(cache.speeches) && cache.speeches.length ? cache.speeches : clone(DEFAULT_SPEECHES);
  cache.current  = cache.current  || newFlightRecord();
  cache.current.dataCard = cache.current.dataCard || {};
  cache.current.ticks    = cache.current.ticks    || {};
  cache.current.notes    = cache.current.notes    || {};
  cache.current.legs     = Array.isArray(cache.current.legs) ? cache.current.legs : [];
  cache.current.legIndex = Number.isInteger(cache.current.legIndex) ? cache.current.legIndex : 0;
  cache.history  = Array.isArray(cache.history) ? cache.history : [];
  if (!cache.crew || typeof cache.crew !== 'object') cache.crew = {};
  return cache;
}

function migrate(s) {
  if (!s || typeof s !== 'object') return freshState();
  if (s.v === VERSION) return s;
  // Speech upgrade (v2→v3 schema): { body } → { bodyEn, bodyHe }.
  // v8→v9 and v9→v10: PA library rewritten — the previous defaults are
  // replaced wholesale with the set in DEFAULT_SPEECHES. We force the
  // reseed rather than preserving customisations because each rewrite
  // was an explicit user ask. (User-renamed PAs would be lost on those
  // bumps; once the library stabilises this can become opt-in.)
  // Pinned PAs — see setSpeechPinned. We preserve them verbatim across
  // every reseed / patch path below. Match by id first, then by name so
  // a user-renamed pin still survives.
  const pinnedSpeeches = (Array.isArray(s.speeches) ? s.speeches : [])
    .filter(sp => sp && sp.pinned);
  const isPinnedRef = (sp) => pinnedSpeeches.some(p =>
    (sp.id && p.id === sp.id) || (sp.name && p.name === sp.name));
  const reseedSpeeches = !s.v || s.v < 10;
  let upgradedSpeeches;
  if (reseedSpeeches) {
    // Pinned items survive the wholesale reseed; the rest comes from
    // DEFAULT_SPEECHES in the new order.
    const defaults = clone(DEFAULT_SPEECHES);
    if (pinnedSpeeches.length) {
      // Drop defaults that the user pinned a custom version of (match by
      // id/name) so we don't end up with two Welcome rows.
      const filteredDefaults = defaults.filter(d => !isPinnedRef(d));
      upgradedSpeeches = clone(pinnedSpeeches).concat(filteredDefaults);
    } else {
      upgradedSpeeches = defaults;
    }
  } else if (Array.isArray(s.speeches) && s.speeches.length) {
    upgradedSpeeches = s.speeches.map(sp => {
      if (sp.bodyEn || sp.bodyHe) return sp;
      const dflt = DEFAULT_SPEECHES.find(d => d.name === sp.name);
      return {
        id: sp.id,
        name: sp.name || 'PA',
        bodyEn: sp.body || dflt?.bodyEn || '',
        bodyHe: dflt?.bodyHe || '',
        pinned: !!sp.pinned,
      };
    });
  } else {
    upgradedSpeeches = clone(DEFAULT_SPEECHES);
  }
  // v10 → v11: targeted patch — overwrite the existing Welcome's body with
  // the new El Al house-style wording, and insert IOE right after Welcome
  // if the user doesn't already have it. Anything the user has renamed or
  // added between Welcome and IOE is preserved. Pinned PAs are skipped.
  if (!reseedSpeeches && s.v < 11) {
    const dfltWelcome = DEFAULT_SPEECHES.find(d => d.id === 'sp-welcome');
    const dfltIoe     = DEFAULT_SPEECHES.find(d => d.id === 'sp-ioe');
    const welcomeIdx  = upgradedSpeeches.findIndex(sp => sp.id === 'sp-welcome' || sp.name === 'Welcome');
    if (welcomeIdx >= 0 && dfltWelcome && !upgradedSpeeches[welcomeIdx].pinned) {
      upgradedSpeeches[welcomeIdx] = {
        ...upgradedSpeeches[welcomeIdx],
        bodyEn: dfltWelcome.bodyEn,
        bodyHe: dfltWelcome.bodyHe,
      };
    }
    const hasIoe = upgradedSpeeches.some(sp => sp.id === 'sp-ioe' || sp.name === 'IOE');
    if (!hasIoe && dfltIoe) {
      const insertAt = welcomeIdx >= 0 ? welcomeIdx + 1 : upgradedSpeeches.length;
      upgradedSpeeches.splice(insertAt, 0, clone(dfltIoe));
    }
  }
  // v3→v4: reseed checklist template (new defaults).
  // v4→v5: seed legs: [] + legIndex: 0 on current flight.
  // v5→v6: add settings.calendar block (defaults if missing) — non-destructive.
  // v6→v7: per-leg bags. Each leg gets its own dataCard/ticks/notes. Existing
  //        top-level current.dataCard/ticks/notes get copied into the active
  //        leg (if any) so in-flight data stays attached to that leg.
  const current = s.current || newFlightRecord();
  current.legs = Array.isArray(current.legs) ? current.legs : [];
  current.legIndex = Number.isInteger(current.legIndex) ? current.legIndex : 0;
  current.dataCard = current.dataCard || {};
  current.ticks    = current.ticks    || {};
  current.notes    = current.notes    || {};
  if (current.legs.length) {
    // Make sure every leg has its own bags.
    for (const leg of current.legs) {
      if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
      if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
      if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
      // Seed the leg's dataCard with its own identity fields if absent so
      // the data card reads from a single source of truth.
      for (const k of LEG_IDENTITY_KEYS) {
        if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
          leg.dataCard[k] = leg[k];
        }
      }
    }
    // Pour the pre-v7 top-level dataCard/ticks/notes into the active leg.
    // The user was clearly editing the active leg before the upgrade, so
    // the data belongs there. After migration, top-level stays empty.
    const idx = Math.max(0, Math.min(current.legs.length - 1, current.legIndex));
    const tgt = current.legs[idx];
    for (const [k, v] of Object.entries(current.dataCard)) if (tgt.dataCard[k] == null) tgt.dataCard[k] = v;
    for (const [k, v] of Object.entries(current.ticks))    if (tgt.ticks[k]    == null) tgt.ticks[k]    = v;
    for (const [k, v] of Object.entries(current.notes))    if (tgt.notes[k]    == null) tgt.notes[k]    = v;
    current.dataCard = {};
    current.ticks    = {};
    current.notes    = {};
  }
  // v11 → v12: crew names flip from "SURNAME FIRSTNAME" to "FIRSTNAME SURNAME".
  // Walk every leg's dataCard + top-level identity fields, plus the active
  // current.dataCard if there are no legs, and apply the parser's flipName.
  // Idempotency on later runs is guaranteed by the s.v < 12 gate.
  if (s.v && s.v < 12) {
    const CREW_KEYS = ['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
    const flipBag = (bag) => {
      if (!bag || typeof bag !== 'object') return;
      for (const k of CREW_KEYS) {
        if (bag[k]) bag[k] = flipName(bag[k]);
      }
    };
    if (current.legs.length) {
      for (const leg of current.legs) {
        flipBag(leg);          // top-level cpt/fo/cc1..cc5 on the leg
        flipBag(leg.dataCard); // the per-leg data card bag
      }
    } else {
      flipBag(current.dataCard);
    }
  }
  // v13 → v14: seed block_time = current flight_time on every existing leg.
  // The logbook export reads block_time as the authoritative scheduled block,
  // so back-filling now keeps history honest. Idempotent via the s.v < 14 gate.
  if (s.v && s.v < 14) {
    if (current.legs.length) {
      for (const leg of current.legs) {
        leg.dataCard = leg.dataCard || {};
        if (!leg.dataCard.block_time) {
          leg.dataCard.block_time = leg.flight_time || (leg.dataCard.flight_time || '');
        }
      }
    } else if (current.dataCard) {
      if (!current.dataCard.block_time) {
        current.dataCard.block_time = current.dataCard.flight_time || '';
      }
    }
  }
  // v12 → v13: seed the global crew registry from every existing leg's crew
  // fields. Each entry starts with empty nickname/phone and a flight count
  // equal to the number of legs the name appears in. Idempotency via s.v
  // gate; existing registry entries are preserved if a partial migration
  // happened earlier.
  const crew = (s.crew && typeof s.crew === 'object') ? s.crew : {};
  if (s.v && s.v < 13) {
    const CREW_KEYS = ['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
    const allLegBags = [];
    if (current.legs.length) {
      for (const leg of current.legs) {
        allLegBags.push(leg);
        if (leg.dataCard) allLegBags.push(leg.dataCard);
      }
    } else if (current.dataCard) {
      allLegBags.push(current.dataCard);
    }
    // Count appearances per canonical name. A name showing on both the
    // top-level leg.cpt AND leg.dataCard.cpt is the same leg, so dedupe
    // within each leg by collecting a set first.
    if (current.legs.length) {
      for (const leg of current.legs) {
        const seen = new Set();
        for (const k of CREW_KEYS) {
          const top = (leg[k] || '').trim();
          const card = ((leg.dataCard && leg.dataCard[k]) || '').trim();
          const name = (top || card).toUpperCase();
          if (name) seen.add(name);
        }
        for (const name of seen) {
          if (!crew[name]) crew[name] = { nickname: '', phone: '', flights: 0 };
          crew[name].flights = (crew[name].flights | 0) + 1;
        }
      }
    } else if (current.dataCard) {
      for (const k of CREW_KEYS) {
        const name = ((current.dataCard[k] || '')).trim().toUpperCase();
        if (!name) continue;
        if (!crew[name]) crew[name] = { nickname: '', phone: '', flights: 0 };
        crew[name].flights = (crew[name].flights | 0) + 1;
      }
    }
  }
  // Template handling — pre-v9 stored a different shape, so wholesale
  // reseed for s.v < 9. For modern users (v9+), preserve their template
  // verbatim. This is what makes section/item pinning meaningful: future
  // schema bumps that want to reseed defaults can now selectively merge
  // unpinned items only.
  let upgradedTemplate;
  if (!s.v || s.v < 9) {
    upgradedTemplate = clone(DEFAULT_TEMPLATE);
  } else if (s.template && Array.isArray(s.template.sections)) {
    upgradedTemplate = s.template;
  } else {
    upgradedTemplate = clone(DEFAULT_TEMPLATE);
  }
  return {
    v: VERSION,
    template: upgradedTemplate,
    speeches: upgradedSpeeches,
    current,
    history: Array.isArray(s.history) ? s.history : [],
    crew,
  };
}

let writeT = null;
function scheduleWrite() {
  if (writeT) clearTimeout(writeT);
  writeT = setTimeout(flush, 120);
}
export function flush() {
  if (writeT) { clearTimeout(writeT); writeT = null; }
  if (!cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { console.warn('storage write failed', e); }
}

// ---------- State accessors ----------
export function getState() { return read(); }
export function getTemplate() { return read().template; }
export function setTemplate(t) { read().template = t; scheduleWrite(); }

// ---------- Template editing ----------
export function addSection(name) {
  const s = read();
  const id = 's-' + Math.random().toString(36).slice(2, 8);
  s.template.sections.push({ id, name: name || 'New section', items: [] });
  scheduleWrite();
  return id;
}
// Pin a checklist section so a future schema bump's template reseed
// leaves it alone. Same shape as setSpeechPinned. Items have their own
// pin flag so a user can pin "Preflight" without pinning every item
// underneath.
export function setSectionPinned(id, on) {
  const sec = read().template.sections.find(x => x.id === id);
  if (sec) { sec.pinned = !!on; scheduleWrite(); }
}
export function setItemPinned(id, on) {
  for (const sec of read().template.sections) {
    const it = sec.items.find(x => x.id === id);
    if (it) { it.pinned = !!on; scheduleWrite(); return; }
  }
}

export function renameSection(id, name) {
  const sec = read().template.sections.find(x => x.id === id);
  if (sec) { sec.name = name; scheduleWrite(); }
}
export function deleteSection(id) {
  const s = read();
  s.template.sections = s.template.sections.filter(x => x.id !== id);
  scheduleWrite();
}
export function moveSection(id, delta) {
  const list = read().template.sections;
  const i = list.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  scheduleWrite();
}
export function addItem(sectionId, label) {
  const sec = read().template.sections.find(x => x.id === sectionId);
  if (!sec) return null;
  const id = 'i-' + Math.random().toString(36).slice(2, 8);
  sec.items.push({ id, label: label || 'New item' });
  scheduleWrite();
  return id;
}
export function renameItem(id, label) {
  for (const sec of read().template.sections) {
    const it = sec.items.find(x => x.id === id);
    if (it) { it.label = label; scheduleWrite(); return; }
  }
}
export function deleteItem(id) {
  const s = read();
  for (const sec of s.template.sections) {
    const before = sec.items.length;
    sec.items = sec.items.filter(x => x.id !== id);
    if (sec.items.length !== before) {
      delete s.current.ticks[id];
      delete s.current.notes[id];
      scheduleWrite();
      return;
    }
  }
}
export function moveItem(sectionId, itemId, delta) {
  const sec = read().template.sections.find(x => x.id === sectionId);
  if (!sec) return;
  const i = sec.items.findIndex(x => x.id === itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sec.items.length) return;
  [sec.items[i], sec.items[j]] = [sec.items[j], sec.items[i]];
  scheduleWrite();
}

// ---------- Current flight ----------
//
// Per-leg model: when current.legs[] is non-empty, every read of dataCard /
// ticks / notes routes through the active leg. The top-level current.dataCard
// is only used when there are no legs (single-flight mode). This keeps the
// rest of the app (data-card.js, checklist.js, speeches.js) blissfully
// unaware of the legs concept — they just call getCurrent().dataCard etc.

function activeLeg() {
  const c = read().current;
  if (!Array.isArray(c.legs) || !c.legs.length) return null;
  const i = Math.max(0, Math.min(c.legs.length - 1, c.legIndex | 0));
  const leg = c.legs[i];
  if (!leg) return null;
  // Lazy-create bags so legs imported pre-v7 (or from share-target) still work.
  if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
  if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
  if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
  // Seed identity fields once so the data card reads consistently.
  for (const k of LEG_IDENTITY_KEYS) {
    if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
      leg.dataCard[k] = leg[k];
    }
  }
  return leg;
}
function dataCardBag()  { return (activeLeg() || read().current).dataCard; }
function ticksBag()     { return (activeLeg() || read().current).ticks; }
function notesBag()     { return (activeLeg() || read().current).notes; }

export function getCurrent() {
  const c = read().current;
  const leg = activeLeg();
  if (!leg) return c;
  // Synthesise a view that points at the active leg's bags. Returning a
  // fresh object each call is cheap and keeps callers from accidentally
  // mutating the top-level current.dataCard.
  return {
    id: c.id,
    started: c.started,
    legs: c.legs,
    legIndex: c.legIndex,
    dataCard: leg.dataCard,
    ticks: leg.ticks,
    notes: leg.notes,
  };
}
export function setTick(itemId, on) {
  const bag = ticksBag();
  if (on) bag[itemId] = Date.now();
  else delete bag[itemId];
  scheduleWrite();
}
export function setNote(itemId, text) {
  const bag = notesBag();
  if (text && text.trim()) bag[itemId] = text.trim();
  else delete bag[itemId];
  scheduleWrite();
}
export function setDataField(key, value) {
  const bag = dataCardBag();
  if (value === '' || value == null) delete bag[key];
  else bag[key] = value;
  // Keep the leg's top-level identity fields in sync with the data card so
  // the leg-switcher chip and the depTs() sort still see edits made in the
  // data card (e.g. fixing a dep airport on the fly).
  const leg = activeLeg();
  if (leg && LEG_IDENTITY_KEYS.includes(key)) {
    if (value === '' || value == null) leg[key] = '';
    else leg[key] = value;
  }
  scheduleWrite();
}
export function setDataBulk(fields) {
  const bag = dataCardBag();
  const leg = activeLeg();
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null) delete bag[k];
    else bag[k] = v;
    if (leg && LEG_IDENTITY_KEYS.includes(k)) {
      if (v === '' || v == null) leg[k] = '';
      else leg[k] = v;
    }
  }
  scheduleWrite();
}

// ---------- Crew registry ----------
// One global map keyed by uppercased canonical name (the calendar's
// "FIRSTNAME SURNAME" string). Each entry holds the per-person nickname,
// phone (E.164), and a flight count incremented every time a new leg
// names them. Single source of truth for what gets *displayed* anywhere
// — data card cells, leg-switcher chips, PA token expansion.

function canon(name) {
  return String(name || '').trim().toUpperCase();
}

function ensureCrewEntry(s, name) {
  if (!s.crew || typeof s.crew !== 'object') s.crew = {};
  if (!s.crew[name]) s.crew[name] = { nickname: '', phone: '', flights: 0 };
  return s.crew[name];
}

export function getCrew(name) {
  const k = canon(name);
  if (!k) return null;
  const entry = read().crew?.[k];
  if (!entry) return null;
  return {
    name: k,
    nickname: entry.nickname || '',
    phone: entry.phone || '',
    flights: entry.flights | 0,
  };
}

export function setCrewNickname(name, nickname) {
  const k = canon(name);
  if (!k) return;
  const s = read();
  const entry = ensureCrewEntry(s, k);
  entry.nickname = String(nickname || '').trim();
  scheduleWrite();
}

export function setCrewPhone(name, phone) {
  const k = canon(name);
  if (!k) return;
  const s = read();
  const entry = ensureCrewEntry(s, k);
  // Strip everything that isn't a digit or leading +; WhatsApp's wa.me
  // wants digits only, but storing the + lets the editor round-trip.
  entry.phone = String(phone || '').trim().replace(/[^\d+]/g, '');
  scheduleWrite();
}

// Display this crew member's nickname if one is set, otherwise the
// canonical name. Single funnel — speeches.js, data-card.js, and the
// leg-switcher all use this so nicknames stay consistent everywhere.
export function displayCrew(name) {
  const k = canon(name);
  if (!k) return '';
  const nick = read().crew?.[k]?.nickname;
  return (nick && nick.trim()) || k;
}

// Walk every stored leg (current + history) for the most recent leg
// that named `name`. Used by the "last flight with" popover. Returns
// null when this is the first leg with them.
export function lastLegWith(name) {
  const k = canon(name);
  if (!k) return null;
  const CREW_KEYS = ['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
  const namesInLeg = (leg) => {
    const set = new Set();
    for (const f of CREW_KEYS) {
      const v = (leg?.[f] || (leg?.dataCard && leg.dataCard[f]) || '').trim().toUpperCase();
      if (v) set.add(v);
    }
    return set;
  };
  const allLegs = [];
  for (const leg of read().current.legs || []) allLegs.push(leg);
  for (const flight of read().history || []) {
    for (const leg of flight.legs || []) allLegs.push(leg);
  }
  // Sort by dep_date+dep_time DESC, fall back to lexical so legs with no
  // schedule still come through stable.
  allLegs.sort((a, b) => (depTs(b) || 0) - (depTs(a) || 0));
  for (const leg of allLegs) {
    if (namesInLeg(leg).has(k)) return leg;
  }
  return null;
}

// ---------- Legs (multi-flight roster) ----------
export function getLegs() { return read().current.legs || []; }
export function getLegIndex() { return read().current.legIndex || 0; }

// Used by app.js's maybeAutoJumpToCurrentLeg cooldown. Persisted so a quick
// page reload doesn't keep overriding a manual leg pick the user just made.
// Additive — no schema bump; absent key reads as 0.
export function getLastBootJumpAt() { return Number(read().lastBootJumpAt || 0); }
export function setLastBootJumpAt(ts) {
  const s = read();
  s.lastBootJumpAt = Number(ts) || 0;
  scheduleWrite();
}
export function getLeg(i) {
  const c = read().current;
  const idx = (typeof i === 'number') ? i : (c.legIndex || 0);
  return c.legs?.[idx] || null;
}
export function setLegs(legs) {
  const c = read().current;
  c.legs = Array.isArray(legs) ? legs.slice() : [];
  c.legIndex = 0;
  scheduleWrite();
}
export function setLegIndex(i) {
  const c = read().current;
  const max = (c.legs?.length || 1) - 1;
  c.legIndex = Math.max(0, Math.min(max, i | 0));
  scheduleWrite();
}
export function clearLegs() {
  const c = read().current;
  c.legs = [];
  c.legIndex = 0;
  scheduleWrite();
}

// Append new legs to the persistent list, sort the whole list by UTC dep
// time, then point legIndex at the most-recent of the new entries so the
// data card switches to it.
//
// Each new leg gets its own dataCard/ticks/notes bags. Identity fields
// (flight/tail/dep/arr/flight_time/ctot) and crew fields (cpt/fo/cc1..cc5)
// are seeded into the leg's dataCard so the data card has somewhere to
// read from on first switch.
//
// DEDUPE: if an incoming leg matches an existing leg by flight number
// (and dep_date, when both sides have one) the incoming data is MERGED
// into the existing leg instead of creating a duplicate. Merge rule:
// incoming values win for any non-empty field, so the QR scanner / roster
// re-paste act as "use the updated information" without wiping data the
// existing leg already carries.
//
// Returns { index, added, replaced } so the caller can craft the right
// toast ("Added 3 flights" vs "Updated ELY27") without inspecting state.
export function appendLegs(newLegs) {
  if (!Array.isArray(newLegs) || !newLegs.length) {
    return { index: read().current.legIndex || 0, added: 0, replaced: 0 };
  }
  const c = read().current;
  const existing = Array.isArray(c.legs) ? c.legs : [];
  // Seed bags on each incoming leg up front so the merge has something
  // to copy from on the dataCard side.
  const SEED_KEYS = LEG_IDENTITY_KEYS.concat(['cpt','fo','cc1','cc2','cc3','cc4','cc5']);
  for (const leg of newLegs) {
    if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
    if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
    if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
    // Logbook fields: block_time is the *scheduled* block snapshot —
    // captured once when the leg is first seen and never updated by
    // subsequent calendar syncs. mergeLeg's dataCard-wins rule explicitly
    // skips it (see mergeLeg). actual_flight_time / to_role / ldg_role /
    // max_g start empty; Phase 4's GPS detector fills them.
    if (!leg.dataCard.block_time) {
      leg.dataCard.block_time = leg.flight_time || leg.dataCard.flight_time || '';
    }
    for (const k of SEED_KEYS) {
      if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
        leg.dataCard[k] = leg[k];
      }
    }
  }

  // Partition incoming: merge into existing dupes vs. truly new entries.
  const toAdd = [];
  let mostRecentlyTouched = null;  // reference to whatever leg lives in the
                                   // combined array — used to land legIndex
                                   // on the right thing after the sort.
  let replaced = 0;
  for (const fresh of newLegs) {
    const dupIdx = findDuplicateLegIdx(fresh, existing);
    if (dupIdx >= 0) {
      mergeLeg(existing[dupIdx], fresh);
      mostRecentlyTouched = existing[dupIdx];
      replaced++;
    } else {
      toAdd.push(fresh);
      mostRecentlyTouched = fresh;
    }
  }

  // Sort the combined list by UTC dep time so the switcher stays ordered.
  const combined = existing.concat(toAdd);
  combined.sort((a, b) => depTs(a) - depTs(b));

  // Land legIndex: prefer a newly-added leg if there is one (existing
  // behaviour — that's the most useful focus point), otherwise land on
  // the last leg we replaced so the user can see the updated values.
  let landIdx = 0;
  if (toAdd.length) {
    landIdx = combined.indexOf(toAdd[0]);
  } else if (mostRecentlyTouched) {
    landIdx = combined.indexOf(mostRecentlyTouched);
  }
  c.legs = combined;
  c.legIndex = Math.max(0, landIdx);
  // Bump the crew registry's flight count for every name on each newly
  // added leg. Replaced legs don't bump — the count already covered them.
  // Dedupe per leg so the same person showing on top-level and dataCard
  // doesn't count twice.
  if (toAdd.length) {
    const s = read();
    const CREW_KEYS = ['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
    for (const leg of toAdd) {
      const seen = new Set();
      for (const k of CREW_KEYS) {
        const v = ((leg[k] || (leg.dataCard && leg.dataCard[k]) || '')).trim().toUpperCase();
        if (v) seen.add(v);
      }
      for (const name of seen) {
        const entry = ensureCrewEntry(s, name);
        entry.flights = (entry.flights | 0) + 1;
      }
    }
  }
  scheduleWrite();
  return { index: c.legIndex, added: toAdd.length, replaced };
}

// Find an existing leg that "is the same flight" as the incoming one.
// Match by digits-only flight number primarily; if BOTH sides also have
// a dep_date, require that to match too — that handles the "same flight
// number on a different day" edge case (rare but possible across a long
// duty period).
function findDuplicateLegIdx(incoming, existing) {
  const fl = digitsOf(incoming.flight);
  if (!fl) return -1;
  for (let i = 0; i < existing.length; i++) {
    const e = existing[i];
    if (digitsOf(e.flight) !== fl) continue;
    if (incoming.dep_date && e.dep_date && incoming.dep_date !== e.dep_date) continue;
    return i;
  }
  return -1;
}
function digitsOf(s) {
  return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
}

// Merge `source` into `target` in place. Used when an incoming leg dupes
// an existing one — incoming data wins for anything it actually carries,
// but the existing values stay for whatever the incoming side left empty.
//
// No pre-departure lock — the user asked for the calendar to always be
// authoritative. If dispatch updates crew or flight_time minutes before
// pushback, the resync overrides the local copy. Manual edits made in
// the cockpit will be re-overwritten on the next sync; that's the
// trade-off, and it's correct for this pilot's workflow.
function mergeLeg(target, source) {
  // Top-level identity + schedule fields — incoming wins for non-empty.
  for (const k of ['flight','tail','dep','arr','flight_time','ctot','dep_date','dep_time','arr_date','arr_time']) {
    if (source[k] != null && source[k] !== '') target[k] = source[k];
  }
  // dataCard merge — incoming wins per key for non-empty values, EXCEPT
  // block_time: it's the scheduled-block snapshot taken when the leg first
  // appeared, and shouldn't shift if dispatch later edits flight_time.
  target.dataCard = target.dataCard || {};
  for (const [k, v] of Object.entries(source.dataCard || {})) {
    if (k === 'block_time' && target.dataCard.block_time) continue;
    if (v != null && v !== '') target.dataCard[k] = v;
  }
  // Ticks: union — a tick on either side stays. Otherwise an incoming
  // empty checklist would wipe the local one.
  target.ticks = target.ticks || {};
  for (const [k, v] of Object.entries(source.ticks || {})) {
    if (v) target.ticks[k] = v;
  }
  // Notes: incoming wins for non-empty.
  target.notes = target.notes || {};
  for (const [k, v] of Object.entries(source.notes || {})) {
    if (v && String(v).trim()) target.notes[k] = v;
  }
  // Re-mirror identity fields into dataCard so the data card / leg
  // switcher see a single source of truth.
  for (const k of ['flight','tail','dep','arr','flight_time','ctot']) {
    if (target[k] != null && target[k] !== '') target.dataCard[k] = target[k];
  }
}

// Delete a single leg by index. Adjusts legIndex if the deleted leg was
// before or at the current one.
export function deleteLeg(idx) {
  const c = read().current;
  if (!Array.isArray(c.legs) || idx < 0 || idx >= c.legs.length) return;
  c.legs.splice(idx, 1);
  if (idx < c.legIndex) c.legIndex--;
  if (c.legIndex >= c.legs.length) c.legIndex = Math.max(0, c.legs.length - 1);
  scheduleWrite();
}

// Combine a leg's dep_date (dd.mm) + dep_time (HH:MM UTC) into a comparable
// timestamp. Used by appendLegs to keep the list time-sorted.
function depTs(leg) {
  const d = leg?.dep_date, t = leg?.dep_time;
  if (!d || !t) return Number.MAX_SAFE_INTEGER;
  const [dd, mm] = d.split('.');
  if (!dd || !mm) return Number.MAX_SAFE_INTEGER;
  const year = new Date().getUTCFullYear();
  const iso = `${year}-${mm}-${dd}T${t}:00Z`;
  let ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER;
  // If the parsed time is >6 months stale, assume next year (handles
  // year-end bulletins gracefully).
  if (Date.now() - ts > 6 * 30 * 24 * 3600 * 1000) {
    ts = Date.parse(`${year + 1}-${mm}-${dd}T${t}:00Z`);
  }
  return ts;
}

// Clear just the ticks (and notes) on the *active leg* (or top-level
// current if there are no legs) — used by the checklist card's reset
// button and the "Reset all" flow. Other legs keep their ticks.
export function resetTicks() {
  const leg = activeLeg();
  const tgt = leg || read().current;
  tgt.ticks = {};
  tgt.notes = {};
  scheduleWrite();
}

// Wipe the active leg's data card (V-speeds, fuel, ATIS, SOB, route, crew, …).
// Used by "Reset all" — caller is responsible for re-applying the active
// leg's metadata afterwards if they want the flight identity preserved.
export function clearDataCard() {
  const leg = activeLeg();
  const tgt = leg || read().current;
  tgt.dataCard = {};
  scheduleWrite();
}

// ---------- Speeches ----------
export function getSpeeches() { return read().speeches; }
export function getSpeech(id) { return read().speeches.find(s => s.id === id); }
export function addSpeech(name) {
  const s = read();
  const id = 'sp-' + Math.random().toString(36).slice(2, 8);
  s.speeches.push({ id, name: name || 'New PA', bodyEn: '', bodyHe: '' });
  scheduleWrite();
  return id;
}
// Pin a PA so future schema bumps don't wipe it. Idempotent; default
// state is unpinned. The migration paths that reseed DEFAULT_SPEECHES
// honour this flag — see speechReseedRespectingPins.
export function setSpeechPinned(id, on) {
  const sp = read().speeches.find(x => x.id === id);
  if (sp) { sp.pinned = !!on; scheduleWrite(); }
}
export function renameSpeech(id, name) {
  const sp = read().speeches.find(x => x.id === id);
  if (sp) { sp.name = name; scheduleWrite(); }
}
export function setSpeechBody(id, lang, body) {
  const sp = read().speeches.find(x => x.id === id);
  if (!sp) return;
  if (lang === 'he') sp.bodyHe = body;
  else sp.bodyEn = body;
  scheduleWrite();
}
export function deleteSpeech(id) {
  const s = read();
  s.speeches = s.speeches.filter(x => x.id !== id);
  scheduleWrite();
}
export function moveSpeech(id, delta) {
  const list = read().speeches;
  const i = list.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  scheduleWrite();
}

// ---------- New Flight / history ----------
export function newFlight() {
  const s = read();
  const hadContent =
    Object.keys(s.current.ticks).length > 0 ||
    Object.keys(s.current.dataCard).length > 0 ||
    Object.keys(s.current.notes).length > 0;
  if (hadContent) {
    s.history.unshift({ ...s.current, ended: Date.now() });
    s.history = s.history.slice(0, HISTORY_MAX);
  }
  s.current = newFlightRecord();
  scheduleWrite();
  return s.current;
}
export function getHistory() { return read().history; }
export function deleteHistoryEntry(id) {
  const s = read();
  s.history = s.history.filter(h => h.id !== id);
  scheduleWrite();
}

// ---------- Export / Import / Reset ----------
export function exportJson() { return JSON.stringify(read(), null, 2); }
export function importJson(json) {
  const parsed = JSON.parse(json);
  cache = migrate(parsed);
  flush();
  return cache;
}

// Single-leg export/import — used by the QR share path. Each payload is
// just one flight's worth of data: identity, dataCard, ticks. History and
// template aren't included (those are device-local concepts and shouldn't
// follow a single flight across devices).
//
// The wire format is aggressively compact so the QR stays at a low
// version and scans reliably from across the cockpit. Two tricks:
//   1. Long field names → 2-letter short keys (see K_SHORT). Cuts ~40%.
//   2. Empty/null/'' values are dropped entirely.
// Ticks become a flat array of ticked item ids (timestamps stripped — the
// receiving device just needs to know the box is checked). Notes are
// dropped unless non-empty.
//
// Wire shape:
//   { v: 7, k: 'l', l: { <compact-leg-fields>, tk: [...item-ids] } }

const K_SHORT = {
  // Identity / scheduling
  flight: 'f',  tail: 't',  dep: 'd',  arr: 'a',
  flight_time: 'ft', ctot: 'c',
  dep_date:'dd', dep_time:'dt', arr_date:'ad', arr_time:'at',
  // Takeoff perf
  v1: 'v1', vr: 'vr', v2: 'v2', n1: 'n1', flaps: 'fl',
  // Fuel
  trip_fuel: 'tf', block_fuel: 'bf',
  // SOB / ATIS
  sob_total: 'sb', atis: 'as', atis_note: 'an', atis_read: 'ar',
  // Crew
  cpt: 'cp', fo: 'fo',
  cc1: 'c1', cc2: 'c2', cc3: 'c3', cc4: 'c4', cc5: 'c5',
};
const K_LONG = Object.fromEntries(Object.entries(K_SHORT).map(([l, s]) => [s, l]));

function packLeg(leg) {
  const out = {};
  // Data card + identity only. The user asked for the smallest QR that
  // still carries the flight: tail, flight #, and the data card content
  // (V-speeds, N1, flaps, fuel, ATIS, SOB, dep/arr/flight_time/ctot,
  // crew). Checklist ticks are intentionally NOT shipped — the receiving
  // pilot runs their own checklist; sending ticks would just bloat the
  // QR and push the version up out of camera-scannable range.
  for (const k of ['flight','tail','dep','arr','flight_time','ctot']) {
    const v = leg[k];
    if (v != null && v !== '') out[K_SHORT[k]] = v;
  }
  for (const [k, v] of Object.entries(leg.dataCard || {})) {
    if (v == null || v === '') continue;
    const sk = K_SHORT[k];
    if (sk && out[sk] == null) out[sk] = v;
  }
  return out;
}

function unpackLeg(packed) {
  // Build the full leg shape the rest of the code expects.
  const leg = {
    flight: '', tail: '', dep: '', arr: '', flight_time: '',
    dep_date: '', dep_time: '', arr_date: '', arr_time: '',
    ctot: '',
    dataCard: {}, ticks: {}, notes: {},
  };
  // Identity / scheduling fields land both at top-level and in dataCard
  // (storage.appendLegs would do this anyway, but we do it here so the
  // pack→unpack round-trip is loss-free).
  const identityKeys = ['flight','tail','dep','arr','flight_time','ctot','dep_date','dep_time','arr_date','arr_time'];
  for (const [sk, v] of Object.entries(packed)) {
    if (sk === 'tk' || sk === 'nt') continue;
    const longKey = K_LONG[sk];
    if (!longKey) continue;
    if (identityKeys.includes(longKey)) leg[longKey] = v;
    leg.dataCard[longKey] = v;
  }
  if (Array.isArray(packed.tk)) {
    const now = Date.now();
    for (const s of packed.tk) {
      // Inverse of packLeg's "i-" stripping: bare ids get "i-" prepended,
      // anything that was custom is prefixed with "!" in packLeg and we
      // strip that here.
      const id = (s && s[0] === '!') ? s.slice(1) : ('i-' + s);
      leg.ticks[id] = now;
    }
  }
  if (packed.nt && typeof packed.nt === 'object') {
    Object.assign(leg.notes, packed.nt);
  }
  return leg;
}

export function exportLeg(idx) {
  const c = read().current;
  const i = (typeof idx === 'number')
    ? idx
    : Math.max(0, c.legIndex | 0);
  let leg;
  if (!Array.isArray(c.legs) || !c.legs.length) {
    // No legs → synthesise one from the top-level current bag so single-
    // flight users can still share what they've got.
    leg = {
      flight:      c.dataCard.flight || '',
      tail:        c.dataCard.tail   || '',
      dep:         c.dataCard.dep    || '',
      arr:         c.dataCard.arr    || '',
      flight_time: c.dataCard.flight_time || '',
      ctot:        c.dataCard.ctot   || '',
      dep_date: '', dep_time: '', arr_date: '', arr_time: '',
      dataCard: c.dataCard,
      ticks:    c.ticks,
      notes:    c.notes,
    };
  } else {
    leg = c.legs[Math.max(0, Math.min(c.legs.length - 1, i))];
  }
  return JSON.stringify({ v: VERSION, k: 'l', l: packLeg(leg) });
}

// Accepts a leg payload (as produced by exportLeg) and appends it to the
// current flight's legs[]. Returns the new leg's index so the caller can
// switch to it. Throws if the payload doesn't look like a leg envelope.
export function importLeg(json) {
  const parsed = (typeof json === 'string') ? JSON.parse(json) : json;
  if (!parsed || !parsed.l || (parsed.k !== 'l' && parsed.kind !== 'leg')) {
    throw new Error('Not a Flight Card leg payload');
  }
  // Back-compat: older exports used the verbose envelope { kind:'leg', leg:{...} }.
  // We can still import those by treating .leg as the unpacked shape.
  const packedOrFull = parsed.l || parsed.leg;
  const leg = (parsed.k === 'l') ? unpackLeg(packedOrFull) : clone(packedOrFull);
  return appendLegs([leg]);
}
export function resetAll() {
  cache = freshState();
  flush();
  return cache;
}

window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);

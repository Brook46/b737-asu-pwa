/**
 * Roster Swap & Flight Exchange — Google Apps Script backend.
 *
 * Deploy: Extensions ▸ Apps Script from a Google Sheet, paste this in, then
 *   Deploy ▸ New deployment ▸ Web app
 *     Execute as: Me
 *     Who has access: Anyone   (required so the PWA can POST without OAuth)
 * Copy the /exec URL into the app's ⚙︎ Swap settings, along with SHARED_TOKEN.
 *
 * The Sheet is created/formatted automatically on first run.
 *
 * SECURITY NOTES (read before going live):
 *  - "Anyone" access means the URL is effectively public. SHARED_TOKEN is a weak
 *    gate that stops casual abuse but is NOT real auth — anyone with the URL and
 *    token can post. For a real crew tool, put this behind proper sign-in.
 *  - The crew-scheduling email is the one irreversible side effect. It fires
 *    ONLY server-side, and ONLY when BOTH pilots have an 'accept' recorded for
 *    the same match. A single client can never trigger it alone, and the app
 *    never emails crew scheduling directly.
 *  - Set CREW_EMAIL to a REAL address only when you're ready. While testing,
 *    point it at yourself.
 */

// ======= CONFIG =======
const SHARED_TOKEN = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
const CREW_EMAIL   = 'crewscheduling@airline.com'; // ⚠ set to yourself while testing
const SHEET_LISTINGS = 'Listings';
const SHEET_MATCHES  = 'Matches';

// ======= ENTRY POINTS =======
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== SHARED_TOKEN) return json({ ok: false, error: 'Bad token' });

    switch (req.action) {
      case 'publish':  return json(handlePublish(req));
      case 'matches':  return json(handleMatches(req));
      case 'respond':  return json(handleRespond(req));
      default:         return json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Health check in a browser.
function doGet() { return json({ ok: true, service: 'roster-swap', ts: new Date().toISOString() }); }

// ======= HANDLERS =======

/**
 * publish: upsert this pilot's listing (their profile + duties they want to drop
 * + free days), then re-run matching against everyone else.
 * Body: { profile:{name,employeeId,phone,email}, wants:[snapshot...], freeDays:[...] }
 */
function handlePublish(req) {
  const p = req.profile || {};
  if (!p.employeeId || !p.email) return { ok: false, error: 'Missing profile' };

  const sh = sheet(SHEET_LISTINGS, [
    'listingId', 'timestamp', 'employeeId', 'name', 'phone', 'email', 'wantsJSON', 'freeDaysJSON', 'active',
  ]);

  const listingId = 'L-' + p.employeeId;
  const rows = sh.getDataRange().getValues();
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === listingId);
  const record = [
    listingId, new Date(), String(p.employeeId), p.name || '', p.phone || '', p.email || '',
    JSON.stringify(req.wants || []), JSON.stringify(req.freeDays || []), true,
  ];
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, record.length).setValues([record]);
  else sh.appendRow(record);

  const matches = runMatching(String(p.employeeId));
  return { ok: true, listingId, matchCount: matches.length };
}

/**
 * matches: return the match rows visible to this pilot, shaped for the UI.
 * Body: { employeeId }
 */
function handleMatches(req) {
  const me = String(req.employeeId || '');
  const sh = sheet(SHEET_MATCHES, matchHeader());
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const m = rowToMatch(rows[i]);
    if (m.aId !== me && m.bId !== me) continue;
    if (m.status === 'declined') continue;
    out.push(shapeMatchForPilot(m, me));
  }
  return { ok: true, matches: out };
}

/**
 * respond: record one pilot's accept/decline. If BOTH have accepted, confirm the
 * swap and email crew scheduling exactly once.
 * Body: { matchId, employeeId, decision:'accept'|'decline' }
 */
function handleRespond(req) {
  const me = String(req.employeeId || '');
  const decision = req.decision === 'accept' ? 'accept' : 'decline';
  const sh = sheet(SHEET_MATCHES, matchHeader());
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === req.matchId);
  if (idx < 1) return { ok: false, error: 'No such match' };

  const m = rowToMatch(rows[idx]);
  if (m.aId !== me && m.bId !== me) return { ok: false, error: 'Not your match' };
  if (m.status === 'confirmed') return { ok: true, status: 'confirmed' };

  // Record this side's decision.
  if (me === m.aId) m.aDecision = decision;
  else m.bDecision = decision;

  let status = 'open';
  if (m.aDecision === 'decline' || m.bDecision === 'decline') {
    status = 'declined';
  } else if (m.aDecision === 'accept' && m.bDecision === 'accept' && !m.emailedAt) {
    // BOTH accepted and we haven't emailed yet — the one irreversible step.
    sendSwapEmail(m);
    m.emailedAt = new Date().toISOString();
    status = 'confirmed';
  } else if (m.aDecision === 'accept' || m.bDecision === 'accept') {
    status = 'partial';
  }
  m.status = status;

  sh.getRange(idx + 1, 1, 1, matchHeader().length).setValues([matchToRow(m)]);
  return { ok: true, status: status === 'partial' ? 'accepted' : status };
}

// ======= MATCHING =======

/**
 * Basic two-sided matching: pilot A wants to drop a duty on date D; pilot B is
 * free to fly on date D (and vice-versa). A match needs a benefit in at least
 * one direction; a mutual (both-way) match is preferred. Preference filters
 * (morning/quickTurn/highBlock) are attached as notes, not hard gates, so the
 * pilots decide.
 */
function runMatching(changedEmployeeId) {
  const listings = readListings().filter(l => l.active);
  const msh = sheet(SHEET_MATCHES, matchHeader());
  const existing = msh.getDataRange().getValues();
  const existingKeys = new Set(existing.slice(1).map(r => r[1])); // pairKey column

  const created = [];
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const A = listings[i], B = listings[j];
      if (A.employeeId === B.employeeId) continue;

      // Duties A wants to drop that fall on days B is free (B could pick them up).
      const aToB = A.wants.filter(w => B.freeDays.includes(w.date));
      const bToA = B.wants.filter(w => A.freeDays.includes(w.date));
      if (aToB.length === 0 && bToA.length === 0) continue;

      const pairKey = [A.employeeId, B.employeeId].sort().join('|');
      if (existingKeys.has(pairKey)) continue; // don't duplicate an open pair

      const mineForA = aToB[0] || null;   // A gives this
      const mineForB = bToA[0] || null;   // B gives this
      const matchId = 'M-' + Utilities.getUuid().slice(0, 8);
      const m = {
        matchId, pairKey,
        aId: A.employeeId, aName: A.name, aEmail: A.email, aPhone: A.phone,
        bId: B.employeeId, bName: B.name, bEmail: B.email, bPhone: B.phone,
        // "aGives" is the duty A drops (B picks up); "bGives" is what B drops.
        aGivesJSON: JSON.stringify(mineForA),
        bGivesJSON: JSON.stringify(mineForB),
        aDecision: '', bDecision: '', status: 'open', emailedAt: '',
        note: buildNote(mineForA, mineForB),
        created: new Date().toISOString(),
      };
      msh.appendRow(matchToRow(m));
      existingKeys.add(pairKey);
      created.push(m);
      notifyNewMatch(m); // "match found" alert email to both pilots
    }
  }
  return created;
}

function buildNote(aGives, bGives) {
  const bits = [];
  if (aGives && bGives) bits.push('Two-way swap.');
  else bits.push('One-way pickup.');
  const prefText = w => {
    if (!w || !w.prefs) return '';
    const on = Object.keys(w.prefs).filter(k => w.prefs[k]);
    return on.length ? ` (wants: ${on.join(', ')})` : '';
  };
  if (aGives) bits.push(`${aGives.route} on ${aGives.date}${prefText(aGives)}`);
  if (bGives) bits.push(`${bGives.route} on ${bGives.date}${prefText(bGives)}`);
  return bits.join(' ');
}

// ======= EMAILS =======

/** "Match found" heads-up to both pilots (informational, reversible). */
function notifyNewMatch(m) {
  const subject = 'Roster Swap: possible match found';
  const body =
    `Hi,\n\nA possible roster swap match was found:\n\n${m.note}\n\n` +
    `Open the Duty Calendar app ▸ Swap to review and Accept or Decline.\n\n` +
    `— Roster Swap board (automated)`;
  MailApp.sendEmail({ to: [m.aEmail, m.bEmail].filter(Boolean).join(','), subject, body });
}

/**
 * The official mutual swap request to crew scheduling. Fires ONCE, only after
 * both pilots accepted. CCs both pilots with full details.
 */
function sendSwapEmail(m) {
  const aGives = safeParse(m.aGivesJSON);
  const bGives = safeParse(m.bGivesJSON);
  const subject = `Mutual Roster Swap Request — ${m.aName} (${m.aId}) ⇄ ${m.bName} (${m.bId})`;
  const lines = [
    'To Crew Scheduling,',
    '',
    'The two crew members below have mutually agreed to the following roster swap and request approval:',
    '',
    `Pilot A: ${m.aName}  |  Employee ID: ${m.aId}  |  ${m.aEmail}  |  ${m.aPhone || 'n/a'}`,
    `Pilot B: ${m.bName}  |  Employee ID: ${m.bId}  |  ${m.bEmail}  |  ${m.bPhone || 'n/a'}`,
    '',
    'Requested change:',
    aGives ? `  • ${m.aName} (${m.aId}) to DROP: ${aGives.route} on ${aGives.date} ${aGives.time || ''}  [${aGives.flights || ''}]` : null,
    aGives ? `      → to be picked up by ${m.bName} (${m.bId}).` : null,
    bGives ? `  • ${m.bName} (${m.bId}) to DROP: ${bGives.route} on ${bGives.date} ${bGives.time || ''}  [${bGives.flights || ''}]` : null,
    bGives ? `      → to be picked up by ${m.aName} (${m.aId}).` : null,
    '',
    'Both pilots have confirmed acceptance in the crew swap app.',
    '',
    'Kind regards,',
    'Roster Swap board (automated on behalf of the crew members above)',
  ].filter(l => l !== null);

  MailApp.sendEmail({
    to: CREW_EMAIL,
    cc: [m.aEmail, m.bEmail].filter(Boolean).join(','),
    subject,
    body: lines.join('\n'),
  });
}

// ======= SHEET / MODEL HELPERS =======

function matchHeader() {
  return [
    'matchId', 'pairKey', 'aId', 'aName', 'aEmail', 'aPhone',
    'bId', 'bName', 'bEmail', 'bPhone', 'aGivesJSON', 'bGivesJSON',
    'aDecision', 'bDecision', 'status', 'emailedAt', 'note', 'created',
  ];
}
function matchToRow(m) {
  return [
    m.matchId, m.pairKey, m.aId, m.aName, m.aEmail, m.aPhone,
    m.bId, m.bName, m.bEmail, m.bPhone, m.aGivesJSON, m.bGivesJSON,
    m.aDecision, m.bDecision, m.status, m.emailedAt, m.note, m.created,
  ];
}
function rowToMatch(r) {
  const h = matchHeader(); const o = {};
  h.forEach((k, i) => o[k] = r[i]);
  o.aId = String(o.aId); o.bId = String(o.bId);
  return o;
}

/** Shape a match row for the requesting pilot's UI (mine = what I give). */
function shapeMatchForPilot(m, me) {
  const iAmA = m.aId === me;
  const iGive = safeParse(iAmA ? m.aGivesJSON : m.bGivesJSON);
  const iGet  = safeParse(iAmA ? m.bGivesJSON : m.aGivesJSON);
  const myDecision    = iAmA ? m.aDecision : m.bDecision;
  const theirDecision = iAmA ? m.bDecision : m.aDecision;
  let status = 'open';
  if (m.status === 'confirmed') status = 'confirmed';
  else if (m.status === 'declined') status = 'declined';
  else if (myDecision === 'accept') status = 'accepted_by_me';
  else if (theirDecision === 'accept') status = 'accepted_by_them';
  return {
    matchId: m.matchId,
    status,
    mine:   iGive ? { route: iGive.route, date: iGive.date, time: iGive.time } : null,
    theirs: iGet  ? { route: iGet.route,  date: iGet.date,  time: iGet.time, pilot: iAmA ? m.bName : m.aName } : { pilot: iAmA ? m.bName : m.aName },
    note: m.note,
  };
}

function readListings() {
  const sh = sheet(SHEET_LISTINGS, [
    'listingId', 'timestamp', 'employeeId', 'name', 'phone', 'email', 'wantsJSON', 'freeDaysJSON', 'active',
  ]);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.push({
      listingId: r[0], employeeId: String(r[2]), name: r[3], phone: r[4], email: r[5],
      wants: safeParse(r[6]) || [], freeDays: safeParse(r[7]) || [], active: r[8] === true || r[8] === 'TRUE',
    });
  }
  return out;
}

/** Get (or create + header) a named sheet in the bound spreadsheet. */
function sheet(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  else if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

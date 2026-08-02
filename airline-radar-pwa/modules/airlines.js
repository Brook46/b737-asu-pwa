// airlines.js — the "airline only" rule, and the table that backs it.
//
// Raw ADS-B is everything in the sky: gliders, flight-school Cessnas, police
// helicopters, bizjets, military transports and airliners, all mixed together.
// This app shows *airline* traffic only, so every aircraft has to earn its way
// onto the map through classify() below.
//
// The airline table is deliberately local: the filter must decide instantly for
// ~500 aircraft a refresh, without a network round-trip per plane. It doesn't
// need to be exhaustive — routes.js looks the operator up on adsbdb.com when a
// callsign isn't in here, and an unknown code with an airliner-sized aircraft
// still passes on the shape rules. Names are for display only.
//
// Entry format (compact on purpose — this file is precached):
//   ICAO: ['Airline name', 'IATA', 'country ISO']

export const AIRLINES = {
  // ── Israel & the Middle East
  ELY: ['El Al', 'LY', 'IL'],
  ISR: ['Israir', '6H', 'IL'],
  AIZ: ['Arkia', 'IZ', 'IL'],
  RJA: ['Royal Jordanian', 'RJ', 'JO'],
  MSR: ['EgyptAir', 'MS', 'EG'],
  UAE: ['Emirates', 'EK', 'AE'],
  ETD: ['Etihad Airways', 'EY', 'AE'],
  ABY: ['Air Arabia', 'G9', 'AE'],
  FDB: ['flydubai', 'FZ', 'AE'],
  QTR: ['Qatar Airways', 'QR', 'QA'],
  SVA: ['Saudia', 'SV', 'SA'],
  KNE: ['flynas', 'XY', 'SA'],
  KAC: ['Kuwait Airways', 'KU', 'KW'],
  JZR: ['Jazeera Airways', 'J9', 'KW'],
  GFA: ['Gulf Air', 'GF', 'BH'],
  OMA: ['Oman Air', 'WY', 'OM'],
  IAW: ['Iraqi Airways', 'IA', 'IQ'],
  MEA: ['Middle East Airlines', 'ME', 'LB'],
  SYR: ['Syrian Air', 'RB', 'SY'],
  IRA: ['Iran Air', 'IR', 'IR'],

  // ── Türkiye, Caucasus & Central Asia
  THY: ['Turkish Airlines', 'TK', 'TR'],
  PGT: ['Pegasus Airlines', 'PC', 'TR'],
  SXS: ['SunExpress', 'XQ', 'TR'],
  AHY: ['Azerbaijan Airlines', 'J2', 'AZ'],
  KZR: ['Air Astana', 'KC', 'KZ'],
  UZB: ['Uzbekistan Airways', 'HY', 'UZ'],
  TGZ: ['Georgian Airways', 'A9', 'GE'],

  // ── United Kingdom & Ireland
  BAW: ['British Airways', 'BA', 'GB'],
  SHT: ['British Airways Shuttle', 'BA', 'GB'],
  VIR: ['Virgin Atlantic', 'VS', 'GB'],
  EZY: ['easyJet', 'U2', 'GB'],
  EJU: ['easyJet Europe', 'U2', 'AT'],
  EZS: ['easyJet Switzerland', 'U2', 'CH'],
  RYR: ['Ryanair', 'FR', 'IE'],
  RUK: ['Ryanair UK', 'RK', 'GB'],
  EIN: ['Aer Lingus', 'EI', 'IE'],
  TOM: ['TUI Airways', 'BY', 'GB'],
  EXS: ['Jet2', 'LS', 'GB'],
  LOG: ['Loganair', 'LM', 'GB'],
  BEE: ['Blue Islands', 'SI', 'GB'],
  WUK: ['Wizz Air UK', 'W9', 'GB'],

  // ── Western & Central Europe
  DLH: ['Lufthansa', 'LH', 'DE'],
  CLH: ['Lufthansa CityLine', 'CL', 'DE'],
  GEC: ['Lufthansa Cargo', 'LH', 'DE'],
  EWG: ['Eurowings', 'EW', 'DE'],
  CFG: ['Condor', 'DE', 'DE'],
  DIS: ['Discover Airlines', '4Y', 'DE'],
  AFR: ['Air France', 'AF', 'FR'],
  TVF: ['Transavia France', 'TO', 'FR'],
  KLM: ['KLM', 'KL', 'NL'],
  TRA: ['Transavia', 'HV', 'NL'],
  TFL: ['TUI fly Netherlands', 'OR', 'NL'],
  BEL: ['Brussels Airlines', 'SN', 'BE'],
  JAF: ['TUI fly Belgium', 'TB', 'BE'],
  LGL: ['Luxair', 'LG', 'LU'],
  SWR: ['SWISS', 'LX', 'CH'],
  EDW: ['Edelweiss Air', 'WK', 'CH'],
  AUA: ['Austrian Airlines', 'OS', 'AT'],
  IBE: ['Iberia', 'IB', 'ES'],
  IBS: ['Iberia Express', 'I2', 'ES'],
  ANE: ['Air Nostrum', 'YW', 'ES'],
  VLG: ['Vueling', 'VY', 'ES'],
  AEA: ['Air Europa', 'UX', 'ES'],
  TAP: ['TAP Air Portugal', 'TP', 'PT'],
  ITY: ['ITA Airways', 'AZ', 'IT'],
  NOS: ['Neos', 'NO', 'IT'],
  ISS: ['Aeroitalia', 'XZ', 'IT'],

  // ── Nordics, Baltics & Eastern Europe
  SAS: ['SAS', 'SK', 'SE'],
  NAX: ['Norwegian', 'DY', 'NO'],
  NSZ: ['Norwegian Air Sweden', 'D8', 'SE'],
  FIN: ['Finnair', 'AY', 'FI'],
  ICE: ['Icelandair', 'FI', 'IS'],
  BTI: ['airBaltic', 'BT', 'LV'],
  WZZ: ['Wizz Air', 'W6', 'HU'],
  WMT: ['Wizz Air Malta', 'W4', 'MT'],
  LOT: ['LOT Polish Airlines', 'LO', 'PL'],
  ENT: ['Enter Air', 'E4', 'PL'],
  CSA: ['Czech Airlines', 'OK', 'CZ'],
  TVS: ['Smartwings', 'QS', 'CZ'],
  ROT: ['TAROM', 'RO', 'RO'],
  BLA: ['Blue Air', '0B', 'RO'],
  AEE: ['Aegean Airlines', 'A3', 'GR'],
  OAL: ['Olympic Air', 'OA', 'GR'],
  SKU: ['SKY express', 'GQ', 'GR'],
  AMC: ['Air Malta / KM Malta', 'KM', 'MT'],
  CTN: ['Croatia Airlines', 'OU', 'HR'],
  ADR: ['Air Serbia', 'JU', 'RS'],
  BUC: ['Bulgaria Air', 'FB', 'BG'],
  AFL: ['Aeroflot', 'SU', 'RU'],
  SBI: ['S7 Airlines', 'S7', 'RU'],
  SVR: ['Ural Airlines', 'U6', 'RU'],
  PBD: ['Pobeda', 'DP', 'RU'],
  AUI: ['Ukraine Intl Airlines', 'PS', 'UA'],

  // ── North America
  AAL: ['American Airlines', 'AA', 'US'],
  UAL: ['United Airlines', 'UA', 'US'],
  DAL: ['Delta Air Lines', 'DL', 'US'],
  SWA: ['Southwest Airlines', 'WN', 'US'],
  ASA: ['Alaska Airlines', 'AS', 'US'],
  JBU: ['JetBlue', 'B6', 'US'],
  NKS: ['Spirit Airlines', 'NK', 'US'],
  FFT: ['Frontier Airlines', 'F9', 'US'],
  HAL: ['Hawaiian Airlines', 'HA', 'US'],
  SCX: ['Sun Country', 'SY', 'US'],
  AAY: ['Allegiant Air', 'G4', 'US'],
  SKW: ['SkyWest', 'OO', 'US'],
  ENY: ['Envoy Air', 'MQ', 'US'],
  RPA: ['Republic Airways', 'YX', 'US'],
  EDV: ['Endeavor Air', '9E', 'US'],
  JIA: ['PSA Airlines', 'OH', 'US'],
  ASH: ['Mesa Airlines', 'YV', 'US'],
  QXE: ['Horizon Air', 'QX', 'US'],
  GJS: ['GoJet Airlines', 'G7', 'US'],
  ACA: ['Air Canada', 'AC', 'CA'],
  ROU: ['Air Canada Rouge', 'RV', 'CA'],
  JZA: ['Air Canada Express', 'QK', 'CA'],
  WJA: ['WestJet', 'WS', 'CA'],
  TSC: ['Air Transat', 'TS', 'CA'],
  POE: ['Porter Airlines', 'PD', 'CA'],
  AMX: ['Aeroméxico', 'AM', 'MX'],
  VOI: ['Volaris', 'Y4', 'MX'],
  VIV: ['Viva Aerobus', 'VB', 'MX'],

  // ── Latin America
  AVA: ['Avianca', 'AV', 'CO'],
  LAN: ['LATAM Airlines', 'LA', 'CL'],
  TAM: ['LATAM Brasil', 'JJ', 'BR'],
  GLO: ['GOL', 'G3', 'BR'],
  AZU: ['Azul', 'AD', 'BR'],
  ARG: ['Aerolíneas Argentinas', 'AR', 'AR'],
  CMP: ['Copa Airlines', 'CM', 'PA'],

  // ── Africa
  ETH: ['Ethiopian Airlines', 'ET', 'ET'],
  SAA: ['South African Airways', 'SA', 'ZA'],
  KQA: ['Kenya Airways', 'KQ', 'KE'],
  RAM: ['Royal Air Maroc', 'AT', 'MA'],
  DAH: ['Air Algérie', 'AH', 'DZ'],
  TAR: ['Tunisair', 'TU', 'TN'],
  LAM: ['LAM Mozambique', 'TM', 'MZ'],
  RWD: ['RwandAir', 'WB', 'RW'],

  // ── South & Southeast Asia
  AIC: ['Air India', 'AI', 'IN'],
  IGO: ['IndiGo', '6E', 'IN'],
  AXB: ['Air India Express', 'IX', 'IN'],
  SEJ: ['SpiceJet', 'SG', 'IN'],
  AKJ: ['Akasa Air', 'QP', 'IN'],
  PIA: ['Pakistan Intl Airlines', 'PK', 'PK'],
  ALK: ['SriLankan Airlines', 'UL', 'LK'],
  BBC: ['Biman Bangladesh', 'BG', 'BD'],
  SIA: ['Singapore Airlines', 'SQ', 'SG'],
  TGW: ['Scoot', 'TR', 'SG'],
  MAS: ['Malaysia Airlines', 'MH', 'MY'],
  AXM: ['AirAsia', 'AK', 'MY'],
  XAX: ['AirAsia X', 'D7', 'MY'],
  THA: ['Thai Airways', 'TG', 'TH'],
  BKP: ['Bangkok Airways', 'PG', 'TH'],
  TVJ: ['Thai VietJet', 'VZ', 'TH'],
  HVN: ['Vietnam Airlines', 'VN', 'VN'],
  VJC: ['VietJet Air', 'VJ', 'VN'],
  GIA: ['Garuda Indonesia', 'GA', 'ID'],
  LNI: ['Lion Air', 'JT', 'ID'],
  CTV: ['Citilink', 'QG', 'ID'],
  PAL: ['Philippine Airlines', 'PR', 'PH'],
  CEB: ['Cebu Pacific', '5J', 'PH'],

  // ── East Asia
  CCA: ['Air China', 'CA', 'CN'],
  CES: ['China Eastern', 'MU', 'CN'],
  CSN: ['China Southern', 'CZ', 'CN'],
  CHH: ['Hainan Airlines', 'HU', 'CN'],
  CSH: ['Shanghai Airlines', 'FM', 'CN'],
  CXA: ['Xiamen Air', 'MF', 'CN'],
  CQH: ['Spring Airlines', '9C', 'CN'],
  CPA: ['Cathay Pacific', 'CX', 'HK'],
  HKE: ['HK Express', 'UO', 'HK'],
  CRK: ['Hong Kong Airlines', 'HX', 'HK'],
  CAL: ['China Airlines', 'CI', 'TW'],
  EVA: ['EVA Air', 'BR', 'TW'],
  JAL: ['Japan Airlines', 'JL', 'JP'],
  ANA: ['All Nippon Airways', 'NH', 'JP'],
  APJ: ['Peach Aviation', 'MM', 'JP'],
  SKY: ['Skymark Airlines', 'BC', 'JP'],
  KAL: ['Korean Air', 'KE', 'KR'],
  AAR: ['Asiana Airlines', 'OZ', 'KR'],
  JJA: ['Jeju Air', '7C', 'KR'],
  TWB: ["T'way Air", 'TW', 'KR'],

  // ── Oceania
  QFA: ['Qantas', 'QF', 'AU'],
  JST: ['Jetstar', 'JQ', 'AU'],
  VOZ: ['Virgin Australia', 'VA', 'AU'],
  ANZ: ['Air New Zealand', 'NZ', 'NZ'],

  // ── Scheduled cargo (airline traffic too — they fly the same airways)
  FDX: ['FedEx Express', 'FX', 'US'],
  UPS: ['UPS Airlines', '5X', 'US'],
  GTI: ['Atlas Air', '5Y', 'US'],
  PAC: ['Polar Air Cargo', 'PO', 'US'],
  CKS: ['Kalitta Air', 'K4', 'US'],
  ABX: ['ABX Air', 'GB', 'US'],
  CLX: ['Cargolux', 'CV', 'LU'],
  TAY: ['ASL Airlines Belgium', '3V', 'BE'],
  BOX: ['AeroLogic', '3S', 'DE'],
  CAO: ['Air China Cargo', 'CA', 'CN'],
  SQC: ['Singapore Airlines Cargo', 'SQ', 'SG'],
  MPH: ['Martinair', 'MP', 'NL'],
  QDA: ['China Postal Airlines', 'CF', 'CN'],
  TUS: ['ASL Airlines Ireland', 'AG', 'IE'],
};

// Operators whose callsigns look exactly like an airline's (three letters plus
// digits) but are not scheduled airline traffic: business-jet fleets, military
// transport and air-ambulance. Without this list a NetJets Global or a USAF
// C-17 would sail through the "large aircraft" branch of classify().
const BIZJET_OPS = new Set([
  'NJE', 'EJA', 'EJM', 'LXJ', 'JTL', 'VTE', 'GAJ', 'TWY', 'VJT', 'XOJ', 'DPJ',
  'FJO', 'IJM', 'LNX', 'OPT', 'PVT', 'RVR', 'TFF', 'JMN', 'CNS', 'PJS',
]);
const MILITARY_OPS = new Set([
  'RCH', 'RRR', 'CNV', 'IAM', 'ASY', 'FAF', 'GAF', 'NOW', 'BAF', 'HAF', 'IAF',
  'CFC', 'AME', 'BOXER', 'DUKE', 'JAKE', 'SPAR', 'SAM', 'NATO', 'AWACS',
  'HOIST', 'REACH', 'BLUE', 'TARTN', 'ASCOT', 'RFR', 'CTM', 'IAM1', 'PLF',
]);
const MEDICAL_OPS = new Set(['FCL', 'CAL9', 'LIF', 'MED', 'AMB', 'HEMS', 'RESQ']);
const NOT_AIRLINE = new Set([...BIZJET_OPS, ...MILITARY_OPS, ...MEDICAL_OPS]);

// Rotorcraft and military types, by ICAO type code. Neither list needs to be
// exhaustive: ADS-B category A7 catches most helicopters on its own, and an
// unrecognised military transport still lands in "other" rather than pretending
// to be an airliner.
const HELI_TYPES = new Set([
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H125', 'H130',
  'H135', 'H145', 'H155', 'H160', 'H175', 'H500', 'H60', 'A109', 'A119',
  'A139', 'A169', 'A189', 'AS32', 'AS35', 'AS50', 'AS55', 'AS65', 'B06',
  'B06T', 'B212', 'B214', 'B222', 'B407', 'B412', 'B429', 'B430', 'B505',
  'B525', 'BK17', 'EH10', 'GAZL', 'LYNX', 'MI8', 'MI17', 'MI24', 'PUMA',
  'R22', 'R44', 'R66', 'S61', 'S64', 'S76', 'S92', 'UH1', 'CH47', 'V22',
]);
const MILITARY_TYPES = new Set([
  'A400', 'C130', 'C30J', 'C17', 'C5M', 'C160', 'K35R', 'KC46', 'KC10',
  'E3TF', 'E3CF', 'E6', 'E8', 'P8', 'P3', 'RC35', 'B52', 'B1', 'B2',
  'F15', 'F16', 'F18', 'F22', 'F35', 'EUFI', 'RFAL', 'TOR', 'MG29', 'SU27',
  'SU30', 'SU34', 'A10', 'AV8B', 'C295', 'CN35', 'C27J', 'U2', 'GLF5',
  'H60', 'AH64', 'AH1', 'MQ9', 'RQ4', 'T6', 'TEX2', 'HAWK', 'M346', 'L39',
]);
const BIZJET_TYPES = new Set([
  'GLEX', 'GL5T', 'GL7T', 'GLF4', 'GLF5', 'GLF6', 'GA5C', 'GA6C', 'G280',
  'CL30', 'CL35', 'CL60', 'CRJ1', 'C25A', 'C25B', 'C25C', 'C500', 'C510',
  'C525', 'C550', 'C560', 'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750',
  'E35L', 'E50P', 'E55P', 'E545', 'E550', 'F2TH', 'F900', 'FA7X', 'FA8X',
  'LJ35', 'LJ45', 'LJ60', 'LJ75', 'H25B', 'HDJT', 'PC24', 'BE40',
]);

// Aircraft ICAO type codes that mean "airliner" even when the operator code is
// unknown to us — a new or regional carrier still gets on the map.
const AIRLINER_TYPES = new Set([
  // Airbus
  'A19N', 'A20N', 'A21N', 'A318', 'A319', 'A320', 'A321', 'A306', 'A30B',
  'A310', 'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345',
  'A346', 'A359', 'A35K', 'A388',
  // Boeing
  'B712', 'B722', 'B732', 'B733', 'B734', 'B735', 'B736', 'B737', 'B738',
  'B739', 'B37M', 'B38M', 'B39M', 'B3XM', 'B741', 'B742', 'B743', 'B744',
  'B748', 'B752', 'B753', 'B762', 'B763', 'B764', 'B772', 'B773', 'B77L',
  'B77W', 'B778', 'B779', 'B788', 'B789', 'B78X',
  // Embraer / Bombardier / regional
  'E170', 'E75L', 'E75S', 'E190', 'E195', 'E290', 'E295', 'E145', 'E135',
  'CRJ2', 'CRJ7', 'CRJ9', 'CRJX', 'BCS1', 'BCS3', 'DH8A', 'DH8C', 'DH8D',
  'AT43', 'AT45', 'AT72', 'AT75', 'AT76', 'SF34', 'SU95', 'RJ85', 'RJ1H',
  'MD82', 'MD83', 'MD88', 'MD90', 'MD11', 'B461', 'B462', 'B463',
  // Chinese / Russian types
  'C919', 'ARJ2', 'T204', 'T154', 'IL96', 'AN24', 'AN26',
]);

/** Look an operator up. Returns {code,name,iata,country} or null. */
export function lookup(code) {
  const row = AIRLINES[code];
  if (!row) return null;
  return { code, name: row[0], iata: row[1], country: row[2] };
}

/** The kinds of traffic the map can show. Airlines are the default layer. */
export const KIND = {
  AIRLINE: 'airline',
  MILITARY: 'military',
  HELI: 'heli',
  BIZJET: 'bizjet',
  LIGHT: 'light',
};

export const KIND_LABEL = {
  airline: 'Airlines',
  military: 'Military & state',
  heli: 'Helicopters',
  bizjet: 'Business jets',
  light: 'Light & private',
};

/**
 * Sort one raw ADS-B record into a kind, and pull out the bits the rest of the
 * app needs.
 *
 * The app was built airliners-only, and that is still the default layer — but
 * the other traffic is in the same feed, so it is classified here and the map
 * decides what to draw. The order matters: an aircraft is judged on what it IS
 * (rotorcraft, military type) before what its callsign looks like, because a
 * military transport flies an airline-shaped callsign in an airliner-sized
 * aeroplane and would otherwise pass as a scheduled flight.
 *
 * @returns {{kind:string, code:string, flightNo:string, airline:object|null}}
 *          never null — every record lands in some kind.
 */
export function classify(ac) {
  const callsign = String(ac.flight || '').trim().toUpperCase();
  const type = String(ac.t || '').toUpperCase();
  const cat = String(ac.category || '').toUpperCase();
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(callsign);
  const code = m ? m[1] : '';
  const flightNo = m ? m[2] : '';

  // 1. Rotorcraft — ADS-B category A7 is the authoritative signal.
  if (cat === 'A7' || HELI_TYPES.has(type)) {
    return { kind: KIND.HELI, code, flightNo, airline: null };
  }
  // 2. Military and state, by operator callsign or by airframe.
  if ((code && MILITARY_OPS.has(code)) || MILITARY_TYPES.has(type)) {
    return { kind: KIND.MILITARY, code, flightNo, airline: null };
  }
  // 3. Business jets.
  if ((code && BIZJET_OPS.has(code)) || BIZJET_TYPES.has(type)) {
    return { kind: KIND.BIZJET, code, flightNo, airline: null };
  }

  // 4. Airline traffic: an ICAO flight-number callsign that isn't just the
  //    registration, from a known airline or on an airliner-sized aeroplane.
  const reg = String(ac.r || '').trim().toUpperCase().replace(/-/g, '');
  const isRegCallsign = reg && callsign.replace(/-/g, '') === reg;
  const looksBig = AIRLINER_TYPES.has(type) || cat === 'A3' || cat === 'A4' || cat === 'A5';
  if (m && !isRegCallsign && !NOT_AIRLINE.has(code)) {
    const airline = lookup(code);
    if (airline) return { kind: KIND.AIRLINE, code, flightNo, airline };
    if (looksBig) return { kind: KIND.AIRLINE, code, flightNo, airline: null };
  }

  // 5. An airliner-sized aeroplane with no usable callsign is still an
  //    airliner — unidentified, not light aircraft. Filing an A350 under
  //    "light & private" because its transponder omitted the flight number is
  //    exactly the sort of small lie that makes the whole display untrustworthy.
  if (looksBig) return { kind: KIND.AIRLINE, code, flightNo, airline: null };

  // 6. Everything else: GA, private, gliders, unidentified small stuff.
  return { kind: KIND.LIGHT, code, flightNo, airline: null };
}

/** Was this record airline traffic? Kept for the places that only care. */
export function isAirline(cls) { return !!cls && cls.kind === KIND.AIRLINE; }

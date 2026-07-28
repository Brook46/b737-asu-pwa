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
const NOT_AIRLINE = new Set([
  // business / fractional jet operators
  'NJE', 'EJA', 'EJM', 'LXJ', 'JTL', 'VTE', 'GAJ', 'TWY', 'VJT', 'XOJ', 'DPJ',
  'FJO', 'IJM', 'LNX', 'OPT', 'PVT', 'RVR', 'TFF', 'JMN', 'CNS', 'PJS',
  // military / state transport
  'RCH', 'RRR', 'CNV', 'IAM', 'ASY', 'FAF', 'GAF', 'NOW', 'BAF', 'HAF', 'IAF',
  'CFC', 'AME', 'BOXER', 'DUKE', 'JAKE', 'SPAR', 'SAM',
  // survey / calibration / medevac
  'FCL', 'CAL9', 'LIF', 'MED', 'AMB',
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

/**
 * Decide whether one raw ADS-B record is airline traffic, and pull out the bits
 * the rest of the app needs.
 *
 * The rule, in order:
 *   1. There must be a callsign, and it must be an ICAO flight-number callsign
 *      (three letters + digits). A registration in the callsign field is a
 *      private flight; no callsign at all is usually an unidentified target.
 *   2. Known bizjet/military operator codes are out, whatever they're flying.
 *   3. A known airline code is in.
 *   4. Otherwise the aircraft itself has to look like an airliner — a known
 *      airliner type, or ADS-B category A3/A4/A5 (large, high-vortex, heavy).
 *
 * @returns {{code:string, flightNo:string, airline:object|null}|null}
 *          null when the aircraft is not airline traffic.
 */
export function classify(ac) {
  const callsign = String(ac.flight || '').trim().toUpperCase();
  if (!callsign) return null;

  // A callsign identical to the registration is a private/GA flight.
  const reg = String(ac.r || '').trim().toUpperCase().replace(/-/g, '');
  if (reg && callsign.replace(/-/g, '') === reg) return null;

  const m = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(callsign);
  if (!m) return null;
  const code = m[1];
  if (NOT_AIRLINE.has(code)) return null;

  const airline = lookup(code);
  if (airline) return { code, flightNo: m[2], airline };

  // Unknown operator: let the aircraft vouch for it.
  const type = String(ac.t || '').toUpperCase();
  const cat = String(ac.category || '').toUpperCase();
  const looksBig = AIRLINER_TYPES.has(type) || cat === 'A3' || cat === 'A4' || cat === 'A5';
  return looksBig ? { code, flightNo: m[2], airline: null } : null;
}

// airports.js — embedded compact airport DB.
//
// Keyed by IATA. Each entry: { icao, city, name, lat, lon }
// Coverage: Israeli airports + major hubs around the destinations a 4X-fleet
// pilot would commonly see. Easy to extend — just add more rows.

export const AIRPORTS = {
  // ── Israel
  TLV: { icao: 'LLBG', city: 'Tel Aviv',  name: 'Ben Gurion',           lat: 32.0114, lon: 34.8867, elev: 135 },
  ETM: { icao: 'LLER', city: 'Eilat',     name: 'Ramon',                lat: 29.7236, lon: 35.0118, elev: 288 },
  HFA: { icao: 'LLHA', city: 'Haifa',     name: 'Haifa',                lat: 32.8094, lon: 35.0431, elev: 28 },
  VDA: { icao: 'LLOV', city: 'Ovda',      name: 'Ovda',                 lat: 29.9403, lon: 34.9358, elev: 1492 },

  // ── Europe — UK & Ireland
  LHR: { icao: 'EGLL', city: 'London',    name: 'Heathrow',             lat: 51.4700, lon: -0.4543, elev: 83 },
  LGW: { icao: 'EGKK', city: 'London',    name: 'Gatwick',              lat: 51.1481, lon: -0.1903, elev: 202 },
  STN: { icao: 'EGSS', city: 'London',    name: 'Stansted',             lat: 51.8860, lon:  0.2389, elev: 348 },
  LTN: { icao: 'EGGW', city: 'London',    name: 'Luton',                lat: 51.8747, lon: -0.3683, elev: 526 },
  MAN: { icao: 'EGCC', city: 'Manchester',name: 'Manchester',           lat: 53.3537, lon: -2.2750, elev: 257 },
  DUB: { icao: 'EIDW', city: 'Dublin',    name: 'Dublin',               lat: 53.4213, lon: -6.2701, elev: 242 },

  // ── Europe — Continental
  CDG: { icao: 'LFPG', city: 'Paris',     name: 'Charles de Gaulle',    lat: 49.0097, lon:  2.5479, elev: 392 },
  ORY: { icao: 'LFPO', city: 'Paris',     name: 'Orly',                 lat: 48.7233, lon:  2.3795, elev: 291 },
  FRA: { icao: 'EDDF', city: 'Frankfurt', name: 'Frankfurt',            lat: 50.0379, lon:  8.5622, elev: 364 },
  MUC: { icao: 'EDDM', city: 'Munich',    name: 'Munich',               lat: 48.3538, lon: 11.7861, elev: 1487 },
  BER: { icao: 'EDDB', city: 'Berlin',    name: 'Berlin Brandenburg',   lat: 52.3667, lon: 13.5033, elev: 157 },
  AMS: { icao: 'EHAM', city: 'Amsterdam', name: 'Schiphol',             lat: 52.3105, lon:  4.7683, elev: -11 },
  BRU: { icao: 'EBBR', city: 'Brussels',  name: 'Brussels',             lat: 50.9014, lon:  4.4844, elev: 184 },
  ZRH: { icao: 'LSZH', city: 'Zurich',    name: 'Zurich',               lat: 47.4647, lon:  8.5492, elev: 1416 },
  GVA: { icao: 'LSGG', city: 'Geneva',    name: 'Geneva',               lat: 46.2381, lon:  6.1090, elev: 1411 },
  VIE: { icao: 'LOWW', city: 'Vienna',    name: 'Vienna',               lat: 48.1103, lon: 16.5697, elev: 600 },
  MAD: { icao: 'LEMD', city: 'Madrid',    name: 'Barajas',              lat: 40.4983, lon: -3.5676, elev: 1998 },
  BCN: { icao: 'LEBL', city: 'Barcelona', name: 'El Prat',              lat: 41.2974, lon:  2.0784, elev: 12 },
  LIS: { icao: 'LPPT', city: 'Lisbon',    name: 'Humberto Delgado',     lat: 38.7813, lon: -9.1359, elev: 374 },
  FCO: { icao: 'LIRF', city: 'Rome',      name: 'Fiumicino',            lat: 41.8003, lon: 12.2389, elev: 15 },
  MXP: { icao: 'LIMC', city: 'Milan',     name: 'Malpensa',             lat: 45.6306, lon:  8.7281, elev: 768 },
  LIN: { icao: 'LIML', city: 'Milan',     name: 'Linate',               lat: 45.4451, lon:  9.2767, elev: 353 },
  ATH: { icao: 'LGAV', city: 'Athens',    name: 'Eleftherios Venizelos',lat: 37.9364, lon: 23.9445, elev: 308 },
  IST: { icao: 'LTFM', city: 'Istanbul',  name: 'Istanbul',             lat: 41.2753, lon: 28.7519, elev: 325 },
  SAW: { icao: 'LTFJ', city: 'Istanbul',  name: 'Sabiha Gökçen',        lat: 40.8986, lon: 29.3092, elev: 312 },
  ARN: { icao: 'ESSA', city: 'Stockholm', name: 'Arlanda',              lat: 59.6519, lon: 17.9186, elev: 137 },
  CPH: { icao: 'EKCH', city: 'Copenhagen',name: 'Kastrup',              lat: 55.6181, lon: 12.6561, elev: 17 },
  OSL: { icao: 'ENGM', city: 'Oslo',      name: 'Gardermoen',           lat: 60.1939, lon: 11.1004, elev: 681 },
  HEL: { icao: 'EFHK', city: 'Helsinki',  name: 'Vantaa',               lat: 60.3172, lon: 24.9633, elev: 179 },
  WAW: { icao: 'EPWA', city: 'Warsaw',    name: 'Chopin',               lat: 52.1657, lon: 20.9671, elev: 362 },
  KRK: { icao: 'EPKK', city: 'Kraków',    name: 'John Paul II',         lat: 50.0777, lon: 19.7848, elev: 791 },
  PRG: { icao: 'LKPR', city: 'Prague',    name: 'Václav Havel',         lat: 50.1008, lon: 14.2632, elev: 1247 },
  BUD: { icao: 'LHBP', city: 'Budapest',  name: 'Ferenc Liszt',         lat: 47.4297, lon: 19.2611, elev: 495 },
  OTP: { icao: 'LROP', city: 'Bucharest', name: 'Henri Coandă',         lat: 44.5722, lon: 26.1023, elev: 314 },
  SOF: { icao: 'LBSF', city: 'Sofia',     name: 'Sofia',                lat: 42.6952, lon: 23.4114, elev: 1742 },
  LCA: { icao: 'LCLK', city: 'Larnaca',   name: 'Larnaca',              lat: 34.8751, lon: 33.6249, elev: 8 },
  RIX: { icao: 'EVRA', city: 'Riga',      name: 'Riga',                 lat: 56.9236, lon: 23.9711, elev: 36 },
  TLL: { icao: 'EETN', city: 'Tallinn',   name: 'Lennart Meri',         lat: 59.4133, lon: 24.8328, elev: 131 },
  VNO: { icao: 'EYVI', city: 'Vilnius',   name: 'Vilnius',              lat: 54.6341, lon: 25.2858, elev: 648 },
  BEG: { icao: 'LYBE', city: 'Belgrade',  name: 'Nikola Tesla',         lat: 44.8184, lon: 20.3091, elev: 335 },
  ZAG: { icao: 'LDZA', city: 'Zagreb',    name: 'Franjo Tuđman',        lat: 45.7429, lon: 16.0688, elev: 353 },

  // ── Middle East
  DXB: { icao: 'OMDB', city: 'Dubai',     name: 'Dubai',                lat: 25.2528, lon: 55.3644, elev: 62 },
  AUH: { icao: 'OMAA', city: 'Abu Dhabi', name: 'Abu Dhabi',            lat: 24.4330, lon: 54.6511, elev: 88 },
  DWC: { icao: 'OMDW', city: 'Dubai',     name: 'Al Maktoum',           lat: 24.8967, lon: 55.1614, elev: 171 },
  DOH: { icao: 'OTHH', city: 'Doha',      name: 'Hamad',                lat: 25.2731, lon: 51.6080, elev: 13 },
  RUH: { icao: 'OERK', city: 'Riyadh',    name: 'King Khalid',          lat: 24.9576, lon: 46.6988, elev: 2049 },
  JED: { icao: 'OEJN', city: 'Jeddah',    name: 'King Abdulaziz',       lat: 21.6796, lon: 39.1565, elev: 48 },
  BAH: { icao: 'OBBI', city: 'Bahrain',   name: 'Bahrain Intl',         lat: 26.2708, lon: 50.6336, elev: 6 },
  KWI: { icao: 'OKBK', city: 'Kuwait',    name: 'Kuwait Intl',          lat: 29.2266, lon: 47.9689, elev: 206 },
  AMM: { icao: 'OJAI', city: 'Amman',     name: 'Queen Alia',           lat: 31.7226, lon: 35.9933, elev: 2395 },
  BEY: { icao: 'OLBA', city: 'Beirut',    name: 'Rafic Hariri',         lat: 33.8209, lon: 35.4884, elev: 87 },
  CAI: { icao: 'HECA', city: 'Cairo',     name: 'Cairo',                lat: 30.1219, lon: 31.4056, elev: 382 },

  // ── North America
  JFK: { icao: 'KJFK', city: 'New York',     name: 'JFK',               lat: 40.6398, lon: -73.7789, elev: 13 },
  EWR: { icao: 'KEWR', city: 'Newark',       name: 'Newark Liberty',    lat: 40.6925, lon: -74.1687, elev: 18 },
  LGA: { icao: 'KLGA', city: 'New York',     name: 'LaGuardia',         lat: 40.7772, lon: -73.8726, elev: 21 },
  LAX: { icao: 'KLAX', city: 'Los Angeles',  name: 'Los Angeles Intl',  lat: 33.9416, lon: -118.4085, elev: 125 },
  SFO: { icao: 'KSFO', city: 'San Francisco',name: 'SFO',               lat: 37.6213, lon: -122.3790, elev: 13 },
  ORD: { icao: 'KORD', city: 'Chicago',      name: "O'Hare",            lat: 41.9786, lon: -87.9048, elev: 672 },
  MIA: { icao: 'KMIA', city: 'Miami',        name: 'Miami Intl',        lat: 25.7959, lon: -80.2870, elev: 8 },
  ATL: { icao: 'KATL', city: 'Atlanta',      name: 'Hartsfield-Jackson',lat: 33.6407, lon: -84.4277, elev: 1026 },
  BOS: { icao: 'KBOS', city: 'Boston',       name: 'Logan',             lat: 42.3656, lon: -71.0096, elev: 20 },
  IAD: { icao: 'KIAD', city: 'Washington',   name: 'Dulles',            lat: 38.9531, lon: -77.4565, elev: 313 },
  YYZ: { icao: 'CYYZ', city: 'Toronto',      name: 'Pearson',           lat: 43.6777, lon: -79.6248, elev: 569 },
  YUL: { icao: 'CYUL', city: 'Montreal',     name: 'Trudeau',           lat: 45.4706, lon: -73.7408, elev: 118 },

  // ── Asia
  HKG: { icao: 'VHHH', city: 'Hong Kong', name: 'Hong Kong Intl',       lat: 22.3080, lon: 113.9185, elev: 28 },
  NRT: { icao: 'RJAA', city: 'Tokyo',     name: 'Narita',               lat: 35.7647, lon: 140.3863, elev: 141 },
  HND: { icao: 'RJTT', city: 'Tokyo',     name: 'Haneda',               lat: 35.5494, lon: 139.7798, elev: 21 },
  ICN: { icao: 'RKSI', city: 'Seoul',     name: 'Incheon',              lat: 37.4602, lon: 126.4407, elev: 23 },
  PEK: { icao: 'ZBAA', city: 'Beijing',   name: 'Beijing Capital',      lat: 40.0801, lon: 116.5846, elev: 116 },
  PVG: { icao: 'ZSPD', city: 'Shanghai',  name: 'Pudong',               lat: 31.1443, lon: 121.8083, elev: 13 },
  SIN: { icao: 'WSSS', city: 'Singapore', name: 'Changi',               lat: 1.3644,  lon: 103.9915, elev: 22 },
  BKK: { icao: 'VTBS', city: 'Bangkok',   name: 'Suvarnabhumi',         lat: 13.6900, lon: 100.7501, elev: 5 },
  DEL: { icao: 'VIDP', city: 'Delhi',     name: 'Indira Gandhi',        lat: 28.5562, lon: 77.1000, elev: 777 },
  BOM: { icao: 'VABB', city: 'Mumbai',    name: 'Chhatrapati Shivaji',  lat: 19.0896, lon: 72.8656, elev: 39 },

  // ── Africa
  JNB: { icao: 'FAOR', city: 'Johannesburg', name: 'OR Tambo',          lat: -26.1392, lon: 28.2460, elev: 5558 },
  CPT: { icao: 'FACT', city: 'Cape Town',    name: 'Cape Town Intl',    lat: -33.9648, lon: 18.6017, elev: 151 },
  ADD: { icao: 'HAAB', city: 'Addis Ababa',  name: 'Bole',              lat: 8.9779,   lon: 38.7993, elev: 7656 },
  NBO: { icao: 'HKJK', city: 'Nairobi',      name: 'Jomo Kenyatta',     lat: -1.3192,  lon: 36.9278, elev: 5330 },

  // ── Russia / CIS
  SVO: { icao: 'UUEE', city: 'Moscow',    name: 'Sheremetyevo',         lat: 55.9726, lon: 37.4146, elev: 630 },
  DME: { icao: 'UUDD', city: 'Moscow',    name: 'Domodedovo',           lat: 55.4088, lon: 37.9063, elev: 588 },
  LED: { icao: 'ULLI', city: 'Saint Petersburg', name: 'Pulkovo',       lat: 59.8003, lon: 30.2625, elev: 78 },
  KBP: { icao: 'UKBB', city: 'Kyiv',      name: 'Boryspil',             lat: 50.3450, lon: 30.8947, elev: 427 },
};

// Index by ICAO → IATA
export const BY_ICAO = {};
for (const [iata, a] of Object.entries(AIRPORTS)) BY_ICAO[a.icao] = iata;

// Lookup by IATA or ICAO. Returns the airport row or null.
export function lookup(code) {
  if (!code) return null;
  const c = String(code).toUpperCase().trim();
  if (AIRPORTS[c]) return { iata: c, ...AIRPORTS[c] };
  if (BY_ICAO[c]) {
    const iata = BY_ICAO[c];
    return { iata, ...AIRPORTS[iata] };
  }
  return null;
}

// Resolve a code to a city name. If no match, return the code unchanged.
export function cityName(code) {
  const hit = lookup(code);
  return hit ? hit.city : (code || '');
}


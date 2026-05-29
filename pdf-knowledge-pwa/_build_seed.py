#!/usr/bin/env python3
"""Builds a JS seed bundle from _tanchum_structure.json.

Emits scenarios (briefings + sub-briefings, with EN translations), and one
indexed anchor per leaf topic with its phase / type / scenario tags and the
manual cross-references it found on its page.

Run once:  python3 _build_seed.py > _tanchum_seed.js
"""
import json, sys, re

with open('_tanchum_structure.json', encoding='utf-8') as f:
    OUTLINE = json.load(f)

# ---- Translations (Hebrew → English) -----------------------------------
# Curated by topic. Anything not in the map keeps its original Hebrew so the
# user can spot it and translate manually.
TR = {
    # ---- chapters ----
    'שיגור': 'Dispatch',
    'התנעה, הסעה והמראה': 'Start, Taxi & Takeoff',
    'שיוט': 'Cruise',
    'גישה ונחיתה': 'Approach & Landing',
    'חירומים': 'Emergencies',
    'חישובי ביצועים': 'Performance Calculations',
    'ידע כללי ונהלים שונים': 'General Knowledge & Procedures',
    'הגדרות': 'Definitions',
    'מערכות ומבנה מטוס 737': '737 Systems & Structure',
    'MANEUVERS NNC': 'NNC Maneuvers',
    'בולטין – BULLETIN RECORD': 'Bulletin Record',
    # ---- dispatch sections ----
    'תכנון טיסה - כללי': 'Flight Planning — General',
    'דרישות מז"א משדות בתכנון': 'WX Requirements for Planned Airports',
    'שיטות שיגור שונות': 'Dispatch Methods',
    'FTL': 'FTL',
    'MEL  / CDL / NEF': 'MEL / CDL / NEF',
    'סדר עדיפויות בעת תקלה ביציאה לטיסה': 'Priority Order on Pre-Departure Defect',
    # ---- dispatch topics ----
    'מדיניות אלעל - סדר עדיפות לתכנון טיסה': 'EL AL Policy — Flight-Planning Priority',
    'מדיניות תכנון בקרבת מז"א פעיל': 'Planning Policy Near Active WX',
    'דלק TANKERING': 'Fuel TANKERING',
    'גבהים': 'Altitudes',
    'סיווג שדות ע"פ אלעל': 'EL AL Airport Categorization',
    'קטגוריות RFFS': 'RFFS Categories',
    'RAIM': 'RAIM',
    'שינוי המחייב OFP חדש': 'Changes Requiring New OFP',
    'מז"א בשדה היעד': 'WX at Destination',
    'שדה משנה להמראה - Takeoff Alternate': 'Takeoff Alternate',
    'שדה משנה ליעד - Destination Alternate': 'Destination Alternate',
    'שדה משנה לנתיב (מפת עיגולים)': 'Enroute Alternate (Circles Map)',
    'מז"א נדרש בשדות המשנה (משנה ליעד / נתיב / המראה)': 'WX Required at Alternates',
    'מז"א נדרש בשדה EDTO בתכנון': 'EDTO Alternate WX in Planning',
    'שימוש בתחזית מז"א TAF': 'Using TAF Forecasts',
    'שיגור לשדה סגור': 'Dispatch to a Closed Airport',
    'שיגור במהירות גבוהה/נמוכה': 'High/Low-Speed Dispatch',
    'שיגור ללא שדה משנה': 'Dispatch Without Alternate',
    'שיגור RCF': 'RCF Dispatch',
    'שחרור מטוס לטיסה ע"י אצ"א': 'Aircraft Release by Flight Crew',
    'שיגור EDTO': 'EDTO Dispatch',
    'ביצוע EDTO': 'EDTO In-Flight',
    # ---- start/taxi/takeoff sections ----
    'תפעול קרקעי': 'Ground Ops',
    'דלק': 'Fuel',
    'ניירת ביציאה לטיסה': 'Pre-Flight Paperwork',
    'תפעול חורף ביציאה ובטיסה': 'Winter / Adverse-WX Operations',
    'התנעה': 'Engine Start',
    'המראה': 'Takeoff',
    # ---- start/taxi/takeoff topics ----
    'הגעה למטוס (737)': 'Reporting at Aircraft (737)',
    'מש"ב וצוות קבינה': 'ISM & Cabin Crew',
    'תקני שירות ותקלה שירותית': 'Service Standards & Service Defects',
    'תדרוך צוות קבינה': 'Cabin-Crew Briefing',
    'בורדינג': 'Boarding',
    'הגשת ארוחה על הקרקע': 'Meal Service on the Ground',
    'תדריך קברניט לנוסעים': 'Captain Briefing to Passengers',
    'הודעות לנוסעים (אם הזמן מאפשר)': 'Passenger Announcements (if time)',
    'תדריך בטיחות לנוסעים (באחריות מש"ב)': 'Safety Briefing to Passengers (ISM)',
    'דלק ליציאה לטיסה': 'Departure Fuel',
    'נוהל תדלוק': 'Refueling Procedure',
    'תדלוק עם נוסעים': 'Refueling with Passengers',
    'העברת דלק על הקרקע': 'Fuel Transfer on the Ground',
    'פיקוח אצ"א על תדלוק': 'Flight-Crew Refueling Supervision',
    'מסמכים נדרשים לטיסה': 'Required Flight Documents',
    'LOADSHEET': 'LOADSHEET',
    'LAST MINUTE CHANGE LMC -': 'Last-Minute Change (LMC)',
    'NOTOC': 'NOTOC',
    'חומרים פטורים ממגבלות חומ"ס': 'DG-Exempt Materials',
    'סוללות ליתיום': 'Lithium Batteries',
    'הטסת בעלי חיים': 'Carriage of Animals',
    'הטסת כלי נשק': 'Carriage of Weapons',
    'תפעול בתנאי התקרחות – ICING CONDITIONS': 'Operations in Icing Conditions',
    'חתחות חמור – SEVERE TURBULENCE': 'Severe Turbulence',
    'גשם כבד / ברד – Moderate / Heavy Rain Hail or Sleet': 'Heavy Rain / Hail / Sleet',
    'התקרחות חמורה – SEVERE ICING': 'Severe Icing',
    'ICE CRYSTAL ICING': 'Ice Crystal Icing',
    'תיקון טמפרטורות קרות – Cold Temperature Altitude Correction': 'Cold-Temperature Altitude Correction',
    'סופות חול /אבק': 'Sand / Dust Storms',
    'DE ICING / ANTI ICING': 'De-Icing / Anti-Icing',
    'המראה - כללי': 'Takeoff — General',
    'מינימה להמראה': 'Takeoff Minima',
    'תנאים בהם אסור להמריא': 'Conditions Prohibiting Takeoff',
    'המראה ברוח צד חזקה / משבית': 'Strong Crosswind / Gusty Takeoff',
    'המראה במשקלים קלים': 'Light-Weight Takeoff',
    'המראה ללא A/T': 'Takeoff Without Autothrottle',
    'טיסה ידנית ללא FD': 'Manual Flight Without Flight Director',
    'תנאים להפסקת המראה': 'Conditions for Rejecting Takeoff',
    'NADP - Noise Abatement': 'NADP — Noise Abatement',
    'Wake Turbulence': 'Wake Turbulence',
    'זמני טיסה': 'Flight Times',
    'הגבלת  15 הטיה': '15° Bank Limit',
    'מגבלות מהירות': 'Speed Limits',
    'שינוי גובה ושיעורי הנמכה': 'Altitude Changes & Descent Rates',
    'מהירויות בטיסה': 'In-Flight Speeds',
    # ---- cruise sections ----
    'דלק בטיסה': 'In-Flight Fuel',
    'מזג אוויר בביצוע': 'In-Flight Weather',
    'שונות': 'Miscellaneous',
    # ---- cruise topics ----
    'צריכת דלק בטיסה': 'In-Flight Fuel Consumption',
    'ניהול דלק בטיסה': 'In-Flight Fuel Management',
    'חיסכון בדלק בטיסה': 'In-Flight Fuel Saving',
    'חוקי אצבע דלק בטיסה': 'In-Flight Fuel Rules of Thumb',
    'טמפרטורת דלק נמוכה בטיסה': 'Low Fuel Temperature In Flight',
    'מז"א ביעד ובשדות משנה בביצוע': 'In-Flight WX at Dest / Alternates',
    'דיווחי חובה מז"א': 'Mandatory WX Reports',
    'עקיפת מזג אויר פעיל': 'Active-WX Avoidance',
    'נהלי RVSM': 'RVSM Procedures',
    'דרישות חמצן': 'Oxygen Requirements',
    'דיווחי חובה לשליטה - OCC': 'Mandatory Reports to OCC',
    # ---- approach/landing sections ----
    'תנאים לגישה': 'Approach Conditions',
    'סוגי גישות': 'Approach Types',
    'גישה מיוצבת והליכה סביב': 'Stabilized Approach & Go-Around',
    'סוגי נחיתות': 'Landing Types',
    'יורדינג': 'Deplaning',
    # ---- approach topics ----
    'כללי': 'General',
    'מינימה לגישה': 'Approach Minima',
    'מינימה לקברניט חסר ניסיון – INEXPERIENCED PIC': 'Inexperienced-PIC Minima',
    'המרה של Visibility ל-RVR/CMV': 'Converting Visibility to RVR / CMV',
    'גישות מאושרות לשימוש אלעל': 'Approaches Approved for EL AL',
    'גישות CAT II / III': 'CAT II / III Approaches',
    'גישת NPA': 'NPA Approach',
    'גישות RNAV/RNP': 'RNAV / RNP Approaches',
    'גישות ראיה - כללי': 'Visual Approaches — General',
    'הקפת ראייה – VISUAL TRAFFIC PATTERN': 'Visual Traffic Pattern',
    'גישת CIRCLE TO LAND / CIRCLING APPROACH': 'Circling Approach',
    'גישת PRM': 'PRM Approach',
    'SIDE STEP MANEUVER': 'Side-Step Maneuver',
    'יירוט GS מלמעלה - GS FROM ABOVE': 'GS-From-Above Intercept',
    'הולדינג - HOLDING': 'Holding',
    'תנאים לבחירת APP': 'Approach Selection Criteria',
    'גישה מיוצבת Stabilized Approach': 'Stabilized Approach',
    'APPROACH BAN': 'Approach Ban',
    'Revised Touchdown Zone': 'Revised Touchdown Zone',
    'המשך טיסה אחרי המינימה': 'Continuing Below Minima',
    'חובה ללכת סביב – Mandatory Missed Approach': 'Mandatory Missed Approach',
    'הליכה סביב': 'Go-Around',
    'נחיתה - כללי': 'Landing — General',
    'שימוש ב-AUTOBRAKE': 'AUTOBRAKE Usage',
    'נחיתה ברוח צד חזקה': 'Strong-Crosswind Landing',
    'REJECTED LANDING - ה"ס בגובה נמוך מהמינימה': 'Rejected Landing (G/A Below Minima)',
    'BOUNCED LANDING - קפיצה אחרי נגיעת כני נסע ראשיים': 'Bounced Landing',
    'BALKED LANDING - ה"ס מהמסלול אחרי נגיעה': 'Balked Landing',
    'מניעת TIPPING': 'TIPPING Prevention',
    'אירועים המחייבים פתיחת תקלה': 'Events Requiring Maintenance Write-Up',
    # ---- emergencies ----
    'מתגים הדורשים אישור "CONFIRM"': 'Switches Requiring "CONFIRM"',
    'LAND AT THE NEAREST SUITABLE AIRPORT': 'Land at the Nearest Suitable Airport',
    'תפעול לחיצים': 'Circuit-Breaker Operations',
    'מדיניות בעת כשלון מנוע': 'Engine-Failure Policy',
    'הליכה לשדה משנה - DIVERSION': 'Diversion',
    'INCAPACITATION OF CREW MEMBERS': 'Incapacitation of Crew Members',
    'אש / עשן בקבינה': 'Cabin Fire / Smoke',
    'טיפול באירוע חומ"ס בטיסה': 'In-Flight Dangerous-Goods Incident',
    'חטיפה': 'Hijacking',
    'הנמכת חירום – EMERGENCY DESCENT': 'Emergency Descent',
    'ביצוע DRIFT DOWN – כשלון מנוע בשיוט': 'Drift-Down (Engine Failure in Cruise)',
    'כשלון שני מנועים בשיוט – LOSS OF THRUST ON BOTH ENGINES': 'Dual-Engine Loss of Thrust in Cruise',
    'כישלון מנוע EFP': 'EFP — Engine Failure Procedure',
    'כישלון מנוע בפיינל (תצורת נחיתה) - ENGINE FAILURE ON FINAL': 'Engine Failure on Final (Landing Config)',
    'פגיעת ציפורים - BIRD STRIKE': 'Bird Strike',
    'נחיתה מעל משקל מירבי - OVERWEIGHT LANDING': 'Overweight Landing',
    'פיצוץ צמיג - TIRE FAILURE': 'Tire Failure',
    'נחיתה ללא ANTISKID': 'Landing Without Antiskid',
    'נחיתה ללא כל הגלגלים מטה': 'Landing With Gear-Up / Partial Gear',
    'פגיעת זנב - TAIL STRIKE': 'Tail Strike',
    'אבדן קשר – COMMUNICATIONS FAILURE': 'Communications Failure',
    'יירוט - INTERCEPTION': 'Interception',
    'נוסע חולה / נפטר': 'Sick / Deceased Passenger',
    'נוסע אלים – DISRUPTIVE/UNRULY PASSANGERS': 'Disruptive / Unruly Passengers',
    'פינוי חירום מתוכנן': 'Planned Emergency Evacuation',
    'פינוי חירום ממטוס חונה': 'Evacuation from Parked Aircraft',
    'פעולות לאחר אירוע בטיחות או תקרית': 'Actions After Safety Event / Incident',
    # ---- performance ----
    'חישוב ביצועים להמראה': 'Takeoff Performance Calculation',
    'חישוב ביצועים לנחיתה': 'Landing Performance Calculation',
    'שימוש ב-OPT': 'Using OPT',
    'גרדיאנט טיפוס בכשלון מנוע EFP': 'EFP Climb Gradient',
    'גרדיאנט הליכה סביב': 'Go-Around Gradient',
    'דרישות עבור DRIFT DOWN': 'Drift-Down Requirements',
    'ביצועים בשיוט': 'Cruise Performance',
    # ---- general knowledge ----
    'סמכות ואחריות ה- PIC': 'PIC Authority & Responsibility',
    'ה-PIC יהיה PF': 'PIC Shall Be PF',
    'מגבלות רפואיות': 'Medical Limitations',
    'נהלי קוקפיט': 'Cockpit Procedures',
    'אירוח בתא הטייס': 'Cockpit Visitors',
    'Controlled Rest at the Flight Deck': 'Controlled Rest on the Flight Deck',
    'קוקפיט שקט': 'Sterile Cockpit',
    'אייפד': 'iPad',
    'שלבים קריטיים בטיסה (AOV)': 'Critical Flight Phases (AOV)',
    # ---- definitions ----
    'סוגי גבהים': 'Types of Altitudes',
    'תאורות וסימוני מסלולים': 'Runway Lighting & Markings',
    'מטאורולוגיה - הגדרות': 'Meteorology — Definitions',
    # ---- systems ----
    'כללי והבדלים בין מטוסים': 'General & Aircraft Differences',
    'מידות / מגבלות / נתוני מטוס': 'Dimensions / Limits / Aircraft Data',
    'חוזק מסלול ACN/PCN ACR/PCR': 'Runway Strength ACN/PCN ACR/PCR',
    'EKK': 'EKK',
    'EKZ – מטוס מטען': 'EKZ — Freighter Aircraft',
    'מטוסי SHORT FIELD PERFORMANCE': 'Short-Field Performance Aircraft',
    'מערכות שיש להן RECALL': 'Systems With RECALL',
    'פרק 1 - WATER and WASTE': 'Ch.1 — Water & Waste',
    'פרק 2 - פנאומטיקה ומיזוג אוויר - AIR SYSTEMS': 'Ch.2 — Pneumatics & Air Systems',
    'פרק 3 - ANTI ICE AND RAIN': 'Ch.3 — Anti-Ice & Rain',
    'פרק 4 - AUTOMATIC FLIGHT': 'Ch.4 — Automatic Flight',
    'פרק 6 - חשמל': 'Ch.6 — Electrical',
    'פרק 7 - מנועים ו-APU': 'Ch.7 — Engines & APU',
    'פרק 8 - FIRE PROTECTION': 'Ch.8 — Fire Protection',
    'פרק 9 - FLIGHT CONTROLS': 'Ch.9 — Flight Controls',
    'פרק 10 - תצוגות': 'Ch.10 — Displays',
    'פרק 11 - ניווט ו-FMC': 'Ch.11 — Navigation & FMC',
    'פרק 12 - מערכת הדלק': 'Ch.12 — Fuel System',
    'פרק 13 - הידראוליקה': 'Ch.13 — Hydraulics',
    'פרק 14 - LANDING GEAR': 'Ch.14 — Landing Gear',
    'פרק 15 – WARNING SYSTEMS': 'Ch.15 — Warning Systems',
    # ---- NNC maneuvers ----
    'STALL': 'STALL',
    'RTO': 'RTO — Rejected Takeoff',
    'GPWS WARNING': 'GPWS Warning',
    'TRAFFIC RA': 'TCAS Traffic RA',
    'UPSET': 'UPSET Recovery',
    'WINDSHEAR': 'Windshear',
    # ---- bulletins ----
    'התראות שווא WS': 'False WS Warnings',
    'התראת שווא של Stick Shaker': 'False Stick-Shaker Warnings',
    'רעידות הנובעות מ-Elevator Tab': 'Vibrations from Elevator Tab',
    'מגבלות גובה ומהירות לא נכונות ב-FMC אחרי שינוי מסלול': 'Wrong FMC Alt/Speed After Route Change',
    'גובה לא נכון ב-FMC אחרי שינוי גישה עם נקודה משותפת': 'Wrong FMC Altitude After Approach Change',
    'אין יכולת VNAV או חישובי FMC לאחר הכנסת רוח בהנמכה, ללא גישה': 'No VNAV / FMC Calc After Descent Wind Entry',
    'חריגה מהנתיב בביצוע פניית נוהל': 'Path Deviation During Procedure Turn',
    'אוברשוט ביירוט ה-LOC': 'LOC Intercept Overshoot',
    'קפיצה ב-ROLL בגישות RNP': 'Roll Jump on RNP Approaches',
    'פאנל דיחוס מהבהב / כבה': 'Pressurization Panel Flashing / Off',
    'סחיפת מיקום ADIRU ושגיאות ב-Ground Speed': 'ADIRU Position Drift & GS Errors',
    'אנומליה ב-Master Caution': 'Master Caution Anomaly',
    'הפרעות בשידור ממיקרופון ידני עם מכשיר מחובר לשקע חשמל': 'Hand-Mic Transmit Interference From Plugged Device',
    'אנומליה ב-Air Speed Low Aural Alert': 'Air-Speed Low Aural-Alert Anomaly',
    'התראת GS בגישות IAN (EKK) / תצוגות מסכים במטוס EKK': 'GS Alerts on IAN Approaches (EKK) / EKK Displays',
    'תפעול ידית מדפים': 'Flap-Lever Operation',
}

def tr(t):
    return TR.get(t.strip(), t.strip())

# Chapter → phases / briefing-type / scenario kind
# btypeNames map to default seeded briefing types: 'normal', 'nonnormal', 'briefing'
CHAPTER_DEFAULTS = {
    'שיגור':                   {'phases': ['dispatch'],            'btype': 'briefing'},
    'התנעה, הסעה והמראה':       {'phases': ['takeoff'],             'btype': 'normal'},
    'שיוט':                    {'phases': ['cruise'],              'btype': 'normal'},
    'גישה ונחיתה':              {'phases': ['approach', 'landing'], 'btype': 'normal'},
    'חירומים':                  {'phases': ['cruise','descent','approach','landing'], 'btype': 'nonnormal'},
    'חישובי ביצועים':           {'phases': ['takeoff','landing','cruise'], 'btype': 'briefing'},
    'ידע כללי ונהלים שונים':    {'phases': [],                      'btype': 'briefing'},
    'הגדרות':                   {'phases': [],                      'btype': 'briefing'},
    'מערכות ומבנה מטוס 737':    {'phases': [],                      'btype': 'briefing'},
    'MANEUVERS NNC':           {'phases': [],                      'btype': 'nonnormal'},
    'בולטין – BULLETIN RECORD': {'phases': [],                      'btype': 'briefing'},
}

# ---- Build scenario tree + anchors ----
# Strategy:
#   depth 0 → top-level briefing  (sc_t_<idx>)
#   depth 1 → sub-briefing       (sc_s_<idx>), parent = nearest preceding depth-0
#   depth 2 → indexed anchor      (idx_<idx>),  scenarios = [nearest depth-1, nearest depth-0]
# Some chapters have leaves at depth 1 (no depth-2 children). In that case
# the depth-1 entry IS the anchor, and we don't create a sub-briefing for it.

scenarios = []
anchors = []

cur_top = None   # last top-level (depth 0) scenario id + meta
cur_sub = None   # last sub-briefing  (depth 1) scenario id + page

for i, o in enumerate(OUTLINE):
    depth, title, page, refs = o['depth'], o['title'], o['page'], o['refs']
    if page is None: continue
    en = tr(title)
    if depth == 0:
        sid = f'sc_t_{i}'
        defaults = CHAPTER_DEFAULTS.get(title, {'phases': [], 'btype': 'normal'})
        cur_top = {'id': sid, 'phases': defaults['phases'], 'btype': defaults['btype'], 'page': page}
        cur_sub = None
        scenarios.append({
            'id': sid, 'name': en, 'parentId': None, 'parentIds': [],
            'phases': defaults['phases'], 'briefingTypes': [defaults['btype']],
            'color': {'briefing': '#7aa3ff', 'normal': '#3ddc97', 'nonnormal': '#ff6b6b'}[defaults['btype']],
            'kind': 'normal', 'sort': i, 'top': True,
        })
    elif depth == 1:
        # If this depth-1 has any depth-2 children that follow, treat it as a
        # sub-briefing; otherwise treat as a leaf anchor.
        has_children = (i + 1 < len(OUTLINE)) and OUTLINE[i + 1]['depth'] >= 2
        if has_children and cur_top:
            sid = f'sc_s_{i}'
            cur_sub = {'id': sid, 'page': page}
            scenarios.append({
                'id': sid, 'name': en, 'parentId': None, 'parentIds': [cur_top['id']],
                'phases': [], 'briefingTypes': [],
                'color': '#ffb84d', 'kind': 'normal', 'sort': i, 'top': False,
            })
        else:
            # Leaf at depth 1 — emit anchor, no sub-briefing.
            anchor_scenarios = [cur_top['id']] if cur_top else []
            anchors.append({
                'id': f'idx_{i}', 'pageNum': page, 'title': en,
                'scenarios': anchor_scenarios,
                'phases': cur_top['phases'] if cur_top else [],
                'btype': cur_top['btype'] if cur_top else 'normal',
                'refs': refs,
            })
            cur_sub = None
    elif depth >= 2:
        # Leaf topic.
        anchor_scenarios = []
        if cur_sub: anchor_scenarios.append(cur_sub['id'])
        if cur_top: anchor_scenarios.append(cur_top['id'])
        anchors.append({
            'id': f'idx_{i}', 'pageNum': page, 'title': en,
            'scenarios': anchor_scenarios,
            'phases': cur_top['phases'] if cur_top else [],
            'btype': cur_top['btype'] if cur_top else 'normal',
            'refs': refs,
        })

# ---- Emit JS bundle ----
js = []
js.append('// Auto-generated by _build_seed.py — do not edit by hand.')
js.append('export const TANCHUM_SEED = {')
js.append('  scenarios: ' + json.dumps(scenarios, ensure_ascii=False, indent=2) + ',')
js.append('  anchors: ' + json.dumps(anchors, ensure_ascii=False, indent=2) + ',')
js.append('};')
print('\n'.join(js))
print('// scenarios:', len(scenarios), file=sys.stderr)
print('// anchors:', len(anchors), file=sys.stderr)

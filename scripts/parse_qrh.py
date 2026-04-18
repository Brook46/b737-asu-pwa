#!/usr/bin/env python3
"""Parse Boeing 737 QRH 'Flight With Unreliable Airspeed' tables into JSON.

Source: D6-27370-858-ELA Rev.57 (4X-EK fleet). Covers 737-800W CFM56-7B26 and
737-900ERW CFM56-7B27 variants. Output: data/qrh-800.json and data/qrh-900.json.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pypdf

PDF = Path("/Users/alonbrookstein/Downloads/QRH.pdf")
OUT = Path(__file__).resolve().parent.parent / "data"

# 1-indexed page ranges (start inclusive, end exclusive)
VARIANTS = {
    "800": (481, 515),
    "900": (601, 634),
}
WEIGHTS = [40, 50, 60, 70, 80]  # tonnes


def read_pages(start: int, end: int) -> dict[int, str]:
    r = pypdf.PdfReader(str(PDF))
    return {i: (r.pages[i - 1].extract_text() or "") for i in range(start, end)}


def pad5(xs, *, right=True):
    """Pad or truncate to length 5. Missing columns are on the light-weight side."""
    if len(xs) >= 5:
        return xs[:5]
    return ([None] * (5 - len(xs)) + list(xs)) if right else (list(xs) + [None] * (5 - len(xs)))


def flatten(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ---- pitch/metric grid parser (Climb / Cruise / Descent / Go-Around bodies) --

_ALT_TOKEN = r"(?:SEA\s*LEVEL|-?\d{3,5})"


def _parse_alt_grid(flat: str, *, metric: str, with_kias: bool):
    """Iterate `<alt> PITCH ATT <nums> <METRIC> <nums> [KIAS <nums>]` on the
    flat (single-line) text, returning rows in order encountered."""
    kias_part = r"KIAS\s+([-\d\s]+?)\s*(?=" + _ALT_TOKEN + r"\s*PITCH|PRESSURE|Flaps\s+\d+|Only|January|February|March|April|May|June|July|August|September|October|November|December|$)" if with_kias else ""
    if with_kias:
        pattern = (
            rf"({_ALT_TOKEN})\s+PITCH ATT\s+([-\d.\s]+?)\s+{re.escape(metric)}[^0-9\-]*([-\d.\s]+?)\s+"
            rf"KIAS\s+([-\d\s]+?)\s*(?=" + _ALT_TOKEN + r"\s*PITCH|PRESSURE|Flaps\s+\d+|Only|January|February|March|April|May|June|July|August|September|October|November|December|$)"
        )
    else:
        pattern = (
            rf"({_ALT_TOKEN})\s+PITCH ATT\s+([-\d.\s]+?)\s+{re.escape(metric)}[^0-9\-]*([-\d.\s]+?)\s*"
            rf"(?=" + _ALT_TOKEN + r"\s*PITCH|PRESSURE|Flaps\s+\d+|Only|January|February|March|April|May|June|July|August|September|October|November|December|$)"
        )
    out = []
    for m in re.finditer(pattern, flat, re.IGNORECASE):
        alt_raw = re.sub(r"\s+", " ", m.group(1)).upper()
        alt = 0 if "SEA" in alt_raw else int(alt_raw)
        pitch = pad5([float(x) for x in m.group(2).split()])
        vals = pad5([float(x) for x in m.group(3).split()])
        row = {"alt": alt, "pitch": pitch, "metric": vals}
        if with_kias:
            row["kias"] = pad5([int(float(x)) for x in m.group(4).split()])
        out.append(row)
    return out


def rename_metric(rows, key):
    return [{**({k: v for k, v in r.items() if k != "metric"}), key: r["metric"]} for r in rows]


# ---- terminal / final approach per-airport-altitude parser -------------------

_APT_RE = re.compile(r"Airport Altitude\s*=\s*(SEA LEVEL|-?\d+\s*FT)", re.IGNORECASE)
_FLAP_CFG_RE = re.compile(
    r"FLAPS?\s+(UP|\d+)\s*(?:\(GEAR\s+(UP|DOWN)\))?\s*(?:VREF\d+\s*\+?\s*\d+|\(VREF\d+\s*\+\s*\d+\))\s*"
    r"PITCH ATT\s+([-\d.\s]+?)\s+%N1\s+([-\d.\s]+?)\s+KIAS\s+([-\d\s]+?)"
    r"(?=\s*FLAPS?\s+(?:UP|\d+)|FLAP POSITION|Airport Altitude|TERMINAL|FINAL|PRESSURE|March|September|January|$)",
    re.IGNORECASE,
)


def _apt_alt_value(raw: str) -> int:
    t = raw.strip().upper()
    if "SEA" in t:
        return 0
    return int(re.match(r"-?\d+", t).group())


_FLAP_CFG_ITER = re.compile(
    r"FLAPS?\s+(UP|\d+)\s*\(?\s*(?:GEAR\s+(UP|DOWN))?\s*\)?\s*"
    r"(?:\(?VREF(\d+)\s*\+\s*(\d+)\)?)\s*"
    r"PITCH ATT\s+([-\d.\s]+?)\s+%N1\s+([-\d.\s]+?)\s+KIAS\s+([-\d\s]+?)"
    r"(?=\s+FLAPS?\s+(?:UP|\d+)|FLAP POSITION|PRESSURE|Airport Altitude|TERMINAL|FINAL|"
    r"January|February|March|April|May|June|July|August|September|October|November|December|$)",
    re.IGNORECASE,
)


def _extract_flap_configs(body: str):
    flaps = []
    for c in _FLAP_CFG_ITER.finditer(body):
        flaps.append({
            "flap": c.group(1).upper(),
            "gear": (c.group(2) or "UP").upper(),
            "vref": f"VREF{c.group(3)}+{c.group(4)}",
            "pitch": pad5([float(x) for x in c.group(5).split()]),
            "n1": pad5([float(x) for x in c.group(6).split()]),
            "kias": pad5([int(float(x)) for x in c.group(7).split()]),
        })
    return flaps


def parse_term_approach(flat: str, section: str):
    """Return list of {apt_alt, flaps: [...]}. Pages may carry 1 or 2 airport
    altitudes. When 2 are stacked at the top, they share a page but each owns
    its own 'FLAP POSITION' sub-table. We split by FLAP POSITION markers and
    pair them 1:1 with airport-altitude markers in order."""
    apt_matches = list(_APT_RE.finditer(flat))
    if not apt_matches:
        return []
    # Split the flat text into sub-bodies at each "FLAP POSITION" marker.
    fp_markers = [m.start() for m in re.finditer(r"FLAP POSITION", flat, re.IGNORECASE)]
    if not fp_markers:
        return []
    # Each sub-body spans fp_markers[i] -> fp_markers[i+1] (or end)
    sub_bodies = []
    for i, s in enumerate(fp_markers):
        e = fp_markers[i + 1] if i + 1 < len(fp_markers) else len(flat)
        sub_bodies.append(flat[s:e])
    # Pair 1:1 with airport-altitude markers in order
    out = []
    for i, body in enumerate(sub_bodies):
        if i >= len(apt_matches):
            break
        apt_alt = _apt_alt_value(apt_matches[i].group(1))
        flaps = _extract_flap_configs(body)
        if flaps:
            out.append({"apt_alt": apt_alt, "flaps": flaps})
    return out


# ---- main --------------------------------------------------------------------


def build_variant(tag: str) -> dict:
    start, end = VARIANTS[tag]
    pages = read_pages(start, end)

    # Page start: CLIMB + CRUISE grids.
    p1 = flatten(pages[start])
    climb = _parse_alt_grid(p1, metric="V/S (FT/MIN)", with_kias=False)
    cruise = _parse_alt_grid(p1, metric="%N1", with_kias=False)
    climb = rename_metric(climb, "vs")
    climb = [{**r, "vs": [int(v) if v is not None else None for v in r["vs"]]} for r in climb]
    cruise = rename_metric(cruise, "n1")

    # Page start+1: DESCENT + HOLDING
    p2 = flatten(pages[start + 1])
    descent = _parse_alt_grid(p2, metric="V/S (FT/MIN)", with_kias=False)
    descent = rename_metric(descent, "vs")
    descent = [{**r, "vs": [int(v) if v is not None else None for v in r["vs"]]} for r in descent]
    holding = _parse_alt_grid(p2, metric="%N1", with_kias=True)
    holding = rename_metric(holding, "n1")

    terminal, approach = [], []
    go_around = {"flap_1": [], "flap_5": [], "flap_15": []}

    for pn in range(start + 2, end):
        page_text = pages[pn]
        flat = flatten(page_text)
        up = page_text.upper()

        if "GO-AROUND" in up and ("Flaps 1," in page_text or "Flaps 5," in page_text or "Flaps 15," in page_text):
            # Parse by flap-config sub-sections. Each sub-section precedes its
            # pressure-altitude table. The flap-config line appears once; the
            # corresponding grid is the NEXT pressure-altitude grid in reading
            # order.
            # Find "Flaps N, Gear Up, Set Go-Around Thrust" markers + pressure
            # altitude grids (all with same column layout PITCH/V/S/KIAS).
            flap_markers = [(m.start(), m.group(1)) for m in
                            re.finditer(r"Flaps\s+(\d+),\s+Gear Up,\s+Set Go-Around Thrust",
                                        flat, re.IGNORECASE)]
            # Grids: find all pressure-altitude grid blocks on this page
            grid_starts = [m.start() for m in re.finditer(r"PRESSURE ALTITUDE \(FT\)", flat)]
            # For pages with both Flaps 1 and Flaps 5 (two grids, two markers),
            # map marker[i] -> grid[i]. For Flaps 15 page (one marker, one grid),
            # map directly.
            for idx, (_, flap_n) in enumerate(flap_markers):
                if idx >= len(grid_starts):
                    break
                gstart = grid_starts[idx]
                gend = grid_starts[idx + 1] if idx + 1 < len(grid_starts) else len(flat)
                body = flat[gstart:gend]
                rows = _parse_alt_grid(body, metric="V/S (FT/MIN)", with_kias=True)
                rows = rename_metric(rows, "vs")
                rows = [{**r, "vs": [int(v) if v is not None else None for v in r["vs"]]} for r in rows]
                go_around[f"flap_{flap_n}"].extend(rows)

        elif "TERMINAL AREA" in up:
            terminal.extend(parse_term_approach(flat, "terminal"))
        elif "FINAL APPROACH" in up:
            rows = parse_term_approach(flat, "approach")
            # Final Approach is always Gear Down (implied by the section header).
            for r in rows:
                for f in r["flaps"]:
                    f["gear"] = "DOWN"
            approach.extend(rows)

    terminal.sort(key=lambda r: r["apt_alt"])
    approach.sort(key=lambda r: r["apt_alt"])

    return {
        "variant": "737-800W" if tag == "800" else "737-900ERW",
        "engine": "CFM56-7B26" if tag == "800" else "CFM56-7B27",
        "source": "D6-27370-858-ELA Rev.57 · PI-QRH §10 (fleet 4X-EK)",
        "weights_t": WEIGHTS,
        "notes": {
            "climb": "Flaps Up · Max Climb Thrust · 280 kt / M.76",
            "cruise": "Flaps Up · %N1 for Level Flight · M.76 / 280 kt",
            "descent": "Flaps Up · Idle Thrust · M.76 / 280 kt",
            "holding": "VREF40 + 70 kt · Flaps Up · %N1 for Level Flight",
            "terminal": "Terminal Area 5,000 ft AGL · %N1 for Level Flight",
            "approach": "Final Approach 1,500 ft AGL · Gear Down · %N1 for 3° Glideslope",
            "go_around": "Flaps 1/5/15 · Gear Up · Set Go-Around Thrust",
        },
        "climb": climb,
        "cruise": cruise,
        "descent": descent,
        "holding": holding,
        "terminal": terminal,
        "approach": approach,
        "go_around": go_around,
    }


def summarize(data: dict) -> str:
    ga = data["go_around"]
    return (
        f"climb={len(data['climb'])} cruise={len(data['cruise'])} "
        f"descent={len(data['descent'])} hold={len(data['holding'])} "
        f"terminal={len(data['terminal'])} approach={len(data['approach'])} "
        f"ga_f1={len(ga['flap_1'])} ga_f5={len(ga['flap_5'])} ga_f15={len(ga['flap_15'])}"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for tag in VARIANTS:
        data = build_variant(tag)
        path = OUT / f"qrh-{tag}.json"
        path.write_text(json.dumps(data, indent=2))
        print(f"[{tag}] {summarize(data)} -> {path}")


if __name__ == "__main__":
    sys.exit(main())

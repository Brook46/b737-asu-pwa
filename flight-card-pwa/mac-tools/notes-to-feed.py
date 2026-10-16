#!/usr/bin/env python3
"""Apple Notes (as read by read-notes.js) -> the Flight Card social feed.

Input:  JSON file of [{ "title": ..., "html": ... }, ...]
Output: {"notes": { CODE: html, ... }, "skipped": [title, ...]} on stdout.

Every rule here comes from the real "AIRPORTS B" folder:

* Titles are the airport codes, then the city:
      "LFMN     NCE        ניס קוט דה אזור"
      "EIDW.  DUB   Dublin    דבלין"          (note the full stop)
  Every leading all-caps 3-4 letter token becomes a key, so a note reaches
  the app under its ICAO AND its IATA code. The app looks legs up by IATA,
  and airports missing from its own table (Nice, Paphos, Batumi, Rhodes...)
  could otherwise never be matched from the ICAO alone.
* A prose title naming exactly one code ("תהליך De ice ב-JFK") is attached to
  that airport as an extra section under its own bold heading.
* Titles naming no code (the "פורמט שדה" template) are skipped and reported.
* Bodies are Apple's HTML. Flight Card keeps div / br / b / i / u / font /
  span; headings and list items are rewritten into those so they keep their
  emphasis and their line breaks instead of collapsing into one line.
"""
import html as htmlmod
import json
import os
import re
import sys

# ICAO -> IATA, from the OurAirports-derived database the 737 Inside app
# already ships (3,281 scheduled airports). Covers every ICAO in the folder.
NAVDB = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "..", "b737-systems-pwa", "data", "navdb.json")
try:
    with open(NAVDB, encoding="utf-8") as _f:
        ICAO_TO_IATA = {k: v[5] for k, v in json.load(_f)["airports"].items() if v[5]}
except (OSError, ValueError, KeyError):
    ICAO_TO_IATA = {}       # still works, just can't translate ICAO-only titles

CODE = re.compile(r"^[A-Z]{3,4}$")
SPLIT = re.compile(r"[\s/·,:;.\-–—|]+")


def leading_codes(title):
    """Every all-caps 3-4 letter token at the START of the title, in order."""
    out = []
    for tok in SPLIT.split(title.strip()):
        if not tok:
            continue
        if CODE.match(tok):
            out.append(tok)
        else:
            break
    return out


def keys_for(codes):
    """The codes a note is filed under: IATA, because Flight Card matches legs
    by IATA and translates to ICAO itself only for its own small table.

    Each ICAO is translated through the database, and any 3-letter code the
    title gives is kept too — so a typo in the title ("HESH SHM" for Sharm,
    whose real code is SSH) still files the note where the roster will look,
    and an IATA the database lacks still gets through. Sending each note once
    per IATA, not once per code, halves the feed: every title carries both
    codes, and the doubled payload was within 6% of the worker's 1 MB limit.
    Only a title with no IATA anywhere falls back to its ICAO."""
    out = []
    for c in codes:
        k = ICAO_TO_IATA.get(c) if len(c) == 4 else c
        if k and k not in out:
            out.append(k)
    return out or codes


def named_codes(title):
    """For prose titles: all-caps 3-4 letter codes named anywhere in them."""
    return re.findall(r"(?<![A-Za-z])[A-Z]{3,4}(?![A-Za-z])", title)


def text_of(fragment):
    return re.sub(r"\s+", " ", htmlmod.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def clean_html(body, title):
    s = body
    s = re.sub(r"<img\b[^>]*>", "", s, flags=re.I)                      # belt and braces
    s = re.sub(r"<h[1-6]\b[^>]*>(.*?)</h[1-6]>", r"<div><b>\1</b></div>", s, flags=re.I | re.S)
    s = re.sub(r"<li\b[^>]*>(.*?)</li>", r"<div>• \1</div>", s, flags=re.I | re.S)
    s = re.sub(r"</?(?:ul|ol|tt|a|object|table|tbody|thead|tr)\b[^>]*>", "", s, flags=re.I)
    s = re.sub(r"<t[dh]\b[^>]*>", "", s, flags=re.I)
    s = re.sub(r"</t[dh]>", " ", s, flags=re.I)

    # Notes repeats the title as the body's first line; the app already shows
    # the note under its airport, so drop that line.
    blocks = re.split(r"(?=<div\b)", s)
    want = re.sub(r"\s+", " ", title).strip()
    for i, b in enumerate(blocks):
        t = text_of(b)
        if not t:
            continue                                # skip leading empty lines
        if t == want:
            blocks[i] = ""
        break
    s = "".join(blocks)

    empty = r"(?:\s*<div>\s*(?:<br\s*/?>)?\s*</div>\s*)"
    s = re.sub(r"^" + empty + "+", "", s)
    s = re.sub(empty + r"+$", "", s)
    return s.strip()


def convert(data):
    if isinstance(data, dict) and data.get("error"):
        raise SystemExit("ERROR: " + data["error"])
    notes, extras, skipped = {}, {}, []
    for n in data:
        title = (n.get("title") or "").strip()
        body = clean_html(n.get("html") or "", title)
        if not body:
            continue
        codes = leading_codes(title)
        if codes:
            for k in keys_for(codes):
                notes[k] = body
            continue
        named = keys_for(sorted(set(named_codes(title))))
        if len(named) == 1:
            extras.setdefault(named[0], []).append(
                f"<div><br></div><div><b>{htmlmod.escape(title)}</b></div>{body}")
        else:
            skipped.append(title)
    for code, sections in extras.items():
        notes[code] = (notes.get(code, "") + "".join(sections)).strip()
    return {"notes": notes, "skipped": skipped}


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(convert(json.load(f)), ensure_ascii=False))

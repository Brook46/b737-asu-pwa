#!/usr/bin/env python3
"""Tiny multi-page PDF generator for testing the B737 Companion. Not part of the app."""

def esc(s):
    return s.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")

def cstream(lines):
    parts = ["BT"]
    for x,y,sz,t in lines:
        parts.append(f"/F1 {sz} Tf 1 0 0 1 {x} {y} Tm ({esc(t)}) Tj")
    parts.append("ET")
    return "\n".join(parts)

def build_pdf(pages):
    objs = []
    cat,pp,fn = 1,2,3
    pids, cids = [], []
    nid = 4
    for _ in pages:
        pids.append(nid); nid+=1; cids.append(nid); nid+=1
    objs.append((cat, f"<< /Type /Catalog /Pages {pp} 0 R >>"))
    kids = " ".join(f"{p} 0 R" for p in pids)
    objs.append((pp, f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>"))
    objs.append((fn, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"))
    for i, lines in enumerate(pages):
        pid, cid = pids[i], cids[i]
        objs.append((pid, f"<< /Type /Page /Parent {pp} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {fn} 0 R >> >> /Contents {cid} 0 R >>"))
        s = cstream(lines)
        objs.append((cid, f"<< /Length {len(s.encode('latin-1'))} >>\nstream\n{s}\nendstream"))
    objs.sort(key=lambda o: o[0])
    out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    off = {}
    for oid,body in objs:
        off[oid] = len(out)
        out += f"{oid} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xpos = len(out)
    n = len(objs)+1
    out += f"xref\n0 {n}\n".encode("latin-1") + b"0000000000 65535 f \n"
    for oid in range(1,n):
        out += f"{off[oid]:010d} 00000 n \n".encode("latin-1")
    out += (f"trailer\n<< /Size {n} /Root {cat} 0 R >>\nstartxref\n{xpos}\n%%EOF").encode("latin-1")
    return out

def page(title, body, footer):
    lines = [(72,720,16,title)]
    y = 680
    for b in body:
        lines.append((72,y,11,b)); y -= 20
    lines.append((72,60,10,footer))
    return lines

PAGES = [
    page("Preflight Procedure",
         ["The preflight procedure establishes the flight deck for departure.",
          "Verify the overhead panel switches and the FMC route initialisation.",
          "Cross-check fuel and weight values against the dispatch release."],
         "FCOM  13.10.1"),
    page("Engine Failure at V1",
         ["At V1 the takeoff is continued regardless of engine failure.",
          "The flying pilot maintains directional control with rudder and aileron.",
          "After positive rate and gear up call, identify and confirm the failed engine."],
         "QRH  Engine Failure"),
    page("Adverse Weather Operations",
         ["Adverse weather operations require additional briefing and minima.",
          "Crosswind components are checked against runway condition reports.",
          "Icing procedures include cowl anti-ice ON when in icing conditions."],
         "FCOM  SP.16.1"),
]

if __name__ == "__main__":
    open("test-fcom.pdf","wb").write(build_pdf(PAGES))
    print("wrote test-fcom.pdf")

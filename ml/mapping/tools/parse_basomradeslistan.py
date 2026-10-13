"""Extracts, from the text of Stockholms stad's "Basområdeslistan 2026", which
stadsdelsområde (SDO), SDN-del and Nyko-5 stadsdel each of the 117 SBK stadsdel
polygons belongs to, and writes the small tracked excerpt
`ml/mapping/sources/basomradeslistan_2026_stadsdelar.csv`.

Source (authoritative, Stockholms stad / Stadsledningskontoret, report by Sweco):
  Basområdeslistan, Årsrapport 2026, published 2026-06-02
  https://start.stockholm/globalassets/start/om-stockholms-stad/utredningar-statistik-och-fakta/statistik/befolkning/basomradeslistan-2026.pdf
  Retrieved 2026-10-13 (86 PDF pages, 48 MB). Tabell 1 (huvuddelar/stadsområden) is on
  PDF page 8, Tabell 2 (stadsdelsområden, SDN-delar, stadsdelar, basområden) on
  PDF pages 9-29.

The PDF is not stored in the repo (48 MB). To reproduce: extract the text per page
(e.g. pdf.js / `unpdf` `extractText(pdf, {mergePages: false})`, writing
"=====PAGE n=====" before each page) into a text file and run

    ml/.venv/bin/python ml/mapping/tools/parse_basomradeslistan.py <text file>

103 of the 117 polygons carry a name that is also a Nyko-5 stadsdel name in Tabell 2
(matched exactly, upper case). The other 14 are SBK polygons that do not exist as a
Nyko-5 stadsdel under that name (the inner-city polygons are coarser or cut
differently than Nyko-5, and Hansta is a basområde); those rows are written by hand
in MANUAL below, each citing the exact Tabell 2 line it rests on. Riddarholmen is not
listed anywhere in the Basområdeslistan; its row says so.
"""

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GEOJSON = ROOT / "ml" / "mapping" / "sources" / "stadsdelar_fullsize.geo.json"
OUT = ROOT / "ml" / "mapping" / "sources" / "basomradeslistan_2026_stadsdelar.csv"

# Tabell 1 (PDF page 8): Nyko-2 stadsområde. 10-14 = Inre staden, 21 = Söderort, 22 = Västerort.
STADSOMRADE = {
    "10": ("Gamla stan - City-området", "Inre staden"),
    "11": ("Vasastads-området", "Inre staden"),
    "12": ("Östermalms-området", "Inre staden"),
    "13": ("Kungsholms-området", "Inre staden"),
    "14": ("Södermalms-området", "Inre staden"),
    "21": ("Söderort", "Yttre staden"),
    "22": ("Västerort", "Yttre staden"),
}

# (nyko5, namn i Basområdeslistan, SDO, SDN-del, PDF-sida, anmärkning)
MANUAL = {
    "GAMLA STAN": (
        "10101", "STORKYRKAN", "12. Södermalm", "12.1 Storkyrkan-Mariatorget", 19,
        "Tabell 2: stadsdel 10101 STORKYRKAN (Gamla stan) under SDN-del 12.1; Tabell 1: stadsområde 10 'Gamla stan - City-området'.",
    ),
    "RIDDARHOLMEN": (
        "", "", "", "", 0,
        "Not listed as a stadsdel or basområde in the Basområdeslistan 2026 (searched the whole text), so the SDO column is empty. "
        "Assigned with Gamla stan per PLAN-v3 2.2; sv.wikipedia.org/wiki/Riddarholmen (retrieved 2026-10-13): Riddarholmen "
        "'ingår tillsammans med Gamla stan i Södermalms stadsdelsområde'. (Geometry cannot decide it: the polygon touches "
        "Gamla Stan, Norrmalm, Södermalm and Kungsholmen.)",
    ),
    "SKEPPSHOLMEN": (
        "10103", "JAKOB", "9. Norra innerstan", "09.1 Södra Norrmalm", 15,
        "Tabell 2: basområde 1010360 Skeppsholmen under stadsdel 10103 JAKOB; Nyko prefix 101 = stadsområde 10 'Gamla stan - City-området'.",
    ),
    "NORRMALM": (
        "10102", "KLARA / JAKOB / SÖDRA JOHANNES / SÖDRA ADOLF FREDRIK", "9. Norra innerstan", "09.1 Södra Norrmalm", 15,
        "Tabell 2: SDN-del 09.1 'Södra Norrmalm' = stadsdelarna 10102 KLARA, 10103 JAKOB, 11101 SÖDRA JOHANNES, 11201 SÖDRA ADOLF FREDRIK.",
    ),
    "VASASTADEN": (
        "11301", "NORRA JOHANNES / NORRA ADOLF FREDRIK / GUSTAV VASA / ÖSTRA MATTEUS / VÄSTRA MATTEUS", "9. Norra innerstan",
        "09.2 Vasastan-Roslagstull; 09.3 Matteus", 16,
        "Tabell 2: SDN-delarna 09.2 'Vasastan-Roslagstull' and 09.3 'Matteus'; Tabell 1: stadsområde 11 'Vasastads-området'.",
    ),
    "ÖSTERMALM": (
        "12101", "ENGELBREKTS K:A / HEDVIG ELEONORA / OSCARS KYRKA", "9. Norra innerstan", "10.1 Centrala Östermalm", 17,
        "Tabell 2: SDN-del 10.1 'Centrala Östermalm'; Tabell 1: stadsområde 12 'Östermalms-området'.",
    ),
    "DJURGÅRDEN": (
        "12302", "DJURGÅRDEN", "9. Norra innerstan", "10.2 Djurgårdslandet", 18,
        "Tabell 2: stadsdel 12302 DJURGÅRDEN (basområden Djurgårdsstaden, Södra Djurgården).",
    ),
    "NORRA DJURGÅRDEN": (
        "12302", "DJURGÅRDEN", "9. Norra innerstan", "10.2 Djurgårdslandet", 18,
        "Tabell 2, fotnot 1 till 12302 DJURGÅRDEN: 'här ingår de boende på Norra Djurgården'.",
    ),
    "LADUGÅRDSGÄRDET": (
        "12303", "GÄRDET", "9. Norra innerstan", "10.2 Djurgårdslandet", 18,
        "Tabell 2: basområde 1230390 Ladugårdsgärdet under stadsdel 12303 GÄRDET.",
    ),
    "HJORTHAGEN": (
        "12104", "HJORTHAGEN-VÄRTAHAMNEN", "9. Norra innerstan", "10.2 Djurgårdslandet", 18,
        "Tabell 2: stadsdel 12104 HJORTHAGEN-VÄRTAHAMNEN.",
    ),
    "KUNGSHOLMEN": (
        "13101", "KUNGSHOLM", "8. Kungsholmen", "08.1 Östra Kungsholmen", 14,
        "Tabell 2: stadsdel 13101 KUNGSHOLM under SDO 8 Kungsholmen.",
    ),
    "SÖDERMALM": (
        "14101", "MARIATORGET / NORRA+MELLERSTA+SÖDRA HÖGALID / VÄSTRA+ÖSTRA KATARINA / NORRA+SÖDRA SOFIA / SÖDRA STATION",
        "12. Södermalm", "12.1-13.2", 19,
        "Tabell 2: SDO 12 Södermalm, stadsdelarna 14101-14402 (Södra Hammarbyhamnen 14403 is its own polygon).",
    ),
    "LÅNGHOLMEN": (
        "14204", "REIMERSHOLME-LÅNGHOLMEN", "12. Södermalm", "12.2 Centrala Högalid", 19,
        "Tabell 2: basområde 1420410 Långholmen under stadsdel 14204 REIMERSHOLME-LÅNGHOLMEN.",
    ),
    "REIMERSHOLME": (
        "14204", "REIMERSHOLME-LÅNGHOLMEN", "12. Södermalm", "12.2 Centrala Högalid", 19,
        "Tabell 2: basområde 1420420 Reimersholme under stadsdel 14204 REIMERSHOLME-LÅNGHOLMEN.",
    ),
    "HANSTA": (
        "22601", "AKALLA", "1. Järva", "01.1 Kista", 9,
        "Tabell 2: basområde 2260160 'Norra Akalla (inkl Hansta)' under stadsdel 22601 AKALLA (Hansta is a basområde, not a Nyko-5 stadsdel).",
    ),
}


# Footnotes in Tabell 2 that qualify an exact-name match (PDF page in brackets).
NOTES = {
    "HAMMARBYHÖJDEN": (
        " BOUNDARY CASE: footnotes 3-4 (PDF p.22-23): the basområde Blåsut (1 746 inhabitants, 2025-12-31) lies geographically in "
        "Hammarbyhöjden but is counted in SDN-del 14.2 Södra Enskede-Årsta (Enskede-Årsta-Vantör); the rest (8 955) is in Skarpnäck."
    ),
    "HÄGERSTEN": (
        " Footnote 7 (PDF p.28): excl. basområde Örnsberg Syd-Väst, which is reported under SDN-del 22.1 Liljeholmen "
        "(same register area, no effect)."
    ),
}


def parse_table2(lines: list[str]) -> list[dict]:
    start = next(i for i, ln in enumerate(lines) if ln.startswith("Tabell 2 Folkmängd 2025-12-31 områdesvis"))
    end = next(i for i, ln in enumerate(lines) if i > start and ln.startswith("Tabell 3"))
    page = 9  # first Tabell 2 page; the page marker precedes the heading
    sdo = sdn = None
    rows = []
    for i in range(start, end):
        ln = lines[i]
        m = re.match(r"=====PAGE (\d+)=====", ln)
        if m:
            page = int(m.group(1))
            continue
        m = re.match(r"^(\d+)\. (.+?) [\d ]+$", ln)
        if m and not ln.startswith("SDN"):
            sdo = f"{m.group(1)}. {m.group(2)}"
            continue
        m = re.match(r"^SDN-del (\d\d\.\d) (.+?) \d", ln)
        if m:
            sdn = f"{m.group(1)} {m.group(2)}"
            continue
        m = re.match(r"^(\d{5}) ([A-ZÅÄÖ:\- ,.]+?)(\d?) \d", ln)
        if m:
            rows.append({"nyko5": m.group(1), "namn": m.group(2).strip(), "sdo": sdo, "sdn": sdn, "sida": page})
    return rows


def main(text_path: str) -> None:
    lines = Path(text_path).read_text(encoding="utf-8").split("\n")
    rows = parse_table2(lines)
    by_name: dict[str, dict] = {}
    for r in rows:
        by_name.setdefault(r["namn"], r)

    geo = json.loads(GEOJSON.read_text(encoding="utf-8"))
    names = sorted(f["properties"]["name"] for f in geo["features"])
    out = []
    for n in names:
        if n in MANUAL:
            nyko5, namn, sdo, sdn, sida, anm = MANUAL[n]
            kalla = "manual"
        elif n in by_name:
            r = by_name[n]
            nyko5, namn, sdo, sdn, sida = r["nyko5"], r["namn"], r["sdo"], r["sdn"], r["sida"]
            anm = "Exact name match with a Nyko-5 stadsdel in Tabell 2." + NOTES.get(n, "")
            kalla = "exact_name"
        else:
            raise SystemExit(f"{n}: neither in Tabell 2 nor in MANUAL")
        stadsomrade_kod = nyko5[:2] if nyko5 else ""
        if n == "RIDDARHOLMEN":
            stadsomrade_kod = ""
        out.append(
            {
                "stadsdel": n,
                "nyko5": nyko5,
                "namn_i_listan": namn,
                "stadsdelsomrade": sdo,
                "sdn_del": sdn,
                "stadsomrade_nyko2": stadsomrade_kod,
                "pdf_sida": sida or "",
                "matchning": kalla,
                "anmarkning": anm,
            }
        )
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"wrote {len(out)} rows to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])

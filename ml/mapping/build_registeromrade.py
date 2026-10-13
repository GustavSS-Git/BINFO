"""Builds the BRF register's area taxonomy (display layer, PLAN-v3 2.2):

  ml/mapping/registeromraden.csv         19 areas: slug, namn, grupp, ordning, motivering
  ml/mapping/stadsdel_registeromrade.csv 117 SBK stadsdel polygons -> one register area

This is a SEPARATE display layer. It does not touch the valuation model, its 13
areas (`stadsdel_omrade_crosswalk.csv`, `data/derived/postnummer_omrade.csv`) or
anything in src/lib/vardering.

The area <-> stadsdel allocation below is the PLAN-v3 2.2 table (owner-approved
taxonomy). Every row is backed by a source: the committed excerpt
`sources/basomradeslistan_2026_stadsdelar.csv` of Stockholms stad's
"Basområdeslistan 2026" (https://start.stockholm/globalassets/start/om-stockholms-stad/
utredningar-statistik-och-fakta/statistik/befolkning/basomradeslistan-2026.pdf,
published 2026-06-02, retrieved 2026-10-13; see tools/parse_basomradeslistan.py). The
build FAILS if

  * a polygon name in `stadsdelar_fullsize.geo.json` is missing or assigned twice,
  * a name in the allocation below is not a polygon,
  * for a polygon outside the inner city, its stadsdelsområde / SDN-del in the
    Basområdeslistan is not one the assigned register area is allowed to draw from
    (EXPECTED_SDO below), or
  * the Nyko-2 stadsområde (Inre staden / Söderort / Västerort) of a polygon
    disagrees with the group of its register area.

Grouping (`grupp`): Stockholms stad's own Nyko-2 stadsområden, Basområdeslistan
Tabell 1 (PDF p.8): stadsområde 10-14 = Inre staden, 21 = Söderort, 22 = Västerort.
We label them Innerstaden, Söderort, Västerort. There is NO official "Norr" group in
the source, so none is defined (Kista/Järva and Hässelby are Västerort, Norrmalm and
Vasastan are Innerstaden).

Output encoding: UTF-8, LF.
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
GEOJSON = HERE / "sources" / "stadsdelar_fullsize.geo.json"
EXCERPT = HERE / "sources" / "basomradeslistan_2026_stadsdelar.csv"
OUT_STADSDEL = HERE / "stadsdel_registeromrade.csv"
OUT_AREAS = HERE / "registeromraden.csv"

BASOMRADESLISTAN = (
    "Stockholms stad, Basområdeslistan 2026 (publ. 2026-06-02), "
    "https://start.stockholm/globalassets/start/om-stockholms-stad/utredningar-statistik-och-fakta/"
    "statistik/befolkning/basomradeslistan-2026.pdf, retrieved 2026-10-13"
)

GRUPP_FRAN_NYKO2 = {"10": "Innerstaden", "11": "Innerstaden", "12": "Innerstaden", "13": "Innerstaden", "14": "Innerstaden",
                    "21": "Söderort", "22": "Västerort"}

J_PLAN = "PLAN-v3 2.2 (owner-approved taxonomy)."

# slug, namn, grupp, motivering (area level)
AREAS = [
    ("gamla-stan", "Gamla stan", "Innerstaden",
     "Gamla Stan, Riddarholmen, Skeppsholmen. Basområdeslistan Tabell 1: stadsområde 10 'Gamla stan - City-området'. " + J_PLAN),
    ("norrmalm", "Norrmalm", "Innerstaden",
     "SDN-del 09.1 Södra Norrmalm (Klara, Jakob, Södra Johannes, Södra Adolf Fredrik). " + J_PLAN),
    ("vasastan", "Vasastan", "Innerstaden",
     "SBK stadsdel Vasastaden = SDN-del 09.2 Vasastan-Roslagstull + 09.3 Matteus; stadsområde 11. " + J_PLAN),
    ("ostermalm", "Östermalm", "Innerstaden", "SDN-del 10.1 Centrala Östermalm; stadsområde 12. " + J_PLAN),
    ("djurgarden-gardet", "Djurgården & Gärdet", "Innerstaden",
     "SDN-del 10.2 Djurgårdslandet (Djurgården incl. Norra Djurgården, Gärdet, Hjorthagen-Värtahamnen). " + J_PLAN),
    ("kungsholmen", "Kungsholmen", "Innerstaden",
     "SDO Kungsholmen excl. the Essinge islands (stadsområde 13). " + J_PLAN),
    ("essingeoarna", "Essingeöarna", "Innerstaden",
     "Lilla and Stora Essingen; Tabell 1 lists distrikt 133 'Essinge' separately inside stadsområde 13; part of SDO Kungsholmen. " + J_PLAN),
    ("sodermalm", "Södermalm", "Innerstaden",
     "SDO Södermalm excl. Södra Hammarbyhamnen (stadsområde 14), incl. Långholmen and Reimersholme (stadsdel 14204). " + J_PLAN),
    ("hammarby-sjostad", "Hammarby sjöstad", "Innerstaden",
     "Stadsdel 14403 Södra Hammarbyhamnen (SDN-del 13.2 Sofia, stadsområde 14). Product decision to give it its own area. " + J_PLAN),
    ("liljeholmen-hagersten", "Liljeholmen & Hägersten", "Söderort",
     "SDO Hägersten-Älvsjö, SDN-delarna 22.1 Liljeholmen, 23.1 Norra Hägersten and 23.2 Södra Hägersten. " + J_PLAN),
    ("alvsjo", "Älvsjö", "Söderort", "SDO Hägersten-Älvsjö, SDN-del 21.1 Älvsjö. " + J_PLAN),
    ("arsta-johanneshov", "Årsta & Johanneshov", "Söderort",
     "SDO Enskede-Årsta-Vantör, SDN-del 14.1 Norra Enskede-Årsta (Årsta, Johanneshov, Östberga). " + J_PLAN),
    ("enskede", "Enskede", "Söderort",
     "SDO Enskede-Årsta-Vantör, SDN-del 14.2 Södra Enskede-Årsta + 20.1 Norra Vantör + 20.2 Södra Vantör. " + J_PLAN),
    ("skarpnack", "Skarpnäck", "Söderort", "SDO Skarpnäck (SDN-del 15.1 + 15.2). " + J_PLAN),
    ("farsta", "Farsta", "Söderort", "SDO Farsta (SDN-del 18.1 + 18.2). " + J_PLAN),
    ("skarholmen", "Skärholmen", "Söderort", "SDO Skärholmen (SDN-del 24.1). " + J_PLAN),
    ("bromma", "Bromma", "Västerort", "SDO Bromma (SDN-del 06.1, 06.2, 06.3). " + J_PLAN),
    ("hasselby-vallingby", "Hässelby-Vällingby", "Västerort", "SDO Hässelby-Vällingby (SDN-del 04.1 + 04.2). " + J_PLAN),
    ("kista-jarva", "Kista & Järva", "Västerort", "SDO Järva (SDN-del 01.1 Kista, 02.1 Rinkeby, 03.1 Gamla Spånga, 03.2 Tensta). " + J_PLAN),
]

# slug -> polygon names exactly as in stadsdelar_fullsize.geo.json
ALLOCATION: dict[str, list[str]] = {
    "gamla-stan": ["GAMLA STAN", "RIDDARHOLMEN", "SKEPPSHOLMEN"],
    "norrmalm": ["NORRMALM"],
    "vasastan": ["VASASTADEN"],
    "ostermalm": ["ÖSTERMALM"],
    "djurgarden-gardet": ["DJURGÅRDEN", "NORRA DJURGÅRDEN", "LADUGÅRDSGÄRDET", "HJORTHAGEN"],
    "kungsholmen": ["KUNGSHOLMEN", "MARIEBERG", "STADSHAGEN", "FREDHÄLL", "KRISTINEBERG"],
    "essingeoarna": ["LILLA ESSINGEN", "STORA ESSINGEN"],
    "sodermalm": ["SÖDERMALM", "LÅNGHOLMEN", "REIMERSHOLME"],
    "hammarby-sjostad": ["SÖDRA HAMMARBYHAMNEN"],
    "liljeholmen-hagersten": [
        "LILJEHOLMEN", "GRÖNDAL", "ASPUDDEN", "MIDSOMMARKRANSEN", "HÄGERSTEN", "HÄGERSTENSÅSEN",
        "VÄSTERTORP", "FRUÄNGEN", "MÄLARHÖJDEN", "VÄSTBERGA",
    ],
    "alvsjo": ["ÄLVSJÖ", "HERRÄNGEN", "LÅNGBRO", "SOLBERGA", "LISEBERG", "LÅNGSJÖ", "ÖRBY SLOTT"],
    "arsta-johanneshov": ["ÅRSTA", "JOHANNESHOV", "ÖSTBERGA"],
    "enskede": [
        "ENSKEDE GÅRD", "GAMLA ENSKEDE", "ENSKEDEFÄLTET", "STUREBY", "BANDHAGEN", "HÖGDALEN", "ÖRBY", "RÅGSVED", "HAGSÄTRA",
    ],
    "skarpnack": [
        "HAMMARBYHÖJDEN", "BJÖRKHAGEN", "KÄRRTORP", "BAGARMOSSEN", "SKARPNÄCKS GÅRD", "ENSKEDEDALEN", "FLATEN", "ORHEM", "SKRUBBA",
    ],
    "farsta": [
        "FARSTA", "FARSTA STRAND", "FARSTANÄSET", "GUBBÄNGEN", "HÖKARÄNGEN", "SKÖNDAL", "SVEDMYRA", "TALLKROGEN", "FAGERSJÖ", "LARSBODA",
    ],
    "skarholmen": ["SKÄRHOLMEN", "BREDÄNG", "SÄTRA", "VÅRBERG"],
    "bromma": [
        "ABRAHAMSBERG", "ALVIK", "BECKOMBERGA", "BLACKEBERG", "BROMMA KYRKA", "BÄLLSTA", "ENEBY", "HÖGLANDET", "MARIEHÄLL",
        "NOCKEBY", "NOCKEBYHOV", "NORRA ÄNGBY", "OLOVSLUND", "RIKSBY", "SMEDSLÄTTEN", "STORA MOSSEN", "SÖDRA ÄNGBY",
        "TRANEBERG", "ULVSUNDA", "ULVSUNDA INDUSTRIOMR", "ÅKESHOV", "ÅKESLUND", "ÅLSTEN", "ÄPPELVIKEN",
    ],
    "hasselby-vallingby": [
        "GRIMSTA", "HÄSSELBY GÅRD", "HÄSSELBY STRAND", "HÄSSELBY VILLASTAD", "KÄLVESTA", "NÄLSTA", "RÅCKSTA", "VINSTA", "VÄLLINGBY",
    ],
    "kista-jarva": [
        "AKALLA", "HUSBY", "KISTA", "RINKEBY", "TENSTA", "BROMSTEN", "FLYSTA", "LUNDA", "SOLHEM", "SUNDBY", "HANSTA",
    ],
}

# Which Basområdeslistan SDO / SDN-del prefixes a register area may draw from. Inner-city
# areas (SDO 8, 9, 12 and the manual rows) are checked via the Nyko-2 group only.
# key: slug -> list of (SDO prefix, SDN-del prefix or "" for any)
EXPECTED_SDO: dict[str, list[tuple[str, str]]] = {
    "kungsholmen": [("8.", "")],
    "essingeoarna": [("8.", "")],
    "liljeholmen-hagersten": [("22.", "22.1"), ("22.", "23.1"), ("22.", "23.2")],
    "alvsjo": [("22.", "21.1")],
    "arsta-johanneshov": [("14.", "14.1")],
    "enskede": [("14.", "14.2"), ("14.", "20.1"), ("14.", "20.2")],
    "skarpnack": [("15.", "")],
    "farsta": [("18.", "")],
    "skarholmen": [("24.", "")],
    "bromma": [("6.", "")],
    "hasselby-vallingby": [("4.", "")],
    "kista-jarva": [("1.", "")],
    "hammarby-sjostad": [("12.", "13.2")],
}


def build() -> tuple[list[dict], list[dict]]:
    geo = json.loads(GEOJSON.read_text(encoding="utf-8"))
    polygons = [f["properties"]["name"] for f in geo["features"]]
    if len(polygons) != len(set(polygons)):
        raise SystemExit("duplicate polygon names in geojson")

    area_by_slug = {a[0]: a for a in AREAS}
    slug_of: dict[str, str] = {}
    for slug, names in ALLOCATION.items():
        if slug not in area_by_slug:
            raise SystemExit(f"allocation for unknown area {slug}")
        for n in names:
            if n not in polygons:
                raise SystemExit(f"{n!r} ({slug}) is not a polygon in {GEOJSON.name}")
            if n in slug_of:
                raise SystemExit(f"{n!r} assigned twice: {slug_of[n]} and {slug}")
            slug_of[n] = slug
    missing = sorted(set(polygons) - set(slug_of))
    if missing:
        raise SystemExit(f"unmapped polygons: {missing}")
    if set(ALLOCATION) != set(area_by_slug):
        raise SystemExit("every area needs an allocation")

    excerpt = {r["stadsdel"]: r for r in csv.DictReader(EXCERPT.open(encoding="utf-8"))}
    if set(excerpt) != set(polygons):
        raise SystemExit("excerpt does not cover exactly the 117 polygons")

    rows = []
    for order, (slug, namn, grupp, _m) in enumerate(AREAS, start=1):
        for n in sorted(ALLOCATION[slug]):
            ex = excerpt[n]
            nyko2 = ex["stadsomrade_nyko2"]
            if nyko2 and GRUPP_FRAN_NYKO2[nyko2] != grupp:
                raise SystemExit(f"{n}: Nyko-2 {nyko2} is {GRUPP_FRAN_NYKO2[nyko2]}, area {slug} is {grupp}")
            if slug in EXPECTED_SDO and ex["matchning"] == "exact_name":
                ok = any(
                    ex["stadsdelsomrade"].startswith(sdo) and (not sdn or ex["sdn_del"].startswith(sdn))
                    for sdo, sdn in EXPECTED_SDO[slug]
                )
                if not ok:
                    raise SystemExit(f"{n}: SDO {ex['stadsdelsomrade']!r}/{ex['sdn_del']!r} not expected for {slug}")
            where = f"{ex['stadsdelsomrade']}, SDN-del {ex['sdn_del']}" if ex["stadsdelsomrade"] else "no entry"
            motivering = (
                f"Basområdeslistan 2026 Tabell 2 (PDF p.{ex['pdf_sida'] or '-'}): Nyko {ex['nyko5'] or '-'}, {where}. "
                f"{ex['anmarkning']}"
            )
            flagga = ""
            if n == "HAMMARBYHÖJDEN":
                flagga = "grans: basomrade Blasut raknas till Enskede-Arsta-Vantor"
            elif n == "RIDDARHOLMEN":
                flagga = "ej_i_kalla: Riddarholmen saknas i Basomradeslistan"
            rows.append(
                {
                    "stadsdel": n,
                    "registeromrade": namn,
                    "slug": slug,
                    "grupp": grupp,
                    "ordning": order,
                    "motivering": motivering,
                    "flagga": flagga,
                    "kalla": BASOMRADESLISTAN,
                }
            )
    rows.sort(key=lambda r: (r["ordning"], r["stadsdel"]))
    area_rows = [
        {"slug": s, "namn": n, "grupp": g, "ordning": i, "antal_stadsdelar": len(ALLOCATION[s]), "motivering": m}
        for i, (s, n, g, m) in enumerate(AREAS, start=1)
    ]
    return rows, area_rows


def main() -> None:
    rows, area_rows = build()
    with OUT_STADSDEL.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    with OUT_AREAS.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(area_rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(area_rows)
    print(f"wrote {len(rows)} stadsdel rows, {len(area_rows)} areas")
    for a in area_rows:
        print(f"  {a['ordning']:2d} {a['slug']:24s} {a['grupp']:12s} {a['antal_stadsdelar']}")


if __name__ == "__main__":
    main()

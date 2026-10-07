"""Builds data/derived/regional_prisniva.json from
  - data/raw/maklarstatistik_stockholms_lan.xlsx (sheet "Bostadsrätter", owner-supplied,
    Svensk Mäklarstatistik, https://www.maklarstatistik.se/omrade/riket/stockholms-lan/,
    uppdaterad 08 september 2026): län row + 26 kommuner, "3 månader average" and
    "12 mån average", kr/kvm. AVERAGES (medelvärde), no n given.
  - data/raw/riket_prisniva.csv (owner statement 2026-10-07).
Kommun codes come from data/derived/postnummer_kommun.csv (GeoNames names + OSM KNKOD),
never from memory; unmatched names are reported and make the build fail.

Run: ml/.venv/bin/python -I ml/build_regional_prisniva.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "data" / "raw" / "maklarstatistik_stockholms_lan.xlsx"
RIKET_CSV = ROOT / "data" / "raw" / "riket_prisniva.csv"
KOMMUN_CSV = ROOT / "data" / "derived" / "postnummer_kommun.csv"
OUT = ROOT / "data" / "derived" / "regional_prisniva.json"

LAN_ROW_NAME = "Stockholms län"
LAN_KOD = "01"  # first two digits of every Stockholms län kommun code in postnummer_kommun.csv
PERIOD_12M = {"fran": "2025-09", "till": "2026-08", "etikett": "sep 2025 - aug 2026 (12 mån)"}
PERIOD_3M = {"fran": "2026-06", "till": "2026-08", "etikett": "jun - aug 2026 (3 mån)"}
SOURCE_URL = "https://www.maklarstatistik.se/omrade/riket/stockholms-lan/"


def key(name: str) -> str:
    return re.sub(r"[\s\-]+", " ", name.strip().lower())


def parse_xlsx(path: Path = XLSX) -> list[dict]:
    """Rows after the 'Områden' header: name, kr/kvm 3 mån, kr/kvm 12 mån (ints)."""
    raw = pd.read_excel(path, sheet_name="Bostadsrätter", header=None)
    hdr = raw.index[raw[0] == "Områden"]
    if len(hdr) != 1:
        raise ValueError("expected exactly one 'Områden' header row")
    rows = []
    for _, r in raw.iloc[hdr[0] + 1 :].iterrows():
        if pd.isna(r[0]):
            continue
        v3, v12 = r[1], r[2]
        if pd.isna(v3) or pd.isna(v12) or float(v3) != int(v3) or float(v12) != int(v12):
            raise ValueError(f"non-integer or missing kr/kvm for {r[0]!r}: {v3!r}, {v12!r}")
        rows.append({"namn": str(r[0]).strip(), "kr_per_m2_3man": int(v3), "kr_per_m2_12man": int(v12)})
    return rows


def match_names(rows: list[dict], code_to_name: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Exact (normalised) name match xlsx -> kommun code. Returns (matched rows with
    'kod', list of problems). Ambiguity or no match is a problem."""
    by_key: dict[str, list[str]] = {}
    for code, name in code_to_name.items():
        by_key.setdefault(key(name), []).append(code)
    out, problems = [], []
    for r in rows:
        codes = by_key.get(key(r["namn"]), [])
        if len(codes) != 1:
            problems.append(f"{r['namn']!r}: {len(codes)} matches")
            continue
        out.append({**r, "kod": codes[0]})
    return out, problems


def main() -> None:
    kommun = pd.read_csv(KOMMUN_CSV, dtype=str, keep_default_na=False)
    lan = kommun[kommun["lan_kod"] == LAN_KOD]
    code_to_name = dict(lan.drop_duplicates("kommun_kod")[["kommun_kod", "kommun_namn"]].values)
    rows = parse_xlsx()
    lan_row = [r for r in rows if r["namn"] == LAN_ROW_NAME]
    kommun_rows = [r for r in rows if r["namn"] != LAN_ROW_NAME]
    if len(lan_row) != 1:
        raise SystemExit("län row missing")
    matched, problems = match_names(kommun_rows, code_to_name)
    unused = sorted(set(code_to_name) - {m["kod"] for m in matched})
    if problems or unused:
        raise SystemExit(f"name matching failed: problems={problems} kommuner_without_row={unused}")

    riket = pd.read_csv(RIKET_CSV).iloc[0]
    sthlm = next(m for m in matched if m["kod"] == "0180")

    def entry(r: dict, kod: str | None) -> dict:
        return {
            "kod": kod,
            "namn": r["namn"],
            "krPerM2": r["kr_per_m2_12man"],
            "period": PERIOD_12M,
            "krPerM2Tre_man": r["kr_per_m2_3man"],
            "periodTre_man": PERIOD_3M,
        }

    doc = {
        "version": "regional-prisniva-2026-09",
        "statistik": "medelvärde (average) kr/kvm, bostadsrätter; INTE median",
        "n": None,
        "n_note": "Svensk Mäklarstatistik anger inget antal försäljningar i tabellen; n är okänt.",
        "vald_kolumn": "12 mån average (ägarens beslut 2026-10-07)",
        "kommuner": [entry(m, m["kod"]) for m in sorted(matched, key=lambda m: m["kod"])],
        "lan": {**entry(lan_row[0], LAN_KOD), "namn": LAN_ROW_NAME},
        "riket": {
            "kod": "00",
            "namn": "Riket",
            "krPerM2": int(riket["kr_per_m2"]),
            "period": {"fran": "2026-08", "till": "2026-08", "etikett": "augusti 2026 (en månad)"},
            "kalla": riket["kalla"],
            "proveniens": riket["proveniens"],
            "varning": "Riket avser en enda månad (aug 2026) medan kommunernas 12 mån-kolumn avser sep 2025 - aug 2026; perioderna är inte jämförbara rakt av.",
        },
        "stockholmReferens": {"kod": "0180", "namn": sthlm["namn"], "krPerM2": sthlm["kr_per_m2_12man"], "period": PERIOD_12M},
        "kallor": [
            {
                "namn": "Svensk Mäklarstatistik, Bostadsrätter - Stockholms län (kommuner)",
                "url": SOURCE_URL,
                "uppdaterad": "2026-09-08",
                "levererad_av": "ägaren, xlsx i data/raw/maklarstatistik_stockholms_lan.xlsx (2026-10-07)",
            },
            {"namn": "Riket 46 317 kr/kvm (aug 2026, average)", "proveniens": "uppgift från ägaren 2026-10-07", "fil": "data/raw/riket_prisniva.csv"},
            {"namn": "Kommunkoder och namn", "proveniens": "data/derived/postnummer_kommun.csv (GeoNames admin2 + OSM KNKOD)"},
        ],
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}: {len(doc['kommuner'])} kommuner, lan {doc['lan']['krPerM2']}, riket {doc['riket']['krPerM2']}")


if __name__ == "__main__":
    main()

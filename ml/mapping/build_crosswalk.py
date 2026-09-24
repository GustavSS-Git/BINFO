"""Builds the stadsdel -> Binfo-omrade crosswalk (117 Stockholm stadsdelar -> 13
Svensk-Maklarstatistik-named areas used by the product).

This is an owner/product decision (per task brief), not a fact we can cite from a
single external source: Svensk Maklarstatistik does not publish which stadsdelar make
up each of its 13 statistical areas. We ground every row in the closest authoritative
grouping we could find (Stockholm stad's own stadsdelsnamnd/stadsdelsomrade
composition, as described on Swedish Wikipedia, cross-checked 2026-09-24) and then
apply a small number of documented, explicit overrides required by the brief:

  - "Centrala Stockholm" does not exist as an administrative unit. We define it (per
    the brief) as the central, non-residential-market "old town" islands that are not
    already part of Kungsholmen, Sodermalm, Vasastan-Norrmalm or Ostermalm: Gamla
    Stan, Riddarholmen, Skeppsholmen. Administratively Gamla Stan/Riddarholmen sit in
    the Sodermalm stadsdelsnamnd and Skeppsholmen sits in the Norrmalm stadsdelsnamnd;
    we carve them out here into their own area because that is what the brief and
    (implicitly) Maklarstatistik's naming scheme require -- Maklarstatistik itself
    uses "Centrala Stockholm" as a *rollup label* for {Essingen, Kungsholmen,
    Ostermalm, Vasastan-Norrmalm, Sodermalm} (see maklarstatistik.se/om-statistiken/
    geografisk-indelning/, retrieved 2026-09-24), not as a 13th disjoint area -- so
    our usage intentionally diverges from theirs. This is flagged in the README.
  - "Essingen" (Stora Essingen, Lilla Essingen) is administratively part of the
    Kungsholmen stadsdelsnamnd, but Maklarstatistik lists Essingen as its own area, so
    we carve it out of Kungsholmen too.
  - "Farsta-Vantor" and "Enskede-Skarpnack" both draw stadsdelar out of the single
    (post-2007) Enskede-Arsta-Vantor stadsdelsnamnd: the historical "Vantor"
    cluster (Bandhagen, Hagsatra, Hogdalen, Ragsved, Orby -- see sv.wikipedia.org/
    wiki/Vantors_stadsdelsomrade, retrieved 2026-09-24) goes to Farsta-Vantor; the
    rest (Enskedefaltet, Enskede gard, Gamla Enskede, Johanneshov, Stureby, Arsta,
    Ostberga) goes to Enskede-Skarpnack together with the full (pre-2023) Skarpnack
    stadsdelsnamnd.
  - "Hagersten-Liljeholmen" is mapped from the full (2020-) Hagersten-Alvsjo
    stadsdelsnamnd, i.e. it also includes the former separate Alvsjo stadsdelsnamnd's
    stadsdelar (Alvsjo, Herrangen, Langbro, Langsjo, Liseberg, Solberga, Orby Slott).
    Maklarstatistik's area name omits "Alvsjo" but there is no separate Alvsjo area in
    the brief's list of 13, so those stadsdelar have nowhere else to go.
  - "Spanga-Kista" is mapped from the full (2023-) Jarva stadsdelsnamnd (former
    Rinkeby-Kista + Spanga-Tensta).

Sources used for the borough (stadsdelsnamnd/stadsdelsomrade) compositions, all
retrieved 2026-09-24 via Swedish Wikipedia (sv.wikipedia.org), itself citing
Stockholms stad's official stadsdelsindelning:
  - Bromma stadsdelsomrade
  - Hagersten-Alvsjo stadsdelsomrade
  - Hasselby-Vallingby stadsdelsomrade
  - Jarva stadsdelsomrade
  - Kungsholmens stadsdelsomrade
  - Norrmalms stadsdelsomrade (pre-2023)
  - Ostermalms stadsdelsomrade (pre-2023)
  - Skarholmens stadsdelsomrade
  - Skarpnacks stadsdelsomrade
  - Sodermalms stadsdelsomrade
  - Enskede-Arsta-Vantors stadsdelsomrade / Vantors stadsdelsomrade (historical)
  - Farsta (borough)

These are administrative, not commercial/paywalled, sources; Wikipedia text is CC
BY-SA (attribution: Wikipedia contributors) and used here only as a pointer to the
underlying municipal fact (which stadsdel belongs to which stadsdelsnamnd) -- not as
a data source we redistribute. No stadsdel-borough fact here was taken from memory
without a citation; the area(13)-per-stadsdelsnamnd allocation is the explicit
product decision described above.

Output: ml/mapping/stadsdel_omrade_crosswalk.csv (stadsdel, omrade, motivering)
"""

import csv
from pathlib import Path

OUT = Path(__file__).parent / "stadsdel_omrade_crosswalk.csv"

# One-line justification per source grouping (reused across rows in that grouping).
J_CENTRALA = (
    "Owner definition (brief): central island stadsdel not already part of "
    "Kungsholmen/Sodermalm/Vasastan-Norrmalm/Ostermalm; administratively part of "
    "Sodermalm resp. Norrmalm stadsdelsnamnd, carved out here."
)
J_BROMMA = "Part of Bromma stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_SKARHOLMEN = "Part of Skarholmens stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_SKARPNACK = "Part of Skarpnacks stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_EAV_ENSKEDE = (
    "Part of Enskede-Arsta-Vantors stadsdelsomrade, non-Vantor remainder "
    "(sv.wikipedia.org, retrieved 2026-09-24)."
)
J_ESSINGEN = (
    "Owner definition (brief): Essinge islands; administratively part of "
    "Kungsholmens stadsdelsomrade, carved out here as its own Maklarstatistik-named area."
)
J_FARSTA = "Part of Farsta stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_VANTOR = (
    "Historical Vantors stadsdelsomrade cluster within Enskede-Arsta-Vantor "
    "(sv.wikipedia.org/wiki/Vantors_stadsdelsomrade, retrieved 2026-09-24)."
)
J_HAGERSTEN_ALVSJO = "Part of Hagersten-Alvsjo stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_HASSELBY = "Part of Hasselby-Vallingby stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."
J_KUNGSHOLMEN = (
    "Part of Kungsholmens stadsdelsomrade excl. the two Essinge-island stadsdelar "
    "(sv.wikipedia.org, retrieved 2026-09-24)."
)
J_JARVA = "Part of Jarva stadsdelsomrade (former Rinkeby-Kista + Spanga-Tensta) (sv.wikipedia.org, retrieved 2026-09-24)."
J_SODERMALM = (
    "Part of Sodermalms stadsdelsomrade excl. Gamla Stan/Riddarholmen "
    "(sv.wikipedia.org, retrieved 2026-09-24)."
)
J_NORRMALM = (
    "Part of (pre-2023) Norrmalms stadsdelsomrade excl. Skeppsholmen "
    "(sv.wikipedia.org, retrieved 2026-09-24)."
)
J_OSTERMALM = "Part of (pre-2023) Ostermalms stadsdelsomrade (sv.wikipedia.org, retrieved 2026-09-24)."

ROWS = [
    ("Gamla Stan", "Centrala Stockholm", J_CENTRALA),
    ("Riddarholmen", "Centrala Stockholm", J_CENTRALA),
    ("Skeppsholmen", "Centrala Stockholm", J_CENTRALA),

    ("Abrahamsberg", "Bromma-Västerled", J_BROMMA),
    ("Alvik", "Bromma-Västerled", J_BROMMA),
    ("Beckomberga", "Bromma-Västerled", J_BROMMA),
    ("Blackeberg", "Bromma-Västerled", J_BROMMA),
    ("Bromma Kyrka", "Bromma-Västerled", J_BROMMA),
    ("Bällsta", "Bromma-Västerled", J_BROMMA),
    ("Eneby", "Bromma-Västerled", J_BROMMA),
    ("Höglandet", "Bromma-Västerled", J_BROMMA),
    ("Mariehäll", "Bromma-Västerled", J_BROMMA),
    ("Nockeby", "Bromma-Västerled", J_BROMMA),
    ("Nockebyhov", "Bromma-Västerled", J_BROMMA),
    ("Norra Ängby", "Bromma-Västerled", J_BROMMA),
    ("Olovslund", "Bromma-Västerled", J_BROMMA),
    ("Riksby", "Bromma-Västerled", J_BROMMA),
    ("Smedslätten", "Bromma-Västerled", J_BROMMA),
    ("Stora Mossen", "Bromma-Västerled", J_BROMMA),
    ("Södra Ängby", "Bromma-Västerled", J_BROMMA),
    ("Traneberg", "Bromma-Västerled", J_BROMMA),
    ("Ulvsunda", "Bromma-Västerled", J_BROMMA),
    ("Ulvsunda Industriomr", "Bromma-Västerled", J_BROMMA),
    ("Åkeshov", "Bromma-Västerled", J_BROMMA),
    ("Åkeslund", "Bromma-Västerled", J_BROMMA),
    ("Ålsten", "Bromma-Västerled", J_BROMMA),
    ("Äppelviken", "Bromma-Västerled", J_BROMMA),

    ("Bredäng", "Brännkyrka-Skärholmen", J_SKARHOLMEN),
    ("Sätra", "Brännkyrka-Skärholmen", J_SKARHOLMEN),
    ("Skärholmen", "Brännkyrka-Skärholmen", J_SKARHOLMEN),
    ("Vårberg", "Brännkyrka-Skärholmen", J_SKARHOLMEN),

    ("Hammarbyhöjden", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Björkhagen", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Enskededalen", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Kärrtorp", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Bagarmossen", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Skarpnäcks Gård", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Flaten", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Orhem", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Skrubba", "Enskede-Skarpnäck", J_SKARPNACK),
    ("Enskedefältet", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Enskede Gård", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Gamla Enskede", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Johanneshov", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Stureby", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Årsta", "Enskede-Skarpnäck", J_EAV_ENSKEDE),
    ("Östberga", "Enskede-Skarpnäck", J_EAV_ENSKEDE),

    ("Lilla Essingen", "Essingen", J_ESSINGEN),
    ("Stora Essingen", "Essingen", J_ESSINGEN),

    ("Fagersjö", "Farsta-Vantör", J_FARSTA),
    ("Farsta", "Farsta-Vantör", J_FARSTA),
    ("Farsta Strand", "Farsta-Vantör", J_FARSTA),
    ("Farstanäset", "Farsta-Vantör", J_FARSTA),
    ("Gubbängen", "Farsta-Vantör", J_FARSTA),
    ("Hökarängen", "Farsta-Vantör", J_FARSTA),
    ("Larsboda", "Farsta-Vantör", J_FARSTA),
    ("Sköndal", "Farsta-Vantör", J_FARSTA),
    ("Svedmyra", "Farsta-Vantör", J_FARSTA),
    ("Tallkrogen", "Farsta-Vantör", J_FARSTA),
    ("Bandhagen", "Farsta-Vantör", J_VANTOR),
    ("Hagsätra", "Farsta-Vantör", J_VANTOR),
    ("Högdalen", "Farsta-Vantör", J_VANTOR),
    ("Rågsved", "Farsta-Vantör", J_VANTOR),
    ("Örby", "Farsta-Vantör", J_VANTOR),

    ("Aspudden", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Fruängen", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Gröndal", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Herrängen", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Hägersten", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Hägerstensåsen", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Liljeholmen", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Liseberg", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Långbro", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Långsjö", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Midsommarkransen", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Mälarhöjden", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Solberga", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Västberga", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Västertorp", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Älvsjö", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),
    ("Örby Slott", "Hägersten-Liljeholmen", J_HAGERSTEN_ALVSJO),

    ("Grimsta", "Hässelby-Vällingby", J_HASSELBY),
    ("Hässelby Gård", "Hässelby-Vällingby", J_HASSELBY),
    ("Hässelby Strand", "Hässelby-Vällingby", J_HASSELBY),
    ("Hässelby Villastad", "Hässelby-Vällingby", J_HASSELBY),
    ("Kälvesta", "Hässelby-Vällingby", J_HASSELBY),
    ("Nälsta", "Hässelby-Vällingby", J_HASSELBY),
    ("Råcksta", "Hässelby-Vällingby", J_HASSELBY),
    ("Vinsta", "Hässelby-Vällingby", J_HASSELBY),
    ("Vällingby", "Hässelby-Vällingby", J_HASSELBY),

    ("Kungsholmen", "Kungsholmen", J_KUNGSHOLMEN),
    ("Stadshagen", "Kungsholmen", J_KUNGSHOLMEN),
    ("Kristineberg", "Kungsholmen", J_KUNGSHOLMEN),
    ("Fredhäll", "Kungsholmen", J_KUNGSHOLMEN),
    ("Marieberg", "Kungsholmen", J_KUNGSHOLMEN),

    ("Akalla", "Spånga-Kista", J_JARVA),
    ("Bromsten", "Spånga-Kista", J_JARVA),
    ("Flysta", "Spånga-Kista", J_JARVA),
    ("Hansta", "Spånga-Kista", J_JARVA),
    ("Husby", "Spånga-Kista", J_JARVA),
    ("Kista", "Spånga-Kista", J_JARVA),
    ("Lunda", "Spånga-Kista", J_JARVA),
    ("Rinkeby", "Spånga-Kista", J_JARVA),
    ("Solhem", "Spånga-Kista", J_JARVA),
    ("Sundby", "Spånga-Kista", J_JARVA),
    ("Tensta", "Spånga-Kista", J_JARVA),

    ("Södermalm", "Södermalm", J_SODERMALM),
    ("Södra Hammarbyhamnen", "Södermalm", J_SODERMALM),
    ("Reimersholme", "Södermalm", J_SODERMALM),
    ("Långholmen", "Södermalm", J_SODERMALM),

    ("Norrmalm", "Vasastan-Norrmalm", J_NORRMALM),
    ("Vasastaden", "Vasastan-Norrmalm", J_NORRMALM),

    ("Östermalm", "Östermalm", J_OSTERMALM),
    ("Djurgården", "Östermalm", J_OSTERMALM),
    ("Hjorthagen", "Östermalm", J_OSTERMALM),
    ("Ladugårdsgärdet", "Östermalm", J_OSTERMALM),
    ("Norra Djurgården", "Östermalm", J_OSTERMALM),
]


def main() -> None:
    assert len(ROWS) == 117, f"expected 117 stadsdelar, got {len(ROWS)}"
    assert len({r[0] for r in ROWS}) == 117, "duplicate stadsdel in crosswalk"
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["stadsdel", "omrade", "motivering"])
        for stadsdel, omrade, motivering in sorted(ROWS, key=lambda r: r[0]):
            w.writerow([stadsdel, omrade, motivering])
    print(f"wrote {len(ROWS)} rows to {OUT}")


if __name__ == "__main__":
    main()

"""Offline geocoding of a BRF's street address to a Stockholm stadsdel and register area.

OFFLINE / BULK USE ONLY: this is a developer and importer tool. It must never be called
from the Worker or from a request path (Nominatim's usage policy forbids that kind of
traffic and the result would be unavailable at runtime anyway). At runtime the app only
uses the precomputed postnummer -> area table (`src/lib/register/`).

Pipeline (PLAN-v3 2.2, priority 1 and 2):

    street address (+ postnummer, + ort)
      -> Nominatim structured search  (street=, postalcode=, city=, countrycodes=se)
      -> lat/lon
      -> point-in-polygon against the 117 SBK stadsdel polygons (CC0)
      -> stadsdel -> register area (stadsdel_registeromrade.csv)

Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/,
read 2026-10-13): absolute maximum of 1 request per second, a valid identifying
User-Agent, attribution (ODbL), results must be cached on our side; "bulk geocoding of
larger amounts of data is not encouraged" - small one-time bulk jobs must be single
threaded, and scripts that run longer than a day or at regular intervals are restricted
to 4 requests per minute. A one-off importer run over a few hundred BRFs at <= 1 req/s
is in line with that; thousands of addresses, or a recurring job, need a different
geocoder (self-hosted Nominatim or a commercial service) - decide before scaling up. This module therefore

  * sends the User-Agent "Binfo/1.0 (contactbinfohere@gmail.com)" (Binfo's contact address),
  * waits at least MIN_INTERVAL_S (1.1 s) between two network requests,
  * caches every response (hits and misses) on disk in
    ml/mapping/sources/raw/nominatim_cache.json (gitignored), keyed by the normalised
    query, and never re-requests a cached query.

Lookup order for one address (each step cached separately):
  1. street + postalcode (+ city if given)
  2. street + city (only if step 1 had no hit and a city is known)
A postnummer in the BRF's report can be missing from OSM or tagged differently, hence
step 2. A hit that falls outside every stadsdel polygon is reported as
`utanfor_stockholms_kommun`, never forced into the nearest area.

Status values: ok | ingen_traff | utanfor_stockholms_kommun.
Flags (';'-joined): `avviker_fran_postnummer` (the postnummer table gives another register
area than the geocoded point; geocoding wins, the flag is for manual review),
`fallback_utan_postnummer`, `osm_traff_ar_inte_adress` (class/type is not a building or
address-level object, e.g. a street centre line: the point is approximate).

Usage:
    ml/.venv/bin/python ml/mapping/geokoda_adress.py "Baltzar von Platens gata 6" --postnummer 11242 --ort Stockholm
    ml/.venv/bin/python ml/mapping/geokoda_adress.py --csv in.csv --out out.csv   # columns: adress, postnummer, ort
"""

import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from shapely.geometry import Point, shape
from shapely.prepared import prep

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GEOJSON = HERE / "sources" / "stadsdelar_fullsize.geo.json"
REGISTER_CROSSWALK = HERE / "stadsdel_registeromrade.csv"
POSTNUMMER_STADSDEL = ROOT / "data" / "derived" / "postnummer_stadsdel.csv"
CACHE_PATH = HERE / "sources" / "raw" / "nominatim_cache.json"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Binfo/1.0 (contactbinfohere@gmail.com)"
MIN_INTERVAL_S = 1.1

# Nominatim classes/types that are address-level; others (e.g. highway=residential) are an
# approximate point on a street or a larger object.
ADDRESS_LEVEL_CLASSES = {"building", "place", "amenity", "shop", "office", "tourism", "leisure", "man_made", "craft", "historic"}
ADDRESS_LEVEL_TYPES = {"house", "apartments", "residential", "yes", "address", "detached", "terrace", "dormitory"}

Fetcher = Callable[[dict], list]


def normalise_part(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def normalise_postnummer(pn: str | None) -> str:
    return "".join(ch for ch in (pn or "") if ch.isdigit())


def cache_key(street: str, postnummer: str | None, city: str | None) -> str:
    return "|".join([normalise_part(street), normalise_postnummer(postnummer), normalise_part(city)])


def build_params(street: str, postnummer: str | None, city: str | None) -> dict:
    params = {"street": street.strip(), "countrycodes": "se", "format": "jsonv2", "limit": "3", "addressdetails": "1"}
    pn = normalise_postnummer(postnummer)
    if pn:
        params["postalcode"] = pn
    if city and city.strip():
        params["city"] = city.strip()
    return params


class Throttle:
    def __init__(self, interval_s: float = MIN_INTERVAL_S):
        self.interval_s = interval_s
        self._last = 0.0

    def wait(self) -> None:
        delta = time.monotonic() - self._last
        if self._last and delta < self.interval_s:
            time.sleep(self.interval_s - delta)
        self._last = time.monotonic()


_throttle = Throttle()


def http_fetch(params: dict) -> list:
    """The only function that talks to the network. One request per call."""
    _throttle.wait()
    url = NOMINATIM_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "sv"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (fixed https URL)
        return json.loads(resp.read().decode("utf-8"))


def load_cache(path: Path = CACHE_PATH) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict, path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def cached_search(street: str, postnummer: str | None, city: str | None, cache: dict, fetch: Fetcher) -> list:
    key = cache_key(street, postnummer, city)
    if key not in cache:
        cache[key] = fetch(build_params(street, postnummer, city))
    return cache[key]


def pick_hit(results: list) -> dict | None:
    """First Nominatim result with usable coordinates (Nominatim already ranks them)."""
    for r in results:
        try:
            float(r["lat"]), float(r["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        return r
    return None


def is_address_level(hit: dict) -> bool:
    return hit.get("category", hit.get("class")) in ADDRESS_LEVEL_CLASSES and hit.get("type") in ADDRESS_LEVEL_TYPES


class Stadsdelar:
    """Point-in-polygon against the SBK stadsdel polygons and the register crosswalk."""

    def __init__(self, geojson: Path = GEOJSON, crosswalk: Path = REGISTER_CROSSWALK):
        data = json.loads(geojson.read_text(encoding="utf-8"))
        self.polys = []
        for f in data["features"]:
            g = shape(f["geometry"])
            self.polys.append((f["properties"]["name"], g, prep(g)))
        self.area_of: dict[str, dict] = {}
        with crosswalk.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                self.area_of[r["stadsdel"]] = {"slug": r["slug"], "namn": r["registeromrade"], "grupp": r["grupp"]}

    def stadsdel_at(self, lat: float, lon: float) -> str | None:
        pt = Point(lon, lat)
        for name, _g, p in self.polys:
            if p.contains(pt):
                return name
        for name, g, _p in self.polys:  # on a shared edge
            if g.intersects(pt):
                return name
        return None


def load_postnummer_area(path: Path = POSTNUMMER_STADSDEL) -> dict[str, str]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return {r["postnummer"]: r["registeromrade"] for r in csv.DictReader(f)}


def geokoda(
    street: str,
    postnummer: str | None = None,
    ort: str | None = None,
    *,
    cache: dict,
    fetch: Fetcher,
    stadsdelar: Stadsdelar,
    postnummer_area: dict[str, str] | None = None,
) -> dict:
    flags: list[str] = []
    hit = None
    pn = normalise_postnummer(postnummer)
    if pn or ort:
        hit = pick_hit(cached_search(street, pn or None, ort, cache, fetch))
    if hit is None and pn and ort:
        hit = pick_hit(cached_search(street, None, ort, cache, fetch))
        if hit is not None:
            flags.append("fallback_utan_postnummer")
    if hit is None and not pn and not ort:
        hit = pick_hit(cached_search(street, None, None, cache, fetch))
    out = {
        "adress": street,
        "postnummer": pn,
        "ort": ort or "",
        "status": "ingen_traff",
        "lat": "",
        "lon": "",
        "osm_visningsnamn": "",
        "stadsdel": "",
        "registeromrade": "",
        "grupp": "",
        "flagga": "",
    }
    if hit is None:
        return out
    lat, lon = float(hit["lat"]), float(hit["lon"])
    out.update(lat=round(lat, 6), lon=round(lon, 6), osm_visningsnamn=hit.get("display_name", ""))
    if not is_address_level(hit):
        flags.append("osm_traff_ar_inte_adress")
    sd = stadsdelar.stadsdel_at(lat, lon)
    if sd is None:
        out["status"] = "utanfor_stockholms_kommun"
    else:
        area = stadsdelar.area_of[sd]
        out.update(status="ok", stadsdel=sd, registeromrade=area["slug"], grupp=area["grupp"])
        if postnummer_area and pn in postnummer_area and postnummer_area[pn] != area["slug"]:
            flags.append("avviker_fran_postnummer")
    out["flagga"] = ";".join(flags)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("adress", nargs="?", help="street + number, e.g. 'Baltzar von Platens gata 6'")
    ap.add_argument("--postnummer")
    ap.add_argument("--ort")
    ap.add_argument("--csv", help="input CSV with columns adress, postnummer, ort")
    ap.add_argument("--out", help="output CSV (with --csv); default stdout")
    args = ap.parse_args(argv)
    if not args.adress and not args.csv:
        ap.error("give an address or --csv")

    stadsdelar = Stadsdelar()
    pn_area = load_postnummer_area()
    cache = load_cache()
    inputs: list[tuple[str, str | None, str | None]] = []
    if args.csv:
        with open(args.csv, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                inputs.append((r["adress"], r.get("postnummer"), r.get("ort")))
    else:
        inputs.append((args.adress, args.postnummer, args.ort))

    results = []
    try:
        for street, pn, ort in inputs:
            results.append(geokoda(street, pn, ort, cache=cache, fetch=http_fetch, stadsdelar=stadsdelar, postnummer_area=pn_area))
            save_cache(cache)
    finally:
        save_cache(cache)
    sink = open(args.out, "w", encoding="utf-8", newline="") if args.out else sys.stdout
    w = csv.DictWriter(sink, fieldnames=list(results[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(results)
    if args.out:
        sink.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

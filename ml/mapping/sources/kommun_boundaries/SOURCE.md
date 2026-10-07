# Kommun boundaries, Stockholms län

- File: `osm_kommun_admin7_stockholms_lan.json` (26 relations, `admin_level=7`, with member-way geometry)
- Source: OpenStreetMap contributors, via the Overpass API
  (`https://overpass-api.de/api/interpreter`), query in `overpass_query.txt`
  (all `boundary=administrative` + `admin_level=7` relations inside the area of OSM relation 54391, "Stockholms län").
- Retrieved: 2026-10-07 (Overpass `timestamp_osm_base` 2026-10-07T21:45:46Z).
- Licence: ODbL 1.0, attribution "(c) OpenStreetMap contributors" (https://www.openstreetmap.org/copyright).
  Same share-alike caveat as the rest of the OSM-derived mapping, see `ml/mapping/README.md` -> "Licensing".
- Each relation carries the SCB kommun code in the OSM tag `KNKOD` (4 digits). The build script
  cross-checks these codes against the GeoNames admin2 codes and the Mäklarstatistik kommun names.
- Boundaries are OSM's, not Lantmäteriet's official ones; points very close to a boundary can be misassigned.

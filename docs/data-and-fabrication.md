# Data, attribution, and fabrication safety

## Data

- Terrain: [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/). Individual contributing datasets have their own attribution requirements.
- Roads and water: OpenStreetMap-derived PMTiles, licensed under ODbL. The app displays attribution and every fabrication package includes `ATTRIBUTION.txt`.
- Place search: Geoapify, proxied by the Worker so its API key is never shipped to the browser. Responses are cached for 24 hours under a hashed query key.
- Interactive reference map: OpenFreeMap. Its imagery is preview-only and never enters fabrication exports.

The operator is responsible for keeping the Worker manifest, PMTiles snapshot, dataset version, provider terms, and attribution notices synchronized. Mapzen's per-tile `X-Imagery-Sources` value is preserved in R2 metadata and included in each project manifest.

## Fabrication

- SVG documents are 1:1 physical size in millimeters.
- `CUT` uses `#ff0035`, `SCORE` uses `#2563eb`, and `ENGRAVE` uses `#111827`.
- Users must verify operation mapping after import into xTool Studio.
- Minimum feature filtering is geometric assistance, not automatic kerf compensation.
- Elevation labels are exported as font-independent vector paths. The X/Y anchor is a preference; generation moves a label to the nearest collision-free position inside each layer, or omits it with a warning when none fits.
- Power, speed, passes, material condition, focus, ventilation, and fire safety remain the maker's responsibility.

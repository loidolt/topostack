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
- Assembly guides are enabled by default. Every layer below the top engraves the outer footprint of each piece on the next layer and, where it fits, an `Lxx` registration label. Labels are accepted only when their full vector bounds lie inside the area that the next layer will cover.
- Material-saving nesting is enabled by default with an 8 mm glue margin. A smaller non-adjacent layer may be cut from inside a lower layer only when the intervening layer covers the entire cavity and every relevant outer, hole, and adjacent-cavity boundary preserves the configured margin. The planner never rotates or translates terrain pieces.
- A nested cut line serves as both the lower layer's cavity and the smaller layer's outer edge. The optimized master and fabrication-panel SVGs emit that shared line once, route each layer's engravings only onto its remaining material, and list all included layer IDs. Keep every loose cutout after fabrication.
- Elevation labels are exported as font-independent vector paths. The X/Y anchor is a preference; generation moves a label to the nearest collision-free position inside each layer, or omits it with a warning when none fits.
- Power, speed, passes, material condition, focus, ventilation, and fire safety remain the maker's responsibility.

# Data, attribution, and fabrication safety

## Data

- Terrain: [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/). Individual contributing datasets have their own attribution requirements.
- Roads, trails, and water: OpenStreetMap-derived PMTiles, licensed under ODbL. Major roads, local roads, and trails are classified from the Protomaps transportation schema; rail, aerialways, ferries, piers, and aeroways are excluded. The app displays attribution and every fabrication package includes `ATTRIBUTION.txt`.
- Place search: Geoapify, proxied by the Worker so its API key is never shipped to the browser. Responses are cached for 24 hours under a hashed query key.
- Interactive reference map: OpenFreeMap. Its imagery is preview-only and never enters fabrication exports.

The operator is responsible for keeping the Worker manifest, PMTiles snapshot, dataset version, provider terms, and attribution notices synchronized. Mapzen's per-tile `X-Imagery-Sources` value is preserved in R2 metadata and included in each project manifest.

## Fabrication

- SVG documents are 1:1 physical size in millimeters.
- Layer count is not a setting. The stack is as tall as the terrain relief at the map's own horizontal scale, multiplied by the vertical exaggeration, and the material thickness decides how many sheets that takes. Counts outside 2–24 sheets are clamped and the exaggeration is refitted to the clamp, so the figure reported in the panel and in `README.txt` always describes the model that will be cut.
- `CUT` uses `#ff0035`, `SCORE` uses `#2563eb`, and `ENGRAVE` uses `#111827`.
- Major roads engrave as parallel lines 0.8 mm apart, local roads as single solid lines, and trails as 1.8 mm dashes separated by 1.2 mm gaps. Buffered vector-tile overlaps are trimmed and matching road pieces are stitched before styling. Forks with three or more road arms receive a compact join, and complete routes are clipped against exposed terrain faces so adjacent layers share exact endpoints without visible gaps. Optional transportation labels use names first and route references as a fallback; duplicate or unsafe labels are omitted.
- Every complete fabrication SVG has top-level color-defined `CUT`, `SCORE`, and `ENGRAVE` groups. All engraved details are black and each panel includes a dimensionally identical `-engrave.svg` companion for paired workflows.
- North-arrow presets are TopoStack-native single-line engraving geometry informed by Wikimedia Commons' [public-domain simple compass rose](https://commons.wikimedia.org/wiki/File:Compass_rose_simple_plain.svg) and [CC0 Compass Rose](https://commons.wikimedia.org/wiki/File:CC0_Compass_Rose.svg). The source artwork permits commercial reuse and modification; TopoStack keeps its adapted geometry deterministic and fabrication-safe rather than embedding third-party SVG markup.
- Users must verify operation mapping after import into xTool Studio.
- Minimum feature filtering is geometric assistance and is independent of kerf compensation.
- Laser kerf defaults to 0.15 mm and accepts calibrated values from 0–1 mm. Exported external cuts move outward by half the configured kerf; internal cuts move inward by half. Setting kerf to zero disables compensation.
- Assembly guides are enabled by default. Every layer below the top engraves the outer footprint of each piece on the next layer, inset by the configured laser kerf so the burn remains covered, and adds an `Lxx` registration label where it fits. Labels are accepted only when their full vector bounds lie inside the area that the next layer will cover.
- Material-saving nesting is enabled by default with an 8 mm glue margin. A smaller non-adjacent layer may be cut from inside a lower layer when the intervening layer preserves the configured glue margin around the cavity. Safe concentric cavity chains let neighboring lower layers be hollowed when their cavity boundaries retain that margin. The planner never rotates or translates terrain pieces.
- A nested cut line serves as both the lower layer's cavity and the smaller layer's outer edge. The optimized master and fabrication-panel SVGs emit that shared line once, route each layer's engravings only onto its remaining material, and list all included layer IDs. Keep every loose cutout after fabrication.
- Elevation labels are exported as font-independent vector paths. The X/Y anchor is a preference; generation moves a label to the nearest collision-free position inside each layer, or omits it with a warning when none fits.
- Power, speed, passes, material condition, focus, ventilation, and fire safety remain the maker's responsibility.

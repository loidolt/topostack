# Architecture

TopoStack has one authoritative geometry flow:

```text
ProjectConfigV1 (including authoritative geographic crop bounds) + SourceBundleV1
  → @topostack/core.generateGeometry()
  → GeometryIRV1 (mm, centered origin, Y down)
  → 2D preview / three.js preview / SVG fabrication package
```

The core package has no Svelte, Atomm, Cloudflare, DOM, or storage imports. The SvelteKit generator is prerendered as a static site, mosaics every elevation/vector tile intersecting the visible crop, and adapts the core to browser Web Workers, IndexedDB, MapLibre, three.js, and the Atomm lifecycle. The Cloudflare Worker streams and caches source data; it does not perform contour generation.

The UI follows the same Svelte 5 runes, immutable domain-state, and static-adapter patterns as Label Studio. Atomm integration stays behind a small bridge that registers the platform lifecycle once and reads current project state through a getter, avoiding stale component closures.

Layer count is derived, never configured. `planTerrainStack` turns the mapped ground width, the physical cut width, the terrain relief, and the requested vertical exaggeration into a stack height, then divides that by the material thickness. The count is clamped to 2–24 sheets and the reported exaggeration is refitted to whatever the clamp allows, so adding material thickness makes a model coarser rather than shorter and widening the cut makes it taller.

Every generated result records a deterministic project fingerprint and source quality. Before markings are clipped and labels are placed, the geometry flow plans same-coordinate material nests and adds their glue-safe cavities to donor layers. Vector-tile buffers are removed and unambiguous degree-two road pieces are stitched before transportation paths are styled as complete routes. Roads use a continuous centerline by default; the optional outlined major-road style offsets the complete route by the configured spacing and adds matching compact joins at forks. Styled routes are then clipped to the highest exposed material across the stack so bends and contour transitions stay continuous. Fabrication export groups each nest family onto one panel and emits shared donor/child cut lines once. Export is rejected when settings changed after generation, the source is synthetic, or any layer is empty.

## Coordinate conventions

- Geographic inputs are WGS84 longitude/latitude.
- Elevation/vector tiles use Web Mercator tile coordinates.
- Geometry IR and SVG use millimeters, centered at `(0, 0)`, with Y down.
- three.js extrudes XY outlines along +Z and mirrors Y once on the content group.

## Data coverage

The first release supports land terrain between ±85.0511° latitude. Mapzen Terrarium tiles provide elevation. The pinned Protomaps 20260819 archive provides OSM-derived roads, trails, and water through zoom 12 from `osm/current.pmtiles`; the browser requests one vector zoom beyond the reference-map zoom when the archive and tile budget permit, then clamps to the advertised range. Source resolution varies, and all output is decorative rather than survey-grade.

## Versioning

`ProjectConfigV1`, `SourceBundleV1`, `GeometryIRV1`, and the exported manifest are explicitly versioned. Any incompatible change must introduce a migration rather than silently reinterpret an IndexedDB or exported project. Replacing the stored `layerCount` with `verticalExaggeration` moved the fingerprint prefix to `v3-`; projects saved before that load at the default exaggeration and must be regenerated once before export.

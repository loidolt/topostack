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

Every generated result records a deterministic project fingerprint and source quality. Fabrication export is rejected when settings changed after generation, the source is synthetic, or any layer is empty.

## Coordinate conventions

- Geographic inputs are WGS84 longitude/latitude.
- Elevation/vector tiles use Web Mercator tile coordinates.
- Geometry IR and SVG use millimeters, centered at `(0, 0)`, with Y down.
- three.js extrudes XY outlines along +Z and mirrors Y once on the content group.

## Data coverage

The first release supports land terrain between ±85.0511° latitude. Mapzen Terrarium tiles provide elevation. OSM-derived vector tiles in `osm/current.pmtiles` provide roads and water lines. Source resolution varies, and all output is decorative rather than survey-grade.

## Versioning

`ProjectConfigV1`, `SourceBundleV1`, `GeometryIRV1`, and the exported manifest are explicitly versioned. Any incompatible change must introduce a migration rather than silently reinterpret an IndexedDB or exported project.

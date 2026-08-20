# Roadmap

## Implemented v1 foundation

- Atomm-first static generator and export lifecycle.
- Global land-elevation tile flow with offline deterministic fallback.
- Rectangular and circular crops, 2–24 layers, configurable dimensions and material thickness.
- Contour polygon generation, feature filtering, cut/score/engrave IR, per-layer and master SVGs.
- Map, 2D, and stacked/exploded 3D previews.
- OSM PMTiles adapter for roads and water, local IndexedDB projects, undo/redo, and project JSON import/export.
- Cloudflare Worker with R2 caching, range requests, geocoding, CORS, rate limiting, and observability.
- Editable elevation-label anchors with font-independent vector paths, material-boundary checks, and automatic collision repair.
- Optional next-layer alignment outlines and hidden registration labels for reliable physical assembly.
- Deterministic browser generation/export tests, production release artifacts, hourly canaries, and web bundle budgets.

## Next releases

1. Add ocean bathymetry from GEBCO and user-uploaded DEM support for inland lakes where trustworthy depth data is unavailable.
2. Add custom SVG crop boundaries, DXF export, sheet nesting, and multi-panel tabletop splitting.
3. Add frames, advanced joinery templates, bills of material, machine presets, and explicit kerf calibration projects.
4. Add optional cloud project synchronization behind a portable identity adapter.

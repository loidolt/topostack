# Roadmap

## Implemented v1 foundation

- First-class flat topographic engravings with independent contour density, heavier index contours, exact single-surface preview, optional engraved border, and an engrave-only 1:1 SVG package.
- Atomm-first static generator and export lifecycle.
- Global land-elevation tile flow with offline deterministic fallback.
- Rectangular and circular crops, 2–24 layers, configurable dimensions and material thickness.
- Contour polygon generation, feature filtering, cut/score/engrave IR, per-layer and master SVGs.
- Map, 2D, and stacked/exploded 3D previews.
- OSM PMTiles adapter for classified roads, trails, transportation labels, water, and state/province boundaries; generated latitude/longitude graticules; local IndexedDB projects; undo/redo; and project JSON import/export.
- Cloudflare Worker with R2 caching, range requests, geocoding, CORS, rate limiting, and observability.
- Editable elevation-label anchors with font-independent vector paths, material-boundary checks, and automatic collision repair.
- Optional next-layer alignment outlines and hidden registration labels for reliable physical assembly.
- Configurable glue-safe material reuse that cuts smaller non-adjacent layers from covered cavities and compacts them into fabrication panels.
- Deterministic browser generation/export tests, production release artifacts, hourly canaries, and web bundle budgets.

## Next releases

1. Add surveyed lake bathymetry (NOAA Great Lakes first) ahead of the modeled GLOBathy basins, and user-uploaded DEM support where neither has trustworthy depth. Ocean bathymetry already arrives with the Mapzen terrain tiles.
2. Add custom SVG crop boundaries, DXF export, general translated/rotated sheet nesting, and multi-panel tabletop splitting.
3. Add frames, advanced joinery templates, bills of material, machine presets, and explicit kerf calibration projects.
4. Add optional cloud project synchronization behind a portable identity adapter.

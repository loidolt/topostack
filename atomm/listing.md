# Atomm listing

- **Immutable generator slug:** `topographic-map-generator`
- **Card title:** TopoStack — Layered Terrain
- **Short description:** Turn anywhere in the world into layered, laser-ready topographic cut and engraving files.
- **Primary category:** Laser cutting
- **Secondary categories:** Engraving, 3D, Relief

## Review notes

TopoStack uses the Atomm platform export button and registers one export lifecycle hook. Download returns a multi-file fabrication package; Open in Studio returns a single master SVG. All machine-facing SVGs use millimeters at physical size and keep cut, score, and engraving operations in named groups.

The generator requests elevation, OSM-derived vector data, and proxied Geoapify place-search results from the configured TopoStack Cloudflare Worker. Search queries are hashed for a 24-hour response cache and are also processed under Geoapify's privacy terms. The interactive reference map loads OpenFreeMap tiles. No Atomm user profile or token is read or stored. Projects are saved only in the browser's IndexedDB unless the user exports `project.json`.

## Cover brief

Prepared asset: `atomm/assets/topostack-cover.png` (1672 × 941 PNG, text-free 16:9 artwork).

Landscape view of a circular, exploded stack of warm birch topographic layers over a deep forest-green background, with fine dark road engraving and subtle blue water scoring. Keep the model centered with generous safe space for Atomm's card crop. Do not add text to the image.

# TopoStack

TopoStack is an Atomm-first generator for turning real-world terrain into either stacked, laser-cut topographic projects or single-surface topographic engravings. Layered relief derives its sheet count from terrain relief, map scale, vertical exaggeration, and material thickness. Flat engraving uses an independent contour-density system and produces one physical-size, engrave-only SVG with optional roads, trails, transportation labels, water outlines with optional vector fill patterns, state/province boundaries, latitude/longitude grid lines, elevation labels, compass, scale bar, and border. Both workflows preserve millimeter fabrication coordinates internally, include project metadata and source attribution, and keep geographic map bounds independent from physical output dimensions.

See [Flat engraving](docs/flat-engraving.md) for the workflow and SVG contract.

## Workspace

- `apps/generator` — static Svelte 5/SvelteKit generator served by the Worker and loaded by Atomm.
- `packages/core` — platform-independent terrain-to-fabrication geometry engine.
- `workers/map-api` — Cloudflare Worker data gateway backed by R2.

## Local development

```bash
npm install
npm run dev
```

The root development command starts the Cloudflare map API first, waits for its health check, and then starts Vite on port 5273. It uses a local terrain cache and the provisioned remote development PMTiles bucket. Run `npm run dev:web` or `npm run dev:api` only when working on one side in isolation.

The map API listens on 8787 and the generator on 5273 — Vite's own 5173 and Wrangler's 8787 collide with nearly every other local project, so only the API keeps its conventional default. `npm run dev` probes both ports before starting anything and, when one is taken, falls forward to the next free port (scanning 20 above the default) and prints the choice. The app is always pointed at whichever API port was picked.

Pin either port with `VITE_MAP_API_PORT` and `TOPOSTACK_WEB_PORT`. A pinned port that is busy is reported as an error rather than moved, so scripted setups fail loudly:

```bash
VITE_MAP_API_PORT=8799 TOPOSTACK_WEB_PORT=5299 npm run dev
```

Both variables also apply to `npm run dev:api` and `npm run dev:web` run separately, minus the automatic fallback. `VITE_MAP_API_PORT` carries the Vite prefix because the browser bundle reads it too; set `VITE_MAP_API_URL` instead to point the local app at an already-running or deployed Worker, which overrides the port variable.

The development Worker accepts any `http://localhost`, `http://127.0.0.1`, or `http://[::1]` origin regardless of port so a relocated dev server still passes CORS. Deployed environments keep the exact `ALLOWED_ORIGINS` list in `workers/map-api/wrangler.jsonc`.

Open the Vite URL directly, or use Atomm's local preview URL:

```text
https://www.atomm.com/creativetools/community/generator/topographic-map-generator?local=http://localhost:5273/
```

The initial Crater Lake preview is a deterministic, bundled snapshot of real Mapzen elevation and Protomaps/OpenStreetMap major-road, local-road, trail, and water data. Roads default to clean continuous centerlines; major roads can instead use a configurable double-line outline, and road widths, spacing, and endpoint shape are shared by previews and fabrication SVGs. Trails use a configurable solid, dashed, or dotted pattern, while optional names and route references are placed as collision-safe vector labels. Latitude/longitude grid lines are generated locally from the selected bounds with area-sensitive 1/2/5-degree spacing, so they do not require another data download. The preview remains preview-only, so generate fresh terrain before fabrication export. Fabrication SVGs separate red cuts, blue scores, and black engravings into operation layers and include registered engraving-only panel companions. If the map-data Worker is unavailable during generation, the app falls back to synthetic terrain so geometry development can continue. Copy `workers/map-api/.dev.vars.example` to `workers/map-api/.dev.vars` and provide a Geoapify key when local place search is needed; terrain generation does not require that secret.

## Validation and packaging

```bash
npm run typecheck
npm test
npm run build
VITE_MAP_API_URL="$DEPLOYED_WORKER_URL" npm run package:atomm
```

The Atomm-ready artifact is written to `apps/generator/topostack-atomm.zip`.
Packaging fails closed when the Worker URL is missing, non-HTTPS, local, on a reserved test/placeholder domain (`.invalid`, `.test`, `.local`, `.localhost`, `example.*`), or a `*.workers.dev` preview URL; the built artifact is scanned for the same endpoint families. Deploy the production Worker and set its `GEOCODER_API_KEY` secret before creating a submission artifact.

After every successful production deployment and readiness smoke test, CI packages the production URL, generates a SHA-256 checksum, and uploads a 30-day `topostack-atomm-<commit>` workflow artifact containing the generator ZIP, checksum, cover image, and listing copy. Run `VITE_MAP_API_URL=https://topostack.loidolt.space npm run release:atomm` to reproduce the same release files locally.

## CI and deployment environments

GitHub Actions validates pull requests targeting `dev` or `main`. A successful push to `dev` deploys the `development` Cloudflare Worker; a successful push to `main` deploys `production`. Pull-request jobs never reference a GitHub environment and therefore cannot read deployment secrets.

Create two GitHub environments with selected-branch deployment rules:

- `development` — allow only the `dev` branch.
- `production` — allow only the `main` branch and require a reviewer before deployment when the repository plan supports it.

Store these secrets separately in both environments, using environment-appropriate values:

- `CLOUDFLARE_API_TOKEN` — a token restricted to the deployment account with Workers Scripts edit, Account Settings read, and Workers R2 Storage edit permissions, plus Workers Routes edit for the `loidolt.space` zone.
- `CLOUDFLARE_ACCOUNT_ID` — the target Cloudflare account ID.
- `GEOCODER_API_KEY` — the Geoapify credential synchronized to the selected Worker as an encrypted runtime secret.

The Cloudflare credentials authenticate CI but are not exposed to Worker code. Only `GEOCODER_API_KEY` is uploaded as a Worker binding. The workflow is defined in `.github/workflows/ci.yml`.

Production uses the `topostack` Worker as the origin for `https://topostack.loidolt.space`. The same deployment serves the generated frontend as static assets and the map API at `/v1/*`. Development deploys the same combined app/API shape to the `topostack-dev` Worker from the `dev` branch.

The `Production Monitor` workflow runs an hourly canary against the frontend, `/health`, `/ready`, the data manifest, and a PMTiles byte-range read. Failed scheduled runs surface through normal GitHub Actions notifications. CI also enforces gzip budgets for total JavaScript, the largest JavaScript chunk, CSS, and the entry HTML via `npm run budget:web`; adjust a limit only alongside an intentional performance review.

## Data setup

The Worker proxies Mapzen Terrarium elevation tiles, preserves their imagery-source metadata, and caches them in the `topostack-map-cache` R2 bucket under dataset-versioned keys. Roads, water, and first-level administrative boundaries come from the pinned Protomaps/OpenStreetMap PMTiles release stored as `osm/current.pmtiles` in the `topostack-vector-data` bucket, served with a short revalidating cache policy because that key is overwritten on dataset updates. The `/ready` endpoint reports whether that archive and the geocoder configuration are present. Place search is proxied to Geoapify with a Worker secret. Provisioning (`scripts/provision-vector-data.mjs`) verifies a pinned SHA-256 digest, writes the development bucket by default, and touches production only with an explicit `--prod` flag. See `workers/map-api/README.md` for provisioning and deployment details.

Terrain and map data are decorative source material, not survey, navigation, or engineering data.

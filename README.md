# TopoStack

TopoStack is an Atomm-first generator for turning real-world terrain into stacked, laser-cut topographic projects. It produces one physical-size SVG per material layer, a master file for xTool Studio, an assembly guide, project metadata, and source attribution.

## Workspace

- `apps/generator` — static Svelte 5/SvelteKit generator served by the Worker and loaded by Atomm.
- `packages/core` — platform-independent terrain-to-fabrication geometry engine.
- `workers/map-api` — Cloudflare Worker data gateway backed by R2.

## Local development

```bash
npm install
npm run dev:api
npm run dev
```

Open the Vite URL directly, or use Atomm's local preview URL:

```text
https://www.atomm.com/creativetools/community/generator/topographic-map-generator?local=http://localhost:5173/
```

The app falls back to a deterministic terrain fixture when the map-data Worker is unavailable, so UI and geometry development remain possible offline.

## Validation and packaging

```bash
npm run typecheck
npm test
npm run build
VITE_MAP_API_URL="$DEPLOYED_WORKER_URL" npm run package:atomm
```

The Atomm-ready artifact is written to `apps/generator/topostack-atomm.zip`.
Packaging fails closed when the Worker URL is missing, local, or an obvious placeholder. Deploy the production Worker and set its `GEOCODER_API_KEY` secret before creating a submission artifact.

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

## Data setup

The Worker proxies Mapzen Terrarium elevation tiles, preserves their imagery-source metadata, and caches them in the `topostack-map-cache` R2 bucket. Roads and water come from the pinned Protomaps/OpenStreetMap PMTiles release stored as `osm/current.pmtiles` in the `topostack-vector-data` bucket. The `/ready` endpoint reports whether that archive and the geocoder configuration are present. Place search is proxied to Geoapify with a Worker secret. See `workers/map-api/README.md` for provisioning and deployment details.

Terrain and map data are decorative source material, not survey, navigation, or engineering data.

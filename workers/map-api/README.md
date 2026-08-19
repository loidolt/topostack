# TopoStack map API

The Worker is deliberately a streaming data gateway, not a GIS compute service. Terrain-to-contour processing stays in the portable browser engine.

## Provision Cloudflare resources

```bash
npx wrangler r2 bucket create topostack-map-cache-development
npx wrangler r2 bucket create topostack-vector-data-development
npx wrangler r2 bucket create topostack-map-cache
npx wrangler r2 bucket create topostack-vector-data
```

TopoStack pins the Protomaps `20260819` basemap build (`4.15.2`) and extracts a global zoom 0–11 archive. The upstream archive's published BLAKE3 digest is `837084e3e47de6f3ec5708f6de116d89789520e2391d67494a99e3daeb66a862`. Build and verify the smaller archive with PMTiles CLI `1.31.2` or newer:

```bash
pmtiles extract https://build.protomaps.com/20260819.pmtiles ./current.pmtiles --maxzoom=11
pmtiles verify ./current.pmtiles
```

The result is approximately 7.9 GB, above Wrangler's 315 MB object-upload limit and R2's 5 GiB single-part limit. The provisioning script verifies the archive, mints 24-hour credentials scoped to only `osm/current.pmtiles`, performs multipart uploads to both buckets, and reads each result back. It uses the existing account-owned Cloudflare API token without storing S3 credentials:

```bash
PMTILES_BIN=/path/to/pmtiles node --env-file=.env scripts/provision-vector-data.mjs ./current.pmtiles --provision
```

The API token must allow R2 object writes and temporary-credential creation. Do not commit the token, temporary credentials, or generated archive. Keep the pinned source, maximum zoom, `DATASET_VERSION`, manifest response, and attribution synchronized when updating the data. The Protomaps archive is an ODbL Produced Work based on OpenStreetMap data.

## Develop and validate

```bash
npm run types
npm run dev
npm run typecheck
npm run build
```

Before deployment, `/ready` intentionally returns `503` unless the vector archive and geocoder secret are available. `/health` only reports that the Worker itself is running.

Local R2 bindings are simulated automatically. Development and production deployments use separate environment declarations:

```bash
npx wrangler deploy --env development
npx wrangler deploy --env production
```

Review and replace the example production origin allowlist before deployment. Place search uses Geoapify through the Worker so the browser never receives the provider key:

```bash
npx wrangler secret put GEOCODER_API_KEY --env development
npx wrangler secret put GEOCODER_API_KEY --env production
```

CI normally synchronizes this secret from the matching GitHub environment during deployment, so the interactive commands are for recovery or local administration only. Copy `.dev.vars.example` to `.dev.vars` and replace its value for local development. Review Geoapify plan limits and attribution terms before launch.

## GitHub deployment mapping

| Git branch | GitHub environment | Wrangler environment | Worker |
| --- | --- | --- | --- |
| `dev` | `development` | `development` | `topostack-dev` |
| `main` | `production` | `production` | `topostack` |

The production frontend and API are one Worker deployment at `https://topostack.loidolt.space`. Wrangler uploads `apps/generator/dist` as static assets, while `/health` and `/v1/*` run the API Worker. Atomm is allowed to call the production API cross-origin; local Vite origins are additionally allowed in development.

Configure `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GEOCODER_API_KEY` as secrets in both GitHub environments. The Cloudflare token needs Workers Scripts edit and R2 edit at the account level plus Workers Routes edit for the `loidolt.space` zone so production can manage its Custom Domain. Restrict the development environment to `dev` and production to `main`; production should also use required reviewers. Pull requests run validation without environment access or Cloudflare credentials.

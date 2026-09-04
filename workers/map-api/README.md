# TopoStack map API

The Worker is deliberately a streaming data gateway, not a GIS compute service. Terrain-to-contour processing stays in the portable browser engine.

## Provision Cloudflare resources

```bash
npx wrangler r2 bucket create topostack-map-cache-development
npx wrangler r2 bucket create topostack-vector-data-development
npx wrangler r2 bucket create topostack-map-cache
npx wrangler r2 bucket create topostack-vector-data
```

TopoStack pins the Protomaps `20260819` basemap build (`4.15.2`) and extracts a global zoom 0–12 archive so local roads and trails are available. The upstream archive's published BLAKE3 digest is `837084e3e47de6f3ec5708f6de116d89789520e2391d67494a99e3daeb66a862`. Build and verify the archive with PMTiles CLI `1.31.2` or newer:

```bash
pmtiles extract https://build.protomaps.com/20260819.pmtiles ./current.pmtiles --maxzoom=12
pmtiles verify ./current.pmtiles
```

The result is above Wrangler's 315 MB object-upload limit and R2's 5 GiB single-part limit. The provisioning script computes the extracted archive's SHA-256, verifies the archive, mints 24-hour credentials scoped to only `osm/current.pmtiles`, performs multipart uploads, and reads each result back. It uses the existing account-owned Cloudflare API token without storing S3 credentials.

The script refuses to upload unless the computed SHA-256 matches a pinned digest supplied via `--expected-sha256=<hex>` or the `EXPECTED_ARCHIVE_SHA256` environment variable. When extracting a new snapshot for the first time, run once with `--skip-digest-check`, record the printed SHA-256, and pin it here alongside the snapshot pin for all subsequent runs. By default only the development bucket is written; the production key is live client data and is only overwritten when `--prod` is passed explicitly:

```bash
# Development only (default):
PMTILES_BIN=/path/to/pmtiles EXPECTED_ARCHIVE_SHA256=<pinned-hex> \
  node --env-file=.env scripts/provision-vector-data.mjs ./current.pmtiles --provision

# Development and production:
PMTILES_BIN=/path/to/pmtiles EXPECTED_ARCHIVE_SHA256=<pinned-hex> \
  node --env-file=.env scripts/provision-vector-data.mjs ./current.pmtiles --provision --prod
```

The API token must allow R2 object writes and temporary-credential creation. Do not commit the token, temporary credentials, or generated archive. Keep the pinned source, maximum zoom, extracted-archive SHA-256, `DATASET_VERSION`, manifest response, and attribution synchronized when updating the data. The Protomaps archive is an ODbL Produced Work based on OpenStreetMap data.

Because `osm/current.pmtiles` is overwritten in place on dataset updates, the Worker serves it with a short one-hour `cache-control` and etag revalidation (`If-None-Match` returns `304`) instead of a long immutable TTL, so clients cannot mix cached byte ranges from different archive generations. Terrain tiles cache under dataset-versioned keys (`terrain/<DATASET_VERSION>/terrarium/...`) and keep a 30-day immutable TTL; bump `DATASET_VERSION` when terrain data changes.

## Develop and validate

```bash
npm run types
npm run dev
npm run typecheck
npm run build
```

`npm run dev` serves the Worker on port 8787; set `VITE_MAP_API_PORT` to use a different one. The root `npm run dev` additionally skips to the next free port when 8787 is taken. In the development environment the Worker allows any loopback origin, so a relocated generator dev server still passes CORS; deployed environments match `ALLOWED_ORIGINS` exactly.

Before deployment, `/ready` intentionally returns `503` unless the vector archive and geocoder secret are available. `/health` only reports that the Worker itself is running.

Local terrain-cache R2 storage is simulated automatically. The local development Worker reads the provisioned PMTiles archive through a remote binding to `topostack-vector-data-development`; this requires Wrangler authentication but avoids duplicating a multi-gigabyte archive on every workstation. Development and production deployments use separate environment declarations:

```bash
npx wrangler deploy --env development
npx wrangler deploy --env production
```

The top-level (no `--env`) configuration binds the `-development` buckets so a bare `wrangler deploy` can never write into production storage; those development buckets must exist (see the provisioning commands above). Deployments should always pass an explicit `--env`. The `--env=""` dry-run used by `npm run build` continues to work against the top-level configuration.

Review and replace the example production origin allowlist before deployment. Cross-origin access is controlled by two vars: `ALLOWED_ORIGINS` (exact-match list) and `ALLOWED_ORIGIN_SUFFIXES` (comma-separated HTTPS host suffixes, default `.atomm.com`). Set `ALLOWED_ORIGIN_SUFFIXES` to an empty string to revoke suffix-based origins without a code change. Place search uses Geoapify through the Worker so the browser never receives the provider key:

```bash
npx wrangler secret put GEOCODER_API_KEY --env development
npx wrangler secret put GEOCODER_API_KEY --env production
```

CI normally synchronizes this secret from the matching GitHub environment during deployment, so the interactive commands are for recovery or local administration only. Copy `.dev.vars.example` to `.dev.vars` and replace its value for local development. Review Geoapify plan limits and attribution terms before launch.

## GitHub deployment mapping

| Git branch | GitHub environment | Wrangler environment | Worker | Public URL | Map cache | Vector data |
| --- | --- | --- | --- | --- | --- | --- |
| `dev` | `development` | `development` | `topostack-dev` | `https://dev-topostack.echofoxtrot.works` | `topostack-map-cache-development` | `topostack-vector-data-development` |
| `main` | `production` | `production` | `topostack` | `https://topostack.echofoxtrot.works` | `topostack-map-cache` | `topostack-vector-data` |

The development frontend and API are deployed at `https://dev-topostack.echofoxtrot.works`; production remains at `https://topostack.echofoxtrot.works`. Wrangler uploads `apps/generator/dist` as static assets, while `/health` and `/v1/*` run the API Worker. Atomm is allowed to call the production API cross-origin; local Vite origins are additionally allowed in development.

Configure `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GEOCODER_API_KEY` as secrets in both GitHub environments. The Cloudflare token needs Workers Scripts edit and R2 edit at the account level plus Workers Routes edit for the `echofoxtrot.works` zone so both environments can manage their Custom Domains. Restrict the development environment to `dev` and production to `main`; production should also use required reviewers. Pull requests run validation without environment access or Cloudflare credentials.

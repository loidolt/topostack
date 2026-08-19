# TopoStack map API

The Worker is deliberately a streaming data gateway, not a GIS compute service. Terrain-to-contour processing stays in the portable browser engine.

## Provision Cloudflare resources

```bash
npx wrangler r2 bucket create topostack-map-cache-development
npx wrangler r2 bucket create topostack-vector-data-development
npx wrangler r2 bucket create topostack-map-cache
npx wrangler r2 bucket create topostack-vector-data
```

Upload an OSM-derived PMTiles planet or regional archive to `osm/current.pmtiles` in each environment's vector bucket:

```bash
npx wrangler r2 object put topostack-vector-data-development/osm/current.pmtiles --file ./current.pmtiles --content-type application/vnd.pmtiles --remote
npx wrangler r2 object put topostack-vector-data/osm/current.pmtiles --file ./current.pmtiles --content-type application/vnd.pmtiles --remote
```

Use an archive whose source and build process comply with ODbL. Keep the source version and required notices synchronized with `DATASET_VERSION` and the manifest response.

## Develop and validate

```bash
npm run types
npm run dev
npm run typecheck
npm run build
```

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

The production frontend is served from `https://topostack.loidolt.space`. That origin and Atomm are allowed to call the production Worker; local Vite origins are additionally allowed in development.

Configure `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GEOCODER_API_KEY` as secrets in both GitHub environments. Restrict the development environment to `dev` and production to `main`; production should also use required reviewers. Pull requests run validation without environment access or Cloudflare credentials.

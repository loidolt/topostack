# Release acceptance and rollback

Use one candidate commit and retain its CI run, Atomm ZIP, checksum, `topostack-atomm.release.json`, and both archive provisioning receipts. A receipt with `workingTreeDirty: true` is local diagnostic evidence; build the published release from a clean commit. Record the intended Worker version ID and deployed frontend revision with the release.

## Automated acceptance

1. Run the Node 22 CI jobs, including the full dependency audit, lint, type checks, coverage, production build, generated Worker types, size budgets, and Chromium/Firefox/WebKit tests.
2. Run the API smoke test and live browser export canary against the candidate deployment. Confirm both archives are present. Inspect retained browser traces and the downloaded master SVG when a canary fails.
3. Exercise mountainous, coastal, low-relief, circular, antimeridian, and dense-water selections in both output modes. Check cancellation during source discovery and successful regeneration after a one-time archive outage.
4. Measure a cold start with a modest mobile CPU/network profile. The startup byte budget includes the default 3D engine and geometry worker; it is not a timing guarantee.

## Platform and physical acceptance

Load the candidate ZIP inside the real Atomm host. Exercise download and Open in Studio, including delayed SDK loading, both output modes, and cross-origin archive requests. Mocked SDK tests do not prove the host's interpretation of exported files.

Import representative files in the intended xTool Studio version. Verify dimensions and units, cut/score/engrave operations, white marker knockout interpretation, shared nested cuts, material connectivity, kerf, and assembly order. Fabricate and measure a small representative test piece before approving larger work.

## Operational acceptance

Confirm configured secrets, provider quotas, GitHub environment protections, notification recipients, and the `geocode/` R2 cleanup rule. Use response-status/cache-outcome logs to alert on uncached provider failures, as well as the scheduled serving-path canaries. Confirm how client-side failure reports reach an operator; the browser monitor captures console errors/traces, but it is not comprehensive production client telemetry.

## Rollback rehearsal

1. Keep the previous release ZIP, clean source commit, Worker version ID, source dataset archives, and SHA-256 provisioning receipts available before replacing a release. Do not rely on mutable `current.pmtiles` keys as backups.
2. Restore the previous frontend/Worker candidate in development using the normal deployment pipeline. If data changed, re-provision the retained vector and lake archives with their exact pinned digests into development first. The provisioning scripts verify each digest before upload and emit a new receipt afterward.
3. Run API readiness, archive range checks, and live generation/download against that restored combination. Compare dataset versions and archive identities with the retained release receipt.
4. After the development rehearsal passes, use the existing protected production deployment process for the chosen rollback commit. Restore data through the explicit production provisioning path only if the compatible dataset differs. The current scripts update development and production when `--prod` is used; account for that behavior in the release window.
5. Repeat production smoke and browser checks, record the resulting Worker/archive identities, and retain the rollback evidence. Archive keys use a one-hour cache lifetime, so verify that ETag revalidation and new generation operations see the restored data before declaring recovery.

This runbook does not establish that account settings, host integration, or physical fabrication have already been accepted. Record the operator, date, candidate, and result of each manual check with the release.

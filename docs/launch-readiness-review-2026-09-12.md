# TopoStack launch readiness review

> Historical review snapshot. See [the remediation notes](launch-readiness-remediation-2026-09-12.md) for implemented fixes and current validation.

Reviewed September 12, 2026. **Recommendation: hold the public launch until the P1 findings and the fabrication correctness findings below are resolved.** The ordinary generation path works, and the project has useful safety checks and substantial test coverage. However, the current release gates fail, and targeted tests exposed incorrect output and failure recovery behavior that the existing suites do not cover.

This review covers the working tree based on commit `3ce55f72f860f673c4270bb3280b12d420376c50`, including the substantial uncommitted changes already present. It covers the Svelte application, data providers, core geometry and SVG generation, Cloudflare gateway, storage, Atomm bridge, tests, dependency advisories, provisioning scripts, release scripts, CI, and operational documentation. Application code was not changed. Temporary component tests were removed; normal ignored build, coverage, browser diagnostic, and packaging outputs were generated.

P1 means a release blocker or a serious reliability issue requiring prompt correction. P2 means a concrete functional or reliability defect. P3 means a lower-impact robustness issue. There are **14 findings: 3 P1, 10 P2, and 1 P3**. Some additional validation gaps and maintenance recommendations follow separately.

## Verification results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| ESLint | Passed | `npm run lint`, zero warnings allowed. |
| Type checks | Passed | All three workspaces; Svelte reported zero errors and warnings. |
| Unit/component tests and coverage | Passed | 166 tests: 71 core, 44 frontend helper, 26 component, 25 Worker. All configured thresholds passed. |
| Core coverage | Passed | 97.29% lines; 81.60% branches. |
| Frontend helper coverage | Passed | 68.61% lines; 58.43% branches. |
| Component coverage | Passed | Aggregate 56.16% lines / 44.42% branches; App.svelte itself 86.08% lines. The aggregate includes mocked provider/storage modules. |
| Worker coverage | Passed | 95.63% lines; 79.38% branches. |
| Production build | Passed | Core compilation, static frontend, Worker deployment dry run. No deployment performed. |
| Generated Worker types | Passed | `npm run types:check -w @topostack/map-api`. |
| Web size budgets | Passed | Initial JS 158,533 bytes gzip; total JS 630,860; largest chunk 270,134; CSS 24,254; HTML 2,143 bytes. These are the script's measurements, not measured page-load timings. |
| Static artifact validation | Passed | CI artifact scan with its documented endpoint-scan exception; full scan also passed during production packaging. |
| Atomm release packaging | Passed | Built with the configured production URL; ZIP and SHA-256 generated. Packaging success does not establish platform acceptance. |
| Production dependency audit | **Failed** | One critical MapLibre advisory. |
| Full dependency audit | **Failed** | Five affected package entries: one critical and four high. The four high entries share the sharp → Miniflare → Wrangler/test-pool dependency chain. |
| Unmodified browser suite | **Failed / partly unverified** | Six passed. Chromium and WebKit generation tests failed on the stale layer-count assertion. Four Firefox tests could not start because the local browser launch failed. |
| Diagnostic export test | Passed | A temporary copy with only `of 10` changed to `of 13` passed the complete generation/ZIP checks in Chromium and WebKit. The repository test was not edited. |
| Public production smoke test | Passed | Frontend headers, health/readiness, terrain, geocoder, manifest, and archive header checks. |
| Public production browser canary | Passed | Chromium generated an export-ready real project in approximately ten seconds. This verifies the currently deployed service, whose code was not proven identical to the dirty working tree. |
| Targeted regressions | Defects reproduced | Retry poisoning, cancellation, label activation, boundary continuity, circular crops, lake resizing, concave containment, map guide mismatch, and unavailable WebGL. |

Local commands used Node 26.5.0 and npm 11.17.0. CI specifies Node 22; this review did not repeat the whole matrix on that runtime. Firefox launch failed after 180 seconds with a graphics framebuffer error and macOS sandbox-extension error, before application tests ran. That result is an environment limitation, not evidence of a Firefox application defect.

## Findings

### 1. [P1] Upgrade the vulnerable MapLibre dependency

**Location:** [apps/generator/package.json:23](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/package.json:23), [MapCanvas.svelte:92](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/MapCanvas.svelte:92).

The lockfile installs MapLibre GL JS 5.24.0, affected by CVE-2026-85061 / GHSA-jrc7-96c5-q579. Its attribution sanitizer can leave dangerous attributes in third-party HTML. TopoStack loads an external OpenFreeMap style and enables the attribution control, so it uses the affected path. Exploitability depends on the supplied attribution and the embedding host's CSP; this review did not demonstrate execution against production. The concrete release impact is independently confirmed: `npm audit --omit=dev --audit-level=moderate`, required by CI, exits unsuccessfully.

Upgrade to a patched version, validate any major-version migration, regenerate the lockfile, and rerun map interaction and attribution tests. The first patched version documented by the maintainer is 6.4.1. [Maintainer advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579).

### 2. [P1] Repair the deterministic browser release gate

**Location:** [e2e/generation.spec.ts:19](/Users/chrisloidolt/Documents/GitHub/topostack/e2e/generation.spec.ts:19).

The generation/export test requires a bundled preview containing ten layers. The current preview contains thirteen; both Chromium and WebKit fail before reaching generation or export. CI makes deployment depend on this job, so the working tree cannot pass its configured release pipeline.

The component test already expects thirteen. Update the expectation consistently, or assert a fixture-derived invariant if the exact count is not the behavior under test. In a temporary copy, changing only this assertion allowed the rest of the generation and ZIP-export scenario to pass in both browsers.

### 3. [P1] Enforce the tile budget before allocating the tile array

**Location:** [data-provider.ts:78](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:78).

`tileWindow()` constructs every intersecting tile object before checking the 24-tile limit. `fittingTileWindow()` can reduce the zoom only after that construction finishes. Valid imported projects may combine very broad bounds with a high stored zoom, making the initial allocation enormous and blocking the main thread before network requests or cancellation can help. A near-world selection at zoom 15 entails roughly one billion candidates.

A safely instrumented execution of the actual function reached 100 allocations despite the 24-tile budget; the probe deliberately stopped there. Compute `(maxWorldX - minWorldX + 1) * (maxY - minY + 1)` first and reject/downshift before allocating or iterating. Add a broad-bounds/high-zoom regression that verifies bounded work, not just the resulting zoom.

### 4. [P2] Fit the map crop guide to the authoritative geographic bounds

**Location:** [MapCanvas.svelte:91](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/MapCanvas.svelte:91), [MapCanvas.svelte:152](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/MapCanvas.svelte:152).

Opening Map restores the camera center and zoom, but it does not fit the saved geographic bounds to the crop guide. The guide's geographic coverage depends on responsive pixel dimensions, while generation continues using the stored bounds. Matching aspect ratio does not fix the different scale. Switching back to Map can therefore show a different selection from the one that will be fabricated.

Reproduction: generate the default project, then open Map at a 1440×1000 viewport. The project retains a longitude span of **0.288391°**, while the 622.078-pixel guide at MapLibre zoom 11 spans **0.213574°**. The status remains ready and export remains associated with the larger stored area. The map style was replaced with an empty local fixture for this measurement; camera and crop logic were unchanged.

Fit the camera to the stored bounds and actual guide rectangle on mount and resize, or render the bounds as a projected geographic overlay. Ensure circles use the same crop transformation as the geometry engine. Test opening, resizing, and reopening Map without user panning.

### 5. [P2] Recover from cached PMTiles header failures

**Location:** [data-provider.ts:27](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:27), [data-provider.ts:519](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:519).

The vector and lake archives are module-level PMTiles instances. In the installed PMTiles implementation, the shared header cache retains a rejected header promise. If the first header request receives a transient error, later Generate attempts reuse that rejected promise. The UI advises regeneration after service restoration, but that action makes no new header request; reloading the page is required.

An actual-library reproduction made two sequential `getHeader()` calls against a source that failed on its first request. Both returned the first failure and the source call count stayed at **one**. Evict/reset failed header entries or recreate the affected archive safely on retry. Cover both the vector and lake archives with a fail-once/succeed-next test.

### 6. [P2] Make archive discovery and reads time out and cancel promptly

**Location:** [data-provider.ts:519](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:519), [data-provider.ts:630](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:630), [App.svelte:739](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/App.svelte:739).

Both archive loaders await `getHeader()` before checking the caller's abort signal. PMTiles header fetching receives no user signal or deadline here. Tile reads receive the caller signal, but no equivalent of the 20-second deadline used for terrain and geocoding. A stalled header leaves `loadTerrain()`'s `Promise.all` pending, and the Cancel button cannot promptly settle generation during that phase.

A probe using the actual loader function and a pending header promise stayed pending after its controller was aborted. Implement a deadline-aware PMTiles Source or equivalent request abstraction, race caller cancellation appropriately, and avoid preserving failed shared promises. Test cancellation during header fetch, directory fetch, and tile body fetch—not only terrain fetch and geometry computation.

### 7. [P2] Load transportation names when labels are enabled after generation

**Location:** [App.svelte:648](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/App.svelte:648), [data-provider.ts:583](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/data-provider.ts:583).

Vector loading discards road names unless `showTransportationLabels` is enabled. That setting defaults to false. Enabling it after a real generation does not invalidate vector data because `changesVectorDetails` excludes this setting. Existing vectors remain marked available, so the app reports updated details and permits export while transportation labels remain absent.

A temporary component regression generated real-status road data without names, configured a vector reload that would supply a name, and enabled the switch. It confirmed **zero vector reloads and zero labels**. The existing label-switch test uses the bundled preview, which already retains names and therefore misses this path.

Retain names during initial decoding, or include label enablement in vector invalidation. Add a test starting from a real generation performed with labels disabled.

### 8. [P2] Preserve boundaries across every elevation transition

**Location:** [geometry.ts:915](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:915), [geometry.ts:579](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:579).

State/province boundaries and custom boundary paths use `splitMarking()`, which assigns runs from elevations sampled only at existing vertices. A two-point segment crossing several elevation bands is assigned to the endpoint's layer and then clipped there. Intermediate and lower portions disappear. The road and open-waterway paths already avoid this by clipping complete paths against exposed material on each layer.

Reproduction: a 300 mm-wide monotonic elevation ramp produces nine layers. A boundary from x=-149 to x=149 retains only x=116.667 to x=149 on the highest layer—about **11% of its length**. The identical road retains contiguous pieces across all nine layers. Export is not blocked by this missing detail.

Route boundary and grid linework through the same complete-path/exposed-face clipping approach. Assert continuity and total visible length across multiple bands for both provider and custom boundaries.

### 9. [P2] Derive circular crop elevation ranges from the material inside the circle

**Location:** [geometry.ts:703](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:703), [geometry.ts:779](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:779).

Stack planning computes the elevation range across the full rectangular raster before clipping contours to the circular material. A high point in a corner outside the circle can consume the layer budget, producing empty upper layers and blocking export even though the retained circle contains valid terrain. Flat engraving also spends its contour thresholds on that irrelevant range.

Reproduction: a 32×32 grid with a 1000 m peak confined to the upper-left 5×5 corner, and approximately 0–10 m terrain elsewhere, generated **18 layers with 17 empty** for a 300 mm circular crop. Packaging then refused export. Those corner peaks are outside the selected circle.

Mask the intended material crop before computing relief and contour thresholds, while retaining interpolation support at its edge. Test extrema exclusively outside the crop, including circles and custom aspect ratios.

### 10. [P2] Keep modeled lake depths independent of physical output stretching

**Location:** [water.ts:217](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/water.ts:217).

The depth model derives north/south ground spacing from `config.heightMm / config.widthMm`. TopoStack allows those dimensions to change independently of geographic bounds, so the physical aspect ratio is not a reliable geographic aspect ratio. Resizing the output height changes the modeled underwater elevations, even when the source grid, geographic area, and lake metadata are unchanged.

Reproduction: using the same flat source grid and corresponding rescaled lake polygon, changing physical height from 300 to 150 mm changed the modeled center bed from **25.714 m to 57.143 m**. Only physical presentation changed; the waterline stayed 100 m.

Derive ground spacing from source geographic bounds/projection. Physical resizing should transform coordinates without altering source elevations or the geographic depth field. Add an invariant test for nonuniform physical resizing.

### 11. [P2] Reject concave boundary crossings when containment margin is zero

**Location:** [geometry2d.ts:147](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry2d.ts:147).

`ringFitsInsidePolygon()` rejects edge proximity only when distance is less than `marginMm - 1e-7`. At the zero margin used by transportation and elevation label placement, that threshold is negative, so even intersecting edges are accepted by this check. Checking vertices and edge midpoints does not prove containment in a concave polygon.

Reproduction: a square label footprint from (-5,-5) to (5,5) was accepted inside a larger square with a narrow top notch spanning x=-3 to -2 and reaching y=0. The footprint's upper edge crosses that notch, but all its corners and midpoints miss it. This can place vector label strokes over missing material.

Reject actual edge crossings independently of the clearance-distance rule, or use polygon difference/containment. Add a zero-margin regression with a narrow concavity located between sampled points. Positive glue-margin nesting is not the demonstrated failure here.

### 12. [P2] Fall back when WebGL context creation fails

**Location:** [ThreePreview.svelte:108](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/ThreePreview.svelte:108), [App.svelte:180](/Users/chrisloidolt/Documents/GitHub/topostack/apps/generator/src/app/App.svelte:180).

The default view constructs `THREE.WebGLRenderer` without handling context-creation failure. The parent's fallback catches a failed dynamic import, but not an exception during component mounting. Context-loss handlers apply only after a renderer exists.

In a browser with WebGL context creation intentionally unavailable, startup emitted **“Error creating WebGL context.”** and left the default preview without a canvas or a useful failure explanation. Switch automatically to the 2D preview or expose a recoverable state from the component. Cover denied/unsupported WebGL separately from context loss and restoration.

### 13. [P2] Enforce geocoder cache freshness in R2

**Location:** [workers/map-api/src/index.ts:291](/Users/chrisloidolt/Documents/GitHub/topostack/workers/map-api/src/index.ts:291), [workers/map-api/src/index.ts:324](/Users/chrisloidolt/Documents/GitHub/topostack/workers/map-api/src/index.ts:324).

The documented 24-hour geocoder cache is only a `Cache-Control` value. Cache reads accept any stored object without checking its upload time or a saved expiry. R2 HTTP metadata does not expire objects, so the application can continue serving an old or empty geocoder result indefinitely while issuing a fresh 24-hour browser cache lifetime on each response. No corresponding lifecycle rule is established in the repository; account-level lifecycle settings were not inspected.

Check age on read and refresh stale entries. Use an explicit R2 lifecycle policy for storage cleanup, with the application controlling freshness. Test a cached response older than 24 hours. Cloudflare documents [HTTP metadata](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#http-metadata) separately from [object lifecycle deletion](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### 14. [P3] Fit or omit fixed-size annotations on small outputs

**Location:** [geometry.ts:950](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:950), [geometry.ts:1184](/Users/chrisloidolt/Documents/GitHub/topostack/packages/core/src/geometry.ts:1184).

Validation accepts any positive physical dimensions, but scale-bar offsets, tick heights, and the compass minimum size assume considerably more material. A valid 10×10 mm engraving places the scale label at y=10 and tick endpoints at y=6.7, outside the artwork's y=-5…5 range. The compass minimum can also exceed available material. The SVG viewport then clips these markings, or an importing tool may include their out-of-bounds geometry.

Either enforce a supported minimum size tied to enabled annotations or measure, relocate, scale, and omit annotations when they cannot fit. Emit an explicit omission warning. This is lower priority than the normal-size fabrication defects above.

## Code quality and maintainability

The separation between browser orchestration, a platform-independent geometry package, and a small data gateway is sound. Strict TypeScript, input validation, operation-specific SVG groups, source-quality and fingerprint export checks, and separate deployment environments provide useful safeguards. The Worker bounds upstream bodies, uses deadlines for its external providers, streams archive ranges, applies rate limits, and avoids shipping geocoder secrets to the browser. Existing tests exercise meaningful cases such as kerf compensation, nesting, provider failures, stale exports, and water modeling. The credential-pattern scan found no matching files; only example environment files were tracked. This was a lightweight scan, not a complete repository-history secret audit.

The largest maintenance risk is duplicated behavior across stages. `App.svelte` combines state/history, persistence, network invalidation, worker lifecycle, exports, and a large settings UI. The approximately 1,240-line geometry module and 808-line provider module also contain several independent responsibilities. Refactor incrementally around behavior: source requirements and cache invalidation, generation job ownership, feature clipping, and export eligibility. Avoid a broad rewrite before launch.

Concrete cleanup opportunities:

- Share export eligibility between `export-policy.ts` and the core package builders so the UI and both export routes cannot diverge.
- Centralize source requirements, including which settings require names, water polygons, lake metadata, and fresh simplification. Finding 7 is an existing consequence of scattered invalidation rules.
- Share geometric clipping and preview/export line styling where practical. Similar implementations are currently repeated in geometry, water patterns, SVG, and preview components.
- Split tests by domain. The large core and component test files make omissions such as provider-loaded labels and sparse boundaries harder to see.
- Correct documentation drift: architecture describes an older fingerprint prefix; missing-lake behavior is described as harmless fallback despite default export requiring depth data; geocoder freshness is overstated.

These structural changes should accompany focused regression fixes, with behavior-preserving refactoring kept separate from changed fabrication semantics.

## Reliability, performance, and operational gaps

The following are risks or missing evidence, not additional confirmed production incidents:

- **Development dependency advisories:** the full audit flags a high-severity sharp/libheif issue through Miniflare, Wrangler, and the Worker test pool. Upgrade the compatible tooling chain and review its actual image-decoding exposure. Do not blindly apply npm's suggested downgrade of the Worker test pool. [sharp maintainer advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).
- **Initial performance:** the size budget measures modulepreload links. The default view immediately loads Three.js, and startup computes the bundled preview geometry synchronously. A passing 158 KB initial-JS budget is not proof of a fast usable first render. Measure cold startup on a modest mobile device or equivalent CPU/network profile.
- **Main-thread data processing:** vector decoding, polygon dissolution, and lake metadata preparation run before the geometry Worker. Linework counts are bounded, but polygon vertex complexity and water-area processing deserve representative dense-lake/coastline profiling.
- **Readiness policy:** `/ready` allows missing lake data, while default projects enable water depth and block export without it. Decide whether readiness means basic availability or successful default generation, and make monitoring and operator guidance explicit.
- **Provider monitoring:** fixed terrain/geocoder canary requests can be served from R2 cache. Passing them verifies the serving path but does not establish that uncached upstream requests currently work. Add a controlled upstream freshness check or monitor cache-miss failure rates.
- **Dataset updates and rollback:** the archives use mutable `current.pmtiles` keys. Short TTLs and ETag handling help, but the repo does not prove rollback of Worker, frontend, vector data, and lake data as one compatible release. Record dataset digests and rehearse a rollback, or move to immutable dataset keys referenced by a release manifest.
- **Production diagnostics:** structured Worker logging is present. Browser module/renderer failures largely reach console or status text; confirm how launch operators learn about client failures. The daily browser monitor does not upload its retained diagnostics in the workflow.
- **Scope of browser coverage:** local E2E substitutes synthetic data marked real; component tests mock the provider and 3D component. The live canary covers one default project in Chromium and checks export readiness, not downloading or inspecting the real result. These layers explain why good aggregate coverage did not catch several findings.

## Evidence still needed for launch acceptance

After the fixes, run the normal CI matrix from the exact release commit, including Firefox in a working environment. Add targeted regressions for the findings, then exercise real coastal, mountainous, low-relief, circular, antimeridian, and dense-water selections in both output modes. Verify cancellation and successful recovery from a one-time archive outage.

The real Atomm iframe lifecycle and both platform export intents were not exercised against the host application. Validate the packaged ZIP there, including cross-origin archive requests, delayed SDK initialization, download, and Open in Studio. Standalone browser downloads and mocked bridge tests are not sufficient evidence for that boundary.

Finally, import representative exported files into the intended xTool Studio workflow and perform a measured test fabrication. Confirm physical dimensions, operation mapping, kerf, shared nested cuts, material connectivity, and whether white marker knockout shapes behave as intended for vector engraving. This review inspected those code paths but did not operate a cutter or prove the receiving application's interpretation of every SVG feature. GitHub environment protection, deployed secrets, account-level storage lifecycle rules, provider quotas, and rollback permissions also remain operator-level checks.

The recommended repair order is: restore the dependency/browser release gates and bounded tile planning; fix map selection and fabrication correctness; fix source recovery and label invalidation; complete host-platform and fabrication acceptance checks on the exact candidate release.

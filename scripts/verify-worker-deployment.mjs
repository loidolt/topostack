const deploymentTarget = process.env.WORKER_URL;
const publicAppUrl = process.env.PUBLIC_APP_URL ?? deploymentTarget;
const expectedEnvironment = process.env.EXPECTED_WORKER_ENVIRONMENT;
const retryDelayMs = 3_000;
const verificationTimeoutMs = 180_000;

if (!deploymentTarget) throw new Error("WORKER_URL was not returned by the deployment action.");
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL was not configured and no deployment URL is available.");
if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) throw new Error("EXPECTED_WORKER_ENVIRONMENT must be development or production.");

const deploymentBase = new URL(deploymentTarget);
const publicBase = new URL(publicAppUrl);
if ([deploymentBase, publicBase].some((url) => url.protocol !== "https:" || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)) throw new Error("Deployment and public app URLs must be HTTPS origins without credentials, paths, queries, or fragments.");

async function fetchWithRetry(base, path, init) {
  let lastError;
  const deadline = Date.now() + verificationTimeoutMs;
  let attempt = 0;
  do {
    attempt += 1;
    try {
      const response = await fetch(new URL(path, base), {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const error = new Error(`${path} returned HTTP ${response.status}`);
        // Only transient statuses are worth retrying; a 404/403/4xx is a
        // deterministic deployment problem and should fail immediately.
        error.retryable = response.status >= 500 || response.status === 429;
        throw error;
      }
      return response;
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (Date.now() + retryDelayMs >= deadline) break;
      console.warn(`Deployment verification attempt ${attempt} for ${path} failed; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

async function fetchJson(base, path) {
  return await (await fetchWithRetry(base, path, { headers: { accept: "application/json" } })).json();
}

const deploymentHealth = await fetchJson(deploymentBase, "/health");
if (deploymentHealth?.service !== "topostack-map-api" || deploymentHealth?.status !== "ok" || deploymentHealth?.environment !== expectedEnvironment) throw new Error(`Unexpected deployment-target health response: ${JSON.stringify(deploymentHealth)}`);

const appResponse = await fetchWithRetry(publicBase, "/", { headers: { accept: "text/html" } });
const contentType = appResponse.headers.get("content-type") ?? "";
const appHtml = await appResponse.text();
// Structural markers from apps/generator/src/app.html rather than marketing
// copy: the SvelteKit body attribute and the Atomm platform SDK script survive
// copy edits, and the built entry page has no <title> element to match on.
if (!contentType.includes("text/html") || !appHtml.includes("data-sveltekit-preload-data") || !appHtml.includes("static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js")) {
  throw new Error("The public deployment did not return the TopoStack frontend.");
}
if (!appResponse.headers.get("content-security-policy")?.includes("default-src 'self'")
  || appResponse.headers.get("x-content-type-options") !== "nosniff"
  || !appResponse.headers.get("strict-transport-security")?.includes("max-age=31536000")) {
  throw new Error("The public frontend is missing required browser security headers.");
}

const health = await fetchJson(publicBase, "/health");
if (health?.service !== "topostack-map-api" || health?.status !== "ok" || health?.environment !== expectedEnvironment) throw new Error(`Unexpected Worker health response: ${JSON.stringify(health)}`);

const readiness = await fetchJson(publicBase, "/ready");
if (readiness?.service !== "topostack-map-api" || readiness?.status !== "ready" || readiness?.environment !== expectedEnvironment || readiness?.dependencies?.geocoder?.status !== "configured" || readiness?.dependencies?.vectorData?.status !== "available" || readiness?.dependencies?.lakeData?.status !== "available") {
  throw new Error(`Unexpected Worker readiness response: ${JSON.stringify(readiness)}`);
}

const terrainResponse = await fetchWithRetry(publicBase, "/v1/terrain/0/0/0.png", { headers: { accept: "image/png" } });
if (!terrainResponse.headers.get("content-type")?.includes("image/png") || !terrainResponse.headers.get("x-topostack-dataset")) {
  throw new Error("The terrain proxy returned invalid metadata.");
}
const terrainHeader = new Uint8Array((await terrainResponse.arrayBuffer()).slice(0, 8));
if (!terrainHeader.every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
  throw new Error("The terrain proxy did not return a PNG tile.");
}

const geocoder = await fetchJson(publicBase, "/v1/geocode?q=Crater%20Lake&limit=1");
if (!Array.isArray(geocoder) || geocoder.length < 1 || typeof geocoder[0]?.display_name !== "string"
  || !Number.isFinite(geocoder[0]?.lat) || !Number.isFinite(geocoder[0]?.lon)) {
  throw new Error(`The geocoder returned an invalid canary response: ${JSON.stringify(geocoder)}`);
}

const vectorResponse = await fetchWithRetry(publicBase, "/v1/osm.pmtiles", { headers: { range: "bytes=0-126" } });
if (vectorResponse.status !== 206 || !vectorResponse.headers.get("content-range")?.startsWith("bytes 0-126/")) throw new Error("The vector archive did not honor a PMTiles header range request.");
const vectorHeader = new Uint8Array(await vectorResponse.arrayBuffer());
if (new TextDecoder().decode(vectorHeader.subarray(0, 7)) !== "PMTiles" || vectorHeader[7] !== 3) throw new Error("The vector archive did not return a PMTiles v3 header.");
if (vectorHeader[101] !== 12) throw new Error("The deployed vector archive has max zoom " + String(vectorHeader[101] ?? "unknown") + "; expected 12.");

if (readiness?.dependencies?.lakeData?.status === "available") {
  const lakeResponse = await fetchWithRetry(publicBase, "/v1/lakes.pmtiles", { headers: { range: "bytes=0-126" } });
  const lakeHeader = new Uint8Array(await lakeResponse.arrayBuffer());
  if (lakeResponse.status !== 206 || new TextDecoder().decode(lakeHeader.subarray(0, 7)) !== "PMTiles" || lakeHeader[7] !== 3) {
    throw new Error("The lake archive did not return a PMTiles v3 header range.");
  }
}

const manifest = await fetchJson(publicBase, "/v1/manifest");
if (manifest?.schemaVersion !== 1 || manifest?.coverage?.vectorMaxZoom !== 12 || typeof manifest?.datasetVersion !== "string" || !Array.isArray(manifest?.sources)) throw new Error("The deployed Worker returned an invalid data manifest.");

console.log(`Verified ${expectedEnvironment} TopoStack app and API at ${publicBase.origin} (deployment ${deploymentTarget})`);

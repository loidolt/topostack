const deploymentTarget = process.env.WORKER_URL;
const publicAppUrl = process.env.PUBLIC_APP_URL ?? deploymentTarget;
const expectedEnvironment = process.env.EXPECTED_WORKER_ENVIRONMENT;
const retryDelayMs = 3_000;
const verificationTimeoutMs = 180_000;

if (!deploymentTarget) throw new Error("WORKER_URL was not returned by the deployment action.");
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL was not configured and no deployment URL is available.");
if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) throw new Error("EXPECTED_WORKER_ENVIRONMENT must be development or production.");

const publicBase = new URL(publicAppUrl);
if (publicBase.protocol !== "https:") throw new Error("The public app URL must use HTTPS.");

async function fetchWithRetry(path, init) {
  let lastError;
  const deadline = Date.now() + verificationTimeoutMs;
  let attempt = 0;
  do {
    attempt += 1;
    try {
      const response = await fetch(new URL(path, publicBase), {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (Date.now() + retryDelayMs >= deadline) break;
      console.warn(`Deployment verification attempt ${attempt} for ${path} failed; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

async function fetchJson(path) {
  return await (await fetchWithRetry(path, { headers: { accept: "application/json" } })).json();
}

const appResponse = await fetchWithRetry("/", { headers: { accept: "text/html" } });
const contentType = appResponse.headers.get("content-type") ?? "";
const appHtml = await appResponse.text();
if (!contentType.includes("text/html") || !appHtml.includes("Turn real-world terrain into layered, laser-ready topographic projects.")) {
  throw new Error("The public deployment did not return the TopoStack frontend.");
}

const health = await fetchJson("/health");
if (health?.service !== "topostack-map-api" || health?.status !== "ok" || health?.environment !== expectedEnvironment) throw new Error(`Unexpected Worker health response: ${JSON.stringify(health)}`);

const readiness = await fetchJson("/ready");
if (readiness?.service !== "topostack-map-api" || readiness?.status !== "ready" || readiness?.environment !== expectedEnvironment || readiness?.dependencies?.geocoder?.status !== "configured" || readiness?.dependencies?.vectorData?.status !== "available") {
  throw new Error(`Unexpected Worker readiness response: ${JSON.stringify(readiness)}`);
}

const vectorResponse = await fetchWithRetry("/v1/osm.pmtiles", { headers: { range: "bytes=0-126" } });
if (vectorResponse.status !== 206 || !vectorResponse.headers.get("content-range")?.startsWith("bytes 0-126/")) throw new Error("The vector archive did not honor a PMTiles header range request.");
const vectorHeader = new Uint8Array(await vectorResponse.arrayBuffer());
if (new TextDecoder().decode(vectorHeader.subarray(0, 7)) !== "PMTiles" || vectorHeader[7] !== 3) throw new Error("The vector archive did not return a PMTiles v3 header.");

const manifest = await fetchJson("/v1/manifest");
if (manifest?.schemaVersion !== 1 || typeof manifest?.datasetVersion !== "string" || !Array.isArray(manifest?.sources)) throw new Error("The deployed Worker returned an invalid data manifest.");

console.log(`Verified ${expectedEnvironment} TopoStack app and API at ${publicBase.origin} (deployment ${deploymentTarget})`);

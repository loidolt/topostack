const workerUrl = process.env.WORKER_URL;
const publicAppUrl = process.env.PUBLIC_APP_URL ?? workerUrl;
const expectedEnvironment = process.env.EXPECTED_WORKER_ENVIRONMENT;
const retryDelayMs = 3_000;
const verificationTimeoutMs = 180_000;

if (!workerUrl) throw new Error("WORKER_URL was not returned by the deployment action.");
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL was not configured and no deployment URL is available.");
if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) throw new Error("EXPECTED_WORKER_ENVIRONMENT must be development or production.");

const deploymentBase = new URL(workerUrl);
const publicBase = new URL(publicAppUrl);
if (deploymentBase.protocol !== "https:" || publicBase.protocol !== "https:") throw new Error("Deployed Worker URLs must use HTTPS.");

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

const manifest = await fetchJson("/v1/manifest");
if (manifest?.schemaVersion !== 1 || typeof manifest?.datasetVersion !== "string" || !Array.isArray(manifest?.sources)) throw new Error("The deployed Worker returned an invalid data manifest.");

console.log(`Verified ${expectedEnvironment} TopoStack app and API at ${publicBase.origin} (deployment ${deploymentBase.origin})`);

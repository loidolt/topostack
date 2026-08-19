const workerUrl = process.env.WORKER_URL;
const expectedEnvironment = process.env.EXPECTED_WORKER_ENVIRONMENT;

if (!workerUrl) throw new Error("WORKER_URL was not returned by the deployment action.");
if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) throw new Error("EXPECTED_WORKER_ENVIRONMENT must be development or production.");

const base = new URL(workerUrl);
if (base.protocol !== "https:") throw new Error("The deployed Worker URL must use HTTPS.");

async function fetchJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(new URL(path, base), { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

const health = await fetchJson("/health");
if (health?.service !== "topostack-map-api" || health?.status !== "ok" || health?.environment !== expectedEnvironment) throw new Error(`Unexpected Worker health response: ${JSON.stringify(health)}`);

const manifest = await fetchJson("/v1/manifest");
if (manifest?.schemaVersion !== 1 || typeof manifest?.datasetVersion !== "string" || !Array.isArray(manifest?.sources)) throw new Error("The deployed Worker returned an invalid data manifest.");

console.log(`Verified ${expectedEnvironment} Worker at ${base.origin}`);

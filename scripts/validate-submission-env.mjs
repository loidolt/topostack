// Fail-closed gate for Atomm packaging: the embedded map API URL must be a
// deployed HTTPS endpoint on a real domain. Keep the forbidden-host families
// in sync with scripts/verify-atomm-dist.mjs, which re-checks the built
// artifact for the same placeholder endpoints.
const raw = process.env.VITE_MAP_API_URL;
if (!raw) throw new Error("VITE_MAP_API_URL is required when packaging for Atomm.");
const url = new URL(raw);

function isForbiddenApiHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  // Reserved/special-use TLDs (RFC 2606/6761) and Workers preview hosts are
  // never valid production endpoints for a submitted artifact.
  const forbiddenSuffixes = [".localhost", ".invalid", ".test", ".local", ".example", ".workers.dev"];
  if (forbiddenSuffixes.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) return true;
  if (host.includes("example.")) return true;
  return false;
}

if (url.protocol !== "https:" || isForbiddenApiHost(url.hostname)) {
  throw new Error("VITE_MAP_API_URL must be a deployed HTTPS endpoint, not localhost, a reserved test/placeholder domain, or a workers.dev preview URL.");
}

import { readFile, readdir, stat } from "node:fs/promises";

// `--skip-endpoint-scan` is used only by the CI validate job, whose build
// intentionally embeds the hermetic `https://ci.invalid` sentinel so tests
// cannot reach real services. Every packaging path (`package:atomm`,
// `release:atomm`) runs the full scan.
const skipEndpointScan = process.argv.includes("--skip-endpoint-scan");

const indexPath = new URL("../apps/generator/dist/index.html", import.meta.url);
const index = await readFile(indexPath, "utf8");
const headers = await readFile(new URL("../apps/generator/dist/_headers", import.meta.url), "utf8");
if (headers.includes("__TOPOSTACK_SCRIPT_HASHES__") || /script-src[^;]*unsafe-inline/.test(headers) || !/script-src[^;]*sha256-/.test(headers)) throw new Error("Production security headers do not contain finalized inline-script hashes.");
if (!index.includes("https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js")) throw new Error("Atomm SDK is missing from the production entry page.");
const distDirectory = new URL("../apps/generator/dist/", import.meta.url);
async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}
const distFiles = await filesBelow(distDirectory);
const scripts = distFiles.filter((file) => file.pathname.endsWith(".js"));
if (!scripts.length) throw new Error("Production artifact contains no JavaScript application files.");
const searchable = [index, ...await Promise.all(scripts.map((file) => readFile(file, "utf8")))].join("\n");

// Keep the forbidden-host families in sync with scripts/validate-submission-env.mjs.
function isForbiddenApiHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  const forbiddenSuffixes = [".localhost", ".invalid", ".test", ".local", ".example", ".workers.dev"];
  if (forbiddenSuffixes.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) return true;
  if (host.includes("example.")) return true;
  return false;
}

if (!skipEndpointScan) {
  const embeddedHosts = [...searchable.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1]);
  const forbidden = embeddedHosts.filter((host) => isForbiddenApiHost(host));
  if (forbidden.length) throw new Error(`Production artifact contains development or placeholder API endpoints: ${[...new Set(forbidden)].join(", ")}`);
}

if (/\b(?:src|href)=["']\/(?!\/)/.test(index)) throw new Error("Production entry page contains root-relative assets that may fail in Atomm.");
const size = (await stat(indexPath)).size;
if (size <= 0) throw new Error("Production entry page is empty.");

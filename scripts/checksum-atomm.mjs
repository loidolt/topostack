import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const archiveUrl = new URL("../apps/generator/topostack-atomm.zip", import.meta.url);
const archive = await readFile(archiveUrl);
const digest = createHash("sha256").update(archive).digest("hex");
await writeFile(new URL("../apps/generator/topostack-atomm.zip.sha256", import.meta.url), `${digest}  topostack-atomm.zip\n`, "utf8");
console.log(`SHA-256 ${digest}`);

const apiOrigin = new URL(process.env.VITE_MAP_API_URL).origin;
async function readApi(path) {
  const response = await fetch(new URL(path, apiOrigin), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Release evidence ${path} returned HTTP ${response.status}.`);
  return response.json();
}
const [manifest, readiness] = await Promise.all([readApi("/v1/manifest"), readApi("/ready")]);
const receipt = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  archive: "topostack-atomm.zip", sha256: digest, bytes: archive.byteLength,
  apiOrigin, datasetVersion: manifest.datasetVersion,
  vectorData: readiness.dependencies.vectorData,
  lakeData: readiness.dependencies.lakeData,
};
await writeFile(new URL("../apps/generator/topostack-atomm.release.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n", "utf8");

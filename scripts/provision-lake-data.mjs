/**
 * Upload the lake bathymetry archive built by build-lake-data.mjs.
 *
 * Mirrors provision-vector-data.mjs, including its digest pin and its refusal to
 * touch production without --prod: the object key is overwritten in place, so an
 * unintended upload is visible to every live client immediately.
 */
import { access, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const DATASET_SNAPSHOT = "hydrolakes-v10+globathy-2022";
const EXPECTED_MAX_ZOOM = 12;
const OBJECT_KEY = "lakes/current.pmtiles";
const DEVELOPMENT_BUCKET = "topostack-vector-data-development";
const PRODUCTION_BUCKET = "topostack-vector-data";
const credentialTtlSeconds = 24 * 60 * 60;

const flags = process.argv.slice(2).filter((argument) => argument.startsWith("--"));
const archivePath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const includeProduction = flags.includes("--prod");
const skipDigestCheck = flags.includes("--skip-digest-check");
const expectedDigest = (flags.find((flag) => flag.startsWith("--expected-sha256="))?.slice("--expected-sha256=".length)
  ?? process.env.EXPECTED_ARCHIVE_SHA256 ?? "").trim().toLowerCase();
if (!archivePath || !flags.includes("--provision")) {
  throw new Error("Usage: node scripts/provision-lake-data.mjs <archive.pmtiles> --provision [--prod] [--expected-sha256=<hex> | EXPECTED_ARCHIVE_SHA256=<hex>] [--skip-digest-check]");
}
// The object key is overwritten in place, so touching the production bucket is
// destructive for live clients. Default to development only.
const buckets = includeProduction ? [DEVELOPMENT_BUCKET, PRODUCTION_BUCKET] : [DEVELOPMENT_BUCKET];

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const pmtilesBin = process.env.PMTILES_BIN ?? "pmtiles";
if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
const childBaseEnv = { ...process.env };
delete childBaseEnv.CLOUDFLARE_API_TOKEN;

await access(archivePath);
const archive = await stat(archivePath);
if (!archive.isFile()) throw new Error(`${archivePath} is not a file.`);

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...childBaseEnv, ...extraEnv }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childBaseEnv, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve(output) : reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`)));
  });
}

async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json", ...init.headers },
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) throw new Error(`Cloudflare API request failed: ${JSON.stringify(payload.errors ?? response.status)}`);
  return payload.result;
}

console.log(`Verifying ${archivePath} (${(archive.size / 1_000_000_000).toFixed(2)} GB).`);
const hash = createHash("sha256");
await pipeline(createReadStream(archivePath), hash);
const archiveDigest = hash.digest("hex");
console.log(`Archive SHA-256: ${archiveDigest}`);
if (expectedDigest) {
  if (archiveDigest !== expectedDigest) throw new Error(`Archive digest mismatch: expected ${expectedDigest}, computed ${archiveDigest}. Refusing to upload.`);
  console.log("Archive digest matches the pinned SHA-256.");
} else if (skipDigestCheck) {
  console.warn("Digest pin check skipped (--skip-digest-check). Record the SHA-256 above and pin it for future runs.");
} else {
  throw new Error("No pinned digest provided. Pass --expected-sha256=<hex> (or set EXPECTED_ARCHIVE_SHA256), or use --skip-digest-check for a first-time pin capture.");
}
await run(pmtilesBin, ["verify", archivePath]);
const header = JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--header-json"]));
if (header.minzoom !== 0 || header.maxzoom !== EXPECTED_MAX_ZOOM) {
  throw new Error(`Expected a global zoom 0-${EXPECTED_MAX_ZOOM} archive; received zoom ${header.minzoom}-${header.maxzoom}.`);
}

const parent = await cloudflare(`/accounts/${accountId}/tokens/verify`);
if (!parent?.id || parent.status !== "active") throw new Error("The Cloudflare account API token is not active.");
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

for (const bucket of buckets) {
  console.log(`Uploading lake bathymetry ${DATASET_SNAPSHOT} to ${bucket}/${OBJECT_KEY}.`);
  const credentials = await cloudflare(`/accounts/${accountId}/r2/temp-access-credentials`, {
    method: "POST",
    body: JSON.stringify({
      bucket,
      parentAccessKeyId: parent.id,
      permission: "object-read-write",
      ttlSeconds: credentialTtlSeconds,
      objects: [OBJECT_KEY],
    }),
  });
  if (!credentials?.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken) throw new Error("Cloudflare did not return complete temporary R2 credentials.");
  const awsEnv = {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_SESSION_TOKEN: credentials.sessionToken,
  };
  const bucketUrl = `s3://${bucket}?endpoint=${endpoint}&region=auto&use_path_style=true`;
  await run(pmtilesBin, ["upload", archivePath, OBJECT_KEY, `--bucket=${bucketUrl}`], awsEnv);
  await run(pmtilesBin, ["show", OBJECT_KEY, `--bucket=${bucketUrl}`], awsEnv);
}

console.log(`Provisioned ${OBJECT_KEY} in ${includeProduction ? "development and production" : "development only (pass --prod to update production)"}.`);

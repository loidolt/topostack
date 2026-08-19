import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const archiveUrl = new URL("../apps/generator/topostack-atomm.zip", import.meta.url);
const archive = await readFile(archiveUrl);
const digest = createHash("sha256").update(archive).digest("hex");
await writeFile(new URL("../apps/generator/topostack-atomm.zip.sha256", import.meta.url), `${digest}  topostack-atomm.zip\n`, "utf8");
console.log(`SHA-256 ${digest}`);

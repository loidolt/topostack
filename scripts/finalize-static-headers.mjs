import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const dist = new URL("../apps/generator/dist/", import.meta.url);
const index = await readFile(new URL("index.html", dist), "utf8");
const headersUrl = new URL("_headers", dist);
let headers = await readFile(headersUrl, "utf8");
const hashes = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim())
  .map((script) => "'sha256-" + createHash("sha256").update(script).digest("base64") + "'");
if (!hashes.length) throw new Error("No inline scripts were found to hash for the Content Security Policy.");
if (!headers.includes("__TOPOSTACK_SCRIPT_HASHES__")) throw new Error("The static headers file is missing its script-hash placeholder.");
headers = headers.replace("__TOPOSTACK_SCRIPT_HASHES__", hashes.join(" "));
await writeFile(headersUrl, headers);

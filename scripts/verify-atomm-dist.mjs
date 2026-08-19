import { readFile, readdir, stat } from "node:fs/promises";

const indexPath = new URL("../apps/generator/dist/index.html", import.meta.url);
const index = await readFile(indexPath, "utf8");
if (!index.includes("https://static-res.atomm.com/scripts/js/generator-sdk/platform-sdk.js")) throw new Error("Atomm SDK is missing from the production entry page.");
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
if (/localhost:8787|127\.0\.0\.1:8787|example\.workers\.dev/.test(searchable)) throw new Error("Production artifact contains a development or placeholder API endpoint.");
if (/\b(?:src|href)=["']\/(?!\/)/.test(index)) throw new Error("Production entry page contains root-relative assets that may fail in Atomm.");
const size = (await stat(indexPath)).size;
if (size <= 0) throw new Error("Production entry page is empty.");

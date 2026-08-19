import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const dist = new URL("../apps/generator/dist/", import.meta.url);
const budgets = {
  totalJavaScriptGzip: 550_000,
  largestJavaScriptGzip: 300_000,
  totalCssGzip: 30_000,
  indexHtmlBytes: 10_000,
};

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}

const files = await filesBelow(dist);
const measured = await Promise.all(files.filter((file) => /\.(?:js|css)$/.test(file.pathname)).map(async (file) => {
  const body = await readFile(file);
  return { file: decodeURIComponent(file.pathname.split("/").at(-1) ?? file.pathname), type: file.pathname.endsWith(".js") ? "js" : "css", raw: body.byteLength, gzip: gzipSync(body).byteLength };
}));
const javascript = measured.filter((entry) => entry.type === "js");
const css = measured.filter((entry) => entry.type === "css");
const totalJavaScriptGzip = javascript.reduce((total, entry) => total + entry.gzip, 0);
const largestJavaScript = javascript.toSorted((left, right) => right.gzip - left.gzip)[0];
const totalCssGzip = css.reduce((total, entry) => total + entry.gzip, 0);
const indexHtmlBytes = (await stat(new URL("index.html", dist))).size;

const report = {
  totalJavaScriptGzip,
  largestJavaScriptGzip: largestJavaScript?.gzip ?? 0,
  largestJavaScriptFile: largestJavaScript?.file ?? "none",
  totalCssGzip,
  indexHtmlBytes,
};
console.log(JSON.stringify({ budgets, measured: report }, null, 2));

const failures = [
  [report.totalJavaScriptGzip, budgets.totalJavaScriptGzip, "Total JavaScript gzip size"],
  [report.largestJavaScriptGzip, budgets.largestJavaScriptGzip, "Largest JavaScript chunk gzip size"],
  [report.totalCssGzip, budgets.totalCssGzip, "Total CSS gzip size"],
  [report.indexHtmlBytes, budgets.indexHtmlBytes, "index.html size"],
].filter(([actual, maximum]) => actual > maximum);
if (failures.length) throw new Error(failures.map(([actual, maximum, label]) => `${label} is ${actual} bytes; budget is ${maximum} bytes.`).join("\n"));

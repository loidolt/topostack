import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const dist = new URL("../apps/generator/dist/", import.meta.url);
// Protect what every visitor downloads up front. Optional preview engines and
// the geometry worker are reported in totalJavaScriptGzip and constrained by
// the per-chunk ceiling, but do not count against the initial-load budget.
const budgets = {
  initialJavaScriptGzip: 180_000,
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
const indexHtml = new URL("index.html", dist);
const indexHtmlBody = await readFile(indexHtml, "utf8");
const initialJavaScriptFiles = [...indexHtmlBody.matchAll(/<link\b[^>]*>/gi)]
  .map(([tag]) => ({
    href: tag.match(/\bhref=["']([^"']+)["']/i)?.[1],
    rel: tag.match(/\brel=["']([^"']+)["']/i)?.[1],
  }))
  .filter(({ href, rel }) => href && rel?.split(/\s+/).includes("modulepreload"))
  .map(({ href }) => new URL(href, dist))
  .filter((file) => file.protocol === "file:" && file.pathname.startsWith(dist.pathname));
const initialJavaScriptGzip = (await Promise.all(
  [...new Set(initialJavaScriptFiles.map((file) => file.href))].map(async (href) =>
    gzipSync(await readFile(new URL(href))).byteLength
  ),
)).reduce((total, size) => total + size, 0);
const indexHtmlBytes = (await stat(indexHtml)).size;

const report = {
  initialJavaScriptGzip,
  totalJavaScriptGzip,
  largestJavaScriptGzip: largestJavaScript?.gzip ?? 0,
  largestJavaScriptFile: largestJavaScript?.file ?? "none",
  totalCssGzip,
  indexHtmlBytes,
};
console.log(JSON.stringify({ budgets, measured: report }, null, 2));

const failures = [
  [report.initialJavaScriptGzip, budgets.initialJavaScriptGzip, "Initial JavaScript gzip size"],
  [report.largestJavaScriptGzip, budgets.largestJavaScriptGzip, "Largest JavaScript chunk gzip size"],
  [report.totalCssGzip, budgets.totalCssGzip, "Total CSS gzip size"],
  [report.indexHtmlBytes, budgets.indexHtmlBytes, "index.html size"],
].filter(([actual, maximum]) => actual > maximum);
if (failures.length) throw new Error(failures.map(([actual, maximum, label]) => `${label} is ${actual} bytes; budget is ${maximum} bytes.`).join("\n"));

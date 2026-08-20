import { projectFingerprint } from "./geometry.js";
import { labelPathData } from "./labels.js";
import type { ExportFile, FabricationPackageV1, GeometryIRV1, LayerIR, Point2D, Polygon2D, ProjectConfigV1 } from "./types.js";

const CUT = "#ff0035";
const SCORE = "#2563eb";
const ENGRAVE = "#111827";

function safeName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return value || "topostack-project";
}

function format(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function pathData(points: Point2D[], offsetX = 0, offsetY = 0, closePath = false): string {
  const commands = points.map((point, index) => `${index === 0 ? "M" : "L"}${format(point.x + offsetX)} ${format(point.y + offsetY)}`);
  if (closePath) commands.push("Z");
  return commands.join(" ");
}

function polygonPath(polygon: Polygon2D, offsetX = 0, offsetY = 0): string {
  return [pathData(polygon.outer, offsetX, offsetY, true), ...polygon.holes.map((hole) => pathData(hole, offsetX, offsetY, true))].join(" ");
}

function layerGroups(layer: LayerIR, offsetX = 0, offsetY = 0): string {
  const cutPaths = layer.polygons.map((polygon, index) => `<path id="${layer.id}-cut-${index + 1}" d="${polygonPath(polygon, offsetX, offsetY)}"/>`).join("");
  const scorePaths = layer.markings.filter((mark) => mark.operation === "score" && mark.points.length > 1).map((mark) => `<path id="${escapeXml(mark.id)}" d="${pathData(mark.points, offsetX, offsetY)}"/>`).join("");
  const engravePaths = layer.markings.filter((mark) => mark.operation === "engrave" && mark.points.length > 1).map((mark) => `<path id="${escapeXml(mark.id)}" d="${pathData(mark.points, offsetX, offsetY)}"/>`).join("");
  const engraveLabels = layer.markings.filter((mark) => mark.operation === "engrave" && mark.label && mark.points[0]).map((mark) => `<path id="${escapeXml(mark.id)}" d="${labelPathData(mark.label ?? "", mark.points[0]!, offsetX, offsetY)}"/>`).join("");
  return `<g id="${layer.id}"><g id="${layer.id}-CUT" data-operation="CUT" fill="none" stroke="${CUT}" stroke-width="0.1" fill-rule="evenodd">${cutPaths}</g><g id="${layer.id}-SCORE" data-operation="SCORE" fill="none" stroke="${SCORE}" stroke-width="0.15">${scorePaths}</g><g id="${layer.id}-ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-width="0.2">${engravePaths}${engraveLabels}</g></g>`;
}

function svgDocument(width: number, height: number, body: string, title: string, viewX = -width / 2, viewY = -height / 2): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}mm" height="${format(height)}mm" viewBox="${format(viewX)} ${format(viewY)} ${format(width)} ${format(height)}"><title>${escapeXml(title)}</title>${body}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

export function layerToSvg(ir: GeometryIRV1, layer: LayerIR): string {
  return svgDocument(ir.widthMm, ir.heightMm, layerGroups(layer), `${ir.projectName} — ${layer.id}`);
}

export function masterToSvg(ir: GeometryIRV1): string {
  const gap = 12;
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(ir.layers.length))));
  const rows = Math.ceil(ir.layers.length / columns);
  const width = columns * ir.widthMm + (columns - 1) * gap;
  const height = rows * ir.heightMm + (rows - 1) * gap;
  const startX = -width / 2 + ir.widthMm / 2;
  const startY = -height / 2 + ir.heightMm / 2;
  const body = ir.layers.map((layer, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = startX + column * (ir.widthMm + gap);
    const offsetY = startY + row * (ir.heightMm + gap);
    return layerGroups(layer, offsetX, offsetY);
  }).join("");
  return svgDocument(width, height, body, `${ir.projectName} — master layout`, -width / 2, -height / 2);
}

export function assemblyGuideToSvg(ir: GeometryIRV1): string {
  const width = 210;
  const height = 297;
  const scale = Math.min(150 / ir.widthMm, 130 / ir.heightMm);
  const stack = ir.layers.map((layer, index) => {
    const offsetX = 105;
    const offsetY = 90 + index * Math.min(2.2, 20 / ir.layers.length);
    const paths = layer.polygons.map((polygon) => `<path d="${polygonPath(polygon, offsetX, offsetY)}"/>`).join("");
    return `<g transform="scale(${format(scale)}) translate(${format(offsetX / scale - offsetX)} ${format(offsetY / scale - offsetY)})" fill="none" stroke="#33443b" stroke-width="${format(0.25 / scale)}">${paths}</g>`;
  }).join("");
  const body = `<rect width="210" height="297" fill="#f5f0e7"/><text x="20" y="25" font-family="sans-serif" font-size="9" font-weight="700" fill="#18241f">${escapeXml(ir.projectName)}</text><text x="20" y="38" font-family="sans-serif" font-size="4" fill="#5a6b61">Stack ${ir.layers.length} layers from layer 01 upward · ${format(ir.layers[0]?.materialThicknessMm ?? 0)} mm material</text>${stack}<text x="20" y="260" font-family="sans-serif" font-size="4" fill="#18241f">Elevation range: ${Math.round(ir.minElevationM)}–${Math.round(ir.maxElevationM)} m</text><text x="20" y="271" font-family="sans-serif" font-size="3.2" fill="#5a6b61">Decorative terrain data only. Verify dimensions, material, kerf, power, and speed with a test cut.</text>`;
  return svgDocument(width, height, body, `${ir.projectName} — assembly guide`, 0, 0);
}

export function buildFabricationPackage(ir: GeometryIRV1, config: ProjectConfigV1): FabricationPackageV1 {
  if (ir.sourceKind !== "real") throw new Error("Generate real terrain data before exporting fabrication files.");
  if (ir.configFingerprint !== projectFingerprint(config)) throw new Error("Project settings changed. Regenerate the terrain before exporting.");
  if (ir.vectorStatus === "unavailable" && (config.showRoads || config.showWater)) throw new Error("Road and water data is unavailable. Disable those map details or regenerate after the service is restored.");
  if (ir.layers.some((layer) => layer.polygons.length === 0)) throw new Error("One or more layers are empty. Reduce the layer count or minimum feature size before exporting.");
  const base = safeName(config.name);
  const layerFiles: ExportFile[] = ir.layers.map((layer) => ({
    filename: `${base}-${layer.id}.svg`,
    blob: new Blob([layerToSvg(ir, layer)], { type: "image/svg+xml" }),
  }));
  const master: ExportFile = { filename: `${base}-master.svg`, blob: new Blob([masterToSvg(ir)], { type: "image/svg+xml" }) };
  const manifest = {
    schemaVersion: 1,
    project: config,
    result: {
      projectId: ir.projectId,
      generatedAt: ir.generatedAt,
      minElevationM: ir.minElevationM,
      maxElevationM: ir.maxElevationM,
      layers: ir.layers.map((layer) => ({ id: layer.id, elevationM: layer.elevationM, filename: `${base}-${layer.id}.svg` })),
      bounds: ir.bounds,
      resolutionM: ir.resolutionM,
      datasetVersion: ir.datasetVersion,
      vectorStatus: ir.vectorStatus,
      imagerySources: ir.imagerySources,
    },
    attribution: ir.attribution,
  };
  const attribution = `${ir.attribution.map((item) => `${item.name} — ${item.license}\n${item.url}`).join("\n\n")}\n\nImagery sources used:\n${ir.imagerySources.length ? ir.imagerySources.join("\n") : "Not reported by source service"}`;
  const alignment = config.showAlignmentGuides ? "Each lower layer includes an engraved outline and Lxx label for positioning the layer directly above it. These marks are designed to be hidden after assembly.\n\n" : "";
  const readme = `${ir.projectName}\n\n${ir.layers.length} layers at ${config.materialThicknessMm} mm each\nFinished stack height: ${format(ir.layers.length * config.materialThicknessMm)} mm\n\nCUT ${CUT}\nSCORE ${SCORE}\nENGRAVE ${ENGRAVE}\n\n${alignment}Import the master SVG into xTool Studio, or use the individual files. Verify dimensions and run a material test before fabrication. Terrain data is decorative and is not survey or engineering data.\n`;
  const files: ExportFile[] = [
    ...layerFiles,
    master,
    { filename: `${base}-assembly-guide.svg`, blob: new Blob([assemblyGuideToSvg(ir)], { type: "image/svg+xml" }) },
    { filename: `${base}-project.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) },
    { filename: "README.txt", blob: new Blob([readme], { type: "text/plain" }) },
    { filename: "ATTRIBUTION.txt", blob: new Blob([attribution], { type: "text/plain" }) },
  ];
  if (files.reduce((total, file) => total + file.blob.size, 0) > 100_000_000) throw new Error("The fabrication package exceeds Atomm's 100 MB export limit.");
  return {
    schemaVersion: 1,
    master,
    files,
  };
}

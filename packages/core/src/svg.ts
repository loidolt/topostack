import { projectFingerprint } from "./geometry.js";
import { labelPathData } from "./labels.js";
import type { ExportFile, FabricationNest, FabricationPackageV1, GeometryIRV1, LayerIR, Point2D, ProjectConfigV1 } from "./types.js";

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

function layerGroups(layer: LayerIR, offsetX = 0, offsetY = 0, omittedHoles = new Map<number, Set<number>>()): string {
  const cutPaths = layer.polygons.flatMap((polygon, polygonIndex) => {
    const omittedHoleIndexes = omittedHoles.get(polygonIndex) ?? new Set<number>();
    return [
      `<path id="${layer.id}-cut-${polygonIndex + 1}" d="${pathData(polygon.outer, offsetX, offsetY, true)}"/>`,
      ...polygon.holes.flatMap((hole, holeIndex) => omittedHoleIndexes.has(holeIndex) ? [] : [
        `<path id="${layer.id}-cut-${polygonIndex + 1}-hole-${holeIndex + 1}" d="${pathData(hole, offsetX, offsetY, true)}"/>`,
      ]),
    ];
  }).join("");
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

interface FabricationPanel {
  rootLayerIndex: number;
  layerIndexes: number[];
}

function fabricationPanels(ir: GeometryIRV1): FabricationPanel[] {
  const parentByLayer = new Map(ir.fabricationNests.map((nest) => [nest.nestedLayerIndex, nest.donorLayerIndex]));
  const childrenByLayer = new Map<number, number[]>();
  ir.fabricationNests.forEach((nest) => childrenByLayer.set(nest.donorLayerIndex, [...(childrenByLayer.get(nest.donorLayerIndex) ?? []), nest.nestedLayerIndex]));
  const collect = (layerIndex: number): number[] => [layerIndex, ...(childrenByLayer.get(layerIndex) ?? []).flatMap(collect)];
  return ir.layers.filter((layer) => !parentByLayer.has(layer.index)).map((layer) => ({
    rootLayerIndex: layer.index,
    layerIndexes: collect(layer.index),
  }));
}

function omittedNestHoles(nests: FabricationNest[], layerIndex: number): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  nests.filter((nest) => nest.donorLayerIndex === layerIndex).forEach((nest) => nest.cavities.forEach((cavity) => {
    result.set(cavity.donorPolygonIndex, new Set([...(result.get(cavity.donorPolygonIndex) ?? []), cavity.donorHoleIndex]));
  }));
  return result;
}

function panelGroups(ir: GeometryIRV1, panel: FabricationPanel, offsetX = 0, offsetY = 0): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(" ");
  const layers = panel.layerIndexes.map((index) => ir.layers[index]).filter((layer): layer is LayerIR => Boolean(layer));
  return `<g id="fabrication-panel-${panel.rootLayerIndex + 1}" data-layers="${escapeXml(layerIds)}">${layers.map((layer) => layerGroups(layer, offsetX, offsetY, omittedNestHoles(ir.fabricationNests, layer.index))).join("")}</g>`;
}

function panelToSvg(ir: GeometryIRV1, panel: FabricationPanel): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  return svgDocument(ir.widthMm, ir.heightMm, panelGroups(ir, panel), `${ir.projectName} — fabrication panel — ${layerIds}`);
}

export function masterToSvg(ir: GeometryIRV1): string {
  const gap = 12;
  const panels = fabricationPanels(ir);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(panels.length))));
  const rows = Math.ceil(panels.length / columns);
  const width = columns * ir.widthMm + (columns - 1) * gap;
  const height = rows * ir.heightMm + (rows - 1) * gap;
  const startX = -width / 2 + ir.widthMm / 2;
  const startY = -height / 2 + ir.heightMm / 2;
  const body = panels.map((panel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = startX + column * (ir.widthMm + gap);
    const offsetY = startY + row * (ir.heightMm + gap);
    return panelGroups(ir, panel, offsetX, offsetY);
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
    const paths = layer.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]).map((ring) => `<path d="${pathData(ring, offsetX, offsetY, true)}"/>`).join("");
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
  const panels = fabricationPanels(ir);
  const panelFiles = panels.map((panel, index) => {
    const layers = panel.layerIndexes.map((layerIndex) => ir.layers[layerIndex]?.id.replace("layer-", "")).filter(Boolean).join("-");
    const filename = panel.layerIndexes.length === 1 ? `${base}-${ir.layers[panel.rootLayerIndex]?.id}.svg` : `${base}-panel-${String(index + 1).padStart(2, "0")}-layers-${layers}.svg`;
    return { panel, file: { filename, blob: new Blob([panelToSvg(ir, panel)], { type: "image/svg+xml" }) } satisfies ExportFile };
  });
  const filenameByLayer = new Map(panelFiles.flatMap(({ panel, file }) => panel.layerIndexes.map((layerIndex) => [layerIndex, file.filename] as const)));
  const master: ExportFile = { filename: `${base}-master.svg`, blob: new Blob([masterToSvg(ir)], { type: "image/svg+xml" }) };
  const manifest = {
    schemaVersion: 1,
    project: config,
    result: {
      projectId: ir.projectId,
      generatedAt: ir.generatedAt,
      minElevationM: ir.minElevationM,
      maxElevationM: ir.maxElevationM,
      layers: ir.layers.map((layer) => ({ id: layer.id, elevationM: layer.elevationM, filename: filenameByLayer.get(layer.index) })),
      fabrication: {
        panelCount: panels.length,
        originalPanelCount: ir.layers.length,
        glueMarginMm: config.glueMarginMm,
        nests: ir.fabricationNests,
      },
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
  const nesting = ir.fabricationNests.length ? `Material nesting reduced ${ir.layers.length} layer panels to ${panels.length} fabrication panels. Smaller layers share cut lines inside lower layers while preserving at least ${format(config.glueMarginMm)} mm of covered glue land. Keep every loose cutout: nested pieces belong to the layer IDs listed in each panel filename and SVG data-layers attribute.\n\n` : config.optimizeMaterialUse ? `No safe material nests fit the requested ${format(config.glueMarginMm)} mm glue margin, so every layer remains on its own panel.\n\n` : "Material-saving nesting is disabled.\n\n";
  const readme = `${ir.projectName}\n\n${ir.layers.length} layers at ${config.materialThicknessMm} mm each\nFinished stack height: ${format(ir.layers.length * config.materialThicknessMm)} mm\nFabrication panels: ${panels.length}\n\nCUT ${CUT}\nSCORE ${SCORE}\nENGRAVE ${ENGRAVE}\n\n${alignment}${nesting}Import the master SVG into xTool Studio, or use the fabrication-panel SVGs. Verify dimensions and run a material test before fabrication. Terrain data is decorative and is not survey or engineering data.\n`;
  const files: ExportFile[] = [
    ...panelFiles.map(({ file }) => file),
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

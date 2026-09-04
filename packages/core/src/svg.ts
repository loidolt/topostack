import { formatNumber as format } from "./format.js";
import { planTerrainStack, projectFingerprint } from "./geometry.js";
import { labelPathData } from "./labels.js";
import { offsetClosedRing } from "./offset.js";
import { displayElevation, displayLength, elevationUnit, lengthUnit } from "./units.js";
import type { ExportFile, FabricationNest, FabricationPackageV1, GeometryIRV1, LayerIR, LineStyleV1, Point2D, ProjectConfigV1 } from "./types.js";

const CUT = "#ff0035";
const SCORE = "#2563eb";
const ENGRAVE = "#111827";

function safeName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return value || "topostack-project";
}

function pathData(points: Point2D[], offsetX = 0, offsetY = 0, closePath = false): string {
  const commands = points.map((point, index) => `${index === 0 ? "M" : "L"}${format(point.x + offsetX)} ${format(point.y + offsetY)}`);
  if (closePath) commands.push("Z");
  return commands.join(" ");
}

function compensatedCutPaths(points: Point2D[], distanceMm: number): Point2D[][] {
  return offsetClosedRing(points, distanceMm, "miter");
}

function layerCutPaths(layer: LayerIR, laserKerfMm: number, offsetX = 0, offsetY = 0, omittedHoles = new Map<number, Set<number>>()): string {
  const compensationMm = laserKerfMm / 2;
  return layer.polygons.flatMap((polygon, polygonIndex) => {
    const omittedHoleIndexes = omittedHoles.get(polygonIndex) ?? new Set<number>();
    return [
      ...compensatedCutPaths(polygon.outer, compensationMm).map((ring, offsetIndex) => `<path id="${layer.id}-cut-${polygonIndex + 1}-offset-${offsetIndex + 1}" d="${pathData(ring, offsetX, offsetY, true)}"/>`),
      ...polygon.holes.flatMap((hole, holeIndex) => omittedHoleIndexes.has(holeIndex) ? [] : [
        ...compensatedCutPaths(hole, -compensationMm).map((ring, offsetIndex) => `<path id="${layer.id}-cut-${polygonIndex + 1}-hole-${holeIndex + 1}-offset-${offsetIndex + 1}" d="${pathData(ring, offsetX, offsetY, true)}"/>`),
      ]),
    ];
  }).join("");
}

function engravingCategory(mark: LayerIR["markings"][number]): string {
  if (mark.id.startsWith("transport-label-")) return "transport-labels";
  if (mark.transportationClass === "major-road") return "major-roads";
  if (mark.transportationClass === "local-road") return "local-roads";
  if (mark.transportationClass === "trail") return "trails";
  if (mark.kind === "water") return "water";
  if (mark.kind === "boundary") return "boundaries";
  if (mark.kind === "grid") return "coordinate-grid";
  if (mark.kind === "label" || mark.kind === "guide") return "annotations";
  return "general";
}

function categoryStrokeAttributes(category: string, style: LineStyleV1): string {
  const width = category === "major-roads" ? style.majorRoadMm :
    category === "local-roads" ? style.localRoadMm :
    category === "trails" ? style.trailMm :
    category === "water" ? style.waterMm :
    category === "boundaries" ? style.boundaryMm :
    category === "coordinate-grid" ? style.coordinateGridMm : style.annotationMm;
  if (category === "boundaries") return ` stroke-width="${format(width)}" stroke-dasharray="${format(Math.max(width * 8, 1.6))} ${format(Math.max(width * 5, 1))}" stroke-linecap="round"`;
  if (category === "coordinate-grid") return ` stroke-width="${format(width)}" stroke-dasharray="0.01 ${format(Math.max(width * 5, 0.9))}" stroke-linecap="round"`;
  if (category === "major-roads" || category === "local-roads") return ` stroke-width="${format(width)}" stroke-linecap="${style.roadCap}" stroke-linejoin="round"`;
  if (category !== "trails" || style.trailPattern === "solid") return ` stroke-width="${format(width)}"`;
  const dash = style.trailPattern === "dotted"
    ? `0.01 ${format(Math.max(width * 4, 0.7))}`
    : `${format(Math.max(width * 6, 1.2))} ${format(Math.max(width * 4, 0.8))}`;
  return ` stroke-width="${format(width)}" stroke-dasharray="${dash}" stroke-linecap="round"`;
}

function markingPath(mark: LayerIR["markings"][number], offsetX: number, offsetY: number): string {
  if (mark.label && mark.points[0]) return `<path id="${escapeXml(mark.id)}" d="${labelPathData(mark.label, mark.points[0], offsetX, offsetY, mark.labelRotationRad, mark.textStyle)}"${mark.textStyle?.font === "rounded" ? ' stroke-linecap="round" stroke-linejoin="round"' : ""}/>`;
  const color = mark.knockout ? "#ffffff" : mark.operation === "score" ? SCORE : ENGRAVE;
  const fill = mark.filled ? ` fill="${color}"` : "";
  const knockout = mark.knockout ? ` stroke="#ffffff" data-knockout="true"` : "";
  return mark.points.length > 1 ? `<path id="${escapeXml(mark.id)}" d="${pathData(mark.points, offsetX, offsetY)}"${fill}${knockout}/>` : "";
}

function layerMarkingPaths(layer: LayerIR, operation: "score" | "engrave", style: LineStyleV1, offsetX = 0, offsetY = 0): string {
  const markings = layer.markings.filter((mark) => mark.operation === operation);
  const categories = ["major-roads", "local-roads", "trails", "transport-labels", "water", "boundaries", "coordinate-grid", "annotations", "general"];
  return categories.map((category) => {
    const paths = markings.filter((mark) => engravingCategory(mark) === category).map((mark) => markingPath(mark, offsetX, offsetY)).join("");
    return paths ? `<g id="${layer.id}-${operation.toUpperCase()}-${category}"${categoryStrokeAttributes(category, style)}>${paths}</g>` : "";
  }).join("");
}

function svgDocument(width: number, height: number, body: string, title: string, viewX = -width / 2, viewY = -height / 2): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}mm" height="${format(height)}mm" viewBox="${format(viewX)} ${format(viewY)} ${format(width)} ${format(height)}"><title>${escapeXml(title)}</title>${body}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

export function layerToSvg(ir: GeometryIRV1, layer: LayerIR): string {
  const width = ir.widthMm + ir.laserKerfMm;
  const height = ir.heightMm + ir.laserKerfMm;
  const body = `<g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-width="${format(ir.lineStyle.annotationMm)}"><g id="${layer.id}-ENGRAVE">${layerMarkingPaths(layer, "engrave", ir.lineStyle)}</g></g><g id="SCORE" data-operation="SCORE" fill="none" stroke="${SCORE}" stroke-width="${format(ir.lineStyle.waterMm)}"><g id="${layer.id}-SCORE">${layerMarkingPaths(layer, "score", ir.lineStyle)}</g></g><g id="CUT" data-operation="CUT" fill="none" stroke="${CUT}" stroke-width="0.1" fill-rule="evenodd"><g id="${layer.id}-CUT">${layerCutPaths(layer, ir.laserKerfMm)}</g></g>`;
  return svgDocument(width, height, body, `${ir.projectName} — ${layer.id}`);
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

function panelOperationGroup(ir: GeometryIRV1, panel: FabricationPanel, operation: "cut" | "score" | "engrave", offsetX = 0, offsetY = 0): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(" ");
  const layers = panel.layerIndexes.map((index) => ir.layers[index]).filter((layer): layer is LayerIR => Boolean(layer));
  const operationName = operation.toUpperCase();
  const body = layers.map((layer) => `<g id="${layer.id}-${operationName}">${operation === "cut" ? layerCutPaths(layer, ir.laserKerfMm, offsetX, offsetY, omittedNestHoles(ir.fabricationNests, layer.index)) : layerMarkingPaths(layer, operation, ir.lineStyle, offsetX, offsetY)}</g>`).join("");
  return `<g id="fabrication-panel-${panel.rootLayerIndex + 1}-${operationName}" data-layers="${escapeXml(layerIds)}">${body}</g>`;
}

function operationGroup(operation: "cut" | "score" | "engrave", body: string, style: LineStyleV1): string {
  const name = operation.toUpperCase();
  const color = operation === "cut" ? CUT : operation === "score" ? SCORE : ENGRAVE;
  const width = operation === "cut" ? "0.1" : format(operation === "score" ? style.waterMm : style.annotationMm);
  return `<g id="${name}" data-operation="${name}" fill="none" stroke="${color}" stroke-width="${width}"${operation === "cut" ? ' fill-rule="evenodd"' : ""}>${body}</g>`;
}

function panelGroups(ir: GeometryIRV1, panel: FabricationPanel, offsetX = 0, offsetY = 0, operations: Array<"cut" | "score" | "engrave"> = ["engrave", "score", "cut"]): string {
  return operations.map((operation) => operationGroup(operation, panelOperationGroup(ir, panel, operation, offsetX, offsetY), ir.lineStyle)).join("");
}

function panelToSvg(ir: GeometryIRV1, panel: FabricationPanel): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const width = ir.widthMm + ir.laserKerfMm;
  const height = ir.heightMm + ir.laserKerfMm;
  return svgDocument(width, height, panelGroups(ir, panel), `${ir.projectName} — fabrication panel — ${layerIds}`);
}

function engravingPanelToSvg(ir: GeometryIRV1, panel: FabricationPanel): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const width = ir.widthMm + ir.laserKerfMm;
  const height = ir.heightMm + ir.laserKerfMm;
  return svgDocument(width, height, panelGroups(ir, panel, 0, 0, ["engrave"]), `${ir.projectName} — engraving panel — ${layerIds}`);
}

function segmentOnCropBoundary(start: Point2D, end: Point2D, config: ProjectConfigV1): boolean {
  const epsilon = 0.02;
  if (config.cropShape === "circle") {
    const radius = config.widthMm / 2;
    return Math.abs(Math.hypot(start.x, start.y) - radius) <= epsilon &&
      Math.abs(Math.hypot(end.x, end.y) - radius) <= epsilon;
  }
  const halfWidth = config.widthMm / 2;
  const halfHeight = config.heightMm / 2;
  return (Math.abs(start.x - halfWidth) <= epsilon && Math.abs(end.x - halfWidth) <= epsilon) ||
    (Math.abs(start.x + halfWidth) <= epsilon && Math.abs(end.x + halfWidth) <= epsilon) ||
    (Math.abs(start.y - halfHeight) <= epsilon && Math.abs(end.y - halfHeight) <= epsilon) ||
    (Math.abs(start.y + halfHeight) <= epsilon && Math.abs(end.y + halfHeight) <= epsilon);
}

/**
 * Filled contour polygons include pieces of the crop edge whenever terrain
 * continues beyond the artwork. Remove those edge-following pieces so a flat
 * topographic line terminates naturally at the optional border.
 */
function openContourPath(points: Point2D[], config: ProjectConfigV1): string {
  let result = "";
  let connected = false;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (segmentOnCropBoundary(start, end, config)) {
      connected = false;
      continue;
    }
    if (!connected) result += `M${format(start.x)} ${format(start.y)}`;
    result += `L${format(end.x)} ${format(end.y)}`;
    connected = true;
  }
  return result;
}

function flatContourPaths(ir: GeometryIRV1, config: ProjectConfigV1, indexContour: boolean): string {
  return ir.layers.slice(1)
    .filter((layer) => (layer.index % config.engravingIndexInterval === 0) === indexContour)
    .flatMap((layer) => layer.polygons.flatMap((polygon, polygonIndex) => [polygon.outer, ...polygon.holes].map((ring, ringIndex) => {
      const data = openContourPath(ring, config);
      return data ? `<path id="contour-${layer.index}-${polygonIndex}-${ringIndex}" data-elevation-m="${format(layer.elevationM)}" d="${data}"/>` : "";
    })))
    .join("");
}

function flatMarkingPaths(ir: GeometryIRV1): string {
  // Score paths in layered projects (notably water) become ordinary engraved
  // lines in a flat project; the output deliberately has one operation only.
  const markings = ir.layers.flatMap((layer) => layer.markings)
    .filter((mark) => !mark.id.startsWith("alignment-"));
  const categories = ["major-roads", "local-roads", "trails", "transport-labels", "water", "boundaries", "coordinate-grid", "annotations", "general"];
  return categories.map((category) => {
    const paths = markings.filter((mark) => engravingCategory(mark) === category).map((mark) => markingPath(mark, 0, 0)).join("");
    return paths ? `<g id="ENGRAVE-${category}"${categoryStrokeAttributes(category, ir.lineStyle)}>${paths}</g>` : "";
  }).join("");
}

function engravingBorder(config: ProjectConfigV1): string {
  if (!config.showEngravingBorder) return "";
  if (config.cropShape === "circle") return `<circle id="engraving-border" cx="0" cy="0" r="${format(config.widthMm / 2)}"/>`;
  return `<rect id="engraving-border" x="${format(-config.widthMm / 2)}" y="${format(-config.heightMm / 2)}" width="${format(config.widthMm)}" height="${format(config.heightMm)}"/>`;
}

/** One physical-size, engrave-only artwork with no cut or score operations. */
export function engravingToSvg(ir: GeometryIRV1, config: ProjectConfigV1): string {
  const minor = flatContourPaths(ir, config, false);
  const index = flatContourPaths(ir, config, true);
  const style = ir.lineStyle;
  const body = `<g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-linecap="round" stroke-linejoin="round"><g id="ENGRAVE-contours-minor" stroke-width="${format(style.contourMm)}">${minor}</g><g id="ENGRAVE-contours-index" stroke-width="${format(style.indexContourMm)}">${index}</g><g id="ENGRAVE-map-details" stroke-width="${format(style.annotationMm)}">${flatMarkingPaths(ir)}</g><g id="ENGRAVE-border" stroke-width="${format(style.borderMm)}">${engravingBorder(config)}</g></g>`;
  return svgDocument(config.widthMm, config.heightMm, body, `${ir.projectName} — flat topographic engraving`);
}

export function masterToSvg(ir: GeometryIRV1): string {
  const gap = 12;
  const panels = fabricationPanels(ir);
  const panelWidth = ir.widthMm + ir.laserKerfMm;
  const panelHeight = ir.heightMm + ir.laserKerfMm;
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(panels.length))));
  const rows = Math.ceil(panels.length / columns);
  const width = columns * panelWidth + (columns - 1) * gap;
  const height = rows * panelHeight + (rows - 1) * gap;
  const startX = -width / 2 + panelWidth / 2;
  const startY = -height / 2 + panelHeight / 2;
  const positioned = panels.map((panel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = startX + column * (panelWidth + gap);
    const offsetY = startY + row * (panelHeight + gap);
    return { panel, offsetX, offsetY };
  });
  const body = (["engrave", "score", "cut"] as const).map((operation) => operationGroup(operation, positioned.map(({ panel, offsetX, offsetY }) => panelOperationGroup(ir, panel, operation, offsetX, offsetY)).join(""), ir.lineStyle)).join("");
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
  const body = `<rect width="210" height="297" fill="#f5f0e7"/><text x="20" y="25" font-family="sans-serif" font-size="9" font-weight="700" fill="#18241f">${escapeXml(ir.projectName)}</text><text x="20" y="38" font-family="sans-serif" font-size="4" fill="#5a6b61">Stack ${ir.layers.length} layers from layer 01 upward · ${format(displayLength(ir.layers[0]?.materialThicknessMm ?? 0, ir.units))} ${lengthUnit(ir.units)} material</text>${stack}<text x="20" y="260" font-family="sans-serif" font-size="4" fill="#18241f">Elevation range: ${Math.round(displayElevation(ir.minElevationM, ir.units))}–${Math.round(displayElevation(ir.maxElevationM, ir.units))} ${elevationUnit(ir.units)}</text><text x="20" y="271" font-family="sans-serif" font-size="3.2" fill="#5a6b61">Decorative terrain data only. Verify dimensions, material, kerf, power, and speed with a test cut.</text>`;
  return svgDocument(width, height, body, `${ir.projectName} — assembly guide`, 0, 0);
}

export function buildFabricationPackage(ir: GeometryIRV1, config: ProjectConfigV1): FabricationPackageV1 {
  if (config.outputMode !== "stack") throw new Error("Choose layered relief before exporting fabrication files.");
  if (ir.sourceKind !== "real") throw new Error("Generate real terrain data before exporting fabrication files.");
  if (ir.configFingerprint !== projectFingerprint(config)) throw new Error("Project settings changed. Regenerate the terrain before exporting.");
  if (ir.vectorStatus !== "available" && (config.showRoads || config.showTrails || config.showWater || config.showBoundaries || config.showWaterDepth)) throw new Error("Map detail data is unavailable. Disable those map details or regenerate after the service is restored.");
  if (ir.layers.some((layer) => layer.polygons.length === 0)) throw new Error("One or more layers are empty. Reduce the layer count or minimum feature size before exporting.");
  const base = safeName(config.name);
  const panels = fabricationPanels(ir);
  const panelFiles = panels.map((panel, index) => {
    const layers = panel.layerIndexes.map((layerIndex) => ir.layers[layerIndex]?.id.replace("layer-", "")).filter(Boolean).join("-");
    const filename = panel.layerIndexes.length === 1 ? `${base}-${ir.layers[panel.rootLayerIndex]?.id}.svg` : `${base}-panel-${String(index + 1).padStart(2, "0")}-layers-${layers}.svg`;
    const engravingFilename = filename.replace(/\.svg$/, "-engrave.svg");
    return {
      panel,
      file: { filename, blob: new Blob([panelToSvg(ir, panel)], { type: "image/svg+xml" }) } satisfies ExportFile,
      engravingFile: { filename: engravingFilename, blob: new Blob([engravingPanelToSvg(ir, panel)], { type: "image/svg+xml" }) } satisfies ExportFile,
    };
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
        laserKerfMm: config.laserKerfMm,
        nests: ir.fabricationNests,
        panels: panelFiles.map(({ panel, file, engravingFile }) => ({ filename: file.filename, engravingFilename: engravingFile.filename, layerIds: panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean) })),
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
  const cutUnit = lengthUnit(config.units);
  const shownLength = (valueMm: number) => `${format(displayLength(valueMm, config.units))} ${cutUnit}`;
  const alignment = config.showAlignmentGuides ? `Each lower layer includes an engraved outline inset ${shownLength(config.laserKerfMm)} beneath the layer directly above it, plus an Lxx label. These marks are designed to be hidden after assembly.\n\n` : "";
  const kerf = config.laserKerfMm > 0 ? `CUT paths include ${shownLength(config.laserKerfMm)} total kerf compensation: external cuts move outward and internal cuts move inward by half the kerf. Calibrate this value for your laser and material.\n\n` : "CUT paths have no kerf compensation. Calibrate your laser and material before fabrication.\n\n";
  const stack = planTerrainStack(config, ir.maxElevationM - ir.minElevationM, ir.bounds);
  // Layer count is derived, so the README states the scale relationship it came from.
  const scale = stack.horizontalScale > 0 ? ` (horizontal scale 1:${Math.round(1 / stack.horizontalScale).toLocaleString("en-US")})` : "";
  const vertical = `Vertical exaggeration: ${ir.verticalExaggeration.toFixed(1)}x${scale}\n`;
  const roadAppearance = config.lineStyle.roadStyle === "centerline" ? "centerlines" : `outlined major roads spaced ${format(config.lineStyle.majorRoadSpacingMm)} mm`;
  const linework = `Road appearance: ${roadAppearance}, ${config.lineStyle.roadCap} endpoints. Engraved line widths: major roads ${format(config.lineStyle.majorRoadMm)} mm, local roads ${format(config.lineStyle.localRoadMm)} mm, trails ${format(config.lineStyle.trailMm)} mm (${config.lineStyle.trailPattern}), water ${format(config.lineStyle.waterMm)} mm, state/province boundaries ${format(config.lineStyle.boundaryMm)} mm (dashed), latitude/longitude grid ${format(config.lineStyle.coordinateGridMm)} mm (dotted), labels and guides ${format(config.lineStyle.annotationMm)} mm.\n`;
  const nesting = ir.fabricationNests.length ? `Material nesting reduced ${ir.layers.length} layer panels to ${panels.length} fabrication panels. Smaller layers share cut lines inside lower layers while preserving at least ${shownLength(config.glueMarginMm)} of covered glue land. Keep every loose cutout: nested pieces belong to the layer IDs listed in each panel filename and SVG data-layers attribute.\n\n` : config.optimizeMaterialUse ? `No safe material nests fit the requested ${shownLength(config.glueMarginMm)} glue margin, so every layer remains on its own panel.\n\n` : "Material-saving nesting is disabled.\n\n";
  const readme = `${ir.projectName}\n\n${ir.layers.length} layers at ${shownLength(config.materialThicknessMm)} each\nFinished stack height: ${shownLength(ir.layers.length * config.materialThicknessMm)}\n${vertical}${linework}Fabrication panels: ${panels.length}\n\nCUT ${CUT}\nSCORE ${SCORE}\nENGRAVE ${ENGRAVE}\n\nEvery complete panel and the master SVG place all engraved paths in a black ENGRAVE color layer, separate from red CUT and blue SCORE paths. Each panel also has a registered -engrave.svg companion containing the same ENGRAVE paths only. Use either the complete panel SVG, or pair its engraving-only companion with a cut workflow; do not process both engraving copies in the same job.\n\n${alignment}${kerf}${nesting}Import the master SVG into xTool Studio, or use the fabrication-panel SVGs. Assign and verify each color layer's processing type, dimensions, and material settings before fabrication. Terrain data is decorative and is not survey or engineering data.\n`;
  const files: ExportFile[] = [
    ...panelFiles.flatMap(({ file, engravingFile }) => [file, engravingFile]),
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

export function buildEngravingPackage(ir: GeometryIRV1, config: ProjectConfigV1): FabricationPackageV1 {
  if (config.outputMode !== "engraving") throw new Error("Choose flat engraving before exporting engraving artwork.");
  if (ir.sourceKind !== "real") throw new Error("Generate real terrain data before exporting engraving files.");
  if (ir.configFingerprint !== projectFingerprint(config)) throw new Error("Project settings changed. Regenerate the terrain before exporting.");
  if (ir.vectorStatus !== "available" && (config.showRoads || config.showTrails || config.showWater || config.showBoundaries)) throw new Error("Map detail data is unavailable. Disable those map details or regenerate after the service is restored.");
  const base = safeName(config.name);
  const master: ExportFile = { filename: `${base}-engraving.svg`, blob: new Blob([engravingToSvg(ir, config)], { type: "image/svg+xml" }) };
  const attribution = `${ir.attribution.map((item) => `${item.name} — ${item.license}\n${item.url}`).join("\n\n")}\n\nImagery sources used:\n${ir.imagerySources.length ? ir.imagerySources.join("\n") : "Not reported by source service"}`;
  const manifest = {
    schemaVersion: 1,
    project: config,
    result: {
      projectId: ir.projectId,
      generatedAt: ir.generatedAt,
      outputMode: "engraving",
      contourCount: config.engravingContourCount,
      indexInterval: config.engravingIndexInterval,
      minElevationM: ir.minElevationM,
      maxElevationM: ir.maxElevationM,
      bounds: ir.bounds,
      resolutionM: ir.resolutionM,
      datasetVersion: ir.datasetVersion,
      vectorStatus: ir.vectorStatus,
      imagerySources: ir.imagerySources,
    },
    attribution: ir.attribution,
  };
  const unit = lengthUnit(config.units);
  const size = `${format(displayLength(config.widthMm, config.units))} × ${format(displayLength(config.heightMm, config.units))} ${unit}`;
  const details = [
    config.showRoads ? "roads" : "",
    config.showTrails ? "trails" : "",
    config.showWater ? "water outlines" : "",
    config.showBoundaries ? "state/province boundaries" : "",
    config.showCoordinateGrid ? "latitude/longitude grid" : "",
  ].filter(Boolean);
  const roadAppearance = config.lineStyle.roadStyle === "centerline" ? "centerlines" : `outlined major roads spaced ${format(config.lineStyle.majorRoadSpacingMm)} mm`;
  const linework = `Road appearance: ${roadAppearance}, ${config.lineStyle.roadCap} endpoints. Line widths: minor contours ${format(config.lineStyle.contourMm)} mm, index contours ${format(config.lineStyle.indexContourMm)} mm, major roads ${format(config.lineStyle.majorRoadMm)} mm, local roads ${format(config.lineStyle.localRoadMm)} mm, trails ${format(config.lineStyle.trailMm)} mm (${config.lineStyle.trailPattern}), water ${format(config.lineStyle.waterMm)} mm, state/province boundaries ${format(config.lineStyle.boundaryMm)} mm (dashed), latitude/longitude grid ${format(config.lineStyle.coordinateGridMm)} mm (dotted), annotations ${format(config.lineStyle.annotationMm)} mm, border ${format(config.lineStyle.borderMm)} mm.\n`;
  const readme = `${ir.projectName}\n\nFlat topographic engraving\nArtwork size: ${size}\nContour lines: ${config.engravingContourCount}\nIndex contour: every ${config.engravingIndexInterval} lines\n${linework}Map details: ${details.length ? details.join(", ") : "none"}\nBorder: ${config.showEngravingBorder ? "engraved" : "none"}\n\nThe SVG contains one black ENGRAVE operation group and no CUT or SCORE paths. Minor and index contours are separated into named subgroups so their line weights can be assigned independently. Verify physical dimensions, focus, power, speed, and material settings with a small test engraving before processing the final item. Terrain data is decorative and is not survey, navigation, or engineering data.\n`;
  const files: ExportFile[] = [
    master,
    { filename: `${base}-project.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) },
    { filename: "README.txt", blob: new Blob([readme], { type: "text/plain" }) },
    { filename: "ATTRIBUTION.txt", blob: new Blob([attribution], { type: "text/plain" }) },
  ];
  return { schemaVersion: 1, master, files };
}

export function buildProjectPackage(ir: GeometryIRV1, config: ProjectConfigV1): FabricationPackageV1 {
  return config.outputMode === "engraving" ? buildEngravingPackage(ir, config) : buildFabricationPackage(ir, config);
}

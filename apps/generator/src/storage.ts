import { del, get, set } from "idb-keyval";
import { DEFAULT_PROJECT, validateProject, type NorthArrowAnchor, type NorthArrowStyle, type ProjectConfigV1 } from "@topostack/core";

const PROJECT_KEY = "topostack:project:v1";

function numberValue(value: unknown): number { return typeof value === "number" ? value : Number.NaN; }
function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}
function unitValue(value: unknown): ProjectConfigV1["units"] {
  if (value === undefined) return DEFAULT_PROJECT.units;
  if (value === "metric" || value === "imperial") return value;
  throw new Error("Project units must be metric or imperial.");
}
function textFontValue(value: unknown): ProjectConfigV1["textStyle"]["font"] {
  if (value === "technical" || value === "rounded" || value === "stencil") return value;
  throw new Error("Text font must be technical, rounded, or stencil.");
}
function northArrowStyleValue(value: unknown): NorthArrowStyle {
  if (value === "minimal" || value === "classic" || value === "mariner") return value;
  throw new Error("North arrow style must be minimal, classic, or mariner.");
}
function northArrowAnchorValue(value: unknown): NorthArrowAnchor {
  if (value === "top-left" || value === "top" || value === "top-right" || value === "left" || value === "center" || value === "right" || value === "bottom-left" || value === "bottom" || value === "bottom-right") return value;
  throw new Error("North arrow anchor is invalid.");
}

export async function loadProject(): Promise<ProjectConfigV1 | undefined> {
  try {
    const value = await get<unknown>(PROJECT_KEY);
    if (value === undefined) return undefined;
    return parseProject(value);
  } catch (error) {
    console.warn("TopoStack: ignoring a saved project that could not be restored.", error);
    return undefined;
  }
}

export function parseProject(value: unknown): ProjectConfigV1 {
  if (!value || typeof value !== "object") throw new Error("Project must be a JSON object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("Not a TopoStack v1 project.");
  const location = record.location;
  if (!location || typeof location !== "object") throw new Error("Project location is missing.");
  const locationRecord = location as Record<string, unknown>;
  const boundsRecord = locationRecord.bounds && typeof locationRecord.bounds === "object" ? locationRecord.bounds as Record<string, unknown> : undefined;
  if (record.elevationLabelPosition !== undefined && (!record.elevationLabelPosition || typeof record.elevationLabelPosition !== "object")) throw new Error("Elevation label position is invalid.");
  const labelPositionRecord = record.elevationLabelPosition as Record<string, unknown> | undefined;
  if (record.textStyle !== undefined && (!record.textStyle || typeof record.textStyle !== "object")) throw new Error("Text style is invalid.");
  const textStyleRecord = record.textStyle as Record<string, unknown> | undefined;
  if (record.northArrowPlacement !== undefined && (!record.northArrowPlacement || typeof record.northArrowPlacement !== "object")) throw new Error("North arrow placement is invalid.");
  const northArrowPlacementRecord = record.northArrowPlacement as Record<string, unknown> | undefined;
  const northArrowOffsetRecord = northArrowPlacementRecord?.offset && typeof northArrowPlacementRecord.offset === "object" ? northArrowPlacementRecord.offset as Record<string, unknown> : undefined;
  const project: ProjectConfigV1 = {
    ...DEFAULT_PROJECT,
    schemaVersion: 1,
    id: typeof record.id === "string" && record.id.trim() ? record.id : crypto.randomUUID(),
    name: typeof record.name === "string" && record.name.trim() ? record.name.slice(0, 120) : "Terrain project",
    location: {
      lat: numberValue(locationRecord.lat), lon: numberValue(locationRecord.lon), zoom: numberValue(locationRecord.zoom),
      label: typeof locationRecord.label === "string" ? locationRecord.label.slice(0, 240) : "Custom coordinates",
      ...(boundsRecord ? { bounds: { west: numberValue(boundsRecord.west), south: numberValue(boundsRecord.south), east: numberValue(boundsRecord.east), north: numberValue(boundsRecord.north) } } : {}),
    },
    cropShape: record.cropShape === "circle" ? "circle" : record.cropShape === "rectangle" ? "rectangle" : DEFAULT_PROJECT.cropShape,
    units: unitValue(record.units),
    widthMm: numberValue(record.widthMm), heightMm: numberValue(record.heightMm), materialThicknessMm: numberValue(record.materialThicknessMm),
    layerCount: numberValue(record.layerCount),
    minimumFeatureMm: record.minimumFeatureMm === undefined ? DEFAULT_PROJECT.minimumFeatureMm : numberValue(record.minimumFeatureMm),
    smoothing: record.smoothing === undefined ? DEFAULT_PROJECT.smoothing : numberValue(record.smoothing),
    showRoads: booleanValue(record.showRoads, "showRoads"),
    showTrails: record.showTrails === undefined ? booleanValue(record.showRoads, "showRoads") : booleanValue(record.showTrails, "showTrails"),
    showTransportationLabels: record.showTransportationLabels === undefined ? false : booleanValue(record.showTransportationLabels, "showTransportationLabels"),
    showWater: booleanValue(record.showWater, "showWater"),
    showAlignmentGuides: record.showAlignmentGuides === undefined ? DEFAULT_PROJECT.showAlignmentGuides : booleanValue(record.showAlignmentGuides, "showAlignmentGuides"),
    optimizeMaterialUse: record.optimizeMaterialUse === undefined ? DEFAULT_PROJECT.optimizeMaterialUse : booleanValue(record.optimizeMaterialUse, "optimizeMaterialUse"),
    glueMarginMm: record.glueMarginMm === undefined ? DEFAULT_PROJECT.glueMarginMm : numberValue(record.glueMarginMm),
    laserKerfMm: record.laserKerfMm === undefined ? DEFAULT_PROJECT.laserKerfMm : numberValue(record.laserKerfMm),
    showElevationLabels: booleanValue(record.showElevationLabels, "showElevationLabels"), showNorthArrow: booleanValue(record.showNorthArrow, "showNorthArrow"), showScaleBar: booleanValue(record.showScaleBar, "showScaleBar"),
    elevationLabelPosition: labelPositionRecord ? { x: numberValue(labelPositionRecord.x), y: numberValue(labelPositionRecord.y) } : { ...DEFAULT_PROJECT.elevationLabelPosition },
    textStyle: textStyleRecord ? {
      font: textFontValue(textStyleRecord.font),
      sizeMm: numberValue(textStyleRecord.sizeMm),
    } : { ...DEFAULT_PROJECT.textStyle },
    northArrowStyle: record.northArrowStyle === undefined ? DEFAULT_PROJECT.northArrowStyle : northArrowStyleValue(record.northArrowStyle),
    northArrowSizeMm: record.northArrowSizeMm === undefined ? DEFAULT_PROJECT.northArrowSizeMm : numberValue(record.northArrowSizeMm),
    northArrowPlacement: northArrowPlacementRecord ? {
      anchor: northArrowAnchorValue(northArrowPlacementRecord.anchor),
      offset: northArrowOffsetRecord ? { x: numberValue(northArrowOffsetRecord.x), y: numberValue(northArrowOffsetRecord.y) } : { ...DEFAULT_PROJECT.northArrowPlacement.offset },
    } : { anchor: DEFAULT_PROJECT.northArrowPlacement.anchor, offset: { ...DEFAULT_PROJECT.northArrowPlacement.offset } },
    explodedPreview: record.explodedPreview === undefined ? DEFAULT_PROJECT.explodedPreview : numberValue(record.explodedPreview),
  };
  validateProject(project);
  if (!Number.isFinite(project.explodedPreview) || project.explodedPreview < 0 || project.explodedPreview > 1) throw new Error("Exploded preview must be between 0 and 1.");
  return project;
}

export async function saveProject(project: ProjectConfigV1): Promise<void> {
  await set(PROJECT_KEY, project);
}

export async function clearProject(): Promise<void> {
  await del(PROJECT_KEY);
}

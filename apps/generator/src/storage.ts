import { del, get, set } from "idb-keyval";
import { DEFAULT_PROJECT, validateProject, type ProjectConfigV1 } from "@topostack/core";

const PROJECT_KEY = "topostack:project:v1";

function numberValue(value: unknown): number { return typeof value === "number" ? value : Number.NaN; }
function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

export async function loadProject(): Promise<ProjectConfigV1 | undefined> {
  try {
    const value = await get<unknown>(PROJECT_KEY);
    if (value === undefined) return undefined;
    return parseProject(value);
  } catch { return undefined; }
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
    widthMm: numberValue(record.widthMm), heightMm: numberValue(record.heightMm), materialThicknessMm: numberValue(record.materialThicknessMm),
    layerCount: numberValue(record.layerCount), minimumFeatureMm: numberValue(record.minimumFeatureMm), smoothing: numberValue(record.smoothing),
    showRoads: booleanValue(record.showRoads, "showRoads"), showWater: booleanValue(record.showWater, "showWater"), showContours: booleanValue(record.showContours, "showContours"),
    showElevationLabels: booleanValue(record.showElevationLabels, "showElevationLabels"), showNorthArrow: booleanValue(record.showNorthArrow, "showNorthArrow"), showScaleBar: booleanValue(record.showScaleBar, "showScaleBar"),
    elevationLabelPosition: labelPositionRecord ? { x: numberValue(labelPositionRecord.x), y: numberValue(labelPositionRecord.y) } : { ...DEFAULT_PROJECT.elevationLabelPosition },
    explodedPreview: numberValue(record.explodedPreview),
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

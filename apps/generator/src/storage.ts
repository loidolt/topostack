import { del, get, set } from "idb-keyval";
import { DEFAULT_PROJECT, validateProject, type CustomLineFeatureV1, type CustomLineKind, type MapMarkerV1, type MarkerSymbol, type NorthArrowAnchor, type NorthArrowStyle, type ProjectConfigV1 } from "@topostack/core";

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
function waterFillPatternValue(value: unknown): ProjectConfigV1["waterFillPattern"] {
  if (value === undefined) return DEFAULT_PROJECT.waterFillPattern;
  if (value === "none" || value === "lines" || value === "ripples" || value === "dots") return value;
  throw new Error("Water fill pattern must be none, lines, ripples, or dots.");
}
function outputModeValue(value: unknown): ProjectConfigV1["outputMode"] {
  if (value === undefined) return DEFAULT_PROJECT.outputMode;
  if (value === "stack" || value === "engraving") return value;
  throw new Error("Project output mode must be stack or engraving.");
}
function textFontValue(value: unknown): ProjectConfigV1["textStyle"]["font"] {
  if (value === "technical" || value === "rounded" || value === "stencil") return value;
  throw new Error("Text font must be technical, rounded, or stencil.");
}
function trailPatternValue(value: unknown): ProjectConfigV1["lineStyle"]["trailPattern"] {
  if (value === "solid" || value === "dashed" || value === "dotted") return value;
  throw new Error("Trail pattern must be solid, dashed, or dotted.");
}
function roadStyleValue(value: unknown): ProjectConfigV1["lineStyle"]["roadStyle"] {
  if (value === undefined) return DEFAULT_PROJECT.lineStyle.roadStyle;
  if (value === "centerline" || value === "outlined") return value;
  throw new Error("Road style must be centerline or outlined.");
}
function roadCapValue(value: unknown): ProjectConfigV1["lineStyle"]["roadCap"] {
  if (value === undefined) return DEFAULT_PROJECT.lineStyle.roadCap;
  if (value === "round" || value === "square") return value;
  throw new Error("Road cap must be round or square.");
}
function northArrowStyleValue(value: unknown): NorthArrowStyle {
  if (value === "minimal" || value === "classic" || value === "mariner") return value;
  throw new Error("North arrow style must be minimal, classic, or mariner.");
}
function northArrowAnchorValue(value: unknown): NorthArrowAnchor {
  if (value === "top-left" || value === "top" || value === "top-right" || value === "left" || value === "center" || value === "right" || value === "bottom-left" || value === "bottom" || value === "bottom-right") return value;
  throw new Error("North arrow anchor is invalid.");
}

function markerSymbolValue(value: unknown): MarkerSymbol {
  if (value === "pin" || value === "circle" || value === "triangle" || value === "star" || value === "cross") return value;
  throw new Error("Marker symbol is invalid.");
}

function markersValue(value: unknown): MapMarkerV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Project markers must be a list.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Each marker must be an object.");
    const marker = item as Record<string, unknown>;
    if (typeof marker.id !== "string") throw new Error("Each marker must have an id.");
    return { id: marker.id, lat: numberValue(marker.lat), lon: numberValue(marker.lon), symbol: markerSymbolValue(marker.symbol) };
  });
}

function customLineKindValue(value: unknown): CustomLineKind {
  if (value === "trail" || value === "boundary") return value;
  throw new Error("Custom line type must be trail or boundary.");
}

function customLinesValue(value: unknown): CustomLineFeatureV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Custom lines must be a list.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Each custom line must be an object.");
    const line = item as Record<string, unknown>;
    if (typeof line.id !== "string") throw new Error("Each custom line must have an id.");
    if (!Array.isArray(line.points)) throw new Error("Each custom line must contain a point list.");
    return {
      id: line.id,
      kind: customLineKindValue(line.kind),
      points: line.points.map((point) => {
        if (!point || typeof point !== "object") throw new Error("Each custom line point must be an object.");
        const coordinate = point as Record<string, unknown>;
        return { lat: numberValue(coordinate.lat), lon: numberValue(coordinate.lon) };
      }),
    };
  });
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

/** Overrides are keyed by HydroLAKES id, so any non-numeric entry is dropped rather than thrown on. */
function waterDepthOverridesValue(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};
  for (const [lake, depth] of Object.entries(value as Record<string, unknown>)) {
    if (/^[1-9]\d*$/.test(lake) && typeof depth === "number" && Number.isFinite(depth) && depth > 0 && depth <= 12000) result[lake] = depth;
  }
  return result;
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
  if (record.lineStyle !== undefined && (!record.lineStyle || typeof record.lineStyle !== "object")) throw new Error("Line style is invalid.");
  const lineStyleRecord = record.lineStyle as Record<string, unknown> | undefined;
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
    outputMode: outputModeValue(record.outputMode),
    widthMm: numberValue(record.widthMm), heightMm: numberValue(record.heightMm), materialThicknessMm: numberValue(record.materialThicknessMm),
    engravingContourCount: record.engravingContourCount === undefined ? DEFAULT_PROJECT.engravingContourCount : numberValue(record.engravingContourCount),
    engravingIndexInterval: record.engravingIndexInterval === undefined ? DEFAULT_PROJECT.engravingIndexInterval : numberValue(record.engravingIndexInterval),
    showEngravingBorder: record.showEngravingBorder === undefined ? DEFAULT_PROJECT.showEngravingBorder : booleanValue(record.showEngravingBorder, "showEngravingBorder"),
    lineStyle: lineStyleRecord ? {
      contourMm: numberValue(lineStyleRecord.contourMm),
      indexContourMm: numberValue(lineStyleRecord.indexContourMm),
      majorRoadMm: numberValue(lineStyleRecord.majorRoadMm),
      localRoadMm: numberValue(lineStyleRecord.localRoadMm),
      trailMm: numberValue(lineStyleRecord.trailMm),
      waterMm: numberValue(lineStyleRecord.waterMm),
      boundaryMm: lineStyleRecord.boundaryMm === undefined ? DEFAULT_PROJECT.lineStyle.boundaryMm : numberValue(lineStyleRecord.boundaryMm),
      coordinateGridMm: lineStyleRecord.coordinateGridMm === undefined ? DEFAULT_PROJECT.lineStyle.coordinateGridMm : numberValue(lineStyleRecord.coordinateGridMm),
      annotationMm: numberValue(lineStyleRecord.annotationMm),
      borderMm: numberValue(lineStyleRecord.borderMm),
      trailPattern: trailPatternValue(lineStyleRecord.trailPattern),
      roadStyle: roadStyleValue(lineStyleRecord.roadStyle),
      majorRoadSpacingMm: lineStyleRecord.majorRoadSpacingMm === undefined ? DEFAULT_PROJECT.lineStyle.majorRoadSpacingMm : numberValue(lineStyleRecord.majorRoadSpacingMm),
      roadCap: roadCapValue(lineStyleRecord.roadCap),
    } : { ...DEFAULT_PROJECT.lineStyle },
    verticalExaggeration: record.verticalExaggeration === undefined ? DEFAULT_PROJECT.verticalExaggeration : numberValue(record.verticalExaggeration),
    minimumFeatureMm: record.minimumFeatureMm === undefined ? DEFAULT_PROJECT.minimumFeatureMm : numberValue(record.minimumFeatureMm),
    smoothing: record.smoothing === undefined ? DEFAULT_PROJECT.smoothing : numberValue(record.smoothing),
    showRoads: booleanValue(record.showRoads, "showRoads"),
    showTrails: record.showTrails === undefined ? booleanValue(record.showRoads, "showRoads") : booleanValue(record.showTrails, "showTrails"),
    showTransportationLabels: record.showTransportationLabels === undefined ? false : booleanValue(record.showTransportationLabels, "showTransportationLabels"),
    showWater: booleanValue(record.showWater, "showWater"),
    waterFillPattern: waterFillPatternValue(record.waterFillPattern),
    showBoundaries: record.showBoundaries === undefined ? DEFAULT_PROJECT.showBoundaries : booleanValue(record.showBoundaries, "showBoundaries"),
    showCoordinateGrid: record.showCoordinateGrid === undefined ? DEFAULT_PROJECT.showCoordinateGrid : booleanValue(record.showCoordinateGrid, "showCoordinateGrid"),
    showWaterDepth: record.showWaterDepth === undefined ? DEFAULT_PROJECT.showWaterDepth : booleanValue(record.showWaterDepth, "showWaterDepth"),
    waterDepthExaggeration: record.waterDepthExaggeration === undefined ? DEFAULT_PROJECT.waterDepthExaggeration : numberValue(record.waterDepthExaggeration),
    waterDepthOverrides: waterDepthOverridesValue(record.waterDepthOverrides),
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
    markers: markersValue(record.markers),
    customLines: customLinesValue(record.customLines),
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

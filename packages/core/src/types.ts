export type CropShape = "rectangle" | "circle";
export type Operation = "cut" | "score" | "engrave";
export type UnitSystem = "metric" | "imperial";
export type TextFont = "technical" | "rounded" | "stencil";
export type TransportationClass = "major-road" | "local-road" | "trail";

export interface TextStyleV1 {
  font: TextFont;
  /** Physical cap height of fabrication text in millimeters. */
  sizeMm: number;
}

export const TEXT_FONTS: readonly TextFont[] = ["technical", "rounded", "stencil"];
export const DEFAULT_TEXT_STYLE: TextStyleV1 = { font: "technical", sizeMm: 3.1 };

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ProjectConfigV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  location: GeoPoint & { label: string; zoom: number; bounds?: GeoBounds };
  cropShape: CropShape;
  units: UnitSystem;
  widthMm: number;
  heightMm: number;
  materialThicknessMm: number;
  layerCount: number;
  minimumFeatureMm: number;
  smoothing: number;
  showRoads: boolean;
  showTrails: boolean;
  showTransportationLabels: boolean;
  showWater: boolean;
  showAlignmentGuides: boolean;
  optimizeMaterialUse: boolean;
  glueMarginMm: number;
  laserKerfMm: number;
  showElevationLabels: boolean;
  elevationLabelPosition: Point2D;
  textStyle: TextStyleV1;
  showNorthArrow: boolean;
  showScaleBar: boolean;
  explodedPreview: number;
}

export interface ElevationGrid {
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
}

export interface SourceAttribution {
  name: string;
  url: string;
  license: string;
}

export interface MarkingFeature {
  id: string;
  kind: "road" | "trail" | "water" | "contour" | "label" | "guide";
  operation: Exclude<Operation, "cut">;
  points: Point2D[];
  label?: string;
  transportationClass?: TransportationClass;
  elevationM?: number;
}

export interface SourceBundleV1 {
  schemaVersion: 1;
  elevation: ElevationGrid;
  markings: MarkingFeature[];
  vectorStatus: "available" | "unavailable" | "not-requested";
  datasetVersion: string;
  sourceKind: "real" | "preview" | "synthetic";
  bounds: GeoBounds;
  imagerySources: string[];
  resolutionM?: number;
  attribution: SourceAttribution[];
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Ring invariants relied on throughout the geometry engine:
 * - every ring is explicitly closed (first point equals last point exactly);
 * - `outer` is wound positively (counter-clockwise in the mm coordinate
 *   space), `holes` are wound negatively;
 * - coordinates are millimeters centered on the material origin.
 */
export interface Polygon2D {
  outer: Point2D[];
  holes: Point2D[][];
}

export interface OperationPath {
  id: string;
  operation: Exclude<Operation, "cut">;
  kind: MarkingFeature["kind"];
  points: Point2D[];
  label?: string;
  labelRotationRad?: number;
  textStyle?: TextStyleV1;
  transportationClass?: TransportationClass;
}

export interface LayerIR {
  id: string;
  index: number;
  elevationM: number;
  materialThicknessMm: number;
  polygons: Polygon2D[];
  markings: OperationPath[];
}

export interface FabricationNestCavity {
  donorPolygonIndex: number;
  donorHoleIndex: number;
  nestedPolygonIndex: number;
}

export interface FabricationNest {
  id: string;
  donorLayerIndex: number;
  nestedLayerIndex: number;
  glueMarginMm: number;
  cavities: FabricationNestCavity[];
}

export interface GeometryWarning {
  code: "LOW_RELIEF" | "EMPTY_LAYER" | "SMALL_FEATURES" | "DATA_FALLBACK" | "VECTOR_DATA_UNAVAILABLE" | "LABEL_OMITTED";
  message: string;
}

export interface GeometryIRV1 {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  units: UnitSystem;
  configFingerprint: string;
  sourceKind: SourceBundleV1["sourceKind"];
  vectorStatus: SourceBundleV1["vectorStatus"];
  datasetVersion: string;
  bounds: GeoBounds;
  resolutionM?: number;
  imagerySources: string[];
  widthMm: number;
  heightMm: number;
  laserKerfMm: number;
  minElevationM: number;
  maxElevationM: number;
  layers: LayerIR[];
  fabricationNests: FabricationNest[];
  warnings: GeometryWarning[];
  attribution: SourceAttribution[];
  generatedAt: string;
}

export interface ExportFile {
  filename: string;
  blob: Blob;
}

export interface FabricationPackageV1 {
  schemaVersion: 1;
  files: ExportFile[];
  /** Convenience pointer to the master-layout SVG; the same file is also present in `files`. */
  master: ExportFile;
}

export interface MapDataProvider {
  getElevation(config: ProjectConfigV1, signal?: AbortSignal): Promise<SourceBundleV1>;
}

export const DEFAULT_PROJECT: ProjectConfigV1 = {
  schemaVersion: 1,
  id: "topostack-demo",
  name: "Crater Lake",
  location: { lat: 42.9446, lon: -122.109, label: "Crater Lake, Oregon", zoom: 11 },
  cropShape: "rectangle",
  units: "metric",
  widthMm: 300,
  heightMm: 200,
  materialThicknessMm: 3,
  layerCount: 10,
  minimumFeatureMm: 0.8,
  smoothing: 1,
  showRoads: true,
  showTrails: true,
  showTransportationLabels: false,
  showWater: true,
  showAlignmentGuides: true,
  optimizeMaterialUse: true,
  glueMarginMm: 8,
  laserKerfMm: 0.15,
  showElevationLabels: true,
  elevationLabelPosition: { x: -0.55, y: 0.55 },
  textStyle: { ...DEFAULT_TEXT_STYLE },
  showNorthArrow: true,
  showScaleBar: true,
  explodedPreview: 0.35,
};

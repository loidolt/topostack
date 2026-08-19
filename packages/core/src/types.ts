export type CropShape = "rectangle" | "circle";
export type Operation = "cut" | "score" | "engrave";

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
  widthMm: number;
  heightMm: number;
  materialThicknessMm: number;
  layerCount: number;
  minimumFeatureMm: number;
  smoothing: number;
  showRoads: boolean;
  showWater: boolean;
  showContours: boolean;
  showElevationLabels: boolean;
  elevationLabelPosition: Point2D;
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
  kind: "road" | "water" | "contour" | "label" | "guide";
  operation: Exclude<Operation, "cut">;
  points: Point2D[];
  label?: string;
  elevationM?: number;
}

export interface SourceBundleV1 {
  schemaVersion: 1;
  elevation: ElevationGrid;
  markings: MarkingFeature[];
  vectorStatus: "available" | "unavailable" | "not-requested";
  datasetVersion: string;
  sourceKind: "real" | "synthetic";
  bounds: GeoBounds;
  imagerySources: string[];
  resolutionM?: number;
  attribution: SourceAttribution[];
}

export interface Point2D {
  x: number;
  y: number;
}

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
}

export interface LayerIR {
  id: string;
  index: number;
  elevationM: number;
  materialThicknessMm: number;
  polygons: Polygon2D[];
  markings: OperationPath[];
}

export interface GeometryWarning {
  code: "LOW_RELIEF" | "EMPTY_LAYER" | "SMALL_FEATURES" | "DATA_FALLBACK" | "VECTOR_DATA_UNAVAILABLE" | "LABEL_OMITTED";
  message: string;
}

export interface GeometryIRV1 {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  configFingerprint: string;
  sourceKind: "real" | "synthetic";
  vectorStatus: SourceBundleV1["vectorStatus"];
  datasetVersion: string;
  bounds: GeoBounds;
  resolutionM?: number;
  imagerySources: string[];
  widthMm: number;
  heightMm: number;
  minElevationM: number;
  maxElevationM: number;
  layers: LayerIR[];
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
  master: ExportFile;
}

export interface MapDataProvider {
  getElevation(config: ProjectConfigV1, signal?: AbortSignal): Promise<SourceBundleV1>;
}

export const DEFAULT_PROJECT: ProjectConfigV1 = {
  schemaVersion: 1,
  id: "topostack-demo",
  name: "Mount Rainier",
  location: { lat: 46.8523, lon: -121.7603, label: "Mount Rainier, Washington", zoom: 11 },
  cropShape: "rectangle",
  widthMm: 300,
  heightMm: 200,
  materialThicknessMm: 3,
  layerCount: 10,
  minimumFeatureMm: 0.8,
  smoothing: 1,
  showRoads: true,
  showWater: true,
  showContours: true,
  showElevationLabels: true,
  elevationLabelPosition: { x: -0.55, y: 0.55 },
  showNorthArrow: true,
  showScaleBar: true,
  explodedPreview: 0.35,
};

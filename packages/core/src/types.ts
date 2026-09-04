export type CropShape = "rectangle" | "circle";
export type OutputMode = "stack" | "engraving";
export type TrailPattern = "solid" | "dashed" | "dotted";
export type WaterFillPattern = "none" | "lines" | "ripples" | "dots";
export type RoadStyle = "centerline" | "outlined";
export type RoadCap = "round" | "square";
export type Operation = "cut" | "score" | "engrave";
export type UnitSystem = "metric" | "imperial";
export type TextFont = "technical" | "rounded" | "stencil";
export type TransportationClass = "major-road" | "local-road" | "trail";
export type NorthArrowStyle = "minimal" | "classic" | "mariner";
export type MarkerSymbol = "pin" | "circle" | "triangle" | "star" | "cross";
export type CustomLineKind = "trail" | "boundary";
export type NorthArrowAnchor = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";

export interface MapMarkerV1 extends GeoPoint {
  id: string;
  symbol: MarkerSymbol;
}

export const MARKER_SYMBOLS: readonly MarkerSymbol[] = ["pin", "circle", "triangle", "star", "cross"];
export const MAP_MARKER_SIZE_MM = 8;
export const MAP_MARKER_CLEARANCE_MM = 1.2;
export const CUSTOM_LINE_KINDS: readonly CustomLineKind[] = ["trail", "boundary"];

export interface CustomLineFeatureV1 {
  id: string;
  kind: CustomLineKind;
  points: GeoPoint[];
}

export interface NorthArrowPlacementV1 {
  anchor: NorthArrowAnchor;
  /** Fine adjustment as a fraction of the available center travel. */
  offset: Point2D;
}

export const NORTH_ARROW_STYLES: readonly NorthArrowStyle[] = ["minimal", "classic", "mariner"];
export const NORTH_ARROW_ANCHORS: readonly NorthArrowAnchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
export const NORTH_ARROW_MIN_SIZE_MM = 12;
export const NORTH_ARROW_MAX_SIZE_MM = 200;
export const NORTH_ARROW_MAX_MAP_FRACTION = 0.45;

export interface TextStyleV1 {
  font: TextFont;
  /** Physical cap height of fabrication text in millimeters. */
  sizeMm: number;
}

/** Physical stroke hierarchy shared by previews and machine SVGs. */
export interface LineStyleV1 {
  contourMm: number;
  indexContourMm: number;
  majorRoadMm: number;
  localRoadMm: number;
  trailMm: number;
  waterMm: number;
  boundaryMm: number;
  coordinateGridMm: number;
  annotationMm: number;
  borderMm: number;
  trailPattern: TrailPattern;
  /** Major roads can be a single continuous stroke or two parallel edge strokes. */
  roadStyle: RoadStyle;
  /** Center-to-center spacing between the two strokes used by outlined major roads. */
  majorRoadSpacingMm: number;
  roadCap: RoadCap;
}

export const DEFAULT_LINE_STYLE: LineStyleV1 = {
  contourMm: 0.16,
  indexContourMm: 0.32,
  majorRoadMm: 0.38,
  localRoadMm: 0.26,
  trailMm: 0.22,
  waterMm: 0.3,
  boundaryMm: 0.24,
  coordinateGridMm: 0.16,
  annotationMm: 0.2,
  borderMm: 0.34,
  trailPattern: "dashed",
  roadStyle: "centerline",
  majorRoadSpacingMm: 0.8,
  roadCap: "round",
};

export const TEXT_FONTS: readonly TextFont[] = ["technical", "rounded", "stencil"];
export const DEFAULT_TEXT_STYLE: TextStyleV1 = { font: "technical", sizeMm: 3.1 };

export const MIN_LAYER_COUNT = 2;
export const MAX_LAYER_COUNT = 24;
export const MIN_VERTICAL_EXAGGERATION = 1;
export const MAX_VERTICAL_EXAGGERATION = 20;

/**
 * Sheets the stack may spend below the water datum at 1x depth. Ocean bathymetry
 * runs to thousands of meters, so without a cap a single coastal map would spend
 * its whole sheet budget on abyssal plain and leave the land two layers thick.
 *
 * Raising `waterDepthExaggeration` raises this in step: the cap protects a
 * reader who never touched the control, but it must not silently ignore one who
 * did. The stack's own 24-sheet limit is the real ceiling.
 */
export const MAX_DEPTH_LAYER_COUNT = 6;

/**
 * Water depth is exaggerated relative to the terrain, not independently of it.
 * The carve writes real metres and the whole stack is contoured at one step, so
 * depth already rises and falls with `verticalExaggeration`; this multiplies it
 * on top of that. 1x keeps water on exactly the terrain's vertical scale.
 */
// The water toggle is the off switch, so the scale never reaches zero: two
// ways to say "flat" would leave the depth panel emptying itself mid-drag.
export const MIN_WATER_DEPTH_EXAGGERATION = 0.25;
export const MAX_WATER_DEPTH_EXAGGERATION = 4;

/** Sea level, and the elevation the threshold ladder snaps to when ocean is present. */
export const SEA_LEVEL_M = 0;

/**
 * A DEM already knows a water body's depth when its interior varies by more
 * than this. Terrarium carries real soundings for oceans but renders every
 * lake - the Great Lakes included - flat at surface elevation, so this is what
 * separates "carve a modeled basin" from "leave the survey alone".
 */
export const BATHYMETRIC_RELIEF_M = 5;

export type WaterKind = "ocean" | "lake";
export type DepthSource = "surveyed" | "modeled" | "user";

/**
 * Physical consequences of a config plus its terrain relief. Layer count is a
 * result of the model's own scale, never an input: the stack is as tall as the
 * exaggerated relief demands, and the material thickness decides how many
 * sheets that takes.
 */
export interface TerrainStackPlan {
  /** Layers the relief resolves to at this scale and thickness, clamped to 2-24. */
  layerCount: number;
  /** Exaggeration actually applied; differs from the requested value when the clamp bites. */
  verticalExaggeration: number;
  stackHeightMm: number;
  /** Sheets of the total spent below the water datum, capped at MAX_DEPTH_LAYER_COUNT. */
  depthLayerCount: number;
  /** Elevation covered by one sheet of material. */
  metersPerLayer: number;
  /** Horizontal scale as a fraction - 1/78247 for the bundled preview. */
  horizontalScale: number;
}

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
  /** Physical result: a layered cut model or one flat engrave-only graphic. */
  outputMode: OutputMode;
  widthMm: number;
  heightMm: number;
  /** Number of elevation contour lines in a flat engraving. */
  engravingContourCount: number;
  /** Every nth contour is emitted as a heavier index contour. */
  engravingIndexInterval: number;
  /** Adds an engraved outline around the selected crop. Never a cut path. */
  showEngravingBorder: boolean;
  lineStyle: LineStyleV1;
  materialThicknessMm: number;
  verticalExaggeration: number;
  minimumFeatureMm: number;
  smoothing: number;
  showRoads: boolean;
  showTrails: boolean;
  showTransportationLabels: boolean;
  showWater: boolean;
  /** Optional vector pattern engraved inside water areas in flat mode. */
  waterFillPattern: WaterFillPattern;
  showBoundaries: boolean;
  showCoordinateGrid: boolean;
  showWaterDepth: boolean;
  /** Depth multiplier relative to the terrain's vertical scale; 1 matches it. */
  waterDepthExaggeration: number;
  /** Per-lake maximum-depth overrides in meters, keyed by HydroLAKES id. */
  waterDepthOverrides: Record<string, number>;
  showAlignmentGuides: boolean;
  optimizeMaterialUse: boolean;
  glueMarginMm: number;
  laserKerfMm: number;
  showElevationLabels: boolean;
  elevationLabelPosition: Point2D;
  textStyle: TextStyleV1;
  showNorthArrow: boolean;
  northArrowStyle: NorthArrowStyle;
  northArrowSizeMm: number;
  northArrowPlacement: NorthArrowPlacementV1;
  showScaleBar: boolean;
  /** User-placed symbols, projected from geographic coordinates onto the artwork. */
  markers: MapMarkerV1[];
  /** User-authored geographic paths, independent of fetched map-detail toggles. */
  customLines: CustomLineFeatureV1[];
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
  kind: "road" | "trail" | "water" | "boundary" | "grid" | "contour" | "label" | "guide" | "marker";
  operation: Exclude<Operation, "cut">;
  points: Point2D[];
  label?: string;
  transportationClass?: TransportationClass;
  elevationM?: number;
}

/**
 * A water body with whatever depth metadata its source could supply. Oceans
 * arrive from the OSM water layer and carry no depth - the DEM already holds
 * their bed. Lakes arrive from the HydroLAKES/GLOBathy archive and carry the
 * numbers `carveWaterDepth` needs to model one.
 */
export interface WaterAreaV1 {
  id: string;
  kind: WaterKind;
  polygon: Polygon2D;
  name?: string;
  hylakId?: number;
  /** HydroLAKES `Elevation`; the DEM median inside the polygon is the fallback. */
  surfaceElevationM?: number;
  /** GLOBathy `Dmax_use_m`. */
  maxDepthM?: number;
  /** HydroLAKES `Depth_avg`, i.e. `Vol_total / Lake_area`. */
  meanDepthM?: number;
  /**
   * Maximum inscribed-circle radius of the *whole* lake, in meters - the `L` in
   * GLOBathy's `D = l * Dmax / L`. Precomputed at provisioning time because a
   * lake larger than the map window would otherwise normalize against a clipped
   * radius and come out far too shallow.
   */
  lmaxM?: number;
  /** True when the polygon reaches the edge of the fetched window. */
  clipped?: boolean;
  /** Set to "user" once a per-lake override has replaced `maxDepthM`. */
  depthSource?: DepthSource;
}

export interface WaterSurfaceIR {
  id: string;
  kind: WaterKind;
  name?: string;
  hylakId?: number;
  polygons: Polygon2D[];
  surfaceElevationM: number;
  bedElevationM: number;
  /**
   * Real-world maximum depth in metres, after any override but *before*
   * exaggeration - so a control bound to it edits the depth of the actual lake
   * rather than the depth of the drawing.
   */
  maxDepthM?: number;
  /** Layer whose top face the surface sits on. */
  layerIndex: number;
  depthSource: DepthSource;
}

export interface SourceBundleV1 {
  schemaVersion: 1;
  elevation: ElevationGrid;
  markings: MarkingFeature[];
  waterAreas?: WaterAreaV1[];
  /** OSM water polygons retained independently of depth-modeling metadata. */
  waterPatternAreas?: Polygon2D[];
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
  /** Closed engraving paths that should render as solid marker artwork. */
  filled?: boolean;
  /** Paper/material-colored geometry that protects a marker from underlying engravings. */
  knockout?: boolean;
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
  code: "LOW_RELIEF" | "EMPTY_LAYER" | "SMALL_FEATURES" | "DATA_FALLBACK" | "VECTOR_DATA_UNAVAILABLE" | "LABEL_OMITTED" | "WATER_DEPTH_CLAMPED";
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
  lineStyle: LineStyleV1;
  verticalExaggeration: number;
  minElevationM: number;
  maxElevationM: number;
  /** Relief of the land alone - what the sheet budget is sized from. */
  landReliefM: number;
  /** How far the deepest water reaches below the land minimum. */
  waterDepthBelowLandM: number;
  layers: LayerIR[];
  waterSurfaces: WaterSurfaceIR[];
  /** Crop-clipped water polygons used by optional flat-engraving fills. */
  waterPatternAreas: Polygon2D[];
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
  outputMode: "stack",
  widthMm: 300,
  heightMm: 200,
  engravingContourCount: 12,
  engravingIndexInterval: 5,
  showEngravingBorder: true,
  lineStyle: { ...DEFAULT_LINE_STYLE },
  materialThicknessMm: 3,
  verticalExaggeration: 2,
  minimumFeatureMm: 0.8,
  smoothing: 1,
  showRoads: true,
  showTrails: true,
  showTransportationLabels: false,
  showWater: true,
  waterFillPattern: "none",
  showBoundaries: false,
  showCoordinateGrid: false,
  showWaterDepth: true,
  waterDepthExaggeration: 1,
  waterDepthOverrides: {},
  showAlignmentGuides: true,
  optimizeMaterialUse: true,
  glueMarginMm: 8,
  laserKerfMm: 0.15,
  showElevationLabels: true,
  elevationLabelPosition: { x: -0.55, y: 0.55 },
  textStyle: { ...DEFAULT_TEXT_STYLE },
  showNorthArrow: true,
  northArrowStyle: "classic",
  northArrowSizeMm: 24,
  northArrowPlacement: { anchor: "bottom-right", offset: { x: 0, y: 0 } },
  showScaleBar: true,
  markers: [],
  customLines: [],
  explodedPreview: 0.35,
};

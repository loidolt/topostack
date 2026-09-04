import { contours } from "d3-contour";
import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";
import {
  type Bounds2D,
  boundsOverlap,
  clamp,
  close,
  distanceToSegment,
  pointAt,
  pointInPolygon,
  pointInRing,
  ringBounds,
  ringFitsInsidePolygon,
  segmentIntersectionT,
  signedArea,
} from "./geometry2d.js";
import { placeElevationLabelStack, placeLabel, placeLinearLabel } from "./label-placement.js";
import { geoPointToMapPoint, markerSymbolCenterForAnchor, markerSymbolPaths } from "./markers.js";
import { offsetClosedRing } from "./offset.js";
import { northArrowFootprint, northArrowMarkings } from "./north-arrow.js";
import { displayElevation, elevationUnit, FEET_PER_METER } from "./units.js";
import { CUSTOM_LINE_KINDS, MAP_MARKER_CLEARANCE_MM, MAP_MARKER_SIZE_MM, MARKER_SYMBOLS, MAX_DEPTH_LAYER_COUNT, MAX_LAYER_COUNT, MAX_WATER_DEPTH_EXAGGERATION, MIN_WATER_DEPTH_EXAGGERATION, MAX_VERTICAL_EXAGGERATION, MIN_LAYER_COUNT, MIN_VERTICAL_EXAGGERATION, NORTH_ARROW_ANCHORS, NORTH_ARROW_MAX_MAP_FRACTION, NORTH_ARROW_MAX_SIZE_MM, NORTH_ARROW_MIN_SIZE_MM, NORTH_ARROW_STYLES, SEA_LEVEL_M } from "./types.js";
import { carveWaterDepth, clampCarveToLadder } from "./water.js";
import type {
  ElevationGrid,
  GeoBounds,
  GeometryIRV1,
  FabricationNest,
  LayerIR,
  MarkingFeature,
  Point2D,
  Polygon2D,
  ProjectConfigV1,
  SourceBundleV1,
  TerrainStackPlan,
  TransportationClass,
  WaterAreaV1,
  WaterSurfaceIR,
} from "./types.js";

const TRANSPORTATION_LABEL_LIMIT = 80;

function boundary(config: ProjectConfigV1): Point2D[] {
  const w = config.widthMm / 2;
  const h = config.heightMm / 2;
  if (config.cropShape === "rectangle") {
    return [
      { x: -w, y: -h },
      { x: w, y: -h },
      { x: w, y: h },
      { x: -w, y: h },
      { x: -w, y: -h },
    ];
  }

  const radius = Math.min(w, h);
  const points = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  // sin/cos of 2π are not exactly 0, so close with a copy of the first point
  // rather than a 97th sample; consumers require first === last exactly.
  return [...points, { ...points[0]! }];
}

function toRing(points: Point2D[]): Ring {
  return points.map(({ x, y }) => [x, y] as Pair);
}

function toPoint(ringPoint: Pair): Point2D {
  return { x: ringPoint[0], y: ringPoint[1] };
}

function containingPolygonIndexes(children: Polygon2D[], containers: Polygon2D[], marginMm: number, allowContainedHoles = false): number[] | undefined {
  const indexes: number[] = [];
  for (const child of children) {
    const containerIndex = containers.findIndex((container) => ringFitsInsidePolygon(child.outer, container, marginMm, allowContainedHoles));
    if (containerIndex < 0) return undefined;
    indexes.push(containerIndex);
  }
  return indexes;
}

function ringsOverlap(left: Point2D[], right: Point2D[]): boolean {
  if (!boundsOverlap(ringBounds(left), ringBounds(right))) return false;
  if (left.some((point) => pointInRing(point, right)) || right.some((point) => pointInRing(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    const leftStart = left[leftIndex];
    const leftEnd = left[leftIndex + 1];
    if (!leftStart || !leftEnd) continue;
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      const rightStart = right[rightIndex];
      const rightEnd = right[rightIndex + 1];
      if (rightStart && rightEnd && segmentIntersectionT(leftStart, leftEnd, rightStart, rightEnd) !== undefined) return true;
    }
  }
  return false;
}

// Re-validation of an existing nest after a later nest carved cavities into its
// covering layer. Contained holes are allowed here because by then every hole
// inside the nested ring is a chained cavity that the creation-time check below
// already proved is covered one level higher — unlike terrain holes, which the
// creation-time check rejects.
function nestHasGlueMargin(nest: FabricationNest, layers: LayerIR[], laserKerfMm: number): boolean {
  const nestedLayer = layers[nest.nestedLayerIndex];
  const coveringLayer = layers[nest.donorLayerIndex + 1];
  return Boolean(nestedLayer && coveringLayer && containingPolygonIndexes(nestedLayer.polygons, coveringLayer.polygons, nest.glueMarginMm + laserKerfMm, true));
}

function addMaterialNests(config: ProjectConfigV1, layers: LayerIR[]): FabricationNest[] {
  if (!config.optimizeMaterialUse) return [];
  const nests: FabricationNest[] = [];
  const nestedLayersWithParents = new Set<number>();
  const requiredClearanceMm = config.glueMarginMm + config.laserKerfMm;
  for (let donorLayerIndex = 0; donorLayerIndex < layers.length - 2; donorLayerIndex += 1) {
    const protectedNorthArrow = donorLayerIndex === 0 && config.showNorthArrow ? northArrowFootprint(config) : undefined;
    for (let nestedLayerIndex = donorLayerIndex + 2; nestedLayerIndex < layers.length; nestedLayerIndex += 1) {
      if (nestedLayersWithParents.has(nestedLayerIndex)) continue;
      const nestedLayer = layers[nestedLayerIndex];
      if (!nestedLayer || nestedLayer.polygons.length === 0) continue;
      const donorLayer = layers[donorLayerIndex];
      const coveringLayer = layers[donorLayerIndex + 1];
      if (!donorLayer || !coveringLayer || coveringLayer.polygons.length === 0) continue;
      if (protectedNorthArrow && nestedLayer.polygons.some((polygon) => ringsOverlap(protectedNorthArrow, polygon.outer))) continue;
      // The covering layer must not have terrain holes inside the nested ring:
      // nothing above covers a terrain hole, so the cavity carved into the
      // donor would be visible through it in the assembled model. At creation
      // time the covering layer has no cavity holes yet (donors ascend), so
      // every contained hole is terrain — reject them all.
      if (!containingPolygonIndexes(nestedLayer.polygons, coveringLayer.polygons, requiredClearanceMm)) continue;
      const donorPolygonIndexes = containingPolygonIndexes(nestedLayer.polygons, donorLayer.polygons, requiredClearanceMm);
      if (!donorPolygonIndexes) continue;
      const cavities = nestedLayer.polygons.map((polygon, nestedPolygonIndex) => {
        const donorPolygonIndex = donorPolygonIndexes[nestedPolygonIndex]!;
        const donorPolygon = donorLayer.polygons[donorPolygonIndex]!;
        const donorHoleIndex = donorPolygon.holes.length;
        donorPolygon.holes.push(signedArea(polygon.outer) > 0 ? [...polygon.outer].reverse() : [...polygon.outer]);
        return { donorPolygonIndex, donorHoleIndex, nestedPolygonIndex };
      });
      const nest: FabricationNest = {
        id: `nest-${nestedLayer.id}-inside-${donorLayer.id}`,
        donorLayerIndex,
        nestedLayerIndex,
        glueMarginMm: config.glueMarginMm,
        cavities,
      };
      const invalidatedAdjacentNest = nests.some((existingNest) => existingNest.donorLayerIndex + 1 === donorLayerIndex && !nestHasGlueMargin(existingNest, layers, config.laserKerfMm));
      if (invalidatedAdjacentNest) {
        [...cavities].reverse().forEach((cavity) => donorLayer.polygons[cavity.donorPolygonIndex]?.holes.splice(cavity.donorHoleIndex, 1));
        continue;
      }
      nests.push(nest);
      nestedLayersWithParents.add(nestedLayerIndex);
      break;
    }
  }
  return nests;
}

function polygonCenter(polygon: Polygon2D, config: ProjectConfigV1): Point2D {
  const points = polygon.outer.slice(0, -1);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: ((Math.min(...xs) + Math.max(...xs)) / 2) / (config.widthMm / 2),
    y: ((Math.min(...ys) + Math.max(...ys)) / 2) / (config.heightMm / 2),
  };
}

function clipPolyline(points: Point2D[], polygons: Polygon2D[], excludedPolygons: Polygon2D[] = []): Point2D[][] {
  if (points.length < 2) return [];
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  const rings = [...polygons, ...excludedPolygons].flatMap((polygon) => [polygon.outer, ...polygon.holes]).map((ring) => ({ ring, bounds: ringBounds(ring) }));
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    const segmentBounds: Bounds2D = {
      minX: Math.min(a.x, b.x) - 1e-6,
      minY: Math.min(a.y, b.y) - 1e-6,
      maxX: Math.max(a.x, b.x) + 1e-6,
      maxY: Math.max(a.y, b.y) + 1e-6,
    };
    const cuts = [0, 1];
    for (const { ring, bounds } of rings) {
      if (!boundsOverlap(segmentBounds, bounds)) continue;
      for (let edge = 0; edge < ring.length - 1; edge += 1) {
        const t = ring[edge] && ring[edge + 1] ? segmentIntersectionT(a, b, ring[edge]!, ring[edge + 1]!) : undefined;
        if (t !== undefined) cuts.push(t);
      }
    }
    cuts.sort((left, right) => left - right);
    const unique = cuts.filter((value, cutIndex) => cutIndex === 0 || Math.abs(value - cuts[cutIndex - 1]!) > 1e-7);
    for (let cutIndex = 0; cutIndex < unique.length - 1; cutIndex += 1) {
      const startT = unique[cutIndex]!;
      const endT = unique[cutIndex + 1]!;
      const midpoint = pointAt(a, b, (startT + endT) / 2);
      if (polygons.some((polygon) => pointInPolygon(midpoint, polygon)) && !excludedPolygons.some((polygon) => pointInPolygon(midpoint, polygon))) {
        const start = pointAt(a, b, startT);
        const end = pointAt(a, b, endT);
        const previous = active[active.length - 1];
        if (!previous || Math.hypot(previous.x - start.x, previous.y - start.y) > 1e-6) {
          if (active.length > 1) result.push(active);
          active = [start];
        }
        active.push(end);
      } else if (active.length > 1) {
        result.push(active);
        active = [];
      }
    }
  }
  if (active.length > 1) result.push(active);
  return result;
}

function offsetPolyline(points: Point2D[], distanceMm: number): Point2D[] {
  if (points.length < 2) return [];
  const segmentNormals = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    return length > 1e-9 ? { x: -(next.y - point.y) / length, y: (next.x - point.x) / length } : { x: 0, y: 0 };
  });
  return points.map((point, index) => {
    const previous = segmentNormals[Math.max(0, index - 1)] ?? { x: 0, y: 0 };
    const next = segmentNormals[Math.min(segmentNormals.length - 1, index)] ?? previous;
    const sum = { x: previous.x + next.x, y: previous.y + next.y };
    const length = Math.hypot(sum.x, sum.y);
    const normal = length > 1e-6 ? { x: sum.x / length, y: sum.y / length } : next;
    const dot = Math.max(0.5, Math.abs(normal.x * next.x + normal.y * next.y));
    const miter = Math.min(Math.abs(distanceMm) / dot, Math.abs(distanceMm) * 2) * Math.sign(distanceMm || 1);
    return { x: point.x + normal.x * miter, y: point.y + normal.y * miter };
  });
}

function styledTransportationPaths(points: Point2D[], transportationClass: TransportationClass, config: ProjectConfigV1, polygons: Polygon2D[], excludedPolygons: Polygon2D[] = []): Point2D[][] {
  if (transportationClass === "major-road" && config.lineStyle.roadStyle === "outlined") {
    const offsetMm = config.lineStyle.majorRoadSpacingMm / 2;
    return [-offsetMm, offsetMm].flatMap((distance) => clipPolyline(offsetPolyline(points, distance), polygons, excludedPolygons));
  }
  return clipPolyline(points, polygons, excludedPolygons);
}

function fabricationLabel(value: string): string | undefined {
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/[^A-Z0-9 .:\/_+\-·]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
  return normalized || undefined;
}

function polylineLength(points: Point2D[]): number {
  return points.reduce((total, point, index) => {
    const next = points[index + 1];
    return total + (next ? Math.hypot(next.x - point.x, next.y - point.y) : 0);
  }, 0);
}

interface TransportationJunction { point: Point2D; arms: number; hasMajorRoad: boolean }

function transportationJunctions(features: MarkingFeature[]): TransportationJunction[] {
  const junctions = new Map<string, TransportationJunction>();
  for (const feature of features) {
    const transportationClass = feature.transportationClass ?? (feature.kind === "road" ? "local-road" : undefined);
    if (!transportationClass || transportationClass === "trail" || feature.points.length < 2) continue;
    feature.points.forEach((point, index) => {
      const key = `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
      const current = junctions.get(key) ?? { point, arms: 0, hasMajorRoad: false };
      current.arms += index === 0 || index === feature.points.length - 1 ? 1 : 2;
      current.hasMajorRoad ||= transportationClass === "major-road";
      junctions.set(key, current);
    });
  }
  return [...junctions.values()].filter((junction) => junction.arms >= 3 && junction.hasMajorRoad)
    .sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x);
}

function junctionRing(center: Point2D, radiusMm: number): Point2D[] {
  const points = Array.from({ length: 20 }, (_, index) => {
    const angle = index / 20 * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radiusMm, y: center.y + Math.sin(angle) * radiusMm };
  });
  return [...points, { ...points[0]! }];
}

function coveringPolygons(layers: LayerIR[], layerIndex: number): Polygon2D[] {
  return layers.slice(layerIndex + 1).flatMap((layer) => layer.polygons);
}

function addAlignmentGuides(config: ProjectConfigV1, layers: LayerIR[]): void {
  for (let index = 0; index < layers.length - 1; index += 1) {
    const layer = layers[index];
    const nextLayer = layers[index + 1];
    if (!layer || !nextLayer || nextLayer.polygons.length === 0) continue;
    const layerNumber = String(layer.index + 1).padStart(2, "0");
    const nextLayerNumber = String(nextLayer.index + 1).padStart(2, "0");
    nextLayer.polygons.forEach((polygon, polygonIndex) => {
      offsetClosedRing(polygon.outer, -config.laserKerfMm, "round").forEach((inset, insetIndex) => {
        clipPolyline(inset, layer.polygons).forEach((points, clipIndex) => layer.markings.push({
          id: `alignment-layer-${layerNumber}-to-${nextLayerNumber}-${polygonIndex}-inset-${insetIndex}-outline-${clipIndex}`,
          operation: "engrave",
          kind: "guide",
          points,
        }));
      });
      const label = `L${nextLayerNumber}`;
      const point = placeLabel(label, config, layer.polygons, layer.markings, polygonCenter(polygon, config), [polygon]);
      if (point) layer.markings.push({
        id: `alignment-layer-${layerNumber}-to-${nextLayerNumber}-${polygonIndex}-label`,
        operation: "engrave",
        kind: "guide",
        points: [point],
        label,
        textStyle: config.textStyle,
      });
    });
  }
}

function stableProjectValue(config: ProjectConfigV1): unknown {
  const { explodedPreview: _previewOnly, ...fabricationConfig } = config;
  return {
    ...fabricationConfig,
    location: { ...config.location, bounds: config.location.bounds ? { ...config.location.bounds } : undefined },
  };
}

// Canonical JSON: object keys sorted recursively so value-identical configs
// hash identically regardless of key insertion order.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function projectFingerprint(config: ProjectConfigV1): string {
  const input = stableStringify(stableProjectValue(config));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v4-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function distanceM(lat: number, lonA: number, lonB: number): number {
  const radians = Math.PI / 180;
  return Math.abs((lonB - lonA) * radians) * 6_371_008.8 * Math.cos(lat * radians);
}

/**
 * Resolve a config and its terrain relief into physical stack dimensions.
 *
 * The model's horizontal scale already exists — `widthMm` over the ground width
 * of the mapped bounds — so the true-scale height of the relief is a fact, not
 * a preference. Exaggeration multiplies that height, and the material thickness
 * divides it into sheets. Layer count is therefore always the last term.
 *
 * When the sheet count lands outside the fabricable range the count is clamped
 * and the exaggeration is refitted to whatever that clamp implies, so the
 * reported figure always describes the model that will actually be cut. The
 * refitted value can fall below `MIN_VERTICAL_EXAGGERATION` or rise above
 * `MAX_VERTICAL_EXAGGERATION`; those bounds constrain the request, not the fit.
 */
export function planTerrainStack(config: ProjectConfigV1, reliefM: number, bounds: GeoBounds, depthBelowLandM = 0): TerrainStackPlan {
  const requested = config.verticalExaggeration;
  const groundWidthM = distanceM((bounds.north + bounds.south) / 2, bounds.west, bounds.east);
  const flat = {
    layerCount: MIN_LAYER_COUNT,
    depthLayerCount: 0,
    verticalExaggeration: requested,
    stackHeightMm: MIN_LAYER_COUNT * config.materialThicknessMm,
    metersPerLayer: Math.max(0, reliefM) / MIN_LAYER_COUNT,
    horizontalScale: 0,
  };
  if (!Number.isFinite(groundWidthM) || groundWidthM <= 0 || !Number.isFinite(reliefM) || reliefM <= 0) return flat;

  const horizontalScale = config.widthMm / (groundWidthM * 1000);
  const trueReliefMm = reliefM * (config.widthMm / groundWidthM);
  if (!(trueReliefMm > 0)) return { ...flat, horizontalScale };

  const landLayerCount = clamp(Math.round((trueReliefMm * requested) / config.materialThicknessMm), MIN_LAYER_COUNT, MAX_LAYER_COUNT);
  const metersPerLayer = reliefM / landLayerCount;
  // Depth is spent at the same vertical scale as the land, so the sea floor
  // steps in step with the hills. The cap is what stops a coastal map from
  // spending its whole budget below the waterline.
  // Round up, not to nearest: a ladder half a sheet short of the water it was
  // sized for would flatten the deepest part and report it as over budget, when
  // one more sheet covers it exactly.
  const depthBudget = Math.min(
    Math.max(MAX_DEPTH_LAYER_COUNT, Math.ceil(MAX_DEPTH_LAYER_COUNT * Math.max(1, config.waterDepthExaggeration))),
    MAX_LAYER_COUNT - landLayerCount,
  );
  const depthLayerCount = Number.isFinite(depthBelowLandM) && depthBelowLandM > 0 && metersPerLayer > 0
    ? clamp(Math.ceil(depthBelowLandM / metersPerLayer), 0, Math.max(0, depthBudget))
    : 0;
  const layerCount = landLayerCount + depthLayerCount;
  return {
    layerCount,
    depthLayerCount,
    // The refit describes the land, which is the part a reader judges the
    // exaggeration by; depth sheets ride along at the same scale.
    verticalExaggeration: (landLayerCount * config.materialThicknessMm) / trueReliefMm,
    stackHeightMm: layerCount * config.materialThicknessMm,
    metersPerLayer,
    horizontalScale,
  };
}

function niceScaleDistance(maximumM: number): number {
  if (!(maximumM > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(maximumM));
  return [5, 2, 1].map((factor) => factor * power).find((value) => value <= maximumM) ?? power;
}

function scaleMarking(maximumM: number, units: ProjectConfigV1["units"]): { distanceM: number; label: string } {
  if (units === "metric") {
    const distanceM = niceScaleDistance(maximumM);
    return { distanceM, label: distanceM >= 1000 ? `${Number((distanceM / 1000).toFixed(1))} km` : `${Math.round(distanceM)} m` };
  }
  const maximumFeet = maximumM * FEET_PER_METER;
  if (maximumFeet >= 2640) {
    const miles = niceScaleDistance(maximumFeet / 5280);
    return { distanceM: miles * 5280 / FEET_PER_METER, label: `${Number(miles.toFixed(1))} mi` };
  }
  const feet = niceScaleDistance(maximumFeet);
  return { distanceM: feet / FEET_PER_METER, label: `${Math.round(feet)} ft` };
}

function removeTinyRing(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return true;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) < minimumFeatureMm || Math.max(...ys) - Math.min(...ys) < minimumFeatureMm;
}

// Douglas–Peucker: keeps every vertex that deviates from the simplified shape
// by more than tolerance. The previous distance-bucket thinning kept collinear
// stair-step vertices while dropping genuine curvature, which read as chunky.
function simplify(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 5 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = tolerance;
    let maxIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(points[index]!, points[start]!, points[end]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return close(points.filter((_, index) => keep[index] === 1));
}

// One Chaikin corner-cutting pass per ring, applied before clipping so the
// crop boundary keeps its sharp corners. Rounds the 90°/45° stair corners
// marching squares leaves behind without measurably shrinking features.
function chaikinRing(ring: Pair[]): Pair[] {
  if (ring.length < 5) return ring;
  const open = ring.slice(0, -1);
  const result: Ring = [];
  for (let index = 0; index < open.length; index += 1) {
    const current = open[index]!;
    const next = open[(index + 1) % open.length]!;
    result.push(
      [current[0] * 0.75 + next[0] * 0.25, current[1] * 0.75 + next[1] * 0.25],
      [current[0] * 0.25 + next[0] * 0.75, current[1] * 0.25 + next[1] * 0.75],
    );
  }
  result.push([result[0]![0], result[0]![1]]);
  return result;
}

// d3-contour emits ring coordinates in cell space where sample (i, j) sits at
// (i + 0.5, j + 0.5); map samples 0..n-1 onto the full material span so the
// forward mapping stays the exact inverse of sampleElevation.
function contourToMm(point: [number, number], grid: ElevationGrid, config: ProjectConfigV1): Point2D {
  return {
    x: ((point[0] - 0.5) / (grid.width - 1) - 0.5) * config.widthMm,
    y: ((point[1] - 0.5) / (grid.height - 1) - 0.5) * config.heightMm,
  };
}

function clipContours(raw: MultiPolygon, clip: Point2D[], minimumFeatureMm: number): Polygon2D[] {
  const result = polygonClipping.intersection(raw, [[toRing(clip)]]) as MultiPolygon;
  const polygons: Polygon2D[] = [];
  for (const polygon of result) {
    const [outerRing, ...holeRings] = polygon;
    if (!outerRing) continue;
    let outer = simplify(close(outerRing.map(toPoint)), minimumFeatureMm * 0.18);
    if (removeTinyRing(outer, minimumFeatureMm)) continue;
    if (signedArea(outer) < 0) outer = [...outer].reverse();
    const holes = holeRings
      .map((ring) => simplify(close(ring.map(toPoint)), minimumFeatureMm * 0.18))
      .filter((ring) => !removeTinyRing(ring, minimumFeatureMm))
      .map((ring) => (signedArea(ring) > 0 ? [...ring].reverse() : ring));
    polygons.push({ outer, holes });
  }
  return polygons;
}

function sampleElevation(grid: ElevationGrid, point: Point2D, config: ProjectConfigV1): number {
  const gridX = clamp(Math.round((point.x / config.widthMm + 0.5) * (grid.width - 1)), 0, grid.width - 1);
  const gridY = clamp(Math.round((point.y / config.heightMm + 0.5) * (grid.height - 1)), 0, grid.height - 1);
  return grid.values[gridY * grid.width + gridX] ?? grid.min;
}

function layerForElevation(elevation: number, thresholds: number[]): number {
  let layer = 0;
  for (let index = 1; index < thresholds.length; index += 1) {
    if (elevation >= (thresholds[index] ?? Number.POSITIVE_INFINITY)) layer = index;
  }
  return layer;
}

function isClosedWater(feature: MarkingFeature): boolean {
  return feature.kind === "water" && feature.points.length > 3 && Math.hypot(feature.points[0]!.x - feature.points.at(-1)!.x, feature.points[0]!.y - feature.points.at(-1)!.y) <= 1e-6;
}

function splitMarking(feature: MarkingFeature, thresholds: number[], grid: ElevationGrid, config: ProjectConfigV1): Array<{ layer: number; points: Point2D[] }> {
  if (isClosedWater(feature)) {
    const elevations = feature.points.slice(0, -1).map((point) => feature.elevationM ?? sampleElevation(grid, point, config)).sort((left, right) => left - right);
    const middle = Math.floor(elevations.length / 2);
    const elevation = elevations.length % 2 === 0 ? ((elevations[middle - 1] ?? grid.min) + (elevations[middle] ?? grid.min)) / 2 : (elevations[middle] ?? grid.min);
    return [{ layer: layerForElevation(elevation, thresholds), points: feature.points }];
  }
  const result: Array<{ layer: number; points: Point2D[] }> = [];
  // A single-point feature (e.g. a point label) still belongs to a layer even
  // though it produces no drawable segment.
  const minimumRun = feature.points.length === 1 ? 1 : 2;
  let activeLayer = -1;
  let active: Point2D[] = [];
  for (const point of feature.points) {
    const elevation = feature.elevationM ?? sampleElevation(grid, point, config);
    const layer = layerForElevation(elevation, thresholds);
    if (layer !== activeLayer) {
      if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
      activeLayer = layer;
      active = active.length ? [active[active.length - 1]!, point] : [point];
    } else {
      active.push(point);
    }
  }
  if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
  return result;
}

/** A readable, area-sensitive graticule interval chosen from 1/2/5 degree steps. */
export function coordinateGridInterval(bounds: GeoBounds): number {
  const target = Math.max(bounds.east - bounds.west, bounds.north - bounds.south) / 8;
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = magnitude * multiplier;
    if (candidate >= target - 1e-12) return candidate;
  }
  return magnitude * 10;
}

function coordinateGridValues(minimum: number, maximum: number, interval: number): number[] {
  const epsilon = interval * 1e-7;
  const values: number[] = [];
  for (let value = Math.ceil((minimum + epsilon) / interval) * interval; value < maximum - epsilon && values.length < 1000; value += interval) {
    values.push(Math.abs(value) < epsilon ? 0 : Number(value.toFixed(10)));
  }
  return values;
}

function mercatorWorldY(latitude: number): number {
  const radians = clamp(latitude, -85.0511, 85.0511) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

function coordinateGridMarkings(config: ProjectConfigV1, bounds: GeoBounds, grid: ElevationGrid): MarkingFeature[] {
  const interval = coordinateGridInterval(bounds);
  const longitudeSamples = Math.max(2, Math.min(256, grid.height));
  const latitudeSamples = Math.max(2, Math.min(256, grid.width));
  const northY = mercatorWorldY(bounds.north);
  const southY = mercatorWorldY(bounds.south);
  const markings: MarkingFeature[] = [];
  coordinateGridValues(bounds.west, bounds.east, interval).forEach((longitude) => {
    const x = ((longitude - bounds.west) / (bounds.east - bounds.west) - 0.5) * config.widthMm;
    markings.push({
      id: `coordinate-longitude-${Math.round(longitude * 1e7)}`,
      kind: "grid",
      operation: "engrave",
      points: Array.from({ length: longitudeSamples }, (_, index) => ({ x, y: (index / (longitudeSamples - 1) - 0.5) * config.heightMm })),
    });
  });
  coordinateGridValues(bounds.south, bounds.north, interval).forEach((latitude) => {
    const y = ((mercatorWorldY(latitude) - northY) / (southY - northY) - 0.5) * config.heightMm;
    markings.push({
      id: `coordinate-latitude-${Math.round(latitude * 1e7)}`,
      kind: "grid",
      operation: "engrave",
      points: Array.from({ length: latitudeSamples }, (_, index) => ({ x: (index / (latitudeSamples - 1) - 0.5) * config.widthMm, y })),
    });
  });
  return markings;
}

function waterPatternAreasFromShorelines(markings: MarkingFeature[]): Polygon2D[] {
  const grouped = new Map<string, Map<number, Point2D[]>>();
  for (const marking of markings) {
    const match = marking.kind === "water" ? marking.id.match(/^(.*water-area-[^-]+)-shore-(\d+)/) : undefined;
    if (!match || marking.points.length < 4) continue;
    const rings = grouped.get(match[1]!) ?? new Map<number, Point2D[]>();
    rings.set(Number(match[2]), marking.points);
    grouped.set(match[1]!, rings);
  }
  return [...grouped.values()].flatMap((rings) => {
    const outer = rings.get(0);
    return outer ? [{ outer, holes: [...rings.entries()].filter(([index]) => index > 0).sort(([left], [right]) => left - right).map(([, points]) => points) }] : [];
  });
}

export function generateGeometry(config: ProjectConfigV1, source: SourceBundleV1): GeometryIRV1 {
  validateProject(config);
  if (source.schemaVersion !== 1) throw new Error("Unsupported source-data schema version.");
  const grid = source.elevation;
  if (grid.values.length !== grid.width * grid.height) throw new Error("Elevation grid dimensions do not match its values.");
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || !Number.isFinite(grid.min) || !Number.isFinite(grid.max) || grid.max < grid.min) throw new Error("Elevation grid metadata is invalid.");
  for (const value of grid.values) if (!Number.isFinite(value)) throw new Error("Elevation grid contains non-finite values.");
  if (![source.bounds.west, source.bounds.south, source.bounds.east, source.bounds.north].every(Number.isFinite) || source.bounds.west >= source.bounds.east || source.bounds.south >= source.bounds.north) throw new Error("Source geographic bounds are invalid.");

  const warnings: GeometryIRV1["warnings"] = [];
  const flatEngraving = config.outputMode === "engraving";
  const usesWaterDepth = !flatEngraving && config.showWaterDepth;
  if (source.vectorStatus !== "available" && (config.showRoads || config.showTrails || config.showWater || config.showBoundaries || usesWaterDepth)) warnings.push({
    code: "VECTOR_DATA_UNAVAILABLE",
    message: "Map detail data is unavailable. This project cannot be exported until the map data is restored or those details are disabled.",
  });
  // Carve modeled lake beds into the grid before anything reads it. Everything
  // downstream then produces the recess on its own: the contour rings become
  // holes, and holes are already honoured by clipping, nesting, and labelling.
  const waterAreas: WaterAreaV1[] = usesWaterDepth
    ? (source.waterAreas ?? []).map((area) => {
        const override = area.hylakId === undefined ? undefined : config.waterDepthOverrides[String(area.hylakId)];
        return override && override > 0 ? { ...area, maxDepthM: override, depthSource: "user" as const } : area;
      })
    : [];
  const groundWidthM = distanceM((source.bounds.north + source.bounds.south) / 2, source.bounds.west, source.bounds.east);
  const carved = carveWaterDepth(grid, config, waterAreas, groundWidthM);
  warnings.push(...carved.warnings);

  // Size the stack from land alone. A coastal map's grid minimum is the abyssal
  // plain, and dividing the whole of that across the sheet budget is what used
  // to squeeze the land into a layer or two.
  let landMin = Number.POSITIVE_INFINITY;
  let landMax = Number.NEGATIVE_INFINITY;
  let waterCells = 0;
  for (let index = 0; index < carved.grid.values.length; index += 1) {
    if (carved.waterMask[index]) { waterCells += 1; continue; }
    const value = carved.grid.values[index]!;
    if (value < landMin) landMin = value;
    if (value > landMax) landMax = value;
  }
  // With no water in view the land *is* the grid, so defer to its declared
  // range rather than re-deriving it: the stored samples are Float32 and the
  // metadata is not, and a map without water must plan exactly as it always has.
  if (waterCells === 0 || !Number.isFinite(landMin) || !Number.isFinite(landMax)) {
    landMin = carved.grid.min;
    landMax = carved.grid.max;
  }
  const landRelief = landMax - landMin;
  const depthBelowLandM = Math.max(0, landMin - carved.grid.min);
  if (landRelief < 20) warnings.push({ code: "LOW_RELIEF", message: flatEngraving ? "This area has very little elevation change; contour lines may be sparse." : "This area has very little elevation change; the layers may look nearly identical." });

  const clip = boundary(config);
  const stack = planTerrainStack(config, landRelief, source.bounds, depthBelowLandM);
  const hasOcean = !flatEngraving && waterAreas.some((area) => area.kind === "ocean");

  // The ladder runs at one uniform step, extended below the land minimum by the
  // depth sheets the budget allowed. When there is an ocean it is shifted so sea
  // level falls exactly on a step, which is what makes a coastline cut as a
  // clean sheet edge instead of a ragged one.
  let ladderBase = flatEngraving ? landMin : landMin - stack.depthLayerCount * stack.metersPerLayer;
  if (hasOcean && stack.metersPerLayer > 0) {
    ladderBase = SEA_LEVEL_M - Math.ceil((SEA_LEVEL_M - ladderBase) / stack.metersPerLayer) * stack.metersPerLayer;
  }
  // Snapping to sea level slides the whole ladder down by up to a full step, so
  // the sheet count is taken from the span the ladder actually has to cover.
  // Keeping the planned count instead would drop the summit off the top.
  const ladderLayerCount = flatEngraving
    ? config.engravingContourCount + 1
    : stack.metersPerLayer > 0
      ? clamp(Math.round((landMax - ladderBase) / stack.metersPerLayer), MIN_LAYER_COUNT, MAX_LAYER_COUNT)
      : stack.layerCount;
  const contourStepM = flatEngraving ? landRelief / (config.engravingContourCount + 1) : stack.metersPerLayer;
  const thresholds = Array.from({ length: ladderLayerCount }, (_, index) => ladderBase + contourStepM * index);

  // Water deeper than the ladder reaches is flattened at its floor rather than
  // silently punching through the base sheet.
  const { grid: modelGrid, clamped } = clampCarveToLadder(carved.grid, ladderBase);
  if (clamped && !flatEngraving) warnings.push({
    code: "WATER_DEPTH_CLAMPED",
    message: `Water here is deeper than the ${stack.depthLayerCount} sheet${stack.depthLayerCount === 1 ? "" : "s"} below the shoreline can hold, so its floor is flattened. Lower the water depth exaggeration, or use thinner material to buy more sheets.`,
  });

  const contourGenerator = contours().size([modelGrid.width, modelGrid.height]).smooth(config.smoothing > 0).thresholds(thresholds.slice(1));
  const generated = contourGenerator(Array.from(modelGrid.values));

  const layers: LayerIR[] = [{
    id: "layer-01",
    index: 0,
    elevationM: thresholds[0] ?? modelGrid.min,
    materialThicknessMm: config.materialThicknessMm,
    polygons: [{ outer: clip, holes: [] }],
    markings: [],
  }];

  generated.forEach((contour, generatedIndex) => {
    const raw: MultiPolygon = contour.coordinates.map((polygon) => polygon.map((ring) => {
      const mapped: Ring = ring.map((point) => {
        const point2d = contourToMm([point[0] ?? 0, point[1] ?? 0], modelGrid, config);
        return [point2d.x, point2d.y] as Pair;
      });
      return config.smoothing > 0 ? chaikinRing(mapped) : mapped;
    }));
    const polygons = clipContours(raw, clip, config.minimumFeatureMm);
    const index = generatedIndex + 1;
    if (polygons.length === 0) warnings.push({ code: "EMPTY_LAYER", message: `Layer ${index + 1} has no printable terrain at its elevation.` });
    layers.push({
      id: `layer-${String(index + 1).padStart(2, "0")}`,
      index,
      elevationM: thresholds[index] ?? modelGrid.max,
      materialThicknessMm: config.materialThicknessMm,
      polygons,
      markings: [],
    });
  });

  // Surfaces are virtual - never cut, only drawn - so they are clipped to the
  // crop here and carried on the IR for the previews to float over the basin.
  const waterSurfaces: WaterSurfaceIR[] = carved.surfaces.flatMap((surface) => {
    const polygons = surface.polygons.flatMap((polygon) => clipContours(
      [[toRing(polygon.outer), ...polygon.holes.map(toRing)]] as MultiPolygon,
      clip,
      config.minimumFeatureMm,
    ));
    if (!polygons.length) return [];
    return [{ ...surface, polygons, layerIndex: layerForElevation(surface.surfaceElevationM, thresholds) }];
  });

  const waterPatternAreas = flatEngraving && config.showWater && config.waterFillPattern !== "none"
    ? (source.waterPatternAreas ?? source.waterAreas?.map((area) => area.polygon) ?? waterPatternAreasFromShorelines(source.markings)).flatMap((polygon) => clipContours(
        [[toRing(polygon.outer), ...polygon.holes.map(toRing)]] as MultiPolygon,
        clip,
        config.minimumFeatureMm,
      ))
    : [];

  const fabricationNests = flatEngraving ? [] : addMaterialNests(config, layers);

  const transportationLabels = new Map<string, Array<{ layer: LayerIR; paths: Point2D[][]; transportationClass: TransportationClass; excludedPolygons: Polygon2D[] }>>();
  const baseLayer = layers[0];
  const customLineMarkings: MarkingFeature[] = config.customLines.map((line, index) => ({
    id: `custom-data-line-${index}`,
    kind: line.kind,
    operation: "engrave",
    points: line.points.map((point) => geoPointToMapPoint(point.lat, point.lon, source.bounds, config.widthMm, config.heightMm)),
    ...(line.kind === "trail" ? { transportationClass: "trail" as const } : {}),
  }));
  const mapMarkings = [
    ...source.markings,
    ...customLineMarkings,
    ...(config.showCoordinateGrid ? coordinateGridMarkings(config, source.bounds, modelGrid) : []),
  ];
  const sourceIdCounts = new Map<string, number>();
  mapMarkings.forEach((feature) => sourceIdCounts.set(feature.id, (sourceIdCounts.get(feature.id) ?? 0) + 1));
  const sourceIdOccurrences = new Map<string, number>();
  for (const feature of mapMarkings) {
    const sourceOccurrence = sourceIdOccurrences.get(feature.id) ?? 0;
    sourceIdOccurrences.set(feature.id, sourceOccurrence + 1);
    const featureId = (sourceIdCounts.get(feature.id) ?? 0) > 1 ? `${feature.id}-source-${sourceOccurrence}` : feature.id;
    const transportationClass = feature.transportationClass ?? (feature.kind === "trail" ? "trail" : feature.kind === "road" ? "local-road" : undefined);
    const isCustomData = feature.id.startsWith("custom-data-line-");
    const enabled = isCustomData ||
      (transportationClass === "trail" && config.showTrails) ||
      (transportationClass !== undefined && transportationClass !== "trail" && config.showRoads) ||
      (feature.kind === "water" && config.showWater) ||
      (feature.kind === "boundary" && config.showBoundaries) ||
      (feature.kind === "grid" && config.showCoordinateGrid) ||
      feature.kind === "contour" || feature.kind === "label" || feature.kind === "guide";
    if (!enabled) continue;
    // A flat engraving has one physical face. Routing every feature through
    // every elevation band only explodes one road into dozens of DOM/SVG paths
    // before reassembling it visually. Clip it to the crop once instead.
    if (flatEngraving && baseLayer) {
      if (transportationClass) {
        const clipped = clipPolyline(feature.points, baseLayer.polygons);
        styledTransportationPaths(feature.points, transportationClass, config, baseLayer.polygons).forEach((points, styleIndex) => baseLayer.markings.push({
          id: `${featureId}-flat-transport-${styleIndex}`,
          operation: "engrave",
          kind: transportationClass === "trail" ? "trail" : "road",
          transportationClass,
          points,
        }));
        const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label) : undefined;
        if (label && clipped.length) transportationLabels.set(label, [...(transportationLabels.get(label) ?? []), { layer: baseLayer, paths: clipped, transportationClass, excludedPolygons: [] }]);
      } else {
        if (feature.label && feature.points[0] && baseLayer.polygons.some((polygon) => pointInPolygon(feature.points[0]!, polygon))) {
          baseLayer.markings.push({ id: `${featureId}-flat-label`, operation: feature.operation, kind: feature.kind, points: [feature.points[0]], label: feature.label, textStyle: config.textStyle });
        }
        clipPolyline(feature.points, baseLayer.polygons)
          .filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm)
          .forEach((points, clipIndex) => baseLayer.markings.push({ id: `${featureId}-flat-${clipIndex}`, operation: feature.operation, kind: feature.kind, points }));
      }
      continue;
    }
    if (transportationClass) {
      layers.forEach((layer, layerIndex) => {
        const excludedPolygons = coveringPolygons(layers, layerIndex);
        const clipped = clipPolyline(feature.points, layer.polygons, excludedPolygons);
        styledTransportationPaths(feature.points, transportationClass, config, layer.polygons, excludedPolygons).forEach((points, styleIndex) => layer.markings.push({
          id: `${featureId}-${layer.index}-transport-${styleIndex}`,
          operation: "engrave",
          kind: transportationClass === "trail" ? "trail" : "road",
          transportationClass,
          points,
        }));
        const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label) : undefined;
        if (label && clipped.length) transportationLabels.set(label, [...(transportationLabels.get(label) ?? []), { layer, paths: clipped, transportationClass, excludedPolygons }]);
      });
      continue;
    }
    // Open waterways are draped over the exposed face of every terrain layer.
    // Assigning them from elevations sampled only at their source vertices can
    // skip every intermediate layer when a coarse segment crosses a contour,
    // leaving the score line visibly short of the step edge. Clipping the full
    // path against each exposed layer footprint makes adjacent pieces meet at
    // the exact contour intersection, independent of source vertex spacing.
    if (feature.kind === "water" && !isClosedWater(feature) && feature.elevationM === undefined) {
      layers.forEach((layer, layerIndex) => {
        const excludedPolygons = coveringPolygons(layers, layerIndex);
        clipPolyline(feature.points, layer.polygons, excludedPolygons).forEach((points, clipIndex) => layer.markings.push({
          id: `${featureId}-${layer.index}-terrain-${clipIndex}`,
          operation: feature.operation,
          kind: feature.kind,
          points,
        }));
      });
      // Keep the existing elevation-based label behavior while the line itself
      // follows the exact layer contours. Explicit-elevation water features use
      // the legacy path below because they intentionally belong to one plane.
      if (feature.label) {
        for (const [segmentIndex, segment] of splitMarking(feature, thresholds, modelGrid, config).entries()) {
          const layer = layers[segment.layer];
          if (layer && segment.points[0] && layer.polygons.some((polygon) => pointInPolygon(segment.points[0]!, polygon))) {
            layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
          }
        }
      }
      continue;
    }
    for (const [segmentIndex, segment] of splitMarking(feature, thresholds, modelGrid, config).entries()) {
      const layer = layers[segment.layer];
      if (!layer) continue;
      const clipped = clipPolyline(segment.points, layer.polygons);
      if (feature.label && segment.points[0] && layer.polygons.some((polygon) => pointInPolygon(segment.points[0]!, polygon))) {
        layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
      }
      clipped.filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm).forEach((points, clipIndex) => layer.markings.push({
        id: `${featureId}-${layer.index}-${segmentIndex}-${clipIndex}`,
        operation: feature.operation,
        kind: feature.kind,
        points,
      }));
    }
  }

  const enabledRoadFeatures = source.markings.filter((feature) => feature.kind === "road" && config.showRoads);
  const roadJunctions = config.lineStyle.roadStyle === "outlined" ? transportationJunctions(enabledRoadFeatures) : [];
  roadJunctions.forEach((junction, junctionIndex) => {
    const ring = junctionRing(junction.point, config.lineStyle.majorRoadSpacingMm / 2);
    (flatEngraving && baseLayer ? [baseLayer] : layers).forEach((layer, layerIndex) => {
      const excludedPolygons = flatEngraving ? [] : coveringPolygons(layers, layerIndex);
      clipPolyline(ring, layer.polygons, excludedPolygons).forEach((points, clipIndex) => layer.markings.push({
        id: `road-junction-${junctionIndex}-${layer.index}-${clipIndex}`,
        operation: "engrave",
        kind: "road",
        transportationClass: "major-road",
        points,
      }));
    });
  });

  if (baseLayer && config.showNorthArrow) {
    baseLayer.markings.push(...northArrowMarkings(config));
  }
  if (baseLayer && config.showScaleBar) {
    const radius = Math.min(config.widthMm, config.heightMm) / 2;
    const x = config.cropShape === "circle" ? -radius * 0.58 : -config.widthMm / 2 + 9;
    const y = config.cropShape === "circle" ? radius * 0.58 : -config.heightMm / 2 + 10;
    const groundWidthM = distanceM((source.bounds.north + source.bounds.south) / 2, source.bounds.west, source.bounds.east);
    // Pick the labeled distance from whatever fits the drawn cap, so the bar
    // length and its engraved label always agree.
    const maxLengthMm = config.cropShape === "circle" ? radius * 0.55 : config.widthMm * 0.35;
    const maxDistanceM = groundWidthM > 0 ? (maxLengthMm / config.widthMm) * groundWidthM : 0;
    const scale = scaleMarking(Math.min(groundWidthM * 0.2, maxDistanceM), config.units);
    const length = groundWidthM > 0 ? (scale.distanceM / groundWidthM) * config.widthMm : 0;
    baseLayer.markings.push(
      { id: "scale-main", operation: "engrave", kind: "guide", points: [{ x, y }, { x: x + length, y }] },
      { id: "scale-left", operation: "engrave", kind: "guide", points: [{ x, y: y - 1.7 }, { x, y: y + 1.7 }] },
      { id: "scale-right", operation: "engrave", kind: "guide", points: [{ x: x + length, y: y - 1.7 }, { x: x + length, y: y + 1.7 }] },
      { id: "scale-label", operation: "engrave", kind: "label", points: [{ x, y: y + 5 }], label: scale.label, textStyle: config.textStyle },
    );
  }

  if (!flatEngraving && config.showAlignmentGuides) addAlignmentGuides(config, layers);

  let transportationLabelIndex = 0;
  const labelEntries = [...transportationLabels].sort((left, right) => {
    const longest = (candidates: (typeof left)[1]) => Math.max(...candidates.flatMap((candidate) => candidate.paths.map(polylineLength)));
    return longest(right[1]) - longest(left[1]) || left[0].localeCompare(right[0]);
  }).slice(0, TRANSPORTATION_LABEL_LIMIT);
  for (const [label, candidates] of labelEntries) {
    const ordered = [...candidates].sort((left, right) => Math.max(...right.paths.map(polylineLength)) - Math.max(...left.paths.map(polylineLength)));
    for (const candidate of ordered) {
      const placement = placeLinearLabel(label, config, candidate.layer, candidate.paths, candidate.excludedPolygons);
      if (!placement) continue;
      candidate.layer.markings.push({
        id: `transport-label-${transportationLabelIndex++}`,
        operation: "engrave",
        kind: "label",
        transportationClass: candidate.transportationClass,
        points: [placement.point],
        label,
        labelRotationRad: placement.rotationRad,
        textStyle: config.textStyle,
      });
      break;
    }
  }

  if (config.showElevationLabels) {
    const omittedLayers: string[] = [];
    const labelsByLayer = layers.map((layer) => {
      const elevation = Math.round(displayElevation(layer.elevationM, config.units));
      const unit = elevationUnit(config.units);
      return [`${elevation} ${unit}`, `${elevation}${unit}`, `${elevation}`];
    });
    const placements = placeElevationLabelStack(labelsByLayer, config, layers);
    layers.forEach((layer, layerIndex) => {
      // A flat map labels only its emphasized index contours. Labelling every
      // minor line overwhelms the engraving and implies a label on the base
      // crop boundary, which is not itself a contour.
      if (flatEngraving && (layer.index === 0 || layer.index % config.engravingIndexInterval !== 0)) return;
      const placed = placements[layerIndex];
      if (!placed) {
        omittedLayers.push(String(layer.index + 1));
        return;
      }
      layer.markings.push({
        id: `elevation-${layer.index}`,
        operation: "engrave",
        kind: "label",
        points: [placed.placement.point],
        label: placed.label,
        labelRotationRad: placed.placement.rotationRad,
        textStyle: config.textStyle,
      });
    });
    if (omittedLayers.length) warnings.push({
      code: "LABEL_OMITTED",
      message: `Elevation labels were omitted from layer${omittedLayers.length === 1 ? "" : "s"} ${omittedLayers.join(", ")} because no collision-free position fit the exposed face.`,
    });
  }

  // Markers are added after every other annotation so their material-colored
  // knockout footprints can visibly interrupt contours, labels, and map
  // details before the solid symbol is drawn on top.
  config.markers.forEach((marker, markerIndex) => {
    if (marker.lon < source.bounds.west || marker.lon > source.bounds.east || marker.lat < source.bounds.south || marker.lat > source.bounds.north) return;
    const anchor = geoPointToMapPoint(marker.lat, marker.lon, source.bounds, config.widthMm, config.heightMm);
    const layer = flatEngraving ? baseLayer : layers[layerForElevation(sampleElevation(modelGrid, anchor, config), thresholds)];
    if (!layer || !layer.polygons.some((polygon) => pointInPolygon(anchor, polygon))) return;
    const symbolCenter = markerSymbolCenterForAnchor(marker.symbol, anchor, MAP_MARKER_SIZE_MM);
    const paths = markerSymbolPaths(marker.symbol, symbolCenter, MAP_MARKER_SIZE_MM)
      .filter((_, pathIndex) => marker.symbol !== "pin" || pathIndex === 0);
    paths.forEach((path, pathIndex) => {
      offsetClosedRing(path, MAP_MARKER_CLEARANCE_MM, "round").forEach((halo, haloIndex) => {
        clipPolyline(halo, layer.polygons).forEach((points, clipIndex) => layer.markings.push({
          id: `map-marker-${markerIndex}-halo-${pathIndex}-${haloIndex}-${clipIndex}`,
          operation: "engrave",
          kind: "marker",
          points,
          filled: true,
          knockout: true,
        }));
      });
    });
    paths.forEach((path, pathIndex) => {
      clipPolyline(path, layer.polygons).forEach((points, clipIndex) => layer.markings.push({
        id: `map-marker-${markerIndex}-${pathIndex}-${clipIndex}`,
        operation: "engrave",
        kind: "marker",
        points,
        filled: true,
      }));
    });
  });

  // External vector archives are allowed to repeat source IDs. Preserve stable
  // human-readable prefixes while guaranteeing valid keyed previews and unique
  // SVG element IDs even when an upstream tile contains a duplicate feature.
  const markingIds = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  layers.forEach((layer) => layer.markings.forEach((marking) => {
    const original = marking.id;
    let occurrence = duplicateCounts.get(original) ?? 0;
    let candidate = occurrence === 0 ? original : `${original}-duplicate-${occurrence}`;
    while (markingIds.has(candidate)) {
      occurrence += 1;
      candidate = `${original}-duplicate-${occurrence}`;
    }
    duplicateCounts.set(original, occurrence + 1);
    marking.id = candidate;
    markingIds.add(candidate);
  }));

  return {
    schemaVersion: 1,
    projectId: config.id,
    projectName: config.name,
    units: config.units,
    configFingerprint: projectFingerprint(config),
    sourceKind: source.sourceKind,
    vectorStatus: source.vectorStatus,
    datasetVersion: source.datasetVersion,
    bounds: source.bounds,
    resolutionM: source.resolutionM,
    imagerySources: source.imagerySources,
    widthMm: config.widthMm,
    heightMm: config.heightMm,
    laserKerfMm: config.laserKerfMm,
    lineStyle: { ...config.lineStyle },
    verticalExaggeration: stack.verticalExaggeration,
    minElevationM: modelGrid.min,
    maxElevationM: modelGrid.max,
    landReliefM: landMax - landMin,
    waterDepthBelowLandM: depthBelowLandM,
    layers,
    waterSurfaces,
    waterPatternAreas,
    fabricationNests,
    warnings,
    attribution: source.attribution,
    generatedAt: new Date().toISOString(),
  };
}

export function validateProject(config: ProjectConfigV1): void {
  if (config.schemaVersion !== 1) throw new Error("Unsupported project schema version.");
  if (config.units !== "metric" && config.units !== "imperial") throw new Error("Project units must be metric or imperial.");
  if (config.outputMode !== "stack" && config.outputMode !== "engraving") throw new Error("Project output mode must be stack or engraving.");
  if (config.waterFillPattern !== "none" && config.waterFillPattern !== "lines" && config.waterFillPattern !== "ripples" && config.waterFillPattern !== "dots") throw new Error("Water fill pattern must be none, lines, ripples, or dots.");
  if (config.cropShape !== "rectangle" && config.cropShape !== "circle") throw new Error("Crop shape must be rectangle or circle.");
  if (!config.elevationLabelPosition || typeof config.elevationLabelPosition !== "object") throw new Error("Elevation label position is required.");
  if (!config.textStyle || typeof config.textStyle !== "object") throw new Error("Text style is required.");
  if (!config.lineStyle || typeof config.lineStyle !== "object") throw new Error("Line style is required.");
  if (!config.northArrowPlacement || typeof config.northArrowPlacement !== "object" || !config.northArrowPlacement.offset || typeof config.northArrowPlacement.offset !== "object") throw new Error("North arrow placement is required.");
  if (!Array.isArray(config.markers)) throw new Error("Project markers must be a list.");
  if (!Array.isArray(config.customLines)) throw new Error("Custom lines must be a list.");
  for (const [label, value] of Object.entries({ showRoads: config.showRoads, showTrails: config.showTrails, showTransportationLabels: config.showTransportationLabels, showWater: config.showWater, showBoundaries: config.showBoundaries, showCoordinateGrid: config.showCoordinateGrid, showWaterDepth: config.showWaterDepth, showAlignmentGuides: config.showAlignmentGuides, optimizeMaterialUse: config.optimizeMaterialUse, showElevationLabels: config.showElevationLabels, showNorthArrow: config.showNorthArrow, showScaleBar: config.showScaleBar, showEngravingBorder: config.showEngravingBorder })) {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  }
  if (config.widthMm <= 0) throw new Error("Project width must be greater than zero.");
  if (config.heightMm <= 0) throw new Error("Project height must be greater than zero.");
  if (config.verticalExaggeration < MIN_VERTICAL_EXAGGERATION || config.verticalExaggeration > MAX_VERTICAL_EXAGGERATION) throw new Error(`Vertical exaggeration must be between ${MIN_VERTICAL_EXAGGERATION} and ${MAX_VERTICAL_EXAGGERATION}.`);
  if (!Number.isFinite(config.waterDepthExaggeration) || config.waterDepthExaggeration < MIN_WATER_DEPTH_EXAGGERATION || config.waterDepthExaggeration > MAX_WATER_DEPTH_EXAGGERATION) throw new Error(`Water depth exaggeration must be between ${MIN_WATER_DEPTH_EXAGGERATION} and ${MAX_WATER_DEPTH_EXAGGERATION}.`);
  if (config.materialThicknessMm < 0.5 || config.materialThicknessMm > 25) throw new Error("Material thickness must be between 0.5 and 25 mm.");
  if (config.location.lat < -85.0511 || config.location.lat > 85.0511) throw new Error("This version supports Web Mercator latitudes only.");
  if (config.location.lon < -180 || config.location.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
  const markerIds = new Set<string>();
  for (const marker of config.markers) {
    if (!marker || typeof marker !== "object" || typeof marker.id !== "string" || !marker.id.trim() || marker.id.length > 120) throw new Error("Each marker must have a valid id.");
    if (markerIds.has(marker.id)) throw new Error("Marker ids must be unique.");
    markerIds.add(marker.id);
    if (!Number.isFinite(marker.lat) || marker.lat < -85.0511 || marker.lat > 85.0511) throw new Error("Marker latitude must be within Web Mercator limits.");
    if (!Number.isFinite(marker.lon) || marker.lon < -180 || marker.lon > 180) throw new Error("Marker longitude must be between -180 and 180 degrees.");
    if (!MARKER_SYMBOLS.includes(marker.symbol)) throw new Error("Marker symbol is invalid.");
  }
  const customLineIds = new Set<string>();
  for (const line of config.customLines) {
    if (!line || typeof line !== "object" || typeof line.id !== "string" || !line.id.trim() || line.id.length > 120) throw new Error("Each custom line must have a valid id.");
    if (customLineIds.has(line.id)) throw new Error("Custom line ids must be unique.");
    customLineIds.add(line.id);
    if (!CUSTOM_LINE_KINDS.includes(line.kind)) throw new Error("Custom line type must be trail or boundary.");
    if (!Array.isArray(line.points) || line.points.length < 2) throw new Error("Each custom line must contain at least two points.");
    for (const point of line.points) {
      if (!point || typeof point !== "object" || !Number.isFinite(point.lat) || point.lat < -85.0511 || point.lat > 85.0511) throw new Error("Custom line latitude must be within Web Mercator limits.");
      if (!Number.isFinite(point.lon) || point.lon < -180 || point.lon > 180) throw new Error("Custom line longitude must be between -180 and 180 degrees.");
    }
  }
  const lineWidths = [config.lineStyle.contourMm, config.lineStyle.indexContourMm, config.lineStyle.majorRoadMm, config.lineStyle.localRoadMm, config.lineStyle.trailMm, config.lineStyle.waterMm, config.lineStyle.boundaryMm, config.lineStyle.coordinateGridMm, config.lineStyle.annotationMm, config.lineStyle.borderMm];
  if (![config.widthMm, config.heightMm, config.verticalExaggeration, config.materialThicknessMm, config.engravingContourCount, config.engravingIndexInterval, config.minimumFeatureMm, config.glueMarginMm, config.laserKerfMm, config.smoothing, config.location.lat, config.location.lon, config.location.zoom, config.elevationLabelPosition.x, config.elevationLabelPosition.y, config.textStyle.sizeMm, config.northArrowSizeMm, config.northArrowPlacement.offset.x, config.northArrowPlacement.offset.y, ...lineWidths].every(Number.isFinite)) throw new Error("Project values must be finite numbers.");
  if (lineWidths.some((width) => width < 0.05 || width > 1.5)) throw new Error("Line widths must be between 0.05 and 1.5 mm.");
  if (!Number.isFinite(config.lineStyle.majorRoadSpacingMm) || config.lineStyle.majorRoadSpacingMm < 0.2 || config.lineStyle.majorRoadSpacingMm > 4) throw new Error("Major road spacing must be between 0.2 and 4 mm.");
  if (config.lineStyle.roadStyle !== "centerline" && config.lineStyle.roadStyle !== "outlined") throw new Error("Road style must be centerline or outlined.");
  if (config.lineStyle.roadCap !== "round" && config.lineStyle.roadCap !== "square") throw new Error("Road cap must be round or square.");
  if (config.lineStyle.trailPattern !== "solid" && config.lineStyle.trailPattern !== "dashed" && config.lineStyle.trailPattern !== "dotted") throw new Error("Trail pattern must be solid, dashed, or dotted.");
  if (!Number.isInteger(config.engravingContourCount) || config.engravingContourCount < 4 || config.engravingContourCount > 40) throw new Error("Engraving contour count must be an integer between 4 and 40.");
  if (!Number.isInteger(config.engravingIndexInterval) || config.engravingIndexInterval < 2 || config.engravingIndexInterval > 10) throw new Error("Engraving index interval must be an integer between 2 and 10.");
  if (config.minimumFeatureMm < 0.2 || config.minimumFeatureMm > 5) throw new Error("Minimum feature must be between 0.2 and 5 mm.");
  if (config.glueMarginMm < 2 || config.glueMarginMm > 25) throw new Error("Glue margin must be between 2 and 25 mm.");
  if (config.laserKerfMm < 0 || config.laserKerfMm > 1) throw new Error("Laser kerf must be between 0 and 1 mm.");
  if (config.smoothing !== 0 && config.smoothing !== 1) throw new Error("Contour smoothing must be 0 or 1.");
  if (Math.abs(config.elevationLabelPosition.x) > 0.9 || Math.abs(config.elevationLabelPosition.y) > 0.9) throw new Error("Elevation label position must be between -90% and 90%.");
  if (config.textStyle.font !== "technical" && config.textStyle.font !== "rounded" && config.textStyle.font !== "stencil") throw new Error("Text font must be technical, rounded, or stencil.");
  if (config.textStyle.sizeMm < 2 || config.textStyle.sizeMm > 10) throw new Error("Text size must be between 2 and 10 mm.");
  if (!NORTH_ARROW_STYLES.includes(config.northArrowStyle)) throw new Error("North arrow style must be minimal, classic, or mariner.");
  if (!NORTH_ARROW_ANCHORS.includes(config.northArrowPlacement.anchor)) throw new Error("North arrow anchor is invalid.");
  const northArrowMaximum = Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(config.widthMm, config.heightMm) * NORTH_ARROW_MAX_MAP_FRACTION));
  if (config.northArrowSizeMm < NORTH_ARROW_MIN_SIZE_MM || config.northArrowSizeMm > northArrowMaximum) throw new Error(`North arrow size must be between ${NORTH_ARROW_MIN_SIZE_MM} and ${northArrowMaximum} mm.`);
  if (Math.abs(config.northArrowPlacement.offset.x) > 1 || Math.abs(config.northArrowPlacement.offset.y) > 1) throw new Error("North arrow offsets must be between -100% and 100%.");
  if (!config.waterDepthOverrides || typeof config.waterDepthOverrides !== "object") throw new Error("Water depth overrides are required.");
  for (const [lake, depth] of Object.entries(config.waterDepthOverrides)) {
    if (!/^[1-9]\d*$/.test(lake)) throw new Error(`Water depth override key ${lake} must be a HydroLAKES id.`);
    if (!Number.isFinite(depth) || depth <= 0 || depth > 12000) throw new Error(`Water depth override for lake ${lake} must be between 0 and 12000 m.`);
  }
  const bounds = config.location.bounds;
  if (bounds && (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) || bounds.west >= bounds.east || bounds.south >= bounds.north || bounds.south < -85.0511 || bounds.north > 85.0511)) throw new Error("Project geographic bounds are invalid.");
}

export function createSyntheticSource(config: ProjectConfigV1, size = 96): SourceBundleV1 {
  const values = new Float32Array(size * size);
  const seedX = Math.sin(config.location.lat * 0.13) * 0.8;
  const seedY = Math.cos(config.location.lon * 0.11) * 0.8;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x / (size - 1) - 0.5) * 2;
      const ny = (y / (size - 1) - 0.5) * 2;
      const peak = Math.exp(-((nx - seedX * 0.22) ** 2 * 2.6 + (ny - seedY * 0.22) ** 2 * 3.2));
      const ridge = Math.exp(-Math.abs(ny + Math.sin(nx * 4.2 + seedX) * 0.22) * 5.5) * 0.36;
      const detail = Math.sin(nx * 10 + seedY * 3) * Math.cos(ny * 8 - seedX * 4) * 0.055;
      // ~1.2 km of relief. The amplitude has to stay believable for the window
      // below, because layer count is derived from the two together.
      const elevation = 850 + (peak + ridge + detail) * 860;
      values[y * size + x] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  return {
    schemaVersion: 1,
    elevation: { width: size, height: size, values, min, max },
    markings: [],
    vectorStatus: "available",
    datasetVersion: "synthetic-v1",
    sourceKind: "synthetic",
    // Roughly the ground window the app requests at its default zoom, so the
    // fallback's map scale — and the layer count derived from it — stay sane.
    bounds: config.location.bounds ?? { west: config.location.lon - 0.1445, south: config.location.lat - 0.101, east: config.location.lon + 0.1445, north: config.location.lat + 0.101 },
    imagerySources: [],
    attribution: [{ name: "TopoStack deterministic terrain preview", url: "https://github.com/", license: "Development fixture" }],
  };
}

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
import { offsetClosedRing } from "./offset.js";
import { northArrowFootprint, northArrowMarkings } from "./north-arrow.js";
import { displayElevation, elevationUnit, FEET_PER_METER } from "./units.js";
import { NORTH_ARROW_ANCHORS, NORTH_ARROW_MAX_MAP_FRACTION, NORTH_ARROW_MAX_SIZE_MM, NORTH_ARROW_MIN_SIZE_MM, NORTH_ARROW_STYLES } from "./types.js";
import type {
  ElevationGrid,
  GeometryIRV1,
  FabricationNest,
  LayerIR,
  MarkingFeature,
  Point2D,
  Polygon2D,
  ProjectConfigV1,
  SourceBundleV1,
  TransportationClass,
} from "./types.js";

const MAJOR_ROAD_OFFSET_MM = 0.4;
const TRAIL_DASH_MM = 1.8;
const TRAIL_GAP_MM = 1.2;
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

function dashPolyline(points: Point2D[], dashMm = TRAIL_DASH_MM, gapMm = TRAIL_GAP_MM): Point2D[][] {
  const result: Point2D[][] = [];
  let drawing = true;
  let remaining = dashMm;
  let active: Point2D[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    let start = points[index]!;
    const end = points[index + 1]!;
    let segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    while (segmentLength > 1e-9) {
      const step = Math.min(remaining, segmentLength);
      const next = pointAt(start, end, step / segmentLength);
      if (drawing) {
        if (!active.length) active.push(start);
        active.push(next);
      }
      start = next;
      segmentLength -= step;
      remaining -= step;
      if (remaining <= 1e-9) {
        if (drawing && active.length > 1) result.push(active);
        active = [];
        drawing = !drawing;
        remaining = drawing ? dashMm : gapMm;
      }
    }
  }
  if (drawing && active.length > 1) result.push(active);
  return result;
}

function styledTransportationPaths(points: Point2D[], transportationClass: TransportationClass, polygons: Polygon2D[], excludedPolygons: Polygon2D[] = []): Point2D[][] {
  if (transportationClass === "major-road") {
    return [-MAJOR_ROAD_OFFSET_MM, MAJOR_ROAD_OFFSET_MM].flatMap((distance) => clipPolyline(offsetPolyline(points, distance), polygons, excludedPolygons));
  }
  if (transportationClass === "trail") return dashPolyline(points).flatMap((dash) => clipPolyline(dash, polygons, excludedPolygons));
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

function junctionRing(center: Point2D): Point2D[] {
  const points = Array.from({ length: 20 }, (_, index) => {
    const angle = index / 20 * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * MAJOR_ROAD_OFFSET_MM, y: center.y + Math.sin(angle) * MAJOR_ROAD_OFFSET_MM };
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
  return `v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function distanceM(lat: number, lonA: number, lonB: number): number {
  const radians = Math.PI / 180;
  return Math.abs((lonB - lonA) * radians) * 6_371_008.8 * Math.cos(lat * radians);
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

function splitMarking(feature: MarkingFeature, thresholds: number[], source: SourceBundleV1, config: ProjectConfigV1): Array<{ layer: number; points: Point2D[] }> {
  const closedWater = feature.kind === "water" && feature.points.length > 3 && Math.hypot(feature.points[0]!.x - feature.points.at(-1)!.x, feature.points[0]!.y - feature.points.at(-1)!.y) <= 1e-6;
  if (closedWater) {
    const elevations = feature.points.slice(0, -1).map((point) => feature.elevationM ?? sampleElevation(source.elevation, point, config)).sort((left, right) => left - right);
    const middle = Math.floor(elevations.length / 2);
    const elevation = elevations.length % 2 === 0 ? ((elevations[middle - 1] ?? source.elevation.min) + (elevations[middle] ?? source.elevation.min)) / 2 : (elevations[middle] ?? source.elevation.min);
    return [{ layer: layerForElevation(elevation, thresholds), points: feature.points }];
  }
  const result: Array<{ layer: number; points: Point2D[] }> = [];
  // A single-point feature (e.g. a point label) still belongs to a layer even
  // though it produces no drawable segment.
  const minimumRun = feature.points.length === 1 ? 1 : 2;
  let activeLayer = -1;
  let active: Point2D[] = [];
  for (const point of feature.points) {
    const elevation = feature.elevationM ?? sampleElevation(source.elevation, point, config);
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

export function generateGeometry(config: ProjectConfigV1, source: SourceBundleV1): GeometryIRV1 {
  validateProject(config);
  if (source.schemaVersion !== 1) throw new Error("Unsupported source-data schema version.");
  const grid = source.elevation;
  if (grid.values.length !== grid.width * grid.height) throw new Error("Elevation grid dimensions do not match its values.");
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || !Number.isFinite(grid.min) || !Number.isFinite(grid.max) || grid.max < grid.min) throw new Error("Elevation grid metadata is invalid.");
  for (const value of grid.values) if (!Number.isFinite(value)) throw new Error("Elevation grid contains non-finite values.");
  if (![source.bounds.west, source.bounds.south, source.bounds.east, source.bounds.north].every(Number.isFinite) || source.bounds.west >= source.bounds.east || source.bounds.south >= source.bounds.north) throw new Error("Source geographic bounds are invalid.");

  const warnings: GeometryIRV1["warnings"] = [];
  if (source.vectorStatus === "unavailable" && (config.showRoads || config.showTrails || config.showWater)) warnings.push({
    code: "VECTOR_DATA_UNAVAILABLE",
    message: "Transportation and water data is unavailable. This project cannot be exported until the map data is restored or those details are disabled.",
  });
  const relief = grid.max - grid.min;
  if (relief < 20) warnings.push({ code: "LOW_RELIEF", message: "This area has very little elevation change; the layers may look nearly identical." });

  const clip = boundary(config);
  const thresholds = Array.from({ length: config.layerCount }, (_, index) => grid.min + (relief * index) / config.layerCount);
  const contourGenerator = contours().size([grid.width, grid.height]).smooth(config.smoothing > 0).thresholds(thresholds.slice(1));
  const generated = contourGenerator(Array.from(grid.values));

  const layers: LayerIR[] = [{
    id: "layer-01",
    index: 0,
    elevationM: grid.min,
    materialThicknessMm: config.materialThicknessMm,
    polygons: [{ outer: clip, holes: [] }],
    markings: [],
  }];

  generated.forEach((contour, generatedIndex) => {
    const raw: MultiPolygon = contour.coordinates.map((polygon) => polygon.map((ring) => {
      const mapped: Ring = ring.map((point) => {
        const point2d = contourToMm([point[0] ?? 0, point[1] ?? 0], grid, config);
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
      elevationM: thresholds[index] ?? grid.max,
      materialThicknessMm: config.materialThicknessMm,
      polygons,
      markings: [],
    });
  });

  const fabricationNests = addMaterialNests(config, layers);

  const transportationLabels = new Map<string, Array<{ layer: LayerIR; paths: Point2D[][]; transportationClass: TransportationClass; excludedPolygons: Polygon2D[] }>>();
  for (const feature of source.markings) {
    const transportationClass = feature.transportationClass ?? (feature.kind === "trail" ? "trail" : feature.kind === "road" ? "local-road" : undefined);
    const enabled = (transportationClass === "trail" && config.showTrails) ||
      (transportationClass !== undefined && transportationClass !== "trail" && config.showRoads) ||
      (feature.kind === "water" && config.showWater) ||
      feature.kind === "contour" || feature.kind === "label" || feature.kind === "guide";
    if (!enabled) continue;
    if (transportationClass) {
      layers.forEach((layer, layerIndex) => {
        const excludedPolygons = coveringPolygons(layers, layerIndex);
        const clipped = clipPolyline(feature.points, layer.polygons, excludedPolygons);
        styledTransportationPaths(feature.points, transportationClass, layer.polygons, excludedPolygons).forEach((points, styleIndex) => layer.markings.push({
          id: `${feature.id}-${layer.index}-transport-${styleIndex}`,
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
    for (const [segmentIndex, segment] of splitMarking(feature, thresholds, source, config).entries()) {
      const layer = layers[segment.layer];
      if (!layer) continue;
      const clipped = clipPolyline(segment.points, layer.polygons);
      if (feature.label && segment.points[0] && layer.polygons.some((polygon) => pointInPolygon(segment.points[0]!, polygon))) {
        layer.markings.push({ id: `${feature.id}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
      }
      clipped.filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm).forEach((points, clipIndex) => layer.markings.push({
        id: `${feature.id}-${layer.index}-${segmentIndex}-${clipIndex}`,
        operation: feature.operation,
        kind: feature.kind,
        points,
      }));
    }
  }

  const enabledRoadFeatures = source.markings.filter((feature) => feature.kind === "road" && config.showRoads);
  transportationJunctions(enabledRoadFeatures).forEach((junction, junctionIndex) => {
    const ring = junctionRing(junction.point);
    layers.forEach((layer, layerIndex) => {
      const excludedPolygons = coveringPolygons(layers, layerIndex);
      clipPolyline(ring, layer.polygons, excludedPolygons).forEach((points, clipIndex) => layer.markings.push({
        id: `road-junction-${junctionIndex}-${layer.index}-${clipIndex}`,
        operation: "engrave",
        kind: "road",
        transportationClass: "major-road",
        points,
      }));
    });
  });

  const baseLayer = layers[0];
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

  if (config.showAlignmentGuides) addAlignmentGuides(config, layers);

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
    minElevationM: grid.min,
    maxElevationM: grid.max,
    layers,
    fabricationNests,
    warnings,
    attribution: source.attribution,
    generatedAt: new Date().toISOString(),
  };
}

export function validateProject(config: ProjectConfigV1): void {
  if (config.schemaVersion !== 1) throw new Error("Unsupported project schema version.");
  if (config.units !== "metric" && config.units !== "imperial") throw new Error("Project units must be metric or imperial.");
  if (config.cropShape !== "rectangle" && config.cropShape !== "circle") throw new Error("Crop shape must be rectangle or circle.");
  if (!config.elevationLabelPosition || typeof config.elevationLabelPosition !== "object") throw new Error("Elevation label position is required.");
  if (!config.textStyle || typeof config.textStyle !== "object") throw new Error("Text style is required.");
  if (!config.northArrowPlacement || typeof config.northArrowPlacement !== "object" || !config.northArrowPlacement.offset || typeof config.northArrowPlacement.offset !== "object") throw new Error("North arrow placement is required.");
  for (const [label, value] of Object.entries({ showRoads: config.showRoads, showTrails: config.showTrails, showTransportationLabels: config.showTransportationLabels, showWater: config.showWater, showAlignmentGuides: config.showAlignmentGuides, optimizeMaterialUse: config.optimizeMaterialUse, showElevationLabels: config.showElevationLabels, showNorthArrow: config.showNorthArrow, showScaleBar: config.showScaleBar })) {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  }
  if (config.widthMm <= 0) throw new Error("Project width must be greater than zero.");
  if (config.heightMm <= 0) throw new Error("Project height must be greater than zero.");
  if (!Number.isInteger(config.layerCount) || config.layerCount < 2 || config.layerCount > 24) throw new Error("Layer count must be a whole number between 2 and 24.");
  if (config.materialThicknessMm < 0.5 || config.materialThicknessMm > 25) throw new Error("Material thickness must be between 0.5 and 25 mm.");
  if (config.location.lat < -85.0511 || config.location.lat > 85.0511) throw new Error("This version supports Web Mercator latitudes only.");
  if (config.location.lon < -180 || config.location.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
  if (![config.widthMm, config.heightMm, config.layerCount, config.materialThicknessMm, config.minimumFeatureMm, config.glueMarginMm, config.laserKerfMm, config.smoothing, config.location.lat, config.location.lon, config.location.zoom, config.elevationLabelPosition.x, config.elevationLabelPosition.y, config.textStyle.sizeMm, config.northArrowSizeMm, config.northArrowPlacement.offset.x, config.northArrowPlacement.offset.y].every(Number.isFinite)) throw new Error("Project values must be finite numbers.");
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
      const elevation = 850 + (peak + ridge + detail) * 2450;
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
    bounds: config.location.bounds ?? { west: config.location.lon - 0.05, south: config.location.lat - 0.035, east: config.location.lon + 0.05, north: config.location.lat + 0.035 },
    imagerySources: [],
    attribution: [{ name: "TopoStack deterministic terrain preview", url: "https://github.com/", license: "Development fixture" }],
  };
}

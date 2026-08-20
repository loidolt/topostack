import { contours } from "d3-contour";
import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";
import { labelDimensions } from "./labels.js";
import { offsetClosedRing } from "./offset.js";
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
} from "./types.js";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  return Array.from({ length: 97 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function toRing(points: Point2D[]): Ring {
  return points.map(({ x, y }) => [x, y] as Pair);
}

function toPoint(ringPoint: Pair): Point2D {
  return { x: ringPoint[0], y: ringPoint[1] };
}

function close(points: Point2D[]): Point2D[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || (first.x === last.x && first.y === last.y)) return points;
  return [...points, first];
}

function signedArea(points: Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current && next) area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInRing(point: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    const crosses = (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  return pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole));
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function segmentDistance(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

function ringFitsInsidePolygon(ring: Point2D[], polygon: Polygon2D, marginMm: number, allowContainedHoles = false): boolean {
  const points = ring.slice(0, -1);
  if (!points.length || !points.every((point) => pointInPolygon(point, polygon))) return false;
  const boundaries = [polygon.outer, ...polygon.holes];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (!start || !end || !pointInPolygon(pointAt(start, end, 0.5), polygon)) return false;
    for (const boundary of boundaries) {
      for (let edge = 0; edge < boundary.length - 1; edge += 1) {
        const boundaryStart = boundary[edge];
        const boundaryEnd = boundary[edge + 1];
        if (boundaryStart && boundaryEnd && segmentDistance(start, end, boundaryStart, boundaryEnd) < marginMm - 1e-7) return false;
      }
    }
  }
  return allowContainedHoles || !polygon.holes.some((hole) => hole.slice(0, -1).some((point) => pointInRing(point, ring)));
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
    for (let nestedLayerIndex = donorLayerIndex + 2; nestedLayerIndex < layers.length; nestedLayerIndex += 1) {
      if (nestedLayersWithParents.has(nestedLayerIndex)) continue;
      const nestedLayer = layers[nestedLayerIndex];
      if (!nestedLayer || nestedLayer.polygons.length === 0) continue;
      const donorLayer = layers[donorLayerIndex];
      const coveringLayer = layers[donorLayerIndex + 1];
      if (!donorLayer || !coveringLayer || coveringLayer.polygons.length === 0) continue;
      if (!containingPolygonIndexes(nestedLayer.polygons, coveringLayer.polygons, requiredClearanceMm, true)) continue;
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

interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function labelBounds(label: string, origin: Point2D, padding = 0): Bounds2D {
  const dimensions = labelDimensions(label);
  return {
    minX: origin.x - padding,
    minY: origin.y - padding,
    maxX: origin.x + dimensions.width + padding,
    maxY: origin.y + dimensions.height + padding,
  };
}

function boundsPoints(bounds: Bounds2D): Point2D[] {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return [
    { x: bounds.minX, y: bounds.minY }, { x: centerX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: centerY }, { x: centerX, y: centerY }, { x: bounds.maxX, y: centerY },
    { x: bounds.minX, y: bounds.maxY }, { x: centerX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY },
  ];
}

function boundsOverlap(a: Bounds2D, b: Bounds2D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointInBounds(point: Point2D, bounds: Bounds2D): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D): boolean {
  return Math.abs(orientation(a, b, point)) < 1e-8 &&
    point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 &&
    point.y >= Math.min(a.y, b.y) - 1e-8 && point.y <= Math.max(a.y, b.y) + 1e-8;
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-8 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) < 1e-8 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) < 1e-8 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) < 1e-8 && pointOnSegment(b, c, d));
}

function segmentIntersectsBounds(a: Point2D, b: Point2D, bounds: Bounds2D): boolean {
  if (pointInBounds(a, bounds) || pointInBounds(b, bounds)) return true;
  const topLeft = { x: bounds.minX, y: bounds.minY };
  const topRight = { x: bounds.maxX, y: bounds.minY };
  const bottomRight = { x: bounds.maxX, y: bounds.maxY };
  const bottomLeft = { x: bounds.minX, y: bounds.maxY };
  return segmentsIntersect(a, b, topLeft, topRight) || segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) || segmentsIntersect(a, b, bottomLeft, topLeft);
}

function boundsInsidePolygon(bounds: Bounds2D, polygon: Polygon2D): boolean {
  if (!boundsPoints(bounds).every((point) => pointInPolygon(point, polygon))) return false;
  const rings = [polygon.outer, ...polygon.holes];
  for (const ring of rings) {
    if (ring.some((point) => pointInBounds(point, bounds))) return false;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (start && end && segmentIntersectsBounds(start, end, bounds)) return false;
    }
  }
  return true;
}

function markingIntersectsBounds(marking: LayerIR["markings"][number], bounds: Bounds2D): boolean {
  if (marking.label && marking.points[0] && boundsOverlap(labelBounds(marking.label, marking.points[0], 0.8), bounds)) return true;
  for (let index = 0; index < marking.points.length - 1; index += 1) {
    const start = marking.points[index];
    const end = marking.points[index + 1];
    if (start && end && segmentIntersectsBounds(start, end, bounds)) return true;
  }
  return false;
}

function labelCandidates(preferred: Point2D): Point2D[] {
  const candidates: Point2D[] = [{ ...preferred }];
  for (let y = -9; y <= 9; y += 1) {
    for (let x = -9; x <= 9; x += 1) {
      const candidate = { x: x / 10, y: y / 10 };
      if (Math.abs(candidate.x - preferred.x) > 1e-8 || Math.abs(candidate.y - preferred.y) > 1e-8) candidates.push(candidate);
    }
  }
  return candidates.map((candidate, index) => ({ candidate, index })).sort((left, right) => {
    const leftDistance = (left.candidate.x - preferred.x) ** 2 + (left.candidate.y - preferred.y) ** 2;
    const rightDistance = (right.candidate.x - preferred.x) ** 2 + (right.candidate.y - preferred.y) ** 2;
    return leftDistance - rightDistance || left.index - right.index;
  }).map(({ candidate }) => candidate);
}

function placeLabel(label: string, config: ProjectConfigV1, polygons: Polygon2D[], markings: LayerIR["markings"], preferred: Point2D, requiredPolygons?: Polygon2D[]): Point2D | undefined {
  const dimensions = labelDimensions(label);
  for (const candidate of labelCandidates(preferred)) {
    const center = { x: candidate.x * config.widthMm / 2, y: candidate.y * config.heightMm / 2 };
    const origin = { x: center.x - dimensions.width / 2, y: center.y - dimensions.height / 2 };
    const bounds = labelBounds(label, origin, 0.8);
    const fitsMaterial = polygons.some((polygon) => boundsInsidePolygon(bounds, polygon));
    const fitsRequirement = !requiredPolygons || requiredPolygons.some((polygon) => boundsInsidePolygon(bounds, polygon));
    if (fitsMaterial && fitsRequirement && !markings.some((marking) => markingIntersectsBounds(marking, bounds))) return origin;
  }
  return undefined;
}

function placeElevationLabel(label: string, config: ProjectConfigV1, layer: LayerIR): Point2D | undefined {
  return placeLabel(label, config, layer.polygons, layer.markings, config.elevationLabelPosition);
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

function segmentIntersectionT(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1 ? t : undefined;
}

function pointAt(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clipPolyline(points: Point2D[], polygons: Polygon2D[]): Point2D[][] {
  if (points.length < 2) return [];
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  const rings = polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]);
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    const cuts = [0, 1];
    for (const ring of rings) {
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
      if (polygons.some((polygon) => pointInPolygon(midpoint, polygon))) {
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

export function projectFingerprint(config: ProjectConfigV1): string {
  const input = JSON.stringify(stableProjectValue(config));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

function removeTinyRing(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return true;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) < minimumFeatureMm || Math.max(...ys) - Math.min(...ys) < minimumFeatureMm;
}

function simplify(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 5 || tolerance <= 0) return points;
  const result: Point2D[] = [points[0]!];
  let previous = points[0]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= tolerance) {
      result.push(point);
      previous = point;
    }
  }
  result.push(points[points.length - 1]!);
  return close(result);
}

function contourToMm(point: [number, number], grid: ElevationGrid, config: ProjectConfigV1): Point2D {
  return {
    x: (point[0] / grid.width - 0.5) * config.widthMm,
    y: (point[1] / grid.height - 0.5) * config.heightMm,
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

function splitMarking(feature: MarkingFeature, thresholds: number[], source: SourceBundleV1, config: ProjectConfigV1): Array<{ layer: number; points: Point2D[] }> {
  const result: Array<{ layer: number; points: Point2D[] }> = [];
  let activeLayer = -1;
  let active: Point2D[] = [];
  for (const point of feature.points) {
    const elevation = feature.elevationM ?? sampleElevation(source.elevation, point, config);
    let layer = 0;
    for (let index = 1; index < thresholds.length; index += 1) {
      if (elevation >= (thresholds[index] ?? Number.POSITIVE_INFINITY)) layer = index;
    }
    if (layer !== activeLayer) {
      if (active.length > 1) result.push({ layer: activeLayer, points: active });
      activeLayer = layer;
      active = active.length ? [active[active.length - 1]!, point] : [point];
    } else {
      active.push(point);
    }
  }
  if (active.length > 1) result.push({ layer: activeLayer, points: active });
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
  if (source.vectorStatus === "unavailable" && (config.showRoads || config.showWater)) warnings.push({
    code: "VECTOR_DATA_UNAVAILABLE",
    message: "Road and water data is unavailable. This project cannot be exported until the map data is restored or those details are disabled.",
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
    const raw: MultiPolygon = contour.coordinates.map((polygon) => polygon.map((ring) => ring.map((point) => {
      const mapped = contourToMm([point[0] ?? 0, point[1] ?? 0], grid, config);
      return [mapped.x, mapped.y] as Pair;
    })));
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

  for (const feature of source.markings) {
    const enabled = (feature.kind === "road" && config.showRoads) ||
      (feature.kind === "water" && config.showWater) ||
      (feature.kind === "contour" && config.showContours) ||
      feature.kind === "label" || feature.kind === "guide";
    if (!enabled) continue;
    for (const segment of splitMarking(feature, thresholds, source, config)) {
      const layer = layers[segment.layer];
      if (!layer) continue;
      if (feature.label && segment.points[0] && layer.polygons.some((polygon) => pointInPolygon(segment.points[0]!, polygon))) {
        layer.markings.push({ id: `${feature.id}-${layer.index}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label });
      }
      clipPolyline(segment.points, layer.polygons).forEach((points, clipIndex) => layer.markings.push({
        id: `${feature.id}-${layer.index}-${clipIndex}`,
        operation: feature.operation,
        kind: feature.kind,
        points,
      }));
    }
  }

  if (config.showContours) {
    layers.slice(1).forEach((layer) => {
      layer.polygons.forEach((polygon, polygonIndex) => layer.markings.push({
        id: `contour-${layer.index}-${polygonIndex}`,
        operation: "engrave",
        kind: "contour",
        points: polygon.outer,
      }));
    });
  }

  const baseLayer = layers[0];
  if (baseLayer && config.showNorthArrow) {
    const radius = Math.min(config.widthMm, config.heightMm) / 2;
    const x = config.cropShape === "circle" ? radius * 0.58 : config.widthMm / 2 - 11;
    const y = config.cropShape === "circle" ? -radius * 0.48 : -config.heightMm / 2 + 18;
    baseLayer.markings.push(
      { id: "north-stem", operation: "engrave", kind: "guide", points: [{ x, y: y + 9 }, { x, y: y - 5 }] },
      { id: "north-head-a", operation: "engrave", kind: "guide", points: [{ x, y: y - 5 }, { x: x - 3, y }] },
      { id: "north-head-b", operation: "engrave", kind: "guide", points: [{ x, y: y - 5 }, { x: x + 3, y }] },
    );
  }
  if (baseLayer && config.showScaleBar) {
    const radius = Math.min(config.widthMm, config.heightMm) / 2;
    const x = config.cropShape === "circle" ? -radius * 0.58 : -config.widthMm / 2 + 9;
    const y = config.cropShape === "circle" ? radius * 0.58 : -config.heightMm / 2 + 10;
    const groundWidthM = distanceM((source.bounds.north + source.bounds.south) / 2, source.bounds.west, source.bounds.east);
    const scaleDistanceM = niceScaleDistance(groundWidthM * 0.2);
    const length = Math.min(config.cropShape === "circle" ? radius * 0.55 : config.widthMm * 0.35, groundWidthM > 0 ? (scaleDistanceM / groundWidthM) * config.widthMm : 0);
    const scaleLabel = scaleDistanceM >= 1000 ? `${Number((scaleDistanceM / 1000).toFixed(1))} km` : `${Math.round(scaleDistanceM)} m`;
    baseLayer.markings.push(
      { id: "scale-main", operation: "engrave", kind: "guide", points: [{ x, y }, { x: x + length, y }] },
      { id: "scale-left", operation: "engrave", kind: "guide", points: [{ x, y: y - 1.7 }, { x, y: y + 1.7 }] },
      { id: "scale-right", operation: "engrave", kind: "guide", points: [{ x: x + length, y: y - 1.7 }, { x: x + length, y: y + 1.7 }] },
      { id: "scale-label", operation: "engrave", kind: "label", points: [{ x, y: y + 5 }], label: scaleLabel },
    );
  }

  if (config.showAlignmentGuides) addAlignmentGuides(config, layers);

  if (config.showElevationLabels) {
    const omittedLayers: string[] = [];
    layers.forEach((layer) => {
      const label = `${Math.round(layer.elevationM)} m · L${String(layer.index + 1).padStart(2, "0")}`;
      const point = placeElevationLabel(label, config, layer);
      if (!point) {
        omittedLayers.push(String(layer.index + 1));
        return;
      }
      layer.markings.push({
        id: `elevation-${layer.index}`,
        operation: "engrave",
        kind: "label",
        points: [point],
        label,
      });
    });
    if (omittedLayers.length) warnings.push({
      code: "LABEL_OMITTED",
      message: `Elevation labels were omitted from layer${omittedLayers.length === 1 ? "" : "s"} ${omittedLayers.join(", ")} because no collision-free position fit the material.`,
    });
  }

  return {
    schemaVersion: 1,
    projectId: config.id,
    projectName: config.name,
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
  if (!config.elevationLabelPosition || typeof config.elevationLabelPosition !== "object") throw new Error("Elevation label position is required.");
  if (config.widthMm < 50 || config.widthMm > 600) throw new Error("Project width must be between 50 and 600 mm.");
  if (config.heightMm < 50 || config.heightMm > 600) throw new Error("Project height must be between 50 and 600 mm.");
  if (config.layerCount < 2 || config.layerCount > 24) throw new Error("Layer count must be between 2 and 24.");
  if (config.materialThicknessMm < 0.5 || config.materialThicknessMm > 25) throw new Error("Material thickness must be between 0.5 and 25 mm.");
  if (config.location.lat < -85.0511 || config.location.lat > 85.0511) throw new Error("This version supports Web Mercator latitudes only.");
  if (config.location.lon < -180 || config.location.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
  if (![config.widthMm, config.heightMm, config.layerCount, config.materialThicknessMm, config.minimumFeatureMm, config.glueMarginMm, config.laserKerfMm, config.smoothing, config.location.lat, config.location.lon, config.location.zoom, config.elevationLabelPosition.x, config.elevationLabelPosition.y].every(Number.isFinite)) throw new Error("Project values must be finite numbers.");
  if (config.minimumFeatureMm < 0.2 || config.minimumFeatureMm > 5) throw new Error("Minimum feature must be between 0.2 and 5 mm.");
  if (config.glueMarginMm < 2 || config.glueMarginMm > 25) throw new Error("Glue margin must be between 2 and 25 mm.");
  if (config.laserKerfMm < 0 || config.laserKerfMm > 1) throw new Error("Laser kerf must be between 0 and 1 mm.");
  if (config.smoothing !== 0 && config.smoothing !== 1) throw new Error("Contour smoothing must be 0 or 1.");
  if (Math.abs(config.elevationLabelPosition.x) > 0.9 || Math.abs(config.elevationLabelPosition.y) > 0.9) throw new Error("Elevation label position must be between -90% and 90%.");
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

import { labelDimensions } from "./labels.js";
import {
  type Bounds2D,
  boundsContainBounds,
  close,
  pointAt,
  pointInBounds,
  pointInPolygon,
  pointInRing,
  ringBounds,
  ringFitsInsidePolygon,
  rotatedPoint,
  segmentsIntersect,
} from "./geometry2d.js";
import type { LayerIR, Point2D, Polygon2D, ProjectConfigV1 } from "./types.js";

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

function labelFootprint(label: string, origin: Point2D, rotationRad: number, padding = 0.8): Point2D[] {
  const dimensions = labelDimensions(label);
  return close([
    { x: origin.x - padding, y: origin.y - padding },
    { x: origin.x + dimensions.width + padding, y: origin.y - padding },
    { x: origin.x + dimensions.width + padding, y: origin.y + dimensions.height + padding },
    { x: origin.x - padding, y: origin.y + dimensions.height + padding },
  ].map((point) => rotatedPoint(point, origin, rotationRad)));
}

function footprintBounds(footprint: Point2D[]): Bounds2D {
  return ringBounds(footprint);
}

function footprintIntersectsPolygons(footprint: Point2D[], polygons: Polygon2D[]): boolean {
  return polygons.some((polygon) => {
    if (footprint.slice(0, -1).some((point) => pointInPolygon(point, polygon))) return true;
    if (polygon.outer.slice(0, -1).some((point) => pointInRing(point, footprint))) return true;
    const rings = [polygon.outer, ...polygon.holes];
    for (let footprintIndex = 0; footprintIndex < footprint.length - 1; footprintIndex += 1) {
      const start = footprint[footprintIndex];
      const end = footprint[footprintIndex + 1];
      if (!start || !end) continue;
      for (const ring of rings) {
        for (let ringIndex = 0; ringIndex < ring.length - 1; ringIndex += 1) {
          const ringStart = ring[ringIndex];
          const ringEnd = ring[ringIndex + 1];
          if (ringStart && ringEnd && segmentsIntersect(start, end, ringStart, ringEnd)) return true;
        }
      }
    }
    return false;
  });
}

export function markingIntersectsBounds(marking: LayerIR["markings"][number], bounds: Bounds2D): boolean {
  if (marking.label && marking.points[0] && boundsOverlap(labelBounds(marking.label, marking.points[0], 0.8), bounds)) return true;
  for (let index = 0; index < marking.points.length - 1; index += 1) {
    const start = marking.points[index];
    const end = marking.points[index + 1];
    if (start && end && segmentIntersectsBounds(start, end, bounds)) return true;
  }
  return false;
}

// The candidate grid never changes; only its distance ordering to the preferred
// point does, so build it once.
const CANDIDATE_GRID: Point2D[] = (() => {
  const grid: Point2D[] = [];
  for (let y = -9; y <= 9; y += 1) {
    for (let x = -9; x <= 9; x += 1) grid.push({ x: x / 10, y: y / 10 });
  }
  return grid;
})();

function labelCandidates(preferred: Point2D): Point2D[] {
  const candidates: Point2D[] = [{ ...preferred }];
  CANDIDATE_GRID.forEach((candidate) => {
    if (Math.abs(candidate.x - preferred.x) > 1e-8 || Math.abs(candidate.y - preferred.y) > 1e-8) candidates.push(candidate);
  });
  return candidates.map((candidate, index) => ({ candidate, index })).sort((left, right) => {
    const leftDistance = (left.candidate.x - preferred.x) ** 2 + (left.candidate.y - preferred.y) ** 2;
    const rightDistance = (right.candidate.x - preferred.x) ** 2 + (right.candidate.y - preferred.y) ** 2;
    return leftDistance - rightDistance || left.index - right.index;
  }).map(({ candidate }) => candidate);
}

export function placeLabel(label: string, config: ProjectConfigV1, polygons: Polygon2D[], markings: LayerIR["markings"], preferred: Point2D, requiredPolygons?: Polygon2D[]): Point2D | undefined {
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

export interface ElevationLabelPlacement {
  point: Point2D;
  rotationRad: number;
}

function readableContourAngle(start: Point2D, end: Point2D): number {
  let angle = Math.atan2(end.y - start.y, end.x - start.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return angle;
}

function labelOriginAtCenter(label: string, center: Point2D, rotationRad: number): Point2D {
  const dimensions = labelDimensions(label);
  const localCenter = { x: dimensions.width / 2, y: dimensions.height / 2 };
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  return {
    x: center.x - (localCenter.x * cosine - localCenter.y * sine),
    y: center.y - (localCenter.x * sine + localCenter.y * cosine),
  };
}

export function placeElevationLabel(label: string, config: ProjectConfigV1, layer: LayerIR, coveringLayer?: LayerIR): ElevationLabelPlacement | undefined {
  const contourPolygons = coveringLayer?.polygons.length ? coveringLayer.polygons : layer.polygons;
  const coveredPolygons = coveringLayer?.polygons ?? [];
  const preferred = {
    x: config.elevationLabelPosition.x * config.widthMm / 2,
    y: config.elevationLabelPosition.y * config.heightMm / 2,
  };
  const dimensions = labelDimensions(label);
  const normalOffset = dimensions.height / 2 + 1.6;
  const candidates: Array<ElevationLabelPlacement & { score: number }> = [];

  contourPolygons.forEach((polygon) => [polygon.outer, ...polygon.holes].forEach((ring) => {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (!start || !end) continue;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < 1e-6) continue;
      const rotationRad = readableContourAngle(start, end);
      const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
      const samples = length > dimensions.width * 1.4 ? [0.25, 0.5, 0.75] : [0.5];
      samples.forEach((sample) => [-1, 1].forEach((side) => {
        const contourPoint = pointAt(start, end, sample);
        const center = {
          x: contourPoint.x + normal.x * normalOffset * side,
          y: contourPoint.y + normal.y * normalOffset * side,
        };
        const point = labelOriginAtCenter(label, center, rotationRad);
        const score = ((center.x - preferred.x) / config.widthMm) ** 2 + ((center.y - preferred.y) / config.heightMm) ** 2;
        candidates.push({ point, rotationRad, score });
      }));
    }
  }));

  // Candidate generation above is cheap; the fit checks are not. Validate in
  // score order and stop at the first fit instead of validating everything.
  candidates.sort((left, right) => left.score - right.score || left.point.y - right.point.y || left.point.x - right.point.x);
  const materialBounds = layer.polygons.map((polygon) => ringBounds(polygon.outer));
  for (const candidate of candidates) {
    const footprint = labelFootprint(label, candidate.point, candidate.rotationRad);
    const bounds = footprintBounds(footprint);
    const fitsMaterial = layer.polygons.some((polygon, polygonIndex) =>
      boundsContainBounds(materialBounds[polygonIndex]!, bounds) && ringFitsInsidePolygon(footprint, polygon, 0));
    if (!fitsMaterial || footprintIntersectsPolygons(footprint, coveredPolygons)) continue;
    if (layer.markings.some((marking) => markingIntersectsBounds(marking, bounds))) continue;
    return { point: candidate.point, rotationRad: candidate.rotationRad };
  }
  return undefined;
}

import type { Point2D, Polygon2D } from "./types.js";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function close(points: Point2D[]): Point2D[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || (first.x === last.x && first.y === last.y)) return points;
  return [...points, first];
}

export function signedArea(points: Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current && next) area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

export function ringBounds(ring: Point2D[]): Bounds2D {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsOverlap(a: Bounds2D, b: Bounds2D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContainBounds(outer: Bounds2D, inner: Bounds2D): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function pointInBounds(point: Point2D, bounds: Bounds2D): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

export function pointInRing(point: Point2D, ring: Point2D[]): boolean {
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

export function pointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  return pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole));
}

export function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function segmentDistance(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

export function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function pointOnSegment(point: Point2D, a: Point2D, b: Point2D): boolean {
  return Math.abs(orientation(a, b, point)) < 1e-8 &&
    point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 &&
    point.y >= Math.min(a.y, b.y) - 1e-8 && point.y <= Math.max(a.y, b.y) + 1e-8;
}

export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
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

export function segmentIntersectionT(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number | undefined {
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

export function pointAt(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rotatedPoint(point: Point2D, origin: Point2D, angleRad: number): Point2D {
  if (angleRad === 0) return point;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return { x: origin.x + dx * cosine - dy * sine, y: origin.y + dx * sine + dy * cosine };
}

export function ringFitsInsidePolygon(ring: Point2D[], polygon: Polygon2D, marginMm: number, allowContainedHoles = false): boolean {
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

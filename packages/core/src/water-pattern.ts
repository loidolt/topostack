import { boundsOverlap, pointAt, pointInPolygon, ringBounds, segmentIntersectionT, type Bounds2D } from "./geometry2d.js";
import type { Point2D, Polygon2D, WaterFillPattern } from "./types.js";

function clipPolyline(points: Point2D[], polygons: Polygon2D[]): Point2D[][] {
  if (points.length < 2 || !polygons.length) return [];
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  const rings = polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]).map((ring) => ({ ring, bounds: ringBounds(ring) }));
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
        const start = ring[edge];
        const end = ring[edge + 1];
        const t = start && end ? segmentIntersectionT(a, b, start, end) : undefined;
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
        const previous = active.at(-1);
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

/**
 * Produces explicit fabrication paths rather than SVG pattern fills, which
 * keeps imports predictable in laser software and makes preview/export match.
 */
export function waterPatternStrokes(
  pattern: WaterFillPattern,
  polygons: Polygon2D[],
  widthMm: number,
  heightMm: number,
  strokeWidthMm: number,
): Point2D[][] {
  if (pattern === "none" || !polygons.length) return [];
  const halfWidth = widthMm / 2;
  const halfHeight = heightMm / 2;
  const spacing = Math.max(2.5, strokeWidthMm * 8);

  if (pattern === "dots") {
    const dots: Point2D[][] = [];
    const dotSpacing = spacing * 1.35;
    for (let y = -halfHeight + dotSpacing / 2; y < halfHeight; y += dotSpacing) {
      const row = Math.round((y + halfHeight) / dotSpacing);
      const offset = row % 2 === 0 ? 0 : dotSpacing / 2;
      for (let x = -halfWidth + dotSpacing / 2 + offset; x < halfWidth; x += dotSpacing) {
        if (polygons.some((polygon) => pointInPolygon({ x, y }, polygon))) dots.push([{ x: x - 0.001, y }, { x: x + 0.001, y }]);
      }
    }
    return dots;
  }

  const strokes: Point2D[][] = [];
  for (let y = -halfHeight + spacing / 2; y < halfHeight; y += spacing) {
    if (pattern === "lines") {
      strokes.push(...clipPolyline([{ x: -halfWidth, y }, { x: halfWidth, y }], polygons));
      continue;
    }
    const wavelength = spacing * 2.6;
    const amplitude = Math.min(0.8, spacing * 0.22);
    const step = Math.max(0.75, wavelength / 12);
    const wave: Point2D[] = [];
    for (let x = -halfWidth; x < halfWidth; x += step) wave.push({ x, y: y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude });
    wave.push({ x: halfWidth, y: y + Math.sin((halfWidth / wavelength) * Math.PI * 2) * amplitude });
    strokes.push(...clipPolyline(wave, polygons));
  }
  return strokes;
}

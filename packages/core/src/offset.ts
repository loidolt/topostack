import ClipperLib from "clipper-lib";
import type { Point2D } from "./types.js";

const CLIPPER_SCALE = 10_000;

function samePoint(left: Point2D, right: Point2D): boolean {
  return left.x === right.x && left.y === right.y;
}

export function offsetClosedRing(points: Point2D[], distanceMm: number, join: "miter" | "round" = "miter"): Point2D[][] {
  if (points.length < 4) return [];
  if (Math.abs(distanceMm) < 1e-9) return [[...points]];
  const first = points[0]!;
  const open = samePoint(first, points.at(-1)!) ? points.slice(0, -1) : [...points];
  const path: ClipperLib.Path = open.map((point) => ({ X: Math.round(point.x * CLIPPER_SCALE), Y: Math.round(point.y * CLIPPER_SCALE) }));
  if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
  const offsetter = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE);
  offsetter.AddPath(path, join === "round" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution: ClipperLib.Paths = [];
  offsetter.Execute(solution, distanceMm * CLIPPER_SCALE);
  return solution
    .filter((ring) => ring.length >= 3)
    .sort((left, right) => Math.abs(ClipperLib.Clipper.Area(right)) - Math.abs(ClipperLib.Clipper.Area(left)))
    .map((ring) => {
      const result = ring.map((point) => ({ x: point.X / CLIPPER_SCALE, y: point.Y / CLIPPER_SCALE }));
      return [...result, result[0]!];
    });
}

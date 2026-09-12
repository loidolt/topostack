import { describe, expect, it } from "vitest";
import { buildProjectPackage, carveWaterDepth, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "./index.js";
import { ringFitsInsidePolygon } from "./geometry2d.js";

const bounds = { west: 0, east: 0.1, south: 0, north: 0.1 };
const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 300, heightMm: 300, showWaterDepth: false, showWater: false, showRoads: false, showTrails: false, showNorthArrow: false, showScaleBar: false, showElevationLabels: false, showAlignmentGuides: false, optimizeMaterialUse: false, location: { ...DEFAULT_PROJECT.location, bounds } };
function source(config: ProjectConfigV1, value: (x: number, y: number) => number, size = 32): SourceBundleV1 {
  const values = Float32Array.from({ length: size * size }, (_, i) => value(i % size, Math.floor(i / size)));
  return { ...createSyntheticSource(config, size), sourceKind: "real", elevation: { width: size, height: size, values, min: Math.min(...values), max: Math.max(...values) } };
}
const ring = (points: number[][]) => points.map(([x, y]) => ({ x: x!, y: y! }));

describe("fabrication geometry regressions", () => {
  it.each(["boundary", "grid"] as const)("preserves a sparse %s across all exposed layers", (kind) => {
    const config = { ...base, showBoundaries: true, showCoordinateGrid: kind === "grid" };
    const data = source(config, (x) => x / 31 * 500);
    data.markings = [{ id: "crossing", kind, operation: "engrave", points: [{ x: -149, y: 0 }, { x: 149, y: 0 }] }];
    const result = generateGeometry(config, data);
    const paths = result.layers.flatMap((layer) => layer.markings.filter((marking) => marking.id.startsWith("crossing-") && marking.points.length > 1));
    expect(paths.length).toBeGreaterThan(3);
    const length = paths.reduce((sum, path) => sum + path.points.slice(1).reduce((subtotal, point, i) => subtotal + Math.hypot(point.x - path.points[i]!.x, point.y - path.points[i]!.y), 0), 0);
    expect(length).toBeCloseTo(298, 3);
  });

  it.each(["stack", "engraving"] as const)("ignores extrema outside a circular %s crop", (outputMode) => {
    const config = { ...base, cropShape: "circle" as const, outputMode };
    const data = source(config, (x, y) => x < 3 && y < 3 ? 1000 : x / 31 * 10);
    const result = generateGeometry(config, data);
    expect(result.landReliefM).toBeLessThanOrEqual(10);
    expect(result.layers.every((layer) => layer.polygons.length > 0)).toBe(true);
    expect(() => buildProjectPackage(result, config)).not.toThrow();
  });

  it("retains interpolated terrain at a circular crop edge without using excluded peaks", () => {
    const config = { ...base, cropShape: "circle" as const };
    const result = generateGeometry(config, source(config, (x, y) => x < 5 && y < 5 ? 1000 : x / 31 * 10));
    expect(result.landReliefM).toBeGreaterThan(10);
    expect(result.landReliefM).toBeLessThan(250);
    expect(result.layers.every((layer) => layer.polygons.length > 0)).toBe(true);
  });

  it("preserves a lake's geographic depth field when the output is stretched", () => {
    const data = source(base, () => 100, 51);
    const lake: WaterAreaV1 = { id: "lake", kind: "lake", polygon: { outer: ring([[-75,-90],[75,-90],[75,90],[-75,90],[-75,-90]]), holes: [] }, maxDepthM: 80, lmaxM: 2800, clipped: true };
    const normal = carveWaterDepth(data.elevation, base, [lake], 10000, 10000);
    const stretched = carveWaterDepth(data.elevation, { ...base, heightMm: 150 }, [{ ...lake, polygon: { ...lake.polygon, outer: lake.polygon.outer.map((point) => ({ ...point, y: point.y / 2 })) } }], 10000, 10000);
    expect(normal.grid.min).toBeLessThan(100);
    expect(stretched.grid.values).toEqual(normal.grid.values);
  });

  it("rejects a label crossing a narrow concavity between its corners and midpoints", () => {
    const footprint = ring([[-5,-5],[5,-5],[5,5],[-5,5],[-5,-5]]);
    const polygon = { outer: ring([[-10,-10],[-3,-10],[-3,0],[-2,0],[-2,-10],[10,-10],[10,10],[-10,10],[-10,-10]]), holes: [] };
    expect(ringFitsInsidePolygon(footprint, polygon, 0)).toBe(false);
    expect(ringFitsInsidePolygon(footprint, { outer: ring([[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]), holes: [] }, 0)).toBe(true);
  });

  it("omits annotations that cannot fit a valid small output", () => {
    const config = { ...base, widthMm: 10, heightMm: 10, outputMode: "engraving" as const, northArrowSizeMm: 12, showNorthArrow: true, showScaleBar: true };
    const result = generateGeometry(config, source(config, (x) => x));
    expect(result.layers.flatMap((layer) => layer.markings).filter((marking) => /^(north|scale)-/.test(marking.id))).toHaveLength(0);
    expect(result.warnings.filter((warning) => warning.message.includes("was omitted"))).toHaveLength(2);
  });
});

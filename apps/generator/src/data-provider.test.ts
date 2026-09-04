import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { boundsForProject, classifyTransportation, cleanWaterwayMarkings, clipVectorTileLine, combineWaterAreas, dissolveWaterAreas, dissolveWaterPolygons, loadVectorMarkings, stitchTransportationMarkings, transportationLabel } from "./data-provider";

describe("transportation metadata", () => {
  it("classifies supported roads and trails while excluding other transport", () => {
    expect(classifyTransportation({ kind: "major_road", kind_detail: "primary" })).toBe("major-road");
    expect(classifyTransportation({ kind: "minor_road", kind_detail: "residential" })).toBe("local-road");
    expect(classifyTransportation({ kind: "path", kind_detail: "track" })).toBe("trail");
    expect(classifyTransportation({ kind: "rail", kind_detail: "light_rail" })).toBeUndefined();
    expect(classifyTransportation({ kind: "ferry", kind_detail: "path" })).toBeUndefined();
  });

  it("prefers names and falls back to route references", () => {
    expect(transportationLabel({ name: "Rim Drive", ref: "OR 62" })).toBe("Rim Drive");
    expect(transportationLabel({ ref: "OR 62", shield_text: "62" })).toBe("OR 62");
    expect(transportationLabel({ shield_text: "62" })).toBe("62");
  });

  it("removes vector-tile buffers before road geometry is projected", () => {
    expect(clipVectorTileLine([
      { x: -2, y: 4 },
      { x: 4, y: 4 },
      { x: 12, y: 4 },
    ], 10)).toEqual([[
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 10, y: 4 },
    ]]);
  });

  it("stitches road pieces across tile edges without joining forks", () => {
    const road = (id: string, points: Array<{ x: number; y: number }>) => ({ id, kind: "road" as const, operation: "engrave" as const, transportationClass: "major-road" as const, label: "Bend Road", points });
    const stitched = stitchTransportationMarkings([
      road("left", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      road("right", [{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 10, y: 5 }]),
    ]);
    expect(stitched).toHaveLength(1);
    expect(stitched[0]?.points).toEqual([{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 4 }, { x: 10, y: 5 }]);

    const fork = stitchTransportationMarkings([
      road("west", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      road("east", [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      road("north", [{ x: 0, y: 0 }, { x: 0, y: 10 }]),
    ]);
    expect(fork).toHaveLength(3);
  });
});

function signedArea(points: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    total += (points[previous]!.x - points[index]!.x) * (points[previous]!.y + points[index]!.y);
  }
  return total / 2;
}

describe("water geometry cleanup", () => {
  const ring = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top },
  ];

  it("dissolves adjacent tile polygons without retaining their shared seam", () => {
    const markings = dissolveWaterPolygons([
      { outer: ring(0, 0, 10, 10), holes: [] },
      { outer: ring(10, 0, 20, 10), holes: [] },
    ], 0.8);
    expect(markings).toHaveLength(1);
    const points = markings[0]!.points;
    expect(points[0]).toEqual(points.at(-1));
    expect(points.some((point, index) => point.x === 10 && points[index + 1]?.x === 10)).toBe(false);
    expect(Math.min(...points.map((point) => point.x))).toBe(0);
    expect(Math.max(...points.map((point) => point.x))).toBe(20);
  });

  it("preserves island shorelines and filters undersized water rings", () => {
    const markings = dissolveWaterPolygons([
      { outer: ring(0, 0, 20, 20), holes: [ring(5, 5, 15, 15)] },
      { outer: ring(30, 30, 30.4, 30.4), holes: [] },
    ], 0.8);
    expect(markings).toHaveLength(2);
    expect(markings.every((marking) => marking.points[0]?.x === marking.points.at(-1)?.x && marking.points[0]?.y === marking.points.at(-1)?.y)).toBe(true);
  });

  it("keeps the filled shape, wound as the geometry engine expects", () => {
    const areas = dissolveWaterAreas([
      { outer: ring(0, 0, 20, 20), holes: [ring(5, 5, 15, 15)] },
    ], 0.8);
    expect(areas).toHaveLength(1);
    const area = areas[0]!;
    // Outer rings wind positively and holes negatively, per the Polygon2D contract.
    expect(signedArea(area.outer)).toBeGreaterThan(0);
    expect(area.holes).toHaveLength(1);
    expect(signedArea(area.holes[0]!)).toBeLessThan(0);
  });

  it("lets a lake win over the ocean polygon covering it", () => {
    const lake = {
      id: "lake-7",
      kind: "lake" as const,
      hylakId: 7,
      polygon: { outer: ring(4, 4, 8, 8), holes: [] },
    };
    const combined = combineWaterAreas([lake], [{ outer: ring(0, 0, 20, 20), holes: [] }], 0.8);
    // Both sources describe the same water, so the ocean is cut back to a ring
    // around the lake rather than being drawn over the carved recess.
    const ocean = combined.filter((area) => area.kind === "ocean");
    expect(ocean).toHaveLength(1);
    expect(ocean[0]?.polygon.holes).toHaveLength(1);
    expect(combined.filter((area) => area.kind === "lake")).toEqual([lake]);
  });

  it("deduplicates and stitches waterways while preserving forks", () => {
    const water = (id: string, points: Array<{ x: number; y: number }>) => ({ id, kind: "water" as const, operation: "score" as const, points });
    const continuous = cleanWaterwayMarkings([
      water("left", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      water("duplicate", [{ x: 0, y: 0 }, { x: -10, y: 0 }]),
      water("right", [{ x: 0, y: 0 }, { x: 10, y: 2 }]),
      water("tiny", [{ x: 30, y: 0 }, { x: 30.2, y: 0 }]),
    ], 0.8);
    expect(continuous).toHaveLength(1);
    expect(continuous[0]?.points[0]).toEqual({ x: -10, y: 0 });
    expect(continuous[0]?.points.at(-1)).toEqual({ x: 10, y: 2 });

    const fork = cleanWaterwayMarkings([
      water("west", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      water("east", [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      water("north", [{ x: 0, y: 0 }, { x: 0, y: 10 }]),
    ], 0.8);
    expect(fork).toHaveLength(3);
  });
});

const getHeaderMock = vi.hoisted(() => vi.fn());
const getZxyMock = vi.hoisted(() => vi.fn());
vi.mock("pmtiles", () => ({
  PMTiles: class {
    getHeader = getHeaderMock;
    getZxy = getZxyMock;
  },
}));

describe("geographic crop bounds", () => {
  it("centers finite bounds on the selected location", () => {
    const bounds = boundsForProject(DEFAULT_PROJECT);
    expect(bounds.west).toBeLessThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.east).toBeGreaterThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.south).toBeLessThan(DEFAULT_PROJECT.location.lat);
    expect(bounds.north).toBeGreaterThan(DEFAULT_PROJECT.location.lat);
  });

  it("keeps the selected map area independent of fabrication dimensions", () => {
    const original = boundsForProject(DEFAULT_PROJECT);
    const wide = boundsForProject({ ...DEFAULT_PROJECT, widthMm: 400, heightMm: 100 });
    const tall = boundsForProject({ ...DEFAULT_PROJECT, widthMm: 100, heightMm: 400 });
    expect(wide).toEqual(original);
    expect(tall).toEqual(original);
  });
});

describe("vector marking zoom", () => {
  beforeEach(() => {
    getHeaderMock.mockReset();
    getZxyMock.mockReset();
    getZxyMock.mockResolvedValue(undefined);
  });

  it("requests one extra vector zoom for local roads and trails", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 15 });
    const bounds = boundsForProject(DEFAULT_PROJECT);
    await loadVectorMarkings(bounds, 11.43, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalled();
    for (const call of getZxyMock.mock.calls) {
      expect(call[0]).toBe(12);
      expect(Number.isInteger(call[1])).toBe(true);
      expect(Number.isInteger(call[2])).toBe(true);
    }
  });

  it("clamps the rounded zoom to the archive range", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 11 });
    const bounds = boundsForProject(DEFAULT_PROJECT);
    await loadVectorMarkings(bounds, 11.6, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalled();
    for (const call of getZxyMock.mock.calls) expect(call[0]).toBe(11);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { boundsForProject, classifyTransportation, clipVectorTileLine, loadVectorMarkings, stitchTransportationMarkings, transportationLabel } from "./data-provider";

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

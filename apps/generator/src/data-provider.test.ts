import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { boundsForProject, loadVectorMarkings } from "./data-provider";

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

  it("rounds a fractional map zoom to an integer archive level", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 15 });
    const bounds = boundsForProject(DEFAULT_PROJECT);
    await loadVectorMarkings(bounds, 11.43, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalled();
    for (const call of getZxyMock.mock.calls) {
      expect(call[0]).toBe(11);
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

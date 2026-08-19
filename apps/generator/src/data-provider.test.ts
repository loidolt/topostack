import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { boundsForProject } from "./data-provider";

describe("geographic crop bounds", () => {
  it("centers finite bounds on the selected location", () => {
    const bounds = boundsForProject(DEFAULT_PROJECT);
    expect(bounds.west).toBeLessThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.east).toBeGreaterThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.south).toBeLessThan(DEFAULT_PROJECT.location.lat);
    expect(bounds.north).toBeGreaterThan(DEFAULT_PROJECT.location.lat);
  });

  it("changes ground aspect with the fabrication aspect", () => {
    const wide = boundsForProject({ ...DEFAULT_PROJECT, widthMm: 400, heightMm: 100 });
    const tall = boundsForProject({ ...DEFAULT_PROJECT, widthMm: 100, heightMm: 400 });
    expect(tall.north - tall.south).toBeGreaterThan((wide.north - wide.south) * 10);
  });
});

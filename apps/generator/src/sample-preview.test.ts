import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry } from "@topostack/core";
import { boundsForProject } from "./data-provider";
import { createSamplePreviewSource } from "./sample-preview";

describe("Crater Lake bundled preview", () => {
  it("contains real elevation, road, and water data for the default crop", () => {
    const source = createSamplePreviewSource();
    const expectedBounds = boundsForProject(DEFAULT_PROJECT);
    expect(source.sourceKind).toBe("preview");
    expect(source.elevation.values).toHaveLength(66 * 44);
    expect(source.elevation.max - source.elevation.min).toBeGreaterThan(1_000);
    expect(source.markings.some((marking) => marking.kind === "road")).toBe(true);
    expect(source.markings.some((marking) => marking.kind === "water")).toBe(true);
    expect(source.bounds.west).toBeCloseTo(expectedBounds.west, 8);
    expect(source.bounds.north).toBeCloseTo(expectedBounds.north, 8);
    expect(source.attribution.some((item) => item.name === "OpenStreetMap contributors")).toBe(true);
  });

  it("produces visible fabrication markings for every default map detail", () => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const markings = geometry.layers.flatMap((layer) => layer.markings);
    expect(markings.some((marking) => marking.kind === "road")).toBe(true);
    expect(markings.some((marking) => marking.kind === "water")).toBe(true);
    expect(markings.some((marking) => marking.id.startsWith("alignment-"))).toBe(true);
    expect(markings.filter((marking) => marking.id.startsWith("elevation-")).length).toBeGreaterThanOrEqual(Math.ceil(DEFAULT_PROJECT.layerCount / 2));
    expect(markings.some((marking) => marking.id.startsWith("north-"))).toBe(true);
    expect(markings.some((marking) => marking.id.startsWith("scale-"))).toBe(true);
  });
});

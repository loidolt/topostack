import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, labelDimensions, layerToSvg, masterToSvg } from "./index.js";

function realSource(project = DEFAULT_PROJECT) {
  return { ...createSyntheticSource(project, 48), sourceKind: "real" as const, imagerySources: ["srtm/N46W122.tif"] };
}

function pointInRing(point: { x: number; y: number }, ring: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (a && b && (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

describe("TopoStack geometry", () => {
  it("generates nested physical layers from a deterministic elevation grid", () => {
    const source = createSyntheticSource(DEFAULT_PROJECT, 48);
    const result = generateGeometry(DEFAULT_PROJECT, source);
    expect(result.layers).toHaveLength(DEFAULT_PROJECT.layerCount);
    expect(result.layers[0]?.polygons).toHaveLength(1);
    expect(result.maxElevationM).toBeGreaterThan(result.minElevationM);
  });

  it("exports 1:1 millimeter SVGs with machine operation groups", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const svg = layerToSvg(result, result.layers[0]!);
    expect(svg).toContain('width="300mm"');
    expect(svg).toContain('data-operation="CUT"');
    expect(svg).toContain('data-operation="ENGRAVE"');
    expect(svg).toContain('id="elevation-0"');
    expect(svg).not.toContain("<text");
    const fabrication = buildFabricationPackage(result, DEFAULT_PROJECT);
    expect(fabrication.files).toHaveLength(DEFAULT_PROJECT.layerCount - result.fabricationNests.length + 5);
    expect(await fabrication.master.blob.text()).toContain("master layout");
  });

  it("blocks stale and synthetic fabrication exports", () => {
    const synthetic = generateGeometry(DEFAULT_PROJECT, createSyntheticSource(DEFAULT_PROJECT, 32));
    expect(() => buildFabricationPackage(synthetic, DEFAULT_PROJECT)).toThrow(/real terrain/i);
    const real = generateGeometry(DEFAULT_PROJECT, realSource());
    expect(() => buildFabricationPackage(real, { ...DEFAULT_PROJECT, widthMm: 301 })).toThrow(/settings changed/i);
    real.vectorStatus = "unavailable";
    expect(() => buildFabricationPackage(real, DEFAULT_PROJECT)).toThrow(/road and water data is unavailable/i);
  });

  it("records unavailable requested vector data as a geometry warning", () => {
    const source = realSource();
    source.vectorStatus = "unavailable";
    const result = generateGeometry(DEFAULT_PROJECT, source);
    expect(result.warnings[0]).toMatchObject({ code: "VECTOR_DATA_UNAVAILABLE" });
  });

  it("uses unique SVG ids in a multi-layer master", () => {
    const svg = masterToSvg(generateGeometry(DEFAULT_PROJECT, realSource()));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clips markings to circular layer material", () => {
    const project = { ...DEFAULT_PROJECT, cropShape: "circle" as const, widthMm: 200, heightMm: 200 };
    const source = realSource(project);
    source.markings = [{ id: "crossing", kind: "road", operation: "engrave", points: [{ x: -160, y: 0 }, { x: 160, y: 0 }] }];
    const result = generateGeometry(project, source);
    const crossing = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("crossing"));
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.flatMap((marking) => marking.points).every((point) => Math.hypot(point.x, point.y) <= 100.001)).toBe(true);
  });

  it("repairs an elevation label position that collides with an engraved line", () => {
    const project = {
      ...DEFAULT_PROJECT,
      showWater: false,
      showContours: false,
      showNorthArrow: false,
      showScaleBar: false,
      elevationLabelPosition: { x: 0, y: 0 },
    };
    const source = realSource(project);
    source.markings = [{
      id: "center-road",
      kind: "road",
      operation: "engrave",
      elevationM: source.elevation.min,
      points: [{ x: -project.widthMm / 2, y: 0 }, { x: project.widthMm / 2, y: 0 }],
    }];
    const result = generateGeometry(project, source);
    const marking = result.layers[0]?.markings.find((item) => item.id === "elevation-0");
    expect(marking?.label).toBeTruthy();
    const origin = marking?.points[0];
    const dimensions = labelDimensions(marking?.label ?? "");
    expect(origin).toBeTruthy();
    expect(origin && (origin.y > 0 || origin.y + dimensions.height < 0)).toBe(true);
  });

  it("keeps repaired label outlines inside circular material", () => {
    const project = { ...DEFAULT_PROJECT, cropShape: "circle" as const, widthMm: 200, heightMm: 200 };
    const result = generateGeometry(project, realSource(project));
    const labels = result.layers.flatMap((layer) => layer.markings).filter((item) => item.id.startsWith("elevation-"));
    expect(labels.length).toBeGreaterThan(0);
    for (const marking of labels) {
      const origin = marking.points[0]!;
      const dimensions = labelDimensions(marking.label ?? "");
      const corners = [origin, { x: origin.x + dimensions.width, y: origin.y }, { x: origin.x, y: origin.y + dimensions.height }, { x: origin.x + dimensions.width, y: origin.y + dimensions.height }];
      expect(corners.every((point) => Math.hypot(point.x, point.y) < 100)).toBe(true);
    }
  });

  it("engraves the next layer footprint on every lower layer by default", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    result.layers.slice(0, -1).forEach((layer, index) => {
      const nextLayer = result.layers[index + 1]!;
      const outlines = layer.markings.filter((marking) => marking.id.startsWith(`alignment-layer-${String(index + 1).padStart(2, "0")}-to-`) && marking.id.includes("-outline-"));
      if (nextLayer.polygons.length) expect(outlines.length).toBeGreaterThan(0);
      expect(outlines.every((marking) => marking.operation === "engrave" && marking.kind === "guide")).toBe(true);
    });
    expect(result.layers.at(-1)?.markings.some((marking) => marking.id.startsWith("alignment-layer-"))).toBe(false);
    expect(layerToSvg(result, result.layers[0]!)).toContain('id="alignment-layer-01-to-02-');
  });

  it("keeps alignment labels entirely under the next layer", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const labels = result.layers.flatMap((layer, index) => layer.markings
      .filter((marking) => marking.id.startsWith("alignment-layer-") && marking.id.endsWith("-label"))
      .map((marking) => ({ marking, donorLayer: layer, nextLayer: result.layers[index + 1] })));
    expect(labels.length).toBeGreaterThan(0);
    for (const { marking, donorLayer, nextLayer } of labels) {
      const origin = marking.points[0]!;
      const dimensions = labelDimensions(marking.label ?? "");
      const corners = [origin, { x: origin.x + dimensions.width, y: origin.y }, { x: origin.x, y: origin.y + dimensions.height }, { x: origin.x + dimensions.width, y: origin.y + dimensions.height }];
      expect(corners.every((point) => nextLayer?.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
      expect(corners.every((point) => donorLayer.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
    }
  });

  it("removes all assembly registration marks when disabled", () => {
    const project = { ...DEFAULT_PROJECT, showAlignmentGuides: false };
    const result = generateGeometry(project, realSource(project));
    expect(result.layers.some((layer) => layer.markings.some((marking) => marking.id.startsWith("alignment-layer-")))).toBe(false);
  });

  it("nests smaller layers into covered cavities with the configured glue margin", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    expect(result.fabricationNests.length).toBeGreaterThan(0);
    for (const nest of result.fabricationNests) {
      expect(nest.nestedLayerIndex).toBeGreaterThan(nest.donorLayerIndex + 1);
      const donor = result.layers[nest.donorLayerIndex]!;
      const cover = result.layers[nest.donorLayerIndex + 1]!;
      const nested = result.layers[nest.nestedLayerIndex]!;
      for (const cavity of nest.cavities) {
        const childRing = nested.polygons[cavity.nestedPolygonIndex]!.outer;
        expect(donor.polygons[cavity.donorPolygonIndex]!.holes[cavity.donorHoleIndex]).toEqual([...childRing].reverse());
        const container = cover.polygons.find((polygon) => childRing.slice(0, -1).every((point) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))));
        expect(container).toBeTruthy();
        const clearance = Math.min(...childRing.slice(0, -1).flatMap((point) => [container!.outer, ...container!.holes].flatMap((ring) => ring.slice(0, -1).map((start, index) => distanceToSegment(point, start, ring[index + 1]!)))));
        expect(clearance).toBeGreaterThanOrEqual(DEFAULT_PROJECT.glueMarginMm - 1e-6);
      }
    }
    const fabrication = buildFabricationPackage(result, DEFAULT_PROJECT);
    const panelFiles = fabrication.files.filter((file) => file.filename.endsWith(".svg") && !file.filename.endsWith("master.svg") && !file.filename.endsWith("assembly-guide.svg"));
    expect(panelFiles).toHaveLength(DEFAULT_PROJECT.layerCount - result.fabricationNests.length);
    expect(panelFiles.some((file) => file.filename.includes("-panel-") && file.filename.includes("-layers-"))).toBe(true);
    expect(await fabrication.master.blob.text()).toContain("data-layers=");
  });

  it("keeps one fabrication panel per layer when material nesting is disabled", () => {
    const project = { ...DEFAULT_PROJECT, optimizeMaterialUse: false };
    const result = generateGeometry(project, realSource(project));
    expect(result.fabricationNests).toEqual([]);
    expect(buildFabricationPackage(result, project).files).toHaveLength(project.layerCount + 5);
  });

  it("accepts fewer nests as the requested glue margin grows", () => {
    const tight = { ...DEFAULT_PROJECT, glueMarginMm: 2 };
    const generous = { ...DEFAULT_PROJECT, glueMarginMm: 25 };
    expect(generateGeometry(tight, realSource(tight)).fabricationNests.length)
      .toBeGreaterThanOrEqual(generateGeometry(generous, realSource(generous)).fabricationNests.length);
  });
});

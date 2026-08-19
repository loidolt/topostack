import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, labelDimensions, layerToSvg, masterToSvg } from "./index.js";

function realSource(project = DEFAULT_PROJECT) {
  return { ...createSyntheticSource(project, 48), sourceKind: "real" as const, imagerySources: ["srtm/N46W122.tif"] };
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
    expect(fabrication.files).toHaveLength(DEFAULT_PROJECT.layerCount + 5);
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
});

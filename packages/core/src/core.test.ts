import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, displayLength, generateGeometry, labelDimensions, labelLineSegments, layerToSvg, masterToSvg, millimetersFromDisplay, MM_PER_INCH, projectFingerprint, validateProject, type ProjectConfigV1, type SourceBundleV1 } from "./index.js";

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

function gridSource(project: ProjectConfigV1, size: number, elevationAt: (nx: number, ny: number) => number): SourceBundleV1 {
  const values = new Float32Array(size * size);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const elevation = elevationAt((x / (size - 1) - 0.5) * 2, (y / (size - 1) - 0.5) * 2);
      values[y * size + x] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  return { ...createSyntheticSource(project, 2), sourceKind: "real", elevation: { width: size, height: size, values, min, max } };
}

function parsePathPoints(pathData: string): Array<{ x: number; y: number }> {
  return [...pathData.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

describe("TopoStack geometry", () => {
  it("does not invent road or water markings in sample terrain", () => {
    expect(createSyntheticSource(DEFAULT_PROJECT, 48).markings).toEqual([]);
  });

  it("generates nested physical layers from a deterministic elevation grid", () => {
    const source = createSyntheticSource(DEFAULT_PROJECT, 48);
    const result = generateGeometry(DEFAULT_PROJECT, source);
    expect(result.layers).toHaveLength(DEFAULT_PROJECT.layerCount);
    expect(result.layers[0]?.polygons).toHaveLength(1);
    expect(result.maxElevationM).toBeGreaterThan(result.minElevationM);
  });

  it("traces smooth, accurate iso-lines instead of grid stair-steps", () => {
    const project = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, layerCount: 4, smoothing: 1 };
    const cone = (nx: number, ny: number) => 1000 - 500 * Math.hypot(nx, ny);
    const smoothed = generateGeometry(project, gridSource(project, 96, cone));
    // Layer 2's threshold sits at min + relief/2, so the cone's iso-line is a
    // circle of radius sqrt(2)/2 in normalized space = 70.71 mm.
    const ring = smoothed.layers[2]?.polygons[0]?.outer ?? [];
    expect(ring.length).toBeGreaterThan(40);
    const radius = Math.SQRT1_2 * 100;
    const deviation = (points: Array<{ x: number; y: number }>) => Math.max(...points.map((point) => Math.abs(Math.hypot(point.x, point.y) - radius)));
    expect(deviation(ring)).toBeLessThan(2.5);
    const stepped = generateGeometry({ ...project, smoothing: 0 }, gridSource(project, 96, cone));
    expect(deviation(ring)).toBeLessThanOrEqual(deviation(stepped.layers[2]?.polygons[0]?.outer ?? []));
  });

  it("accepts any positive finite fabrication size", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, widthMm: 2_400, heightMm: 1_200 })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, widthMm: 0 })).toThrow(/greater than zero/i);
  });

  it("uses distinct metric glyphs and switches labels and documentation to imperial", async () => {
    expect(labelDimensions("m").width).toBeGreaterThan(labelDimensions("k").width);
    const metric = generateGeometry(DEFAULT_PROJECT, realSource());
    const metricLabels = metric.layers.flatMap((layer) => layer.markings).filter((marking) => marking.label).map((marking) => marking.label ?? "");
    expect(metricLabels.some((label) => /\d m$/.test(label))).toBe(true);
    expect(metric.layers[0]?.markings.find((marking) => marking.id === "scale-label")?.label).toMatch(/\d (m|km)$/);

    const imperialProject = { ...DEFAULT_PROJECT, units: "imperial" as const };
    const imperial = generateGeometry(imperialProject, realSource(imperialProject));
    const imperialLabels = imperial.layers.flatMap((layer) => layer.markings).filter((marking) => marking.label).map((marking) => marking.label ?? "");
    expect(imperial.units).toBe("imperial");
    expect(imperialLabels.some((label) => /\d ft$/.test(label))).toBe(true);
    expect(imperial.layers[0]?.markings.find((marking) => marking.id === "scale-label")?.label).toMatch(/\d (ft|mi)$/);
    const fabrication = buildFabricationPackage(imperial, imperialProject);
    expect(await fabrication.files.find((file) => file.filename === "README.txt")?.blob.text()).toContain(" in each");
    expect(await fabrication.files.find((file) => file.filename.endsWith("assembly-guide.svg"))?.blob.text()).toContain(" ft</text>");
  });

  it("exports 1:1 millimeter SVGs with machine operation groups", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const svg = layerToSvg(result, result.layers[0]!);
    expect(svg).toContain('width="300.15mm"');
    expect(svg).toContain('viewBox="-150.075 -100.075 300.15 200.15"');
    expect(svg).toMatch(/M150\.075 100\.075 .*L-150\.075 -100\.075/s);
    expect(svg).toContain('data-operation="CUT"');
    expect(svg).toContain('data-operation="ENGRAVE"');
    expect(svg).toContain('id="elevation-0"');
    expect(svg).not.toContain("<text");
    const donorLayer = result.layers[result.fabricationNests[0]!.donorLayerIndex]!;
    const nestedSvg = layerToSvg(result, donorLayer);
    const cutGroup = nestedSvg.match(/data-operation="CUT"[^>]*>(.*?)<\/g>/)?.[1] ?? "";
    const cutPathData = [...cutGroup.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(cutPathData.length).toBeGreaterThan(1);
    expect(cutPathData.every((data) => (data.match(/M/g) ?? []).length === 1)).toBe(true);
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
    const cutPaths = [...svg.matchAll(/data-operation="CUT"[^>]*>(.*?)<\/g>/g)]
      .flatMap((group) => [...(group[1] ?? "").matchAll(/<path[^>]* d="([^"]+)"/g)].map((path) => path[1] ?? ""));
    expect(cutPaths.length).toBeGreaterThanOrEqual(DEFAULT_PROJECT.layerCount);
    expect(cutPaths.every((data) => (data.match(/M/g) ?? []).length === 1)).toBe(true);
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

  it("keeps marking ids unique when one feature re-enters an elevation layer", () => {
    const source = realSource();
    source.markings = [{ id: "switchback", kind: "road", operation: "engrave", points: [{ x: -140, y: -80 }, { x: 0, y: 0 }, { x: 140, y: -80 }, { x: 0, y: 0 }, { x: -140, y: -80 }] }];
    const result = generateGeometry(DEFAULT_PROJECT, source);
    const ids = result.layers.flatMap((layer) => layer.markings).map((marking) => marking.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("repairs an elevation label position that collides with an engraved line", () => {
    const project = {
      ...DEFAULT_PROJECT,
      showWater: false,
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
      const strokes = labelLineSegments(marking.label ?? "", marking.points[0]!, 0, 0, marking.labelRotationRad);
      expect(strokes.flatMap(({ start, end }) => [start, end]).every((point) => Math.hypot(point.x, point.y) < 100)).toBe(true);
    }
  });

  it("keeps elevation labels on exposed faces and follows contour tangents", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const labels = result.layers.flatMap((layer, index) => layer.markings
      .filter((marking) => marking.id.startsWith("elevation-"))
      .map((marking) => ({ marking, layer, coveringLayer: result.layers[index + 1] })));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some(({ marking }) => Math.abs(marking.labelRotationRad ?? 0) > 0.05)).toBe(true);
    for (const { marking, layer, coveringLayer } of labels) {
      expect(marking.label).not.toMatch(/L\d/);
      expect(marking.labelRotationRad).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(marking.labelRotationRad).toBeLessThanOrEqual(Math.PI / 2);
      const strokes = labelLineSegments(marking.label ?? "", marking.points[0]!, 0, 0, marking.labelRotationRad);
      const points = strokes.flatMap(({ start, end }) => [start, end]);
      expect(points.every((point) => layer.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
      expect(points.every((point) => !coveringLayer?.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
    }
  });

  it("engraves the next layer footprint on every lower layer by default", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    result.layers.slice(0, -1).forEach((layer, index) => {
      const nextLayer = result.layers[index + 1]!;
      const outlines = layer.markings.filter((marking) => marking.id.startsWith(`alignment-layer-${String(index + 1).padStart(2, "0")}-to-`) && marking.id.includes("-outline-"));
      if (nextLayer.polygons.length) expect(outlines.length).toBeGreaterThan(0);
      expect(outlines.every((marking) => marking.operation === "engrave" && marking.kind === "guide")).toBe(true);
      expect(outlines.flatMap((marking) => marking.points).every((point) => nextLayer.polygons.some((polygon) => pointInRing(point, polygon.outer)))).toBe(true);
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
      expect(marking.label).toMatch(/^L\d{2}$/);
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
    expect(result.fabricationNests.some((nest) => result.fabricationNests.some((next) => next.donorLayerIndex === nest.donorLayerIndex + 1))).toBe(true);
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
        expect(clearance).toBeGreaterThanOrEqual(DEFAULT_PROJECT.glueMarginMm + DEFAULT_PROJECT.laserKerfMm - 1e-6);
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

  it("includes the laser kerf in the nesting glue clearance", () => {
    // Square-pyramid terrain with three layers leaves exactly one nesting
    // candidate with an exact 20 mm ring gap. A 19.5 mm glue margin fits
    // without kerf; adding 1 mm of kerf pushes the required clearance past the
    // gap and must block the nest.
    const pyramid = (nx: number, ny: number) => 100 * (1 - Math.max(Math.abs(nx), Math.abs(ny)));
    const fits = { ...DEFAULT_PROJECT, widthMm: 120, heightMm: 120, layerCount: 3, glueMarginMm: 19.5, laserKerfMm: 0 };
    expect(generateGeometry(fits, gridSource(fits, 41, pyramid)).fabricationNests.length).toBeGreaterThan(0);
    const blocked = { ...fits, laserKerfMm: 1 };
    expect(generateGeometry(blocked, gridSource(blocked, 41, pyramid)).fabricationNests).toEqual([]);
    const project = { ...DEFAULT_PROJECT, glueMarginMm: 2, laserKerfMm: 1 };
    const result = generateGeometry(project, realSource(project));
    expect(result.fabricationNests.length).toBeGreaterThan(0);
    for (const nest of result.fabricationNests) {
      const cover = result.layers[nest.donorLayerIndex + 1]!;
      const nested = result.layers[nest.nestedLayerIndex]!;
      for (const cavity of nest.cavities) {
        const childRing = nested.polygons[cavity.nestedPolygonIndex]!.outer;
        const container = cover.polygons.find((polygon) => childRing.slice(0, -1).every((point) => pointInRing(point, polygon.outer)))!;
        const clearance = Math.min(...childRing.slice(0, -1).flatMap((point) => [container.outer, ...container.holes].flatMap((ring) => ring.slice(0, -1).map((start, index) => distanceToSegment(point, start, ring[index + 1]!)))));
        expect(clearance).toBeGreaterThanOrEqual(project.glueMarginMm + project.laserKerfMm - 1e-6);
      }
    }
  });

  it("refuses to nest under a covering layer with a terrain hole over the cavity", () => {
    // Caldera: gaussian ring of high terrain around a low crater floor. Every
    // upper layer is an annulus, so any nested ring would sit under the
    // covering layer's crater hole — the cavity would be visible from above.
    const project = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, layerCount: 4, glueMarginMm: 2 };
    const source = gridSource(project, 64, (nx, ny) => {
      const r = Math.hypot(nx, ny);
      return 100 * Math.exp(-(((r - 0.45) / 0.25) ** 2));
    });
    const result = generateGeometry(project, source);
    expect(result.layers[1]!.polygons.some((polygon) => polygon.holes.length > 0)).toBe(true);
    expect(result.fabricationNests).toEqual([]);
  });

  it("offsets external cuts outward and internal cuts inward for kerf", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const nest = result.fabricationNests[0]!;
    const donor = result.layers[nest.donorLayerIndex]!;
    const cavity = nest.cavities[0]!;
    const polygon = donor.polygons[cavity.donorPolygonIndex]!;
    const hole = polygon.holes[cavity.donorHoleIndex]!;
    const svg = layerToSvg(result, donor);
    const holePath = svg.match(new RegExp(`id="${donor.id}-cut-${cavity.donorPolygonIndex + 1}-hole-${cavity.donorHoleIndex + 1}-offset-1" d="([^"]+)"`))?.[1];
    expect(holePath).toBeTruthy();
    const holePoints = parsePathPoints(holePath!);
    expect(holePoints.length).toBeGreaterThan(3);
    expect(holePoints.every((point) => pointInRing(point, hole))).toBe(true);
    const outerPath = svg.match(new RegExp(`id="${donor.id}-cut-${cavity.donorPolygonIndex + 1}-offset-1" d="([^"]+)"`))?.[1];
    expect(outerPath).toBeTruthy();
    const outerPoints = parsePathPoints(outerPath!);
    expect(outerPoints.length).toBeGreaterThan(3);
    expect(outerPoints.every((point) => !pointInRing(point, polygon.outer))).toBe(true);
  });

  it("converts display input to millimeters and back exactly", () => {
    expect(millimetersFromDisplay(1, "imperial")).toBeCloseTo(MM_PER_INCH, 10);
    expect(millimetersFromDisplay(5, "metric")).toBe(5);
    expect(displayLength(MM_PER_INCH, "imperial")).toBeCloseTo(1, 10);
    expect(displayLength(millimetersFromDisplay(0.118, "imperial"), "imperial")).toBeCloseTo(0.118, 10);
    expect(millimetersFromDisplay(displayLength(0.15, "imperial"), "imperial")).toBeCloseTo(0.15, 10);
  });

  it("hashes value-identical projects to the same fingerprint regardless of key order", () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULT_PROJECT).reverse()) as unknown as ProjectConfigV1;
    expect(projectFingerprint(reordered)).toBe(projectFingerprint(DEFAULT_PROJECT));
    expect(projectFingerprint({ ...DEFAULT_PROJECT, widthMm: 301 })).not.toBe(projectFingerprint(DEFAULT_PROJECT));
    expect(projectFingerprint({ ...DEFAULT_PROJECT, explodedPreview: 0.9 })).toBe(projectFingerprint(DEFAULT_PROJECT));
  });

  it("rejects fractional layer counts and unknown crop shapes", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, layerCount: 2.5 })).toThrow(/whole number/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, cropShape: "hexagon" as ProjectConfigV1["cropShape"] })).toThrow(/rectangle or circle/i);
  });

  it("warns about empty layers and blocks their fabrication export", () => {
    const project = { ...DEFAULT_PROJECT, layerCount: 4, minimumFeatureMm: 5, optimizeMaterialUse: false };
    // Gradient terrain plus one single-cell spike: the top layer's only region
    // is smaller than the minimum feature size, so it is culled to empty.
    const source = gridSource(project, 48, (nx, ny) => (nx > 0.01 && nx < 0.04 && ny > 0.01 && ny < 0.04 ? 100 : 30 * (nx + 1)));
    const result = generateGeometry(project, source);
    expect(result.warnings.some((warning) => warning.code === "EMPTY_LAYER")).toBe(true);
    expect(result.layers.some((layer) => layer.polygons.length === 0)).toBe(true);
    expect(() => buildFabricationPackage(result, project)).toThrow(/empty/i);
  });

  it("keeps the scale bar length and its engraved label in agreement", () => {
    const project = { ...DEFAULT_PROJECT, cropShape: "circle" as const, widthMm: 300, heightMm: 200 };
    const result = generateGeometry(project, realSource(project));
    const main = result.layers[0]!.markings.find((marking) => marking.id === "scale-main")!;
    const label = result.layers[0]!.markings.find((marking) => marking.id === "scale-label")!.label!;
    const lengthMm = Math.abs(main.points[1]!.x - main.points[0]!.x);
    const capMm = (Math.min(project.widthMm, project.heightMm) / 2) * 0.55;
    expect(lengthMm).toBeGreaterThan(0);
    expect(lengthMm).toBeLessThanOrEqual(capMm + 1e-6);
    const parsed = label.match(/^([\d.]+) (m|km)$/)!;
    const labeledM = Number(parsed[1]) * (parsed[2] === "km" ? 1000 : 1);
    const bounds = result.bounds;
    const groundWidthM = Math.abs(bounds.east - bounds.west) * (Math.PI / 180) * 6_371_008.8 * Math.cos(((bounds.north + bounds.south) / 2) * (Math.PI / 180));
    expect((lengthMm / project.widthMm) * groundWidthM).toBeCloseTo(labeledM, 3);
  });

  it("places single-point labels and renders score-operation labels", () => {
    // Nesting disabled so base-layer cavities cannot swallow the test points.
    const project = { ...DEFAULT_PROJECT, optimizeMaterialUse: false };
    const source = realSource(project);
    source.markings = [
      { id: "summit", kind: "label", operation: "engrave", points: [{ x: 10, y: 10 }], label: "1234", elevationM: source.elevation.min },
      { id: "river", kind: "water", operation: "score", points: [{ x: -20, y: 30 }, { x: 20, y: 30 }], label: "12", elevationM: source.elevation.min },
    ];
    const result = generateGeometry(project, source);
    const base = result.layers[0]!;
    expect(base.markings.find((marking) => marking.id === "summit-0-0-label")?.label).toBe("1234");
    const riverLabel = base.markings.find((marking) => marking.id === "river-0-0-label");
    expect(riverLabel?.operation).toBe("score");
    const scoreGroup = layerToSvg(result, base).match(/data-operation="SCORE"[^>]*>(.*?)<\/g>/s)?.[1] ?? "";
    expect(scoreGroup).toContain('id="river-0-0-label"');
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { parseProject } from "./storage";

describe("project import validation", () => {
  it("accepts a valid v1 project", () => expect(parseProject(DEFAULT_PROJECT)).toMatchObject({ schemaVersion: 1, widthMm: 300 }));
  it("restores markers and defaults legacy projects to an empty marker list", () => {
    const markers = [
      { id: "one", lat: 42.9, lon: -122.1, symbol: "triangle" as const },
      { id: "two", lat: 43, lon: -122, symbol: "cross" as const },
    ];
    expect(parseProject({ ...DEFAULT_PROJECT, markers }).markers).toEqual(markers);
    const { markers: _legacyMarkers, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).markers).toEqual([]);
    expect(() => parseProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0], symbol: "flag" }] })).toThrow(/marker symbol/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0], lon: 200 }] })).toThrow(/marker longitude/i);
  });
  it("restores custom trails and boundaries and defaults legacy projects to no paths", () => {
    const customLines = [
      { id: "trail-1", kind: "trail" as const, points: [{ lat: 42.9, lon: -122.1 }, { lat: 43, lon: -122 }] },
      { id: "boundary-1", kind: "boundary" as const, points: [{ lat: 42.8, lon: -122.2 }, { lat: 43.1, lon: -121.9 }] },
    ];
    expect(parseProject({ ...DEFAULT_PROJECT, customLines }).customLines).toEqual(customLines);
    const { customLines: _legacyCustomLines, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).customLines).toEqual([]);
    expect(() => parseProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0], kind: "river" }] })).toThrow(/trail or boundary/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0], points: [customLines[0].points[0]] }] })).toThrow(/at least two points/i);
  });
  it("validates and restores flat engraving settings", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, outputMode: "engraving", engravingContourCount: 24, engravingIndexInterval: 6, showEngravingBorder: false })).toMatchObject({
      outputMode: "engraving",
      engravingContourCount: 24,
      engravingIndexInterval: 6,
      showEngravingBorder: false,
    });
    expect(() => parseProject({ ...DEFAULT_PROJECT, outputMode: "print" })).toThrow(/output mode/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, engravingContourCount: 41 })).toThrow(/contour count/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, engravingIndexInterval: 1 })).toThrow(/index interval/i);
  });
  it("validates, restores, and defaults shared linework settings", () => {
    const lineStyle = { ...DEFAULT_PROJECT.lineStyle, contourMm: 0.14, majorRoadMm: 0.5, trailPattern: "dotted" as const };
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle }).lineStyle).toEqual(lineStyle);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, waterMm: 2 } })).toThrow(/line widths/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, trailPattern: "zigzag" } })).toThrow(/trail pattern/i);
    const { lineStyle: _legacyLineStyle, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).lineStyle).toEqual(DEFAULT_PROJECT.lineStyle);
    const { boundaryMm: _legacyBoundaryWidth, coordinateGridMm: _legacyCoordinateGridWidth, ...legacyStyle } = DEFAULT_PROJECT.lineStyle;
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle: legacyStyle }).lineStyle).toMatchObject({
      boundaryMm: DEFAULT_PROJECT.lineStyle.boundaryMm,
      coordinateGridMm: DEFAULT_PROJECT.lineStyle.coordinateGridMm,
    });
  });
  it("rejects non-finite and out-of-range values", () => {
    expect(() => parseProject({ ...DEFAULT_PROJECT, widthMm: "not-a-number" })).toThrow(/finite/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lat: 90 } })).toThrow(/Mercator/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, elevationLabelPosition: { x: 1, y: 0 } })).toThrow(/label position/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showAlignmentGuides: "yes" })).toThrow(/showAlignmentGuides/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, optimizeMaterialUse: "yes" })).toThrow(/optimizeMaterialUse/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, glueMarginMm: 30 })).toThrow(/glue margin/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, laserKerfMm: 1.1 })).toThrow(/laser kerf/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, units: "yards" })).toThrow(/units/i);
  });
  it("adds new fabrication defaults to projects saved before those fields existed", () => {
    const {
      elevationLabelPosition: _legacyLabelPosition,
      showAlignmentGuides: _legacyAlignmentGuides,
      optimizeMaterialUse: _legacyOptimizeMaterialUse,
      glueMarginMm: _legacyGlueMarginMm,
      laserKerfMm: _legacyLaserKerfMm,
      units: _legacyUnits,
      textStyle: _legacyTextStyle,
      northArrowStyle: _legacyNorthArrowStyle,
      northArrowSizeMm: _legacyNorthArrowSize,
      northArrowPlacement: _legacyNorthArrowPlacement,
      showTrails: _legacyTrails,
      showTransportationLabels: _legacyTransportationLabels,
      showBoundaries: _legacyBoundaries,
      showCoordinateGrid: _legacyCoordinateGrid,
      ...legacyProject
    } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      elevationLabelPosition: DEFAULT_PROJECT.elevationLabelPosition,
      showAlignmentGuides: true,
      optimizeMaterialUse: true,
      glueMarginMm: 8,
      laserKerfMm: 0.15,
      units: "metric",
      textStyle: DEFAULT_PROJECT.textStyle,
      northArrowStyle: "classic",
      northArrowSizeMm: 24,
      northArrowPlacement: { anchor: "bottom-right", offset: { x: 0, y: 0 } },
      showTrails: DEFAULT_PROJECT.showRoads,
      showTransportationLabels: false,
      showBoundaries: false,
      showCoordinateGrid: false,
    });
  });
  it("loads a project saved with an explicit layer count at the derived default", () => {
    // Layer count used to be a stored setting; it is now derived from map
    // scale, so an old save keeps everything else and adopts the default
    // exaggeration rather than failing to load.
    const { verticalExaggeration: _derivedNow, ...saved } = DEFAULT_PROJECT;
    const legacyProject = { ...saved, layerCount: 18 };
    const parsed = parseProject(legacyProject);
    expect(parsed.verticalExaggeration).toBe(DEFAULT_PROJECT.verticalExaggeration);
    expect(parsed).not.toHaveProperty("layerCount");
    expect(parsed.widthMm).toBe(DEFAULT_PROJECT.widthMm);
  });
  it("validates and restores transportation, boundary, and coordinate grid controls", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, showRoads: false, showTrails: true, showTransportationLabels: true, showBoundaries: true, showCoordinateGrid: true })).toMatchObject({ showRoads: false, showTrails: true, showTransportationLabels: true, showBoundaries: true, showCoordinateGrid: true });
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTrails: "yes" })).toThrow(/showTrails/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTransportationLabels: "yes" })).toThrow(/showTransportationLabels/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showBoundaries: "yes" })).toThrow(/showBoundaries/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showCoordinateGrid: "yes" })).toThrow(/showCoordinateGrid/i);
  });
  it("validates and restores fabrication typography", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "stencil", sizeMm: 5 } }).textStyle).toEqual({ font: "stencil", sizeMm: 5 });
    expect(() => parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "serif", sizeMm: 5 } })).toThrow(/text font/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "technical", sizeMm: 1 } })).toThrow(/text size/i);
  });
  it("validates and restores north-arrow customization", () => {
    const project = parseProject({ ...DEFAULT_PROJECT, northArrowStyle: "mariner", northArrowSizeMm: 32, northArrowPlacement: { anchor: "top-left", offset: { x: 0.2, y: -0.3 } } });
    expect(project).toMatchObject({ northArrowStyle: "mariner", northArrowSizeMm: 32, northArrowPlacement: { anchor: "top-left", offset: { x: 0.2, y: -0.3 } } });
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowStyle: "ornate" })).toThrow(/north arrow style/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowSizeMm: 4 })).toThrow(/north arrow size/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowPlacement: { anchor: "outside", offset: { x: 0, y: 0 } } })).toThrow(/north arrow anchor/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowPlacement: { anchor: "center", offset: { x: 1.1, y: 0 } } })).toThrow(/north arrow offsets/i);
  });
  it("defaults smoothing, minimum feature, and exploded preview for legacy projects", () => {
    const {
      smoothing: _legacySmoothing,
      minimumFeatureMm: _legacyMinimumFeature,
      explodedPreview: _legacyExplodedPreview,
      ...legacyProject
    } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      smoothing: DEFAULT_PROJECT.smoothing,
      minimumFeatureMm: DEFAULT_PROJECT.minimumFeatureMm,
      explodedPreview: DEFAULT_PROJECT.explodedPreview,
    });
  });

  it("loads projects saved before water depth existed", () => {
    const { showWaterDepth: _legacyShowWaterDepth, waterDepthOverrides: _legacyOverrides, waterDepthExaggeration: _legacyExaggeration, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      showWaterDepth: DEFAULT_PROJECT.showWaterDepth,
      waterDepthOverrides: {},
      waterDepthExaggeration: DEFAULT_PROJECT.waterDepthExaggeration,
    });
  });

  it("drops depth overrides that are not usable depths", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, waterDepthOverrides: { "9092": 594, "1": -5, "2": "deep", "3": 99999, lake: 20 } })).toMatchObject({
      waterDepthOverrides: { "9092": 594 },
    });
  });
});

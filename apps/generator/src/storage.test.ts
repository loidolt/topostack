import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { parseProject } from "./storage";

describe("project import validation", () => {
  it("accepts a valid v1 project", () => expect(parseProject(DEFAULT_PROJECT)).toMatchObject({ schemaVersion: 1, widthMm: 300 }));
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
    });
  });
  it("validates and restores transportation controls", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, showRoads: false, showTrails: true, showTransportationLabels: true })).toMatchObject({ showRoads: false, showTrails: true, showTransportationLabels: true });
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTrails: "yes" })).toThrow(/showTrails/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTransportationLabels: "yes" })).toThrow(/showTransportationLabels/i);
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
});

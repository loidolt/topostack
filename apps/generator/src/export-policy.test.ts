import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type SourceBundleV1 } from "@topostack/core";
import { createAtommExport, exportBlockReason } from "./export-policy";

function geometry(kind: SourceBundleV1["sourceKind"] = "real") {
  return generateGeometry(DEFAULT_PROJECT, { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: kind });
}

describe("Atomm export policy", () => {
  it("blocks synthetic and stale results", () => {
    expect(exportBlockReason(geometry("synthetic"), DEFAULT_PROJECT)).toMatch(/real terrain/i);
    expect(exportBlockReason(geometry("preview"), DEFAULT_PROJECT)).toMatch(/real terrain/i);
    expect(exportBlockReason(geometry(), { ...DEFAULT_PROJECT, verticalExaggeration: 9 })).toMatch(/settings changed/i);
  });

  it("blocks incomplete requested vector data", () => {
    const result = geometry();
    result.vectorStatus = "unavailable";
    expect(exportBlockReason(result, DEFAULT_PROJECT)).toMatch(/map detail data is unavailable/i);
    const depthOnly = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false };
    const missingOceanMask = generateGeometry(depthOnly, { ...createSyntheticSource(depthOnly, 32), sourceKind: "real", vectorStatus: "not-requested" });
    expect(exportBlockReason(missingOceanMask, depthOnly)).toMatch(/map detail data is unavailable/i);
    const withoutVectorDetails = { ...depthOnly, showWaterDepth: false };
    const completeWithoutVectors = generateGeometry(withoutVectorDetails, { ...createSyntheticSource(withoutVectorDetails, 32), sourceKind: "real", vectorStatus: "not-requested" });
    expect(exportBlockReason(completeWithoutVectors, withoutVectorDetails)).toBeUndefined();
  });

  it("returns one master for Studio and all files for download", () => {
    const result = geometry();
    const studio = createAtommExport(result, DEFAULT_PROJECT, "openInStudio");
    const download = createAtommExport(result, DEFAULT_PROJECT, "download");
    expect(Array.isArray(studio)).toBe(false);
    expect("filename" in studio && studio.filename.endsWith("-master.svg")).toBe(true);
    expect(Array.isArray(download)).toBe(true);
    expect(Array.isArray(download) && download.length).toBe((result.layers.length - result.fabricationNests.length) * 2 + 5);
  });

  it("returns the engrave-only artwork for a flat project", () => {
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, engravingContourCount: 10 };
    const result = generateGeometry(project, { ...createSyntheticSource(project, 32), sourceKind: "real" });
    const studio = createAtommExport(result, project, "openInStudio");
    const download = createAtommExport(result, project, "download");
    expect("filename" in studio && studio.filename.endsWith("-engraving.svg")).toBe(true);
    expect(Array.isArray(download) && download).toHaveLength(4);
  });
});

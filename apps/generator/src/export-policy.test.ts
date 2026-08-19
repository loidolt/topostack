import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry } from "@topostack/core";
import { createAtommExport, exportBlockReason } from "./export-policy";

function geometry(kind: "real" | "synthetic" = "real") {
  return generateGeometry(DEFAULT_PROJECT, { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: kind });
}

describe("Atomm export policy", () => {
  it("blocks synthetic and stale results", () => {
    expect(exportBlockReason(geometry("synthetic"), DEFAULT_PROJECT)).toMatch(/real terrain/i);
    expect(exportBlockReason(geometry(), { ...DEFAULT_PROJECT, layerCount: 9 })).toMatch(/settings changed/i);
  });

  it("blocks incomplete requested vector data", () => {
    const result = geometry();
    result.vectorStatus = "unavailable";
    expect(exportBlockReason(result, DEFAULT_PROJECT)).toMatch(/road and water data is unavailable/i);
    const withoutVectorDetails = { ...DEFAULT_PROJECT, showRoads: false, showWater: false };
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
    expect(Array.isArray(download) && download.length).toBe(DEFAULT_PROJECT.layerCount + 5);
  });
});

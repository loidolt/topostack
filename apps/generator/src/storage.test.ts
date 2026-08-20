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
  });
  it("adds new fabrication defaults to projects saved before those fields existed", () => {
    const { elevationLabelPosition: _legacyLabelPosition, showAlignmentGuides: _legacyAlignmentGuides, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      elevationLabelPosition: DEFAULT_PROJECT.elevationLabelPosition,
      showAlignmentGuides: true,
    });
  });
});

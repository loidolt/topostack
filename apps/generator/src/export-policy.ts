import { buildProjectPackage, projectFingerprint, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";

export type ExportIntent = "download" | "openInStudio";

export function exportBlockReason(geometry: GeometryIRV1, project: ProjectConfigV1): string | undefined {
  if (geometry.sourceKind !== "real") return `Generate real terrain data before exporting ${project.outputMode === "engraving" ? "engraving" : "fabrication"} files.`;
  if (geometry.configFingerprint !== projectFingerprint(project)) return "Project settings changed. Regenerate the terrain before exporting.";
  const needsVectors = project.showRoads || project.showTrails || project.showWater || project.showBoundaries || (project.outputMode === "stack" && project.showWaterDepth);
  if (geometry.vectorStatus !== "available" && needsVectors) return "Map detail data is unavailable. Disable those map details or regenerate after the service is restored.";
  if (project.outputMode === "stack" && geometry.layers.some((layer) => layer.polygons.length === 0)) return "One or more layers are empty. Reduce the layer count or minimum feature size before exporting.";
  return undefined;
}

export function createAtommExport(geometry: GeometryIRV1, project: ProjectConfigV1, intent: ExportIntent) {
  const reason = exportBlockReason(geometry, project);
  if (reason) throw new Error(reason);
  const output = buildProjectPackage(geometry, project);
  return intent === "openInStudio" ? { filename: output.master.filename, blob: output.master.blob } : output.files;
}

import { buildFabricationPackage, projectFingerprint, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";

export type ExportIntent = "download" | "openInStudio";

export function exportBlockReason(geometry: GeometryIRV1, project: ProjectConfigV1): string | undefined {
  if (geometry.sourceKind !== "real") return "Generate real terrain data before exporting fabrication files.";
  if (geometry.configFingerprint !== projectFingerprint(project)) return "Project settings changed. Regenerate the terrain before exporting.";
  if (geometry.vectorStatus === "unavailable" && (project.showRoads || project.showWater)) return "Road and water data is unavailable. Disable those map details or regenerate after the service is restored.";
  if (geometry.layers.some((layer) => layer.polygons.length === 0)) return "One or more layers are empty. Reduce the layer count or minimum feature size before exporting.";
  return undefined;
}

export function createAtommExport(geometry: GeometryIRV1, project: ProjectConfigV1, intent: ExportIntent) {
  const reason = exportBlockReason(geometry, project);
  if (reason) throw new Error(reason);
  const fabrication = buildFabricationPackage(geometry, project);
  return intent === "openInStudio" ? { filename: fabrication.master.filename, blob: fabrication.master.blob } : fabrication.files;
}

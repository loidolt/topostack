import { projectFingerprint } from "./geometry.js";
import { sourceRequirements } from "./source-requirements.js";
import type { GeometryIRV1, ProjectConfigV1 } from "./types.js";

export function exportBlockReason(geometry: GeometryIRV1, project: ProjectConfigV1): string | undefined {
  if (geometry.sourceKind !== "real") return `Generate real terrain data before exporting ${project.outputMode === "engraving" ? "engraving" : "fabrication"} files.`;
  if (geometry.configFingerprint !== projectFingerprint(project)) return "Project settings changed. Regenerate the terrain before exporting.";
  const { vectors: needsVectors, lakes: needsLakes } = sourceRequirements(project);
  if (geometry.vectorStatus === "partial" && needsVectors) return "Map detail data exceeded the safe feature limit. Narrow the map area or disable some map details, then regenerate.";
  if (geometry.vectorStatus !== "available" && needsVectors) return "Map detail data is unavailable. Disable those map details or regenerate after the service is restored.";
  if (needsLakes && geometry.lakeDataStatus !== "available") return "Lake depth data is unavailable. Disable water depth or regenerate after the service is restored.";
  if (project.outputMode === "stack" && geometry.layers.some((layer) => layer.polygons.length === 0)) return "One or more layers are empty. Reduce the layer count or minimum feature size before exporting.";
  return undefined;
}

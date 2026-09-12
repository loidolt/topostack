import { buildProjectPackage, exportBlockReason, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";

export { exportBlockReason } from "@topostack/core";
export type ExportIntent = "download" | "openInStudio";

export function createAtommExport(geometry: GeometryIRV1, project: ProjectConfigV1, intent: ExportIntent) {
  const reason = exportBlockReason(geometry, project);
  if (reason) throw new Error(reason);
  const output = buildProjectPackage(geometry, project);
  return intent === "openInStudio" ? { filename: output.master.filename, blob: output.master.blob } : output.files;
}

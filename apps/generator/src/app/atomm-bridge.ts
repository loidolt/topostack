import type { GeometryIRV1, ProjectConfigV1 } from "@topostack/core";
import { createAtommExport } from "../export-policy";

type CurrentExport = () => { geometry: GeometryIRV1; project: ProjectConfigV1 };

let currentExport: CurrentExport | undefined;
let registered = false;

export function connectAtomm(getCurrent: CurrentExport, onReady: () => void): () => void {
  currentExport = getCurrent;
  const setup = () => {
    if (!window.atomm) return;
    onReady();
    if (registered) return;
    registered = true;
    window.atomm.lifecycle.on("export", async ({ intent }) => {
      if (!currentExport) throw new Error("TopoStack is not ready to export.");
      const { geometry, project } = currentExport();
      return createAtommExport(geometry, project, intent);
    });
  };
  setup();
  const interval = window.setInterval(setup, 250);
  const timeout = window.setTimeout(() => window.clearInterval(interval), 5_000);
  return () => {
    window.clearInterval(interval);
    window.clearTimeout(timeout);
  };
}

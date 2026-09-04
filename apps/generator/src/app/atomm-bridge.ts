import type { GeometryIRV1, ProjectConfigV1 } from "@topostack/core";
import { createAtommExport } from "../export-policy";

type CurrentExport = () => { geometry: GeometryIRV1; project: ProjectConfigV1 };

let currentExport: CurrentExport | undefined;
// Register the export handler once per SDK instance. The handler reads the
// module-level getter, so a reconnect swaps in a fresh getter without stacking
// duplicate handlers, and a fresh SDK object gets its own registration.
const registeredSdks = new WeakSet<AtommSdk>();

export function connectAtomm(getCurrent: CurrentExport, onReady: () => void): () => void {
  currentExport = getCurrent;
  const setup = () => {
    const sdk = window.atomm;
    if (!sdk) return;
    onReady();
    if (registeredSdks.has(sdk)) return;
    registeredSdks.add(sdk);
    sdk.lifecycle.on("export", async ({ intent }) => {
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
    // Fail closed after disconnect: a stale handler on a surviving SDK refuses
    // to export until a new connection installs its getter.
    if (currentExport === getCurrent) currentExport = undefined;
  };
}

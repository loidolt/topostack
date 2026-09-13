import type { GeometryIRV1, ProjectConfigV1 } from "@topostack/core";
import { createAtommExport, type ExportIntent } from "../export-policy";

type CurrentExport = () => { geometry: GeometryIRV1; project: ProjectConfigV1 };

export type ExportUpdate =
  | { phase: "preparing"; intent: ExportIntent }
  | { phase: "ready"; intent: ExportIntent; fileCount: number }
  | { phase: "error"; intent: ExportIntent; message: string };

let currentExport: CurrentExport | undefined;
let currentExportUpdate: ((update: ExportUpdate) => void) | undefined;
// Register the export handler once per SDK instance. The handler reads the
// module-level getter, so a reconnect swaps in a fresh getter without stacking
// duplicate handlers, and a fresh SDK object gets its own registration.
const registeredSdks = new WeakSet<AtommSdk>();

export function connectAtomm(getCurrent: CurrentExport, onReady: () => void, onExportUpdate: (update: ExportUpdate) => void = () => undefined): () => void {
  currentExport = getCurrent;
  currentExportUpdate = onExportUpdate;
  const setup = () => {
    const sdk = window.atomm;
    if (!sdk) return;
    onReady();
    if (registeredSdks.has(sdk)) return;
    registeredSdks.add(sdk);
    sdk.lifecycle.on("export", async ({ intent }) => {
      currentExportUpdate?.({ phase: "preparing", intent });
      // Give Svelte a frame to paint the progress state before SVG/package
      // serialization occupies the main thread.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      try {
        if (!currentExport) throw new Error("TopoStack is not ready to export.");
        const { geometry, project } = currentExport();
        const output = createAtommExport(geometry, project, intent);
        currentExportUpdate?.({ phase: "ready", intent, fileCount: Array.isArray(output) ? output.length : 1 });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TopoStack could not prepare this export.";
        currentExportUpdate?.({ phase: "error", intent, message });
        throw error;
      }
    });
  };
  // Async SDK downloads can finish after the short discovery polling window.
  const script = document.querySelector<HTMLScriptElement>('script[src="https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js"]');
  script?.addEventListener("load", setup);
  setup();
  const interval = window.setInterval(setup, 250);
  const timeout = window.setTimeout(() => window.clearInterval(interval), 5_000);
  return () => {
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    script?.removeEventListener("load", setup);
    // Fail closed after disconnect: a stale handler on a surviving SDK refuses
    // to export until a new connection installs its getter.
    if (currentExport === getCurrent) { currentExport = undefined; currentExportUpdate = undefined; }
  };
}

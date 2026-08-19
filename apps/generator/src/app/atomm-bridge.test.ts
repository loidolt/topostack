// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, createSyntheticSource, generateGeometry } from "@topostack/core";
import { createAtommExport } from "../export-policy";

vi.mock("../export-policy", () => ({ createAtommExport: vi.fn(() => []) }));

describe("Atomm bridge", () => {
  beforeEach(() => { vi.resetModules(); vi.mocked(createAtommExport).mockClear(); delete window.atomm; });

  it("waits for the SDK, registers once, and exports the latest state", async () => {
    vi.useFakeTimers();
    const geometry = generateGeometry(DEFAULT_PROJECT, createSyntheticSource(DEFAULT_PROJECT));
    let project = DEFAULT_PROJECT;
    let handler: ((value: AtommExportIntent) => Promise<AtommExportFile | AtommExportFile[]>) | undefined;
    const on = vi.fn((_event: "export", callback: typeof handler) => { handler = callback; });
    const ready = vi.fn();
    const { connectAtomm } = await import("./atomm-bridge");
    const disconnect = connectAtomm(() => ({ geometry, project }), ready);
    window.atomm = { lifecycle: { on }, ui: { toast: vi.fn(), closeToast: vi.fn() }, app: { getLocale: vi.fn() } } as unknown as AtommSdk;
    await vi.advanceTimersByTimeAsync(250);
    expect(on).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    project = { ...DEFAULT_PROJECT, name: "Latest project" };
    await handler?.({ intent: "download" });
    expect(createAtommExport).toHaveBeenCalledWith(geometry, project, "download");
    connectAtomm(() => ({ geometry, project }), ready);
    expect(on).toHaveBeenCalledTimes(1);
    disconnect();
    vi.useRealTimers();
  });
});

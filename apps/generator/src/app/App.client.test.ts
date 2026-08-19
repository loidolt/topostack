import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";

const loadTerrainMock = vi.hoisted(() => vi.fn());
vi.mock("../data-provider", async (importOriginal) => ({ ...await importOriginal<typeof import("../data-provider")>(), loadTerrain: loadTerrainMock }));
vi.mock("../storage", async (importOriginal) => ({ ...await importOriginal<typeof import("../storage")>(), loadProject: vi.fn(async () => undefined), saveProject: vi.fn(async () => undefined) }));
vi.mock("./atomm-bridge", () => ({ connectAtomm: vi.fn(() => () => undefined) }));
vi.mock("./ThreePreview.svelte", async () => ({ default: (await import("./TestPreview.svelte")).default }));

import App from "./App.svelte";

describe("TopoStack Svelte shell", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(async () => { if (component) await unmount(component); component = undefined; loadTerrainMock.mockReset(); });

  it("edits and undoes the project name and switches preview modes", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Alpine study";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(name.value).toBe("Alpine study");
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    expect(name.value).toBe(DEFAULT_PROJECT.name);
    [...target.querySelectorAll("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await tick();
    expect(target.querySelector('svg[aria-label^="Cut preview for layer"]')).not.toBeNull();
  });

  it("cancels an in-flight terrain request and reports the outcome", async () => {
    loadTerrainMock.mockImplementation((_project, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true })));
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const generate = [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!;
    generate.click();
    await tick();
    expect(generate.textContent).toContain("Cancel generation");
    generate.click();
    await tick(); await Promise.resolve();
    expect(target.querySelector('[role="status"]')?.textContent).toContain("Generation canceled");
  });
});

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT } from "@topostack/core";
import { theme } from "../lib/theme";

const loadTerrainMock = vi.hoisted(() => vi.fn());
const loadVectorMarkingsMock = vi.hoisted(() => vi.fn());
const loadLakeAreasMock = vi.hoisted(() => vi.fn());
vi.mock("../data-provider", async (importOriginal) => ({ ...await importOriginal<typeof import("../data-provider")>(), loadTerrain: loadTerrainMock, loadVectorMarkings: loadVectorMarkingsMock, loadLakeAreas: loadLakeAreasMock }));
vi.mock("../storage", async (importOriginal) => ({ ...await importOriginal<typeof import("../storage")>(), loadProject: vi.fn(async () => undefined), saveProject: vi.fn(async () => undefined) }));
vi.mock("./atomm-bridge", () => ({ connectAtomm: vi.fn(() => () => undefined) }));
vi.mock("./ThreePreview.svelte", async () => ({ default: (await import("./TestPreview.svelte")).default }));

import App from "./App.svelte";

describe("TopoStack Svelte shell", () => {
  let component: ReturnType<typeof mount> | undefined;
  const stored = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() { return stored.size; },
    clear: () => stored.clear(),
    getItem: (key) => stored.get(key) ?? null,
    key: (index) => [...stored.keys()][index] ?? null,
    removeItem: (key) => { stored.delete(key); },
    setItem: (key, value) => { stored.set(key, String(value)); },
  };
  // The app lazy-loads the 3D preview. Resolve the mocked module once up front
  // so the first in-test dynamic import cannot race mock registration and pull
  // in the real WebGL component.
  beforeAll(async () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageStub });
    await import("./ThreePreview.svelte");
  });
  afterEach(async () => { if (component) await unmount(component); component = undefined; loadTerrainMock.mockReset(); loadVectorMarkingsMock.mockReset(); loadLakeAreasMock.mockReset(); theme.preference = "system"; localStorage.removeItem("topostack-theme"); delete window.atomm; });

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
    expect(target.querySelector('[data-marking-kind="road"]')).not.toBeNull();
    expect(target.querySelector(".layer-heading")?.textContent).toMatch(/Layer \d+ of 10/);
  });

  it("lays out fabrication controls in full-width rows with a compact position pair", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Fabrication settings"))!.click();
    await tick();
    const fields = target.querySelector<HTMLElement>(".advanced-fields")!;
    expect(fields.querySelectorAll('.toggle-stack button[role="switch"]')).toHaveLength(2);
    expect(fields.querySelectorAll(".field-stack > .field-row")).toHaveLength(3);
    // Text engraving and the elevation label position now sit beside what they
    // affect in Map details rather than in the fabrication panel.
    expect(fields.querySelector(".swatch-options")).toBeNull();
    expect(target.querySelectorAll('.swatch-options[aria-label="Engraving font"] button[role="radio"]')).toHaveLength(3);
    expect(target.querySelectorAll('input[aria-label="Label X"]')).toHaveLength(1);
  });

  it("changes engraving font and exact physical text size without refetching terrain", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const stencil = [...target.querySelectorAll<HTMLButtonElement>('.swatch-options[aria-label="Engraving font"] button[role="radio"]')].find((button) => button.textContent?.includes("Stencil"))!;
    stencil.click();
    await vi.waitFor(() => expect(stencil.getAttribute("aria-checked")).toBe("true"));
    const size = target.querySelector<HTMLInputElement>('input[aria-label="Text size"]')!;
    size.value = "5";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('input[aria-label="Text size slider"]')?.value).toBe("5"));
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("customizes north-arrow design, physical size, and anchored placement without refetching terrain", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const designs = target.querySelectorAll<HTMLButtonElement>('.swatch-options[aria-label="North arrow design"] button[role="radio"]');
    expect(designs).toHaveLength(3);
    const mariner = [...designs].find((button) => button.textContent?.includes("Mariner"))!;
    mariner.click();
    await vi.waitFor(() => expect(mariner.getAttribute("aria-checked")).toBe("true"));
    const size = target.querySelector<HTMLInputElement>('input[aria-label="North arrow size"]')!;
    size.value = "30";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    const topLeft = target.querySelector<HTMLButtonElement>('.north-arrow-anchor-grid button[aria-label="Top left"]')!;
    topLeft.click();
    const offsetX = target.querySelector<HTMLInputElement>('input[aria-label="North arrow offset X"]')!;
    offsetX.value = "15";
    offsetX.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(topLeft.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('input[aria-label="North arrow size slider"]')?.value).toBe("30"));
    expect(offsetX.value).toBe("15");
    expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.northMarkings)).toBeGreaterThan(10);
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("applies and persists an explicit color scheme", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const system = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("System"))!;
    system.focus();
    system.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await tick();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("topostack-theme")).toBe("dark");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')).not.toBeNull();
  });

  it("resizes cut geometry without changing or refetching the map area", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const width = target.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(width.max).toBe("");
    width.value = "1200";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i));
    expect(target.querySelector(".preview-readout")?.textContent).toContain("1200 × 200 mm");
    expect(loadTerrainMock).not.toHaveBeenCalled();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Imperial"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".preview-readout")?.textContent).toContain("47.244 × 7.874 in"));
    expect(width.value).toBe("47.244");
    expect(width.closest(".field-row")?.textContent).toContain("in");
    expect(target.querySelector(".layer-heading")?.textContent).toContain("ft");
    expect(loadTerrainMock).not.toHaveBeenCalled();
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
    expect(target.querySelector(".status-line")?.textContent).toContain("Generation canceled");
  });

  it("does not let an unresolved platform toast block generation", async () => {
    window.atomm = {
      lifecycle: { on: vi.fn() },
      ui: { toast: vi.fn(() => new Promise<string>(() => undefined)), closeToast: vi.fn(async () => undefined) },
      app: { getLocale: vi.fn(async () => "en-US") },
    };
    loadTerrainMock.mockImplementation(() => new Promise(() => undefined));
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await tick();
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });

  it("updates every Map Details feature without pressing Generate", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const cases = [
      ["Roads", "road"],
      ["Trails", "trail"],
      ["Water outlines", "water"],
      ["Assembly guides", "alignment"],
      ["Elevation labels", "elevation"],
      ["North arrow", "north"],
      ["Scale bar", "scale"],
    ] as const;

    for (const [label, attribute] of cases) {
      const input = target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
      expect(Number(stage.dataset[`${attribute}Markings` as keyof DOMStringMap])).toBeGreaterThan(0);
      input.click();
      await vi.waitFor(() => expect(input.getAttribute("aria-checked"), label).toBe("false"));
      await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent, label).toMatch(/updated/i));
      await vi.waitFor(() => expect(stage.dataset[`${attribute}Markings` as keyof DOMStringMap], label).toBe("0"));
    }
    const transportationLabels = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Transportation labels"]')!;
    expect(transportationLabels.getAttribute("aria-checked")).toBe("false");
    transportationLabels.click();
    await vi.waitFor(() => expect(transportationLabels.getAttribute("aria-checked")).toBe("true"));
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("renders named road engravings when transportation labels are enabled", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const labels = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Transportation labels"]')!;
    expect(stage.dataset.transportationLabelMarkings).toBe("0");
    labels.click();
    await vi.waitFor(() => expect(Number(stage.dataset.transportationLabelMarkings)).toBeGreaterThan(0));
    expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i);
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("commits only the latest result when a detail is toggled rapidly", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const roads = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!;
    roads.click(); roads.click();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    await vi.waitFor(() => expect(Number(stage.dataset.roadMarkings)).toBeGreaterThan(0));
    expect(roads.getAttribute("aria-checked")).toBe("true");
  });

  it("fetches only vector markings when a generated source did not request them", async () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockResolvedValue({
      markings: [{ id: "fetched-road", kind: "road", operation: "engrave", elevationM: source.elevation.min, points: [{ x: -100, y: -80 }, { x: 100, y: -80 }] }],
      inland: [],
      ocean: [],
    });
    loadLakeAreasMock.mockResolvedValue([]);
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    for (const label of ["Roads", "Trails", "Water outlines", "Water depth"]) {
      const input = target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
      input.click();
      await vi.waitFor(() => expect(input.getAttribute("aria-checked")).toBe("false"));
    }
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    const roads = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!;
    roads.click();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    await vi.waitFor(() => expect(loadVectorMarkingsMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock.mock.calls[0]?.[2]).toMatchObject({ showRoads: true, showTrails: false, showWater: false });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Map details updated"));
    await vi.waitFor(() => expect(Number(stage.dataset.roadMarkings)).toBeGreaterThan(0));
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });

  it("fetches lake metadata when water depth is enabled after generation", async () => {
    const projectWithoutDepth = { ...DEFAULT_PROJECT, showWaterDepth: false };
    const source = {
      ...createSyntheticSource(projectWithoutDepth, 32),
      sourceKind: "real" as const,
      vectorStatus: "available" as const,
      waterAreas: [],
    };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadLakeAreasMock.mockResolvedValue([]);
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();

    const depth = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Water depth"]')!;
    depth.click();
    await vi.waitFor(() => expect(depth.getAttribute("aria-checked")).toBe("false"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));

    depth.click();
    await vi.waitFor(() => expect(loadLakeAreasMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(depth.getAttribute("aria-checked")).toBe("true"));
  });
});

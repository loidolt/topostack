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
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element): void { this.callback([{ target, contentRect: { width: 500, height: 500 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect(): void {}
      unobserve(): void {}
    } });
    await import("./ThreePreview.svelte");
  });
  afterEach(async () => { if (component) await unmount(component); component = undefined; loadTerrainMock.mockReset(); loadVectorMarkingsMock.mockReset(); loadLakeAreasMock.mockReset(); theme.preference = "system"; localStorage.removeItem("topostack-theme"); localStorage.removeItem("topostack-menu-sections-v1"); delete window.atomm; });

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

  it("switches to a flat engraving workflow with dedicated controls and preview", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const engraving = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Flat engraving"))!;
    engraving.click();
    await vi.waitFor(() => expect(engraving.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector('svg[aria-label="Flat engraving preview"]')).not.toBeNull());
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Contour density"]')?.value).toBe("12");
    expect(target.querySelector('button[role="switch"][aria-label="Engraved border"]')).not.toBeNull();
    expect(target.querySelector('button[role="switch"][aria-label="Water depth"]')).toBeNull();
    expect(target.querySelector(".layer-dock")).toBeNull();
    expect(target.querySelector(".bar-meta")?.textContent).toContain("No cut paths");
    const viewport = target.querySelector<HTMLElement>("[data-engraving-viewport]")!;
    const artwork = target.querySelector<SVGSVGElement>('svg[aria-label="Flat engraving preview"]')!;
    const initialViewBox = artwork.getAttribute("viewBox");
    expect(viewport.dataset.zoom).toBe("1.00");
    target.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click();
    await vi.waitFor(() => expect(viewport.dataset.zoom).toBe("1.50"));
    expect(viewport.dataset.rendering).toBe("preview");
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    expect(viewport.dataset.renderZoom).toBe("1.50");
    expect(artwork.getAttribute("viewBox")).not.toBe(initialViewBox);
    expect(Number(artwork.getAttribute("viewBox")!.split(" ")[2])).toBeLessThan(Number(initialViewBox!.split(" ")[2]));
    expect(target.querySelector(".engraving-zoom-value")?.textContent).toBe("150%");
    target.querySelector<HTMLButtonElement>('button[aria-label="Reset engraving view"]')!.click();
    await vi.waitFor(() => expect(viewport.dataset.zoom).toBe("1.00"));
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -80, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(Number(viewport.dataset.zoom)).toBeGreaterThan(1));
    expect(viewport.dataset.rendering).toBe("preview");
    expect(viewport.dataset.renderZoom).toBe("1.00");
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    expect(target.querySelector<HTMLElement>(".engraving-canvas")?.style.transform).toMatch(/scale\(1\./);
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    expect(viewport.dataset.renderZoom).toBe(viewport.dataset.zoom);
    expect(artwork.getAttribute("viewBox")).not.toBe(initialViewBox);
    expect(target.querySelector<HTMLElement>(".engraving-canvas")?.style.transform).toContain("scale(1)");
    const settledViewBox = artwork.getAttribute("viewBox");
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = vi.fn(() => true);
    viewport.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number, clientY: number): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    viewport.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    viewport.dispatchEvent(pointerEvent("pointermove", 150, 125));
    const panLayer = target.querySelector<HTMLElement>(".engraving-pan-layer")!;
    await vi.waitFor(() => expect(panLayer.style.transform).toContain("50px, 25px"));
    expect(artwork.getAttribute("viewBox")).toBe(settledViewBox);
    viewport.dispatchEvent(pointerEvent("pointerup", 150, 125));
    await vi.waitFor(() => expect(panLayer.style.transform).toBe("translate3d(0, 0, 0)"));
    expect(artwork.getAttribute("viewBox")).not.toBe(settledViewBox);
  });

  it("applies linework presets and custom trail patterns to the engraving preview", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const bold = [...target.querySelectorAll<HTMLButtonElement>('.line-presets button[role="radio"]')].find((button) => button.textContent?.includes("Bold"))!;
    bold.click();
    await vi.waitFor(() => expect(bold.getAttribute("aria-checked")).toBe("true"));
    [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Flat engraving"))!.click();
    await vi.waitFor(() => expect(target.querySelector('svg[aria-label="Flat engraving preview"]')).not.toBeNull());
    await vi.waitFor(() => expect(target.querySelector('.engraving-contours path:not(.index-contour)')?.getAttribute("stroke-width")).toBe("0.24"));
    target.querySelector<HTMLButtonElement>(".linework-customize")!.click();
    await tick();
    const dotted = [...target.querySelectorAll<HTMLButtonElement>('.trail-pattern-options button[role="radio"]')].find((button) => button.textContent?.includes("Dotted"))!;
    dotted.click();
    await vi.waitFor(() => expect(dotted.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector('[data-transportation-class="trail"] path')?.getAttribute("stroke-dasharray")).toMatch(/^0\.01 /));
    const outlined = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Outlined"))!;
    outlined.click();
    await vi.waitFor(() => expect(outlined.getAttribute("aria-checked")).toBe("true"));
    expect(target.querySelector('input[aria-label="Major road outline spacing"]')).not.toBeNull();
    const square = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Square"))!;
    square.click();
    await vi.waitFor(() => expect(target.querySelector('[data-transportation-class="major-road"] path')?.getAttribute("stroke-linecap")).toBe("square"));
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

  it("collapses, expands, and remembers configuration sections", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();

    const sections = [...target.querySelectorAll<HTMLButtonElement>(".section-disclosure")];
    expect(sections).toHaveLength(7);
    expect(sections[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(sections.slice(1).every((section) => section.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(target.querySelector<HTMLElement>("#section-size")?.hidden).toBe(true);

    [...target.querySelectorAll<HTMLButtonElement>(".section-tools button")].find((button) => button.textContent === "Expand all")!.click();
    await tick();
    expect(sections.every((section) => section.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(target.querySelector<HTMLElement>("#section-size")?.hidden).toBe(false);

    sections.find((section) => section.textContent?.includes("Map details"))!.click();
    await tick();
    const saved = JSON.parse(localStorage.getItem("topostack-menu-sections-v1") ?? "{}") as Record<string, boolean>;
    expect(saved.details).toBe(false);
    expect(saved.size).toBe(true);
  });

  it("applies and persists an explicit color scheme", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    const toggle = target.querySelector<HTMLButtonElement>('button[data-theme-preference="system"]')!;
    expect(toggle.getAttribute("aria-label")).toBe("Colour scheme: System");
    toggle.click();
    await tick();
    expect(toggle.dataset.themePreference).toBe("light");
    toggle.click();
    await tick();
    expect(toggle.dataset.themePreference).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe("Colour scheme: Dark");
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
    width.value = "10";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i));
    expect(target.querySelector(".preview-readout")?.textContent).toContain("10 × 7.874 in");
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Metric"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".preview-readout")?.textContent).toContain("254 × 200 mm"));
    expect(width.value).toBe("254");
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

  it("keeps the current preview visible and interactive during an expensive detail refresh", async () => {
    const projectWithoutVectors = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false };
    const source = { ...createSyntheticSource(projectWithoutVectors, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockImplementation((_bounds, _zoom, _project, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }));
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();
    for (const label of ["Roads", "Trails", "Water outlines", "Water depth"]) {
      target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!.click();
      await vi.waitFor(() => expect(target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!.getAttribute("aria-checked")).toBe("false"));
    }
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));

    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!.click();
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const feedback = stage.querySelector<HTMLElement>(".preview-update-overlay")!;
    expect(stage.getAttribute("aria-busy")).toBe("true");
    expect(feedback.textContent).toContain("Refreshing preview");
    expect(feedback.textContent).toContain("Updating map details");
    expect(getComputedStyle(feedback).pointerEvents).toBe("none");
    expect(stage.querySelector('[data-testid="three-preview"]')).not.toBeNull();
    expect(target.querySelector(".status-line")?.classList.contains("status-loading")).toBe(true);
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

  it("fetches and renders state and province boundaries on demand", async () => {
    const projectWithoutVectors = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showBoundaries: false, showWaterDepth: false };
    const source = { ...createSyntheticSource(projectWithoutVectors, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockResolvedValue({
      markings: [{ id: "fetched-boundary", kind: "boundary", operation: "engrave", points: [{ x: -100, y: -40 }, { x: 100, y: 40 }] }],
      inland: [],
      ocean: [],
    });
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

    const boundaries = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="State and province boundaries"]')!;
    boundaries.click();
    await vi.waitFor(() => expect(loadVectorMarkingsMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock.mock.calls[0]?.[2]).toMatchObject({ showBoundaries: true, showRoads: false, showTrails: false, showWater: false });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Map details updated"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-marking-kind="boundary"]')).not.toBeNull());
    expect(boundaries.getAttribute("aria-checked")).toBe("true");
  });

  it("generates and renders a coordinate grid locally without fetching vectors", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();

    const coordinateGrid = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Latitude and longitude grid"]')!;
    coordinateGrid.click();
    await vi.waitFor(() => expect(coordinateGrid.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-marking-kind="grid"]')).not.toBeNull());
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
  });

  it("adds, edits, symbolizes, and removes an arbitrary marker list", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();

    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add marker"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(1));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Marker 1 latitude"]')?.value).toBe(String(DEFAULT_PROJECT.location.lat));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Marker 1 longitude"]')?.value).toBe(String(DEFAULT_PROJECT.location.lon));
    const star = target.querySelector<HTMLButtonElement>('.marker-symbol-options button[title="Star"]')!;
    star.click();
    await vi.waitFor(() => expect(star.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.markerMarkings)).toBeGreaterThan(0));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('button[aria-label="Remove marker 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(0));
    await vi.waitFor(() => expect(target.querySelector<HTMLElement>(".preview-stage")?.dataset.markerMarkings).toBe("0"));
  });

  it("adds custom trail and boundary paths with arbitrary coordinate points", async () => {
    const target = document.createElement("div");
    component = mount(App, { target });
    await tick();

    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add path"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".custom-line-card")).toHaveLength(1));
    expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(4);
    const boundary = [...target.querySelectorAll<HTMLButtonElement>('.custom-line-kind-options button[role="radio"]')].find((button) => button.textContent?.includes("Boundary"))!;
    boundary.click();
    await vi.waitFor(() => expect(boundary.getAttribute("aria-checked")).toBe("true"));
    target.querySelector<HTMLButtonElement>(".custom-point-add")!.click();
    await vi.waitFor(() => expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(6));
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.customLineMarkings)).toBeGreaterThan(0));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('button[aria-label="Remove point 3 from path 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(4));
    target.querySelector<HTMLButtonElement>('button[aria-label="Remove path 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".custom-line-card")).toHaveLength(0));
    await vi.waitFor(() => expect(target.querySelector<HTMLElement>(".preview-stage")?.dataset.customLineMarkings).toBe("0"));
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

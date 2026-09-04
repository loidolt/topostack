<script lang="ts">
  import { onMount } from "svelte";
  import { Box, ChevronDown, Circle, Compass, Download, Layers3, Map as MapIcon, Minus, Mountain, Search, Sparkles, Square, Undo2, Redo2, Upload, Waves, X } from "@lucide/svelte";
  import { AppShell, Brand, Button, ContextBar, Field, IconButton, Input, NumberField, Section, Sidebar, Switch, Topbar, Workspace, type ThemePreference } from "@loidolt/theme-svelte";
  import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, displayElevation, displayLength, elevationUnit, generateGeometry, labelPathData, lengthUnit, MAX_VERTICAL_EXAGGERATION, MAX_WATER_DEPTH_EXAGGERATION, millimetersFromDisplay, MIN_VERTICAL_EXAGGERATION, MIN_WATER_DEPTH_EXAGGERATION, NORTH_ARROW_MAX_MAP_FRACTION, NORTH_ARROW_MAX_SIZE_MM, NORTH_ARROW_MIN_SIZE_MM, northArrowMarkings, planTerrainStack, validateProject, type GeoBounds, type GeometryIRV1, type NorthArrowAnchor, type NorthArrowStyle, type OperationPath, type Point2D, type ProjectConfigV1, type SourceBundleV1, type TextFont } from "@topostack/core";
  import { boundsForProject, combineWaterAreas, loadLakeAreas, loadTerrain, loadVectorMarkings, type PlaceResult } from "../data-provider";
  import { theme } from "../lib/theme";
  import { MAP_DATA_ATTRIBUTION } from "../map-attribution";
  import { createSamplePreviewSource } from "../sample-preview";
  import { exportBlockReason } from "../export-policy";
  import { loadProject, parseProject, saveProject } from "../storage";
  import { connectAtomm } from "./atomm-bridge";
  import LocationDialog from "./LocationDialog.svelte";
  import TwoDPreview from "./TwoDPreview.svelte";

  type PreviewMode = "map" | "2d" | "3d";
  type GenerateState = "idle" | "loading" | "ready" | "error";
  const OSM_ATTRIBUTION = MAP_DATA_ATTRIBUTION.find((entry) => entry.name === "OpenStreetMap contributors") ?? { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };
  const PRESETS: PlaceResult[] = [
    { id: "crater-lake", label: "Crater Lake, Oregon, USA", lat: 42.9446, lon: -122.109 },
    { id: "grand-teton", label: "Grand Teton and Jenny Lake, Wyoming, USA", lat: 43.76, lon: -110.73 },
    { id: "rainier", label: "Mount Rainier, Washington, USA", lat: 46.8523, lon: -121.7603 },
    { id: "grand-canyon", label: "Grand Canyon, Arizona, USA", lat: 36.1069, lon: -112.1129 },
  ];
  const UNIT_OPTIONS = [{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }];
  const SHAPE_OPTIONS = [{ value: "rectangle", label: "Rectangle" }, { value: "circle", label: "Circle" }];
  const MODE_OPTIONS = [{ value: "map", label: "Map" }, { value: "2d", label: "Cut layers" }, { value: "3d", label: "3D stack" }];
  const THEME_OPTIONS = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }];
  const FONT_OPTIONS: Array<{ value: TextFont; label: string }> = [{ value: "technical", label: "Technical" }, { value: "rounded", label: "Rounded" }, { value: "stencil", label: "Stencil" }];
  const NORTH_ARROW_CHOICES: Array<{ value: NorthArrowStyle; label: string }> = [
    { value: "minimal", label: "Minimal" }, { value: "classic", label: "Classic" }, { value: "mariner", label: "Mariner" },
  ];
  const NORTH_ARROW_OPTIONS: Array<{ value: NorthArrowStyle; label: string; markings: OperationPath[] }> = NORTH_ARROW_CHOICES.map((option) => ({ ...option, markings: northArrowMarkings({ ...DEFAULT_PROJECT, northArrowStyle: option.value, northArrowSizeMm: 100, northArrowPlacement: { anchor: "center", offset: { x: 0, y: 0 } } }) }));
  const NORTH_ARROW_ANCHOR_OPTIONS: Array<{ value: NorthArrowAnchor; label: string }> = [
    { value: "top-left", label: "Top left" }, { value: "top", label: "Top" }, { value: "top-right", label: "Top right" },
    { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
    { value: "bottom-left", label: "Bottom left" }, { value: "bottom", label: "Bottom" }, { value: "bottom-right", label: "Bottom right" },
  ];

  function previewFor(config: ProjectConfigV1, source: SourceBundleV1): GeometryIRV1 {
    const result = generateGeometry(config, source);
    addPreviewWarning(result, source);
    return result;
  }

  function addPreviewWarning(result: GeometryIRV1, source: SourceBundleV1): void {
    if (source.sourceKind === "real" || result.warnings.some((warning) => warning.code === "DATA_FALLBACK")) return;
    result.warnings.push({ code: "DATA_FALLBACK", message: source.sourceKind === "preview" ? "Bundled real-data preview. Generate fresh terrain before exporting." : "Sample preview only. Generate real terrain before exporting." });
  }

  function featuredLayerIndex(result: GeometryIRV1): number {
    let best = { index: 0, score: -1 };
    result.layers.forEach((layer) => {
      const score = layer.markings.reduce((total, marking) => total + (marking.kind === "road" || marking.kind === "trail" || marking.kind === "water" ? 3 : marking.id.startsWith("north-") || marking.id.startsWith("scale-") ? 0 : 1), 0);
      if (score > best.score) best = { index: layer.index, score };
    });
    return best.index;
  }

  function layerForEnabledDetail(result: GeometryIRV1, patch: Partial<ProjectConfigV1>): number | undefined {
    if (patch.showWaterDepth) return result.waterSurfaces[0]?.layerIndex;
    const matcher = patch.showRoads ? (id: string, kind: string) => kind === "road" :
      patch.showTrails ? (id: string, kind: string) => kind === "trail" :
      patch.showTransportationLabels ? (id: string) => id.startsWith("transport-label-") :
      patch.showWater ? (id: string, kind: string) => kind === "water" :
      patch.showAlignmentGuides ? (id: string) => id.startsWith("alignment-") :
      patch.showElevationLabels ? (id: string) => id.startsWith("elevation-") :
      patch.showNorthArrow ? (id: string) => id.startsWith("north-") :
      patch.showScaleBar ? (id: string) => id.startsWith("scale-") : undefined;
    if (!matcher) return undefined;
    return result.layers.find((layer) => layer.markings.some((marking) => matcher(marking.id, marking.kind)))?.index;
  }

  const defaultPreviewSource = createSamplePreviewSource();
  const defaultPreviewGeometry = previewFor(DEFAULT_PROJECT, defaultPreviewSource);
  let project = $state.raw<ProjectConfigV1>(DEFAULT_PROJECT);
  let activeSource = $state.raw<SourceBundleV1>(defaultPreviewSource);
  let sourceProject = $state.raw<ProjectConfigV1>(DEFAULT_PROJECT);
  let geometry = $state.raw<GeometryIRV1>(defaultPreviewGeometry);
  let mode = $state<PreviewMode>("3d");
  let generationState = $state<GenerateState>("ready");
  let status = $state("Real-data sample preview ready");
  let detailsUpdating = $state(false);
  let selectedLayer = $state(featuredLayerIndex(defaultPreviewGeometry));
  let searchOpen = $state(false);
  let advancedOpen = $state(false);
  let atommReady = $state(false);
  let themeColor = $state("");
  let booted = $state(false);
  let history = $state.raw<ProjectConfigV1[]>([]);
  let future = $state.raw<ProjectConfigV1[]>([]);
  let importInput: HTMLInputElement;
  let requestId = 0;
  let operationRevision = 0;
  let generationAbort: AbortController | undefined;
  let detailAbort: AbortController | undefined;
  let geometryWorker: Worker | undefined;
  let geometryReject: ((reason?: unknown) => void) | undefined;
  // Heavy preview components (maplibre-gl, three) load on first use of their mode.
  let MapCanvas = $state.raw<typeof import("./MapCanvas.svelte").default | undefined>(undefined);
  let ThreePreview = $state.raw<typeof import("./ThreePreview.svelte").default | undefined>(undefined);

  $effect(() => {
    theme.resolved;
    themeColor = getComputedStyle(document.documentElement).getPropertyValue("--loidolt-background").trim();
  });

  $effect(() => {
    if (mode === "map" && !MapCanvas) void import("./MapCanvas.svelte").then((module) => { MapCanvas = module.default; });
    else if (mode === "3d" && !ThreePreview) void import("./ThreePreview.svelte").then((module) => { ThreePreview = module.default; });
  });

  const totalHeight = $derived(geometry.layers.length * project.materialThicknessMm);
  // Layer count follows from map scale, relief, and material thickness, so the
  // panel previews the stack the current settings will actually produce.
  const stackPlan = $derived(planTerrainStack(project, geometry.landReliefM, geometry.bounds, geometry.waterDepthBelowLandM));
  const fabricationPanelCount = $derived(geometry.layers.length - geometry.fabricationNests.length);
  const exportReady = $derived(!exportBlockReason(geometry, project));
  const visibleWarnings = $derived(geometry.warnings.slice(0, 2));
  const layerTicks = $derived(geometry.layers.map((layer) => Math.round(displayElevation(layer.elevationM, project.units))));
  const shownLengthUnit = $derived(lengthUnit(project.units));
  const shownElevationUnit = $derived(elevationUnit(project.units));
  const northArrowMaximumMm = $derived(Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(project.widthMm, project.heightMm) * NORTH_ARROW_MAX_MAP_FRACTION)));
  const detailCounts = $derived.by(() => {
    const counts = { road: 0, trail: 0, transportationLabel: 0, water: 0, contour: 0, alignment: 0, elevation: 0, north: 0, scale: 0 };
    for (const layer of geometry.layers) {
      for (const marking of layer.markings) {
        if (marking.kind === "road") counts.road += 1;
        else if (marking.kind === "trail") counts.trail += 1;
        else if (marking.kind === "water") counts.water += 1;
        else if (marking.kind === "contour") counts.contour += 1;
        if (marking.id.startsWith("alignment-")) counts.alignment += 1;
        else if (marking.id.startsWith("transport-label-")) counts.transportationLabel += 1;
        else if (marking.id.startsWith("elevation-")) counts.elevation += 1;
        else if (marking.id.startsWith("north-")) counts.north += 1;
        else if (marking.id.startsWith("scale-")) counts.scale += 1;
      }
    }
    return counts;
  });

  /**
   * Lakes deep enough to be worth a control, largest basin first. HydroLAKES
   * only names waterbodies of 500 km2 and up, so the label falls back to the
   * OSM name and then to a plain index.
   */
  const modeledLakes = $derived((geometry.waterSurfaces ?? [])
    // A maximum-depth override only affects modeled basins. Surveyed beds come
    // from the DEM, so showing the same control for them would be a no-op.
    .filter((surface) => surface.kind === "lake" && surface.hylakId !== undefined && surface.depthSource !== "surveyed" && surface.maxDepthM !== undefined)
    .map((surface, index) => ({
      id: surface.id,
      hylakId: surface.hylakId!,
      name: surface.name ?? `Lake ${index + 1}`,
      maxDepthM: surface.maxDepthM ?? surface.surfaceElevationM - surface.bedElevationM,
      depthSource: surface.depthSource,
    }))
    .sort((left, right) => right.maxDepthM - left.maxDepthM)
    .slice(0, 4));
  const hasDepthOverride = $derived(Object.keys(project.waterDepthOverrides).length > 0);

  function shownDepth(valueM: number): number {
    return Math.round(displayElevation(valueM, project.units));
  }

  function setLakeDepth(hylakId: number, shown: number): Promise<void> | undefined {
    if (!Number.isFinite(shown) || shown <= 0) return undefined;
    const depthM = project.units === "imperial" ? shown / 3.280839895 : shown;
    return updateFabrication({ waterDepthOverrides: { ...project.waterDepthOverrides, [String(hylakId)]: depthM } });
  }

  function shownLength(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(3));
  }

  function storedLength(value: number): number {
    return millimetersFromDisplay(value, project.units);
  }

  function shownTextSize(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(project.units === "imperial" ? 4 : 1));
  }

  function previewMarkingPath(marking: OperationPath): string {
    if (marking.label && marking.points[0]) return labelPathData(marking.label, marking.points[0], 0, 0, 0, marking.textStyle);
    return marking.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  }

  function navigateChoice(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const choices = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])];
    const current = choices.indexOf(event.currentTarget);
    if (current < 0 || !choices.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length;
    choices[next]?.focus();
    choices[next]?.click();
  }

  onMount(() => {
    let cancelled = false;
    const disconnectAtomm = connectAtomm(() => ({ geometry, project }), () => atommReady = true);
    void loadProject().then((saved) => {
      if (cancelled) return;
      if (saved) { const source = createSyntheticSource(saved); project = saved; sourceProject = saved; activeSource = source; geometry = previewFor(saved, source); selectedLayer = featuredLayerIndex(geometry); status = "Local project restored · generate to refresh terrain"; }
      booted = true;
    });
    return () => { cancelled = true; disconnectAtomm(); generationAbort?.abort(); detailAbort?.abort(); geometryWorker?.terminate(); geometryReject?.(new DOMException("Generator closed", "AbortError")); };
  });

  $effect(() => {
    const current = project;
    if (!booted) return;
    const timeout = window.setTimeout(() => {
      // Never persist a project that would fail validation on the next load —
      // parse failures there would silently reset the user to the default project.
      try { validateProject(current); } catch { return; }
      if (!Number.isFinite(current.explodedPreview) || current.explodedPreview < 0 || current.explodedPreview > 1) return;
      void saveProject(current).catch(() => status = "Local save is unavailable in this browser");
    }, 450);
    return () => window.clearTimeout(timeout);
  });

  const HISTORY_LIMIT = 40;
  const HISTORY_COALESCE_MS = 1200;
  const COSMETIC_KEYS: ReadonlySet<string> = new Set(["name", "explodedPreview"]);
  let lastEditSignature = "";
  let lastEditTime = 0;

  function affectsGeneration(patch: Partial<ProjectConfigV1>): boolean {
    return Object.keys(patch).some((key) => !COSMETIC_KEYS.has(key));
  }

  // Coalesce rapid edits to the same field(s) — slider drags, keystrokes — into
  // a single undo entry so one drag cannot flood the history stack.
  function pushHistory(keys: string[]): void {
    const signature = [...keys].sort().join("|");
    const now = Date.now();
    future = [];
    const coalesce = signature !== "" && signature === lastEditSignature && now - lastEditTime < HISTORY_COALESCE_MS && history.length > 0;
    lastEditSignature = signature;
    lastEditTime = now;
    if (coalesce) return;
    history = [...history, project].slice(-HISTORY_LIMIT);
  }

  function pushHistoryEntry(): void {
    lastEditSignature = "";
    future = [];
    history = [...history, project].slice(-HISTORY_LIMIT);
  }

  function updateProject(patch: Partial<ProjectConfigV1>): void {
    // Cosmetic edits (rename, exploded-preview slider) must not abort an
    // in-flight generation.
    if (affectsGeneration(patch)) invalidatePendingPreview();
    pushHistory(Object.keys(patch));
    project = { ...project, ...patch };
  }
  function updateLocation(patch: Partial<ProjectConfigV1["location"]>): void {
    invalidatePendingPreview();
    pushHistory(["location"]);
    project = { ...project, location: { ...project.location, ...patch, ...(("lat" in patch || "lon" in patch || "zoom" in patch) && !("bounds" in patch) ? { bounds: undefined } : {}) } };
  }
  function choosePlace(place: PlaceResult): void {
    invalidatePendingPreview();
    pushHistoryEntry();
    project = { ...project, name: place.label.split(",")[0] ?? "Terrain project", location: { ...project.location, lat: place.lat, lon: place.lon, label: place.label, zoom: 11, bounds: undefined } };
    searchOpen = false;
  }
  function undo(): void { const previous = history.at(-1); if (!previous) return; invalidatePendingPreview(); lastEditSignature = ""; future = [...future, project]; history = history.slice(0, -1); project = previous; }
  function redo(): void { const next = future.at(-1); if (!next) return; invalidatePendingPreview(); lastEditSignature = ""; history = [...history, project]; future = future.slice(0, -1); project = next; }

  function invalidatePendingPreview(): void {
    const wasGenerating = generationState === "loading";
    operationRevision += 1;
    generationAbort?.abort();
    detailAbort?.abort();
    if (geometryWorker) {
      geometryWorker.terminate(); geometryWorker = undefined;
      geometryReject?.(new DOMException("Preview superseded", "AbortError")); geometryReject = undefined;
    }
    detailsUpdating = false;
    if (wasGenerating) generationState = "idle";
  }

  function sameMapArea(left: ProjectConfigV1, right: ProjectConfigV1): boolean {
    return left.location.lat === right.location.lat && left.location.lon === right.location.lon && left.location.zoom === right.location.zoom &&
      JSON.stringify(left.location.bounds) === JSON.stringify(right.location.bounds);
  }

  function resizeSource(source: SourceBundleV1, from: ProjectConfigV1, to: ProjectConfigV1): SourceBundleV1 {
    if (from.widthMm === to.widthMm && from.heightMm === to.heightMm) return source;
    const scaleX = to.widthMm / from.widthMm;
    const scaleY = to.heightMm / from.heightMm;
    const scalePoints = (points: Point2D[]) => points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
    return {
      ...source,
      markings: source.markings.map((marking) => ({ ...marking, points: scalePoints(marking.points) })),
      ...(source.waterAreas ? { waterAreas: source.waterAreas.map((area) => ({ ...area, polygon: { outer: scalePoints(area.polygon.outer), holes: area.polygon.holes.map(scalePoints) } })) } : {}),
    };
  }

  function runGeometryWorker(config: ProjectConfigV1, source: SourceBundleV1): Promise<GeometryIRV1> {
    if (typeof Worker === "undefined") return Promise.resolve(generateGeometry(config, source));
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const worker = new Worker(new URL("../geometry.worker.ts", import.meta.url), { type: "module" });
      geometryWorker = worker; geometryReject = reject;
      worker.onmessage = (event: MessageEvent<{ id: number; result?: GeometryIRV1; error?: string }>) => { if (event.data.id !== id) return; worker.terminate(); geometryWorker = undefined; geometryReject = undefined; if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error ?? "Geometry generation failed.")); };
      worker.onerror = (event) => { worker.terminate(); geometryWorker = undefined; geometryReject = undefined; reject(new Error(event.message)); };
      worker.postMessage({ id, config, source });
    });
  }

  async function updateMapDetails(patch: Partial<ProjectConfigV1>): Promise<void> {
    updateProject(patch);
    const nextProject = project;
    const revision = operationRevision;
    if (!sameMapArea(sourceProject, nextProject)) {
      status = "Map details changed · generate to refresh this area";
      return;
    }
    const controller = new AbortController(); detailAbort = controller; detailsUpdating = true;
    status = "Updating map details…";
    try {
      let source = resizeSource(activeSource, sourceProject, nextProject);
      const needsVectors = nextProject.showRoads || nextProject.showTrails || nextProject.showWater || nextProject.showWaterDepth;
      if (needsVectors && source.sourceKind !== "synthetic" && source.vectorStatus !== "available") {
        try {
          const vector = await loadVectorMarkings(source.bounds, nextProject.location.zoom, nextProject, controller.signal);
          const lakes = nextProject.showWaterDepth
            ? await loadLakeAreas(source.bounds, nextProject.location.zoom, nextProject, controller.signal).catch(() => [])
            : [];
          source = { ...source, markings: vector.markings, waterAreas: combineWaterAreas(lakes, vector.ocean, nextProject.minimumFeatureMm), vectorStatus: "available" };
        } catch (error) {
          if (controller.signal.aborted) throw error;
          source = { ...source, markings: source.markings.filter((marking) => marking.kind !== "road" && marking.kind !== "trail" && marking.kind !== "water"), vectorStatus: "unavailable" };
        }
      } else if (patch.showWaterDepth && !sourceProject.showWaterDepth && source.sourceKind === "real") {
        // A source generated while depth was off already retains its OSM ocean
        // masks, but it deliberately skipped the optional lake archive. Fetch
        // those lakes once when the control is enabled so the toggle takes
        // effect immediately without requiring a full terrain regeneration.
        const lakes = await loadLakeAreas(source.bounds, nextProject.location.zoom, nextProject, controller.signal).catch((error) => {
          if (controller.signal.aborted) throw error;
          return [];
        });
        const ocean = (source.waterAreas ?? []).filter((area) => area.kind === "ocean").map((area) => area.polygon);
        source = { ...source, waterAreas: combineWaterAreas(lakes, ocean, nextProject.minimumFeatureMm) };
      }
      const next = await runGeometryWorker(nextProject, source);
      if (controller.signal.aborted || revision !== operationRevision) return;
      addPreviewWarning(next, source);
      geometry = next; activeSource = source; sourceProject = nextProject;
      if (generationState === "error") generationState = "ready";
      selectedLayer = layerForEnabledDetail(next, patch) ?? Math.min(selectedLayer, Math.max(0, next.layers.length - 1));
      status = source.vectorStatus === "unavailable" && needsVectors ? "Map details updated · transportation and water unavailable" : source.sourceKind === "preview" ? "Real-data sample preview updated" : source.sourceKind === "real" ? "Map details updated" : "Sample preview updated · generate for real map data";
    } catch (error) {
      if (controller.signal.aborted || revision !== operationRevision || (error instanceof DOMException && error.name === "AbortError")) return;
      generationState = "error";
      status = error instanceof Error ? error.message : "Could not update map details.";
    } finally {
      if (detailAbort === controller) detailAbort = undefined;
      if (revision === operationRevision) detailsUpdating = false;
    }
  }


  async function updateFabrication(patch: Partial<ProjectConfigV1>): Promise<void> {
    const nextWidth = patch.widthMm ?? project.widthMm;
    const nextHeight = patch.heightMm ?? project.heightMm;
    const maximumNorthArrowSize = Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(nextWidth, nextHeight) * NORTH_ARROW_MAX_MAP_FRACTION));
    if ((patch.widthMm !== undefined || patch.heightMm !== undefined) && (patch.northArrowSizeMm ?? project.northArrowSizeMm) > maximumNorthArrowSize) {
      patch = { ...patch, northArrowSizeMm: maximumNorthArrowSize };
    }
    updateProject(patch);
    const nextProject = project;
    const revision = operationRevision;
    if (!sameMapArea(sourceProject, nextProject)) { status = "Cut size changed · generate to refresh terrain"; return; }
    const controller = new AbortController(); detailAbort = controller; detailsUpdating = true;
    status = "Resizing cut geometry…";
    try {
      const source = resizeSource(activeSource, sourceProject, nextProject);
      const next = await runGeometryWorker(nextProject, source);
      if (controller.signal.aborted || revision !== operationRevision) return;
      addPreviewWarning(next, source);
      geometry = next; activeSource = source; sourceProject = nextProject;
      if (generationState === "error") generationState = "ready";
      selectedLayer = Math.min(selectedLayer, Math.max(0, next.layers.length - 1));
      status = source.sourceKind === "preview" ? "Real-data sample updated" : source.sourceKind === "real" ? "Fabrication geometry updated" : "Sample preview updated · generate for real map data";
    } catch (error) {
      if (controller.signal.aborted || revision !== operationRevision || (error instanceof DOMException && error.name === "AbortError")) return;
      generationState = "error";
      status = error instanceof Error ? error.message : "Could not resize the cut geometry.";
    } finally {
      if (detailAbort === controller) detailAbort = undefined;
      if (revision === operationRevision) detailsUpdating = false;
    }
  }

  async function generate(): Promise<void> {
    invalidatePendingPreview();
    const revision = operationRevision;
    const controller = new AbortController(); generationAbort = controller;
    const generationProject: ProjectConfigV1 = { ...project, location: { ...project.location, bounds: boundsForProject(project) } };
    generationState = "loading"; status = "Fetching elevation tiles…";
    const progressToast = showToast({ type: "info", message: "Building terrain layers…", duration: 0 });
    try {
      const loaded = await loadTerrain(generationProject, controller.signal); status = "Tracing and repairing contours…";
      const next = await runGeometryWorker(generationProject, loaded.source);
      if (loaded.fallback) next.warnings.push({ code: "DATA_FALLBACK", message: "The map service was unavailable, so this preview uses deterministic sample terrain." });
      if (controller.signal.aborted || revision !== operationRevision) return;
      geometry = next; project = generationProject; activeSource = loaded.source; sourceProject = generationProject; selectedLayer = featuredLayerIndex(next); mode = "3d"; generationState = "ready";
      const vectorUnavailable = next.vectorStatus !== "available" && (generationProject.showRoads || generationProject.showTrails || generationProject.showWater || generationProject.showWaterDepth);
      status = loaded.fallback ? "Sample terrain generated · connect the map API for real elevation" : vectorUnavailable ? "Terrain ready · transportation and water unavailable" : `Real terrain ready · ${next.layers.length} layers · ${next.layers.length - next.fabricationNests.length} cut panels`;
      void showToast({ type: loaded.fallback || vectorUnavailable ? "warning" : "success", message: loaded.fallback ? "Preview generated with sample terrain" : vectorUnavailable ? "Terrain generated without roads or water" : "Terrain project ready" });
    } catch (error) {
      if (revision !== operationRevision) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) { generationState = "idle"; status = "Generation canceled"; }
      else { generationState = "error"; status = error instanceof Error ? error.message : "Generation failed. Check the location and try again."; void showToast({ type: "error", message: "Could not generate terrain" }); }
    } finally {
      if (generationAbort === controller) generationAbort = undefined;
      void progressToast.then((toast) => toast && window.atomm ? window.atomm.ui.closeToast(toast) : undefined).catch(() => undefined);
    }
  }
  function cancelGeneration(): void { generationAbort?.abort(); geometryWorker?.terminate(); geometryWorker = undefined; geometryReject?.(new DOMException("Generation canceled", "AbortError")); geometryReject = undefined; }

  function showToast(options: Parameters<NonNullable<typeof window.atomm>["ui"]["toast"]>[0]): Promise<string | undefined> {
    if (!window.atomm) return Promise.resolve(undefined);
    return window.atomm.ui.toast(options).catch(() => undefined);
  }

  function downloadMaster(): void {
    try { const fabrication = buildFabricationPackage(geometry, project); const url = URL.createObjectURL(fabrication.master.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fabrication.master.filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
    catch (error) { generationState = "error"; status = error instanceof Error ? error.message : "Regenerate before exporting."; }
  }
  async function importProject(file: File | undefined): Promise<void> {
    if (!file) return;
    try { const parsed: unknown = JSON.parse(await file.text()); const candidate = parsed && typeof parsed === "object" && "project" in parsed ? (parsed as { project: unknown }).project : parsed; const imported = parseProject(candidate); const source = createSyntheticSource(imported); invalidatePendingPreview(); pushHistoryEntry(); project = imported; sourceProject = imported; activeSource = source; geometry = previewFor(imported, source); selectedLayer = featuredLayerIndex(geometry); generationState = "ready"; status = "Project imported · generate to refresh its terrain"; }
    catch (error) { status = error instanceof Error ? error.message : "Could not import this project."; generationState = "error"; }
    finally { if (importInput) importInput.value = ""; }
  }
</script>

<svelte:head>
  <meta name="theme-color" content={themeColor} />
</svelte:head>

<AppShell class="app-shell">
  {#snippet header()}
    <div class="app-header">
      <Topbar class="topbar">
        {#snippet brand()}<Brand name="TopoStack" meta="Terrain studio" />{/snippet}
        {#snippet navigation()}
          <label class="project-name"><span>Project</span><Input aria-label="Project name" value={project.name} oninput={(event) => updateProject({ name: event.currentTarget.value })} /></label>
          <div class="history-actions">
            <IconButton label="Undo" onclick={undo} disabled={!history.length}><Undo2 size={17} /></IconButton>
            <IconButton label="Redo" onclick={redo} disabled={!future.length}><Redo2 size={17} /></IconButton>
            <IconButton label="Import project JSON" onclick={() => importInput.click()}><Upload size={17} /></IconButton>
            <input bind:this={importInput} class="ldt-visually-hidden" type="file" accept="application/json,.json" onchange={(event) => void importProject(event.currentTarget.files?.[0])} />
          </div>
        {/snippet}
        {#snippet actions()}
          <div class="bar-meta"><span>{geometry.layers.length} layers</span><span>{fabricationPanelCount} cut panels</span><span>{shownLength(totalHeight)} {shownLengthUnit} tall</span></div>
          <div class="ldt-toggle-group ldt-toggle-group--sm theme-toggle" role="radiogroup" aria-label="Colour scheme">{#each THEME_OPTIONS as option}<button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={theme.preference === option.value} data-state={theme.preference === option.value ? "on" : "off"} tabindex={theme.preference === option.value ? 0 : -1} onclick={() => theme.preference = option.value as ThemePreference} onkeydown={navigateChoice}>{option.label}</button>{/each}</div>
          <div class="export-slot"><div data-atomm-export-button class:atomm-export-pending={!atommReady}></div>{#if !atommReady}<Button class="fallback-export" disabled={!exportReady} onclick={downloadMaster}><Download size={15} /> Download SVG</Button>{/if}</div>
        {/snippet}
      </Topbar>
      <ContextBar section="Terrain" title={project.location.label.split(",")[0]} detail={project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}>
        {#snippet actions()}<span class:ready={exportReady} class:error={!exportReady}>{exportReady ? "Ready to export" : "Generate before export"}</span>{/snippet}
      </ContextBar>
    </div>
  {/snippet}

  <Workspace class="workspace">
    {#snippet sidebar()}
    <Sidebar class="config-panel">
      <div class="panel-scroll">
        <Section class="config-section">
          <h1>Build the landscape.</h1>
          <div class="section-kicker"><span>01</span> Location</div>
          <button class="location-card" onclick={() => searchOpen = true}>
            <span class="location-icon"><MapIcon size={18} /></span>
            <span>
              <strong>{project.location.label.split(",")[0]}</strong>
              <small>{project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}</small>
            </span>
            <Search size={17} />
          </button>
          <div class="preset-row">
            {#each PRESETS as preset}
              <button onclick={() => choosePlace(preset)}>{preset.label.split(",")[0].replace("Mount ", "Mt. ")}</button>
            {/each}
          </div>
        </Section>

        <Section class="config-section">
          <div class="section-kicker"><span>02</span> Cut size</div>
          <div class="ldt-toggle-group unit-switch" role="radiogroup" aria-label="Display units">
            {#each UNIT_OPTIONS as option}
              <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.units === option.value} data-state={project.units === option.value ? "on" : "off"} tabindex={project.units === option.value ? 0 : -1} onclick={() => void updateFabrication({ units: option.value as ProjectConfigV1["units"] })} onkeydown={navigateChoice}>{option.label}</button>
            {/each}
          </div>
          <div class="ldt-toggle-group shape-switch" role="radiogroup" aria-label="Crop shape">
            {#each SHAPE_OPTIONS as option}
              <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.cropShape === option.value} data-state={project.cropShape === option.value ? "on" : "off"} tabindex={project.cropShape === option.value ? 0 : -1} onclick={() => void updateFabrication({ cropShape: option.value as ProjectConfigV1["cropShape"], ...(option.value === "circle" ? { heightMm: project.widthMm } : {}) })} onkeydown={navigateChoice}>{#if option.value === "rectangle"}<Square size={15} />{:else}<Circle size={15} />{/if}{option.label}</button>
            {/each}
          </div>
          <div class="field-stack">
            <Field label="Width" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Width" value={shownLength(project.widthMm)} min={project.units === "imperial" ? 0.001 : 0.01} step={project.units === "imperial" ? 0.01 : 1} oninput={(event) => { if (event.currentTarget.value !== "") { const widthMm = storedLength(event.currentTarget.valueAsNumber); void updateFabrication({ widthMm, ...(project.cropShape === "circle" ? { heightMm: widthMm } : {}) }); } }} onValueChange={(width) => { const widthMm = storedLength(width); if (widthMm !== project.widthMm) void updateFabrication({ widthMm, ...(project.cropShape === "circle" ? { heightMm: widthMm } : {}) }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
            <Field label="Height" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Height" value={shownLength(project.heightMm)} min={project.units === "imperial" ? 0.001 : 0.01} step={project.units === "imperial" ? 0.01 : 1} disabled={project.cropShape === "circle"} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ heightMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(height) => { const heightMm = storedLength(height); if (heightMm !== project.heightMm) void updateFabrication({ heightMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
          </div>
        </Section>

        <Section class="config-section">
          <div class="section-kicker"><span>03</span> Terrain layers</div>
          <div class="range-field">
            <span class="range-field__label"><b>Vertical exaggeration</b></span>
            <div class="range-field__row">
              <input type="range" aria-label="Vertical exaggeration slider" min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step="0.5" value={project.verticalExaggeration} oninput={(event) => void updateFabrication({ verticalExaggeration: Number(event.currentTarget.value) })} />
              <span class="number-input number-input--compact"><NumberField label="Vertical exaggeration" value={project.verticalExaggeration} min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step={0.5} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ verticalExaggeration: event.currentTarget.valueAsNumber })} onValueChange={(value) => value !== project.verticalExaggeration && void updateFabrication({ verticalExaggeration: value })} /><em>×</em></span>
            </div>
            <small><span>{MIN_VERTICAL_EXAGGERATION}×</span><span>{MAX_VERTICAL_EXAGGERATION}×</span></small>
          </div>
          <div class="field-stack">
            <Field label="Material thickness" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Material" value={shownLength(project.materialThicknessMm)} min={shownLength(0.5)} max={shownLength(25)} step={project.units === "imperial" ? 0.01 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ materialThicknessMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const materialThicknessMm = storedLength(value); if (materialThicknessMm !== project.materialThicknessMm) void updateFabrication({ materialThicknessMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
          </div>
          <div class="relief-summary">
            <Mountain size={20} />
            <span>
              <strong>{Math.round(displayElevation(geometry.maxElevationM - geometry.minElevationM, project.units)).toLocaleString()} {shownElevationUnit} relief → {stackPlan.layerCount} layers, {shownLength(stackPlan.stackHeightMm)} {shownLengthUnit} tall</strong>
              <small>{stackPlan.verticalExaggeration.toFixed(1)}× applied{stackPlan.horizontalScale > 0 ? ` · scale 1:${Math.round(1 / stackPlan.horizontalScale).toLocaleString()}` : ""} · ≈ {Math.round(displayElevation(stackPlan.metersPerLayer, project.units)).toLocaleString()} {shownElevationUnit} per layer</small>
            </span>
          </div>
        </Section>

        <Section class="config-section">
          <div class="section-kicker"><span>04</span> Map details</div>

          <div class="detail-group">
            <p class="subgroup-heading">Terrain features</p>
            <div class="toggle-stack">
              <Switch checked={project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label="Roads"><span class="toggle-label"><Minus size={16} />Roads</span></Switch>
              <Switch checked={project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label="Trails"><span class="toggle-label"><Minus size={16} />Trails</span></Switch>
              <Switch checked={project.showTransportationLabels} onCheckedChange={(showTransportationLabels) => void updateMapDetails({ showTransportationLabels })} aria-label="Transportation labels"><span class="toggle-label"><Minus size={16} />Transportation labels</span></Switch>
              <Switch checked={project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label="Water outlines"><span class="toggle-label"><Waves size={16} />Water outlines</span></Switch>
              <div class="toggle-control">
                <Switch checked={project.showWaterDepth} onCheckedChange={(showWaterDepth) => void updateMapDetails({ showWaterDepth })} aria-label="Water depth"><span class="toggle-label"><Waves size={16} />Water depth</span></Switch>
                {#if project.showWaterDepth}
                  <div class="toggle-settings">
                    <div class="range-field">
                      <span class="range-field__label"><b>Depth exaggeration</b></span>
                      <div class="range-field__row">
                        <input type="range" aria-label="Water depth exaggeration slider" min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step="0.25" value={project.waterDepthExaggeration} oninput={(event) => void updateFabrication({ waterDepthExaggeration: Number(event.currentTarget.value) })} />
                        <span class="number-input number-input--compact"><NumberField label="Water depth exaggeration" value={project.waterDepthExaggeration} min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step={0.25} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ waterDepthExaggeration: event.currentTarget.valueAsNumber })} onValueChange={(value) => value !== project.waterDepthExaggeration && void updateFabrication({ waterDepthExaggeration: value })} /><em>×</em></span>
                      </div>
                      <small><span>{MIN_WATER_DEPTH_EXAGGERATION}×</span><span>{MAX_WATER_DEPTH_EXAGGERATION}× terrain</span></small>
                    </div>
                    <small class="depth-note">Relative to the terrain's vertical scale, which water already follows. 1× keeps lakes and sea floor on the same scale as the hills.</small>
                  </div>
                {/if}
                {#if project.showWaterDepth && modeledLakes.length}
                  <div class="toggle-settings">
                    <div class="subgroup-heading subgroup-heading--action">
                      <p>Maximum depth</p>
                      {#if hasDepthOverride}<button type="button" onclick={() => void updateFabrication({ waterDepthOverrides: {} })}>Reset</button>{/if}
                    </div>
                    <div class="field-stack">
                      {#each modeledLakes as lake (lake.id)}
                        <Field label={lake.name} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`${lake.name} maximum depth`} value={shownDepth(lake.maxDepthM)} min={1} max={Math.round(displayElevation(12000, project.units))} onValueChange={(depth) => void setLakeDepth(lake.hylakId, depth)} /><em>{shownElevationUnit}</em></span>{/snippet}</Field>
                      {/each}
                    </div>
                    <small class="depth-note">Modeled from GLOBathy and HydroLAKES, which prefer surveyed depths where they exist.</small>
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <div class="detail-group">
            <p class="subgroup-heading">Annotations</p>
            <div class="toggle-stack">
              <div class="toggle-control">
                <Switch checked={project.showElevationLabels} onCheckedChange={(showElevationLabels) => void updateMapDetails({ showElevationLabels })} aria-label="Elevation labels"><span class="toggle-label"><Mountain size={16} />Elevation labels</span></Switch>
                {#if project.showElevationLabels}
                  <div class="toggle-settings">
                    <p class="subgroup-heading">Preferred position</p>
                    <div class="field-stack">
                      <Field label="Label X" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Label X" value={Math.round(project.elevationLabelPosition.x * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...project.elevationLabelPosition, x: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(x) => x !== Math.round(project.elevationLabelPosition.x * 100) && void updateFabrication({ elevationLabelPosition: { ...project.elevationLabelPosition, x: x / 100 } })} /><em>%</em></span>{/snippet}</Field>
                      <Field label="Label Y" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Label Y" value={Math.round(project.elevationLabelPosition.y * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...project.elevationLabelPosition, y: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(y) => y !== Math.round(project.elevationLabelPosition.y * 100) && void updateFabrication({ elevationLabelPosition: { ...project.elevationLabelPosition, y: y / 100 } })} /><em>%</em></span>{/snippet}</Field>
                    </div>
                  </div>
                {/if}
              </div>

              <div class="toggle-control">
                <Switch checked={project.showNorthArrow} onCheckedChange={(showNorthArrow) => void updateMapDetails({ showNorthArrow })} aria-label="North arrow"><span class="toggle-label"><Compass size={16} />North arrow</span></Switch>
                {#if project.showNorthArrow}
                  <div class="toggle-settings">
                    <p class="subgroup-heading">Compass design</p>
                    <div class="swatch-options" role="radiogroup" aria-label="North arrow design">
                      {#each NORTH_ARROW_OPTIONS as option}
                        <button type="button" role="radio" aria-checked={project.northArrowStyle === option.value} data-state={project.northArrowStyle === option.value ? "on" : "off"} tabindex={project.northArrowStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ northArrowStyle: option.value })} onkeydown={navigateChoice}>
                          <svg viewBox="-52 -52 104 104" aria-hidden="true">{#each option.markings as marking}<path d={previewMarkingPath(marking)} />{/each}</svg>
                          <span>{option.label}</span>
                        </button>
                      {/each}
                    </div>
                    <div class="range-field">
                      <span class="range-field__label"><b>Diameter</b></span>
                      <div class="range-field__row">
                        <input aria-label="North arrow size slider" type="range" min={displayLength(NORTH_ARROW_MIN_SIZE_MM, project.units)} max={displayLength(northArrowMaximumMm, project.units)} step={project.units === "imperial" ? 0.01 : 1} value={displayLength(project.northArrowSizeMm, project.units)} oninput={(event) => void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} />
                        <span class="number-input number-input--compact"><NumberField label="North arrow size" value={shownTextSize(project.northArrowSizeMm)} min={displayLength(NORTH_ARROW_MIN_SIZE_MM, project.units)} max={displayLength(northArrowMaximumMm, project.units)} step={project.units === "imperial" ? 0.01 : 1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== project.northArrowSizeMm) void updateFabrication({ northArrowSizeMm: sizeMm }); }} /><em>{shownLengthUnit}</em></span>
                      </div>
                      <small><span>{shownTextSize(NORTH_ARROW_MIN_SIZE_MM)} {shownLengthUnit}</span><span>{shownTextSize(northArrowMaximumMm)} {shownLengthUnit}</span></small>
                    </div>
                    <div class="subgroup-heading subgroup-heading--action">
                      <p>Placement</p>
                      <button type="button" onclick={() => void updateFabrication({ northArrowPlacement: { ...project.northArrowPlacement, offset: { x: 0, y: 0 } } })}>Reset offset</button>
                    </div>
                    <div class="north-arrow-anchor-grid" role="radiogroup" aria-label="North arrow anchor">
                      {#each NORTH_ARROW_ANCHOR_OPTIONS as option}
                        <button type="button" role="radio" aria-label={option.label} title={option.label} aria-checked={project.northArrowPlacement.anchor === option.value} data-state={project.northArrowPlacement.anchor === option.value ? "on" : "off"} tabindex={project.northArrowPlacement.anchor === option.value ? 0 : -1} onclick={() => void updateFabrication({ northArrowPlacement: { anchor: option.value, offset: { x: 0, y: 0 } } })} onkeydown={navigateChoice}><span></span></button>
                      {/each}
                    </div>
                    <div class="field-stack">
                      <Field label="Offset X" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="North arrow offset X" value={Math.round(project.northArrowPlacement.offset.x * 100)} min={-100} max={100} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ northArrowPlacement: { ...project.northArrowPlacement, offset: { ...project.northArrowPlacement.offset, x: event.currentTarget.valueAsNumber / 100 } } })} onValueChange={(x) => x !== Math.round(project.northArrowPlacement.offset.x * 100) && void updateFabrication({ northArrowPlacement: { ...project.northArrowPlacement, offset: { ...project.northArrowPlacement.offset, x: x / 100 } } })} /><em>%</em></span>{/snippet}</Field>
                      <Field label="Offset Y" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="North arrow offset Y" value={Math.round(project.northArrowPlacement.offset.y * 100)} min={-100} max={100} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ northArrowPlacement: { ...project.northArrowPlacement, offset: { ...project.northArrowPlacement.offset, y: event.currentTarget.valueAsNumber / 100 } } })} onValueChange={(y) => y !== Math.round(project.northArrowPlacement.offset.y * 100) && void updateFabrication({ northArrowPlacement: { ...project.northArrowPlacement, offset: { ...project.northArrowPlacement.offset, y: y / 100 } } })} /><em>%</em></span>{/snippet}</Field>
                    </div>
                  </div>
                {/if}
              </div>

              <Switch checked={project.showScaleBar} onCheckedChange={(showScaleBar) => void updateMapDetails({ showScaleBar })} aria-label="Scale bar"><span class="toggle-label"><Minus size={16} />Scale bar</span></Switch>
            </div>
          </div>

          <div class="detail-group">
            <p class="subgroup-heading">Assembly</p>
            <div class="toggle-stack">
              <Switch checked={project.showAlignmentGuides} onCheckedChange={(showAlignmentGuides) => void updateMapDetails({ showAlignmentGuides })} aria-label="Assembly guides"><span class="toggle-label"><Layers3 size={16} />Assembly guides</span></Switch>
            </div>
          </div>

          <div class="detail-group">
            <p class="subgroup-heading">Text engraving</p>
            <div class="swatch-options" role="radiogroup" aria-label="Engraving font">
              {#each FONT_OPTIONS as option}
                <button type="button" role="radio" aria-checked={project.textStyle.font === option.value} data-state={project.textStyle.font === option.value ? "on" : "off"} tabindex={project.textStyle.font === option.value ? 0 : -1} onclick={() => void updateFabrication({ textStyle: { ...project.textStyle, font: option.value } })} onkeydown={navigateChoice}>
                  <svg viewBox="0 -0.4 17 4.2" aria-hidden="true"><path stroke-linecap={option.value === "rounded" ? "round" : "butt"} stroke-linejoin={option.value === "rounded" ? "round" : "miter"} d={labelPathData("123m", { x: 0, y: 0 }, 0, 0, 0, { font: option.value, sizeMm: 3.1 })} /></svg>
                  <span>{option.label}</span>
                </button>
              {/each}
            </div>
            <div class="range-field">
              <span class="range-field__label"><b>Text size</b></span>
              <div class="range-field__row">
                <input aria-label="Text size slider" type="range" min={displayLength(2, project.units)} max={displayLength(10, project.units)} step={project.units === "imperial" ? 0.005 : 0.1} value={displayLength(project.textStyle.sizeMm, project.units)} oninput={(event) => void updateFabrication({ textStyle: { ...project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} />
                <span class="number-input number-input--compact"><NumberField label="Text size" value={shownTextSize(project.textStyle.sizeMm)} min={displayLength(2, project.units)} max={displayLength(10, project.units)} step={project.units === "imperial" ? 0.005 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ textStyle: { ...project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== project.textStyle.sizeMm) void updateFabrication({ textStyle: { ...project.textStyle, sizeMm } }); }} /><em>{shownLengthUnit}</em></span>
              </div>
              <small><span>{shownTextSize(2)} {shownLengthUnit}</span><span>{shownTextSize(10)} {shownLengthUnit}</span></small>
            </div>
          </div>
        </Section>

        <Section class="config-section advanced-section">
          <button type="button" class="section-kicker section-kicker--trigger" aria-expanded={advancedOpen} onclick={() => advancedOpen = !advancedOpen}>
            <span>05</span> Fabrication settings
            <ChevronDown size={14} class={advancedOpen ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          {#if advancedOpen}
            <div class="advanced-fields">
              <div class="toggle-stack">
                <Switch checked={project.optimizeMaterialUse} onCheckedChange={(optimizeMaterialUse) => void updateFabrication({ optimizeMaterialUse })} aria-label="Material-saving nests"><span class="toggle-label"><Layers3 size={16} />Material-saving nests</span></Switch>
                <Switch checked={project.smoothing === 1} onCheckedChange={(smooth) => void updateFabrication({ smoothing: smooth ? 1 : 0 })} aria-label="Smooth contours"><span class="toggle-label"><Waves size={16} />Smooth contours</span></Switch>
              </div>
              <div class="field-stack">
                {#if project.optimizeMaterialUse}<Field label="Glue margin" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Glue margin" value={shownLength(project.glueMarginMm)} min={shownLength(2)} max={shownLength(25)} step={project.units === "imperial" ? 0.01 : 0.5} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ glueMarginMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const glueMarginMm = storedLength(value); if (glueMarginMm !== project.glueMarginMm) void updateFabrication({ glueMarginMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>{/if}
                <Field label="Laser kerf" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Laser kerf" value={shownLength(project.laserKerfMm)} min={0} max={shownLength(1)} step={project.units === "imperial" ? 0.001 : 0.01} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ laserKerfMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const laserKerfMm = storedLength(value); if (laserKerfMm !== project.laserKerfMm) void updateFabrication({ laserKerfMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Minimum feature" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Minimum feature" value={shownLength(project.minimumFeatureMm)} min={shownLength(0.2)} max={shownLength(5)} step={project.units === "imperial" ? 0.01 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ minimumFeatureMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const minimumFeatureMm = storedLength(value); if (minimumFeatureMm !== project.minimumFeatureMm) void updateFabrication({ minimumFeatureMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
              </div>
            </div>
          {/if}
        </Section>
      </div>
      <div class="generate-dock">
        <div class={`status-line status-${generationState}`} role="status" aria-live="polite"><span></span>{!detailsUpdating && !exportReady && geometry.sourceKind === "real" ? "Settings changed · regenerate before export" : status}</div>
        <Button variant="primary" class="generate-button" onclick={() => generationState === "loading" ? cancelGeneration() : void generate()}>{#if generationState === "loading"}<X size={18} /> Cancel generation{:else}<Sparkles size={18} /> {geometry.sourceKind === "real" ? "Regenerate terrain" : "Generate terrain"}{/if}</Button>
      </div>
    </Sidebar>
    {/snippet}

    <section class="preview-panel">
      <div class="preview-toolbar"><div class="ldt-toggle-group mode-switch" role="radiogroup" aria-label="Preview mode">{#each MODE_OPTIONS as option}<button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={mode === option.value} data-state={mode === option.value ? "on" : "off"} tabindex={mode === option.value ? 0 : -1} onclick={() => { if (option.value === "2d" && selectedLayer === 0) selectedLayer = featuredLayerIndex(geometry); mode = option.value as PreviewMode; }} onkeydown={navigateChoice}>{#if option.value === "map"}<MapIcon size={15} />{:else if option.value === "2d"}<Layers3 size={15} />{:else}<Box size={15} />{/if}{option.label}</button>{/each}</div><div class="preview-readout"><span>{shownLength(project.widthMm)} × {shownLength(project.heightMm)} {shownLengthUnit}</span><span>{Math.round(displayElevation(geometry.minElevationM, project.units)).toLocaleString()}–{Math.round(displayElevation(geometry.maxElevationM, project.units)).toLocaleString()} {shownElevationUnit}</span></div></div>
      <div class="preview-stage" data-road-markings={detailCounts.road} data-trail-markings={detailCounts.trail} data-transportation-label-markings={detailCounts.transportationLabel} data-water-markings={detailCounts.water} data-contour-markings={detailCounts.contour} data-alignment-markings={detailCounts.alignment} data-elevation-markings={detailCounts.elevation} data-north-markings={detailCounts.north} data-scale-markings={detailCounts.scale}>{#if mode === "map"}{#if MapCanvas}<MapCanvas {project} onLocationChange={(lat: number, lon: number, zoom: number, bounds: GeoBounds) => updateLocation({ lat, lon, zoom, bounds, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` })} />{:else}<div class="preview-loading">Loading map…</div>{/if}{:else if mode === "2d"}<TwoDPreview {geometry} {selectedLayer} />{:else if ThreePreview}<ThreePreview {geometry} exploded={project.explodedPreview} />{:else}<div class="preview-loading">Loading 3D preview…</div>{/if}{#if mode !== "map"}<div class="preview-attribution">Map data © <a href={OSM_ATTRIBUTION.url} target="_blank" rel="noreferrer">{OSM_ATTRIBUTION.name}</a></div>{/if}{#if generationState === "loading"}<div class="generation-overlay"><div class="contour-loader"><span></span><span></span><span></span></div><strong>Building your terrain</strong><small>{status}</small></div>{/if}{#if visibleWarnings.length}<div class="warning-stack">{#each visibleWarnings as warning (`${warning.code}-${warning.message}`)}<div><span>!</span>{warning.message}</div>{/each}</div>{/if}</div>
      <div class="layer-dock"><div class="layer-heading"><span><Layers3 size={16} /><b>Layer {selectedLayer + 1}</b> of {geometry.layers.length}</span><strong>{layerTicks[selectedLayer]?.toLocaleString()} {shownElevationUnit}</strong></div><input class="layer-range" type="range" min="0" max={Math.max(0, geometry.layers.length - 1)} value={selectedLayer} oninput={(event) => { selectedLayer = Number(event.currentTarget.value); if (mode === "3d") mode = "2d"; }} /><div class="layer-scale"><span>{layerTicks[0]?.toLocaleString()} {shownElevationUnit}</span><span>{layerTicks[Math.floor(layerTicks.length / 2)]?.toLocaleString()} {shownElevationUnit}</span><span>{layerTicks.at(-1)?.toLocaleString()} {shownElevationUnit}</span></div>{#if mode === "3d"}<label class="explode-control"><span>Stack</span><input type="range" min="0" max="1" step="0.05" value={project.explodedPreview} oninput={(event) => updateProject({ explodedPreview: Number(event.currentTarget.value) })} /><span>Exploded</span></label>{/if}</div>
    </section>
  </Workspace>
  {#if searchOpen}<LocationDialog {project} presets={PRESETS} onChoose={choosePlace} onCoordinates={(lat, lon) => updateLocation({ lat, lon, label: "Custom coordinates" })} onClose={() => searchOpen = false} />{/if}
</AppShell>

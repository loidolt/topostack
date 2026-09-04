<script lang="ts">
  import { onMount } from "svelte";
  import { Box, ChevronDown, Circle, Compass, Download, Grid3X3, Layers3, Map as MapIcon, MapPin, Minus, Mountain, PenTool, Plus, Route, Search, Sparkles, Square, Trash2, Undo2, Redo2, Upload, Waves, X } from "@lucide/svelte";
  import { AppShell, Brand, Button, ContextBar, Field, IconButton, Input, NumberField, Section, Sidebar, Switch, ThemeToggle, Topbar, Workspace } from "@loidolt/theme-svelte";
  import { buildProjectPackage, createSyntheticSource, DEFAULT_PROJECT, displayElevation, displayLength, elevationUnit, generateGeometry, labelPathData, lengthUnit, markerSymbolPaths, MAX_VERTICAL_EXAGGERATION, MAX_WATER_DEPTH_EXAGGERATION, millimetersFromDisplay, MIN_VERTICAL_EXAGGERATION, MIN_WATER_DEPTH_EXAGGERATION, NORTH_ARROW_MAX_MAP_FRACTION, NORTH_ARROW_MAX_SIZE_MM, NORTH_ARROW_MIN_SIZE_MM, northArrowMarkings, planTerrainStack, validateProject, type CustomLineFeatureV1, type CustomLineKind, type GeoBounds, type GeoPoint, type GeometryIRV1, type LineStyleV1, type MapMarkerV1, type MarkerSymbol, type NorthArrowAnchor, type NorthArrowStyle, type OperationPath, type Point2D, type ProjectConfigV1, type RoadCap, type RoadStyle, type SourceBundleV1, type TextFont, type TrailPattern, type WaterFillPattern } from "@topostack/core";
  import { boundsForProject, combineWaterAreas, loadLakeAreas, loadTerrain, loadVectorMarkings, type PlaceResult } from "../data-provider";
  import { theme } from "../lib/theme";
  import { MAP_DATA_ATTRIBUTION } from "../map-attribution";
  import { createSamplePreviewSource } from "../sample-preview";
  import { exportBlockReason } from "../export-policy";
  import { loadProject, parseProject, saveProject } from "../storage";
  import { connectAtomm, type ExportUpdate } from "./atomm-bridge";
  import { prepareProjectDownload, startBrowserDownload } from "./native-export";
  import LocationDialog from "./LocationDialog.svelte";
  import EngravingPreview from "./EngravingPreview.svelte";
  import TwoDPreview from "./TwoDPreview.svelte";

  type PreviewMode = "map" | "engraving" | "2d" | "3d";
  type GenerateState = "idle" | "loading" | "ready" | "error";
  type ExportPhase = "idle" | "preparing" | "ready" | "error";
  type ConfigSectionId = "setup" | "size" | "terrain" | "details" | "customData" | "linework" | "advanced";
  const CONFIG_SECTION_IDS: ConfigSectionId[] = ["setup", "size", "terrain", "details", "customData", "linework", "advanced"];
  const MENU_STATE_KEY = "topostack-menu-sections-v1";
  const OSM_ATTRIBUTION = MAP_DATA_ATTRIBUTION.find((entry) => entry.name === "OpenStreetMap contributors") ?? { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };
  const PRESETS: PlaceResult[] = [
    { id: "crater-lake", label: "Crater Lake, Oregon, USA", lat: 42.9446, lon: -122.109 },
    { id: "grand-teton", label: "Grand Teton and Jenny Lake, Wyoming, USA", lat: 43.76, lon: -110.73 },
    { id: "rainier", label: "Mount Rainier, Washington, USA", lat: 46.8523, lon: -121.7603 },
    { id: "grand-canyon", label: "Grand Canyon, Arizona, USA", lat: 36.1069, lon: -112.1129 },
  ];
  const UNIT_OPTIONS = [{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }];
  const SHAPE_OPTIONS = [{ value: "rectangle", label: "Rectangle" }, { value: "circle", label: "Circle" }];
  const STACK_MODE_OPTIONS = [{ value: "map", label: "Map" }, { value: "2d", label: "Cut layers" }, { value: "3d", label: "3D stack" }];
  const ENGRAVING_MODE_OPTIONS = [{ value: "map", label: "Map" }, { value: "engraving", label: "Engraving" }];
  const FONT_OPTIONS: Array<{ value: TextFont; label: string }> = [{ value: "technical", label: "Technical" }, { value: "rounded", label: "Rounded" }, { value: "stencil", label: "Stencil" }];
  const LINE_PRESETS: Array<{ value: string; label: string; description: string; style: LineStyleV1 }> = [
    { value: "fine", label: "Fine", description: "Dense detail", style: { contourMm: 0.1, indexContourMm: 0.22, majorRoadMm: 0.3, localRoadMm: 0.18, trailMm: 0.14, waterMm: 0.22, boundaryMm: 0.16, coordinateGridMm: 0.1, annotationMm: 0.14, borderMm: 0.26, trailPattern: "dotted", roadStyle: "centerline", majorRoadSpacingMm: 0.65, roadCap: "round" } },
    { value: "balanced", label: "Balanced", description: "Clear hierarchy", style: { ...DEFAULT_PROJECT.lineStyle } },
    { value: "bold", label: "Bold", description: "Strong contrast", style: { contourMm: 0.24, indexContourMm: 0.48, majorRoadMm: 0.56, localRoadMm: 0.36, trailMm: 0.3, waterMm: 0.44, boundaryMm: 0.34, coordinateGridMm: 0.24, annotationMm: 0.28, borderMm: 0.52, trailPattern: "dashed", roadStyle: "centerline", majorRoadSpacingMm: 1, roadCap: "round" } },
  ];
  const WATER_FILL_PATTERNS: Array<{ value: WaterFillPattern; label: string }> = [{ value: "none", label: "None" }, { value: "lines", label: "Lines" }, { value: "ripples", label: "Ripples" }, { value: "dots", label: "Dots" }];
  const TRAIL_PATTERNS: Array<{ value: TrailPattern; label: string }> = [{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }];
  const ROAD_STYLES: Array<{ value: RoadStyle; label: string }> = [{ value: "centerline", label: "Centerline" }, { value: "outlined", label: "Outlined" }];
  const ROAD_CAPS: Array<{ value: RoadCap; label: string }> = [{ value: "round", label: "Round" }, { value: "square", label: "Square" }];
  const NORTH_ARROW_CHOICES: Array<{ value: NorthArrowStyle; label: string }> = [
    { value: "minimal", label: "Minimal" }, { value: "classic", label: "Classic" }, { value: "mariner", label: "Mariner" },
  ];
  const NORTH_ARROW_OPTIONS: Array<{ value: NorthArrowStyle; label: string; markings: OperationPath[] }> = NORTH_ARROW_CHOICES.map((option) => ({ ...option, markings: northArrowMarkings({ ...DEFAULT_PROJECT, northArrowStyle: option.value, northArrowSizeMm: 100, northArrowPlacement: { anchor: "center", offset: { x: 0, y: 0 } } }) }));
  const NORTH_ARROW_ANCHOR_OPTIONS: Array<{ value: NorthArrowAnchor; label: string }> = [
    { value: "top-left", label: "Top left" }, { value: "top", label: "Top" }, { value: "top-right", label: "Top right" },
    { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
    { value: "bottom-left", label: "Bottom left" }, { value: "bottom", label: "Bottom" }, { value: "bottom-right", label: "Bottom right" },
  ];
  const MARKER_OPTIONS: Array<{ value: MarkerSymbol; label: string; paths: Point2D[][] }> = [
    { value: "pin", label: "Pin", paths: markerSymbolPaths("pin", { x: 0, y: 0 }, 20) },
    { value: "circle", label: "Circle", paths: markerSymbolPaths("circle", { x: 0, y: 0 }, 20) },
    { value: "triangle", label: "Triangle", paths: markerSymbolPaths("triangle", { x: 0, y: 0 }, 20) },
    { value: "star", label: "Star", paths: markerSymbolPaths("star", { x: 0, y: 0 }, 20) },
    { value: "cross", label: "Cross", paths: markerSymbolPaths("cross", { x: 0, y: 0 }, 20) },
  ];
  const CUSTOM_LINE_OPTIONS: Array<{ value: CustomLineKind; label: string }> = [
    { value: "trail", label: "Trail" },
    { value: "boundary", label: "Boundary" },
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
      const score = layer.markings.reduce((total, marking) => total + (marking.kind === "road" || marking.kind === "trail" || marking.kind === "water" || marking.kind === "boundary" || marking.kind === "grid" ? 3 : marking.id.startsWith("north-") || marking.id.startsWith("scale-") ? 0 : 1), 0);
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
      patch.showBoundaries ? (id: string, kind: string) => kind === "boundary" :
      patch.showCoordinateGrid ? (id: string, kind: string) => kind === "grid" :
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
  let lineworkOpen = $state(false);
  let menuStateReady = $state(false);
  let openSections = $state<Record<ConfigSectionId, boolean>>({
    setup: true,
    size: false,
    terrain: false,
    details: false,
    customData: false,
    linework: false,
    advanced: false,
  });
  let atommReady = $state(false);
  let embeddedInPlatform = $state(false);
  let exportPhase = $state<ExportPhase>("idle");
  let exportTitle = $state("");
  let exportDetail = $state("");
  let exportNoticeTimeout: number | undefined;
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
    const outputMode = project.outputMode;
    if (outputMode === "engraving" && mode !== "map" && mode !== "engraving") mode = "engraving";
    else if (outputMode === "stack" && mode === "engraving") mode = "3d";
  });

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
  const previewModeOptions = $derived(project.outputMode === "engraving" ? ENGRAVING_MODE_OPTIONS : STACK_MODE_OPTIONS);
  const previewBusy = $derived(generationState === "loading" || detailsUpdating);
  const previewBusyLabel = $derived(generationState === "loading" ? "Building your terrain" : "Refreshing preview");
  const contourInterval = $derived(geometry.landReliefM / (project.engravingContourCount + 1));
  const fabricationPanelCount = $derived(geometry.layers.length - geometry.fabricationNests.length);
  const terrainDataStale = $derived(!sameMapArea(sourceProject, project));
  const verticalExaggerationStale = $derived(project.outputMode === "stack" && sourceProject.verticalExaggeration !== project.verticalExaggeration);
  const terrainDataAction = $derived(geometry.sourceKind === "real" ? "regenerate" : "generate");
  const exportReady = $derived(!exportBlockReason(geometry, project));
  const platformExportAvailable = $derived(atommReady && embeddedInPlatform);
  const expectedExportFileCount = $derived(project.outputMode === "engraving" ? 4 : fabricationPanelCount * 2 + 5);
  const visibleWarnings = $derived(geometry.warnings.slice(0, 2));
  const layerTicks = $derived(geometry.layers.map((layer) => Math.round(displayElevation(layer.elevationM, project.units))));
  const shownLengthUnit = $derived(lengthUnit(project.units));
  const shownElevationUnit = $derived(elevationUnit(project.units));
  const northArrowMaximumMm = $derived(Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(project.widthMm, project.heightMm) * NORTH_ARROW_MAX_MAP_FRACTION)));
  const activeLinePreset = $derived(LINE_PRESETS.find((preset) => JSON.stringify(preset.style) === JSON.stringify(project.lineStyle))?.value);
  const activeDetailCount = $derived([
    project.showRoads,
    project.showTrails,
    project.showTransportationLabels,
    project.showWater,
    project.showBoundaries,
    project.showCoordinateGrid,
    project.showElevationLabels,
    project.showNorthArrow,
    project.showScaleBar,
    project.outputMode === "stack" && project.showWaterDepth,
    project.outputMode === "stack" && project.showAlignmentGuides,
    project.outputMode === "engraving" && project.showEngravingBorder,
  ].filter(Boolean).length);
  const detailCounts = $derived.by(() => {
    const counts = { road: 0, trail: 0, transportationLabel: 0, water: 0, contour: project.outputMode === "engraving" ? Math.max(0, geometry.layers.length - 1) : 0, alignment: 0, elevation: 0, north: 0, scale: 0, marker: 0, customLine: 0 };
    for (const layer of geometry.layers) {
      for (const marking of layer.markings) {
        if (marking.kind === "road") counts.road += 1;
        else if (marking.kind === "trail") counts.trail += 1;
        else if (marking.kind === "water") counts.water += 1;
        else if (marking.kind === "contour") counts.contour += 1;
        if (marking.id.startsWith("custom-data-line-")) counts.customLine += 1;
        else if (marking.id.startsWith("alignment-")) counts.alignment += 1;
        else if (marking.id.startsWith("transport-label-")) counts.transportationLabel += 1;
        else if (marking.id.startsWith("elevation-")) counts.elevation += 1;
        else if (marking.id.startsWith("north-")) counts.north += 1;
        else if (marking.id.startsWith("scale-")) counts.scale += 1;
        else if (marking.id.startsWith("map-marker-")) counts.marker += 1;
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

  function shownLineWidth(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(project.units === "imperial" ? 4 : 2));
  }

  type LineWidthKey = Exclude<keyof LineStyleV1, "trailPattern" | "roadStyle" | "roadCap">;
  function setLineWidth(key: LineWidthKey, shown: number): Promise<void> | undefined {
    if (!Number.isFinite(shown)) return undefined;
    return updateFabrication({ lineStyle: { ...project.lineStyle, [key]: storedLength(shown) } });
  }

  function addMarker(): void {
    const marker: MapMarkerV1 = {
      id: crypto.randomUUID(),
      lat: project.location.lat,
      lon: project.location.lon,
      symbol: "pin",
    };
    void updateFabrication({ markers: [...project.markers, marker] });
  }

  function updateMarker(id: string, patch: Partial<MapMarkerV1>): void {
    const current = project.markers.find((marker) => marker.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    if (!Number.isFinite(next.lat) || next.lat < -85.0511 || next.lat > 85.0511 || !Number.isFinite(next.lon) || next.lon < -180 || next.lon > 180) return;
    void updateFabrication({ markers: project.markers.map((marker) => marker.id === id ? next : marker) });
  }

  function removeMarker(id: string): void {
    void updateFabrication({ markers: project.markers.filter((marker) => marker.id !== id) });
  }

  function addCustomLine(): void {
    const longitudeDelta = project.location.lon > 179.998 ? -0.002 : 0.002;
    const line: CustomLineFeatureV1 = {
      id: crypto.randomUUID(),
      kind: "trail",
      points: [
        { lat: project.location.lat, lon: project.location.lon },
        { lat: project.location.lat, lon: Math.max(-180, Math.min(180, project.location.lon + longitudeDelta)) },
      ],
    };
    void updateFabrication({ customLines: [...project.customLines, line] });
  }

  function updateCustomLine(id: string, patch: Partial<CustomLineFeatureV1>): void {
    void updateFabrication({ customLines: project.customLines.map((line) => line.id === id ? { ...line, ...patch } : line) });
  }

  function updateCustomLinePoint(id: string, pointIndex: number, patch: Partial<GeoPoint>): void {
    const line = project.customLines.find((item) => item.id === id);
    const current = line?.points[pointIndex];
    if (!line || !current) return;
    const next = { ...current, ...patch };
    if (!Number.isFinite(next.lat) || next.lat < -85.0511 || next.lat > 85.0511 || !Number.isFinite(next.lon) || next.lon < -180 || next.lon > 180) return;
    updateCustomLine(id, { points: line.points.map((point, index) => index === pointIndex ? next : point) });
  }

  function addCustomLinePoint(id: string): void {
    const line = project.customLines.find((item) => item.id === id);
    const last = line?.points.at(-1);
    if (!line || !last) return;
    updateCustomLine(id, { points: [...line.points, { ...last }] });
  }

  function removeCustomLinePoint(id: string, pointIndex: number): void {
    const line = project.customLines.find((item) => item.id === id);
    if (!line || line.points.length <= 2) return;
    updateCustomLine(id, { points: line.points.filter((_, index) => index !== pointIndex) });
  }

  function removeCustomLine(id: string): void {
    void updateFabrication({ customLines: project.customLines.filter((line) => line.id !== id) });
  }

  function trailPatternDash(style: LineStyleV1): string | undefined {
    if (style.trailPattern === "solid") return undefined;
    return style.trailPattern === "dotted" ? "0.1 3.2" : "6 4";
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

  function toggleSection(section: ConfigSectionId): void {
    openSections = { ...openSections, [section]: !openSections[section] };
  }

  function setAllSections(open: boolean): void {
    openSections = Object.fromEntries(CONFIG_SECTION_IDS.map((section) => [section, open])) as Record<ConfigSectionId, boolean>;
  }

  function sectionSummary(section: ConfigSectionId): string {
    switch (section) {
      case "setup": return `${project.outputMode === "engraving" ? "Flat engraving" : "Layered relief"} · ${project.location.label.split(",")[0]}`;
      case "size": return `${project.cropShape === "circle" ? "Circle" : "Rectangle"} · ${shownLength(project.widthMm)} × ${shownLength(project.heightMm)} ${shownLengthUnit}`;
      case "terrain": return project.outputMode === "engraving" ? `${project.engravingContourCount} contours · index every ${project.engravingIndexInterval}` : `${stackPlan.layerCount} layers · ${shownLength(project.materialThicknessMm)} ${shownLengthUnit} material`;
      case "details": return `${activeDetailCount} ${activeDetailCount === 1 ? "detail" : "details"} enabled`;
      case "customData": return `${project.markers.length} ${project.markers.length === 1 ? "marker" : "markers"} · ${project.customLines.length} ${project.customLines.length === 1 ? "path" : "paths"}`;
      case "linework": return activeLinePreset ? `${LINE_PRESETS.find((preset) => preset.value === activeLinePreset)?.label ?? activeLinePreset} preset` : "Custom stroke widths";
      case "advanced": return project.smoothing === 1 ? "Smooth contours" : "Standard contours";
    }
  }

  function handleExportUpdate(update: ExportUpdate): void {
    if (exportNoticeTimeout !== undefined) window.clearTimeout(exportNoticeTimeout);
    exportPhase = update.phase;
    if (update.phase === "preparing") {
      exportTitle = update.intent === "openInStudio" ? "Preparing Studio artwork" : "Building your download";
      exportDetail = update.intent === "openInStudio"
        ? "Creating one editable master SVG…"
        : `Packaging ${expectedExportFileCount} project files into one download…`;
      status = exportTitle;
      return;
    }
    if (update.phase === "ready") {
      exportTitle = update.intent === "openInStudio" ? "Artwork ready" : "Download ready";
      exportDetail = update.intent === "openInStudio"
        ? "The master SVG was handed to Atomm for Studio."
        : `${update.fileCount} ${update.fileCount === 1 ? "file" : "files"} prepared. Your browser should save them as one download.`;
      status = update.intent === "openInStudio"
        ? "Master SVG prepared for Studio"
        : `Download started · ${update.fileCount} ${update.fileCount === 1 ? "file" : "files"}`;
    } else {
      exportTitle = "Export failed";
      exportDetail = update.message;
      status = update.message;
    }
    exportNoticeTimeout = window.setTimeout(() => {
      exportPhase = "idle";
      exportNoticeTimeout = undefined;
    }, 8_000);
  }
  onMount(() => {
    let cancelled = false;
    try {
      const savedMenuState: unknown = JSON.parse(localStorage.getItem(MENU_STATE_KEY) ?? "null");
      if (savedMenuState && typeof savedMenuState === "object") {
        openSections = Object.fromEntries(CONFIG_SECTION_IDS.map((section) => [section, typeof (savedMenuState as Record<string, unknown>)[section] === "boolean" ? (savedMenuState as Record<string, boolean>)[section] : openSections[section]])) as Record<ConfigSectionId, boolean>;
      }
    } catch {
      // A malformed preference should never prevent the editor from loading.
    }
    menuStateReady = true;
    embeddedInPlatform = window.parent !== window;
    const disconnectAtomm = connectAtomm(() => ({ geometry, project }), () => atommReady = true, handleExportUpdate);
    void loadProject().then((saved) => {
      if (cancelled) return;
      if (saved) { const source = createSyntheticSource(saved); project = saved; sourceProject = saved; activeSource = source; geometry = previewFor(saved, source); selectedLayer = featuredLayerIndex(geometry); status = "Local project restored · generate to refresh terrain"; }
      booted = true;
    });
    return () => { cancelled = true; disconnectAtomm(); if (exportNoticeTimeout !== undefined) window.clearTimeout(exportNoticeTimeout); generationAbort?.abort(); detailAbort?.abort(); geometryWorker?.terminate(); geometryReject?.(new DOMException("Generator closed", "AbortError")); };
  });

  $effect(() => {
    const current = openSections;
    if (!menuStateReady) return;
    try { localStorage.setItem(MENU_STATE_KEY, JSON.stringify(current)); } catch { /* Preferences are optional. */ }
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
  function updateVerticalExaggeration(verticalExaggeration: number): void {
    if (!Number.isFinite(verticalExaggeration) || verticalExaggeration === project.verticalExaggeration) return;
    updateProject({ verticalExaggeration });
    status = "Vertical exaggeration changed · regenerate terrain";
  }

  function updateLocation(patch: Partial<ProjectConfigV1["location"]>): void {
    invalidatePendingPreview();
    pushHistory(["location"]);
    project = { ...project, location: { ...project.location, ...patch, ...(("lat" in patch || "lon" in patch || "zoom" in patch) && !("bounds" in patch) ? { bounds: undefined } : {}) } };
    status = "Map area changed · regenerate terrain data";
  }
  function choosePlace(place: PlaceResult): void {
    invalidatePendingPreview();
    pushHistoryEntry();
    project = { ...project, name: place.label.split(",")[0] ?? "Terrain project", location: { ...project.location, lat: place.lat, lon: place.lon, label: place.label, zoom: 11, bounds: undefined } };
    status = "Map area changed · regenerate terrain data";
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

  function projectForPreview(config: ProjectConfigV1): ProjectConfigV1 {
    return config.outputMode === "stack" && sourceProject.verticalExaggeration !== config.verticalExaggeration
      ? { ...config, verticalExaggeration: sourceProject.verticalExaggeration }
      : config;
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
      ...(source.waterPatternAreas ? { waterPatternAreas: source.waterPatternAreas.map((polygon) => ({ outer: scalePoints(polygon.outer), holes: polygon.holes.map(scalePoints) })) } : {}),
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
    const previewProject = projectForPreview(nextProject);
    const revision = operationRevision;
    if (!sameMapArea(sourceProject, nextProject)) {
      status = "Map details changed · generate to refresh this area";
      return;
    }
    const controller = new AbortController(); detailAbort = controller; detailsUpdating = true;
    status = "Updating map details…";
    try {
      let source = resizeSource(activeSource, sourceProject, previewProject);
      const usesWaterDepth = nextProject.outputMode === "stack" && nextProject.showWaterDepth;
      const needsVectors = nextProject.showRoads || nextProject.showTrails || nextProject.showWater || nextProject.showBoundaries || usesWaterDepth;
      if (needsVectors && source.sourceKind !== "synthetic" && source.vectorStatus !== "available") {
        try {
          const vector = await loadVectorMarkings(source.bounds, nextProject.location.zoom, nextProject, controller.signal);
          const lakes = usesWaterDepth
            ? await loadLakeAreas(source.bounds, nextProject.location.zoom, nextProject, controller.signal).catch(() => [])
            : [];
          source = { ...source, markings: vector.markings, waterAreas: combineWaterAreas(lakes, vector.ocean, nextProject.minimumFeatureMm), waterPatternAreas: [...vector.ocean, ...vector.inland], vectorStatus: "available" };
        } catch (error) {
          if (controller.signal.aborted) throw error;
          source = { ...source, markings: source.markings.filter((marking) => marking.kind !== "road" && marking.kind !== "trail" && marking.kind !== "water" && marking.kind !== "boundary"), waterPatternAreas: [], vectorStatus: "unavailable" };
        }
      } else if (nextProject.outputMode === "stack" && patch.showWaterDepth && !sourceProject.showWaterDepth && source.sourceKind === "real") {
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
      const next = await runGeometryWorker(previewProject, source);
      if (controller.signal.aborted || revision !== operationRevision) return;
      addPreviewWarning(next, source);
      geometry = next; activeSource = source; sourceProject = previewProject;
      if (generationState === "error") generationState = "ready";
      selectedLayer = layerForEnabledDetail(next, patch) ?? Math.min(selectedLayer, Math.max(0, next.layers.length - 1));
      status = source.vectorStatus === "unavailable" && needsVectors ? "Map details updated · source data unavailable" : source.sourceKind === "preview" ? "Real-data sample preview updated" : source.sourceKind === "real" ? "Map details updated" : "Sample preview updated · generate for real map data";
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
    const updatesCustomData = patch.markers !== undefined || patch.customLines !== undefined;
    const nextWidth = patch.widthMm ?? project.widthMm;
    const nextHeight = patch.heightMm ?? project.heightMm;
    const maximumNorthArrowSize = Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(nextWidth, nextHeight) * NORTH_ARROW_MAX_MAP_FRACTION));
    if ((patch.widthMm !== undefined || patch.heightMm !== undefined) && (patch.northArrowSizeMm ?? project.northArrowSizeMm) > maximumNorthArrowSize) {
      patch = { ...patch, northArrowSizeMm: maximumNorthArrowSize };
    }
    updateProject(patch);
    const nextProject = project;
    const previewProject = projectForPreview(nextProject);
    const revision = operationRevision;
    if (!sameMapArea(sourceProject, nextProject)) { status = `${nextProject.outputMode === "engraving" ? "Artwork" : "Cut"} size changed · generate to refresh terrain`; return; }
    const controller = new AbortController(); detailAbort = controller; detailsUpdating = true;
    status = updatesCustomData ? "Updating custom data…" : nextProject.outputMode === "engraving" ? "Updating engraving artwork…" : "Resizing cut geometry…";
    try {
      const source = resizeSource(activeSource, sourceProject, previewProject);
      const next = await runGeometryWorker(previewProject, source);
      if (controller.signal.aborted || revision !== operationRevision) return;
      addPreviewWarning(next, source);
      geometry = next; activeSource = source; sourceProject = previewProject;
      if (generationState === "error") generationState = "ready";
      selectedLayer = Math.min(selectedLayer, Math.max(0, next.layers.length - 1));
      status = updatesCustomData ? "Custom data updated" : source.sourceKind === "preview" ? "Real-data sample updated" : source.sourceKind === "real" ? nextProject.outputMode === "engraving" ? "Engraving artwork updated" : "Fabrication geometry updated" : "Sample preview updated · generate for real map data";
    } catch (error) {
      if (controller.signal.aborted || revision !== operationRevision || (error instanceof DOMException && error.name === "AbortError")) return;
      generationState = "error";
      status = error instanceof Error ? error.message : "Could not update the output geometry.";
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
      geometry = next; project = generationProject; activeSource = loaded.source; sourceProject = generationProject; selectedLayer = featuredLayerIndex(next); mode = generationProject.outputMode === "engraving" ? "engraving" : "3d"; generationState = "ready";
      const vectorUnavailable = next.vectorStatus !== "available" && (generationProject.showRoads || generationProject.showTrails || generationProject.showWater || generationProject.showBoundaries || (generationProject.outputMode === "stack" && generationProject.showWaterDepth));
      status = loaded.fallback ? "Sample terrain generated · connect the map API for real elevation" : vectorUnavailable ? "Terrain ready · map detail data unavailable" : generationProject.outputMode === "engraving" ? `Engraving ready · ${generationProject.engravingContourCount} contours · one SVG` : `Real terrain ready · ${next.layers.length} layers · ${next.layers.length - next.fabricationNests.length} cut panels`;
      void showToast({ type: loaded.fallback || vectorUnavailable ? "warning" : "success", message: loaded.fallback ? "Preview generated with sample terrain" : vectorUnavailable ? "Terrain generated without roads or water" : generationProject.outputMode === "engraving" ? "Engraving artwork ready" : "Terrain project ready" });
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

  async function downloadProject(): Promise<void> {
    const reason = exportBlockReason(geometry, project);
    if (reason) {
      handleExportUpdate({ phase: "error", intent: "download", message: reason });
      return;
    }
    handleExportUpdate({ phase: "preparing", intent: "download" });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const download = await prepareProjectDownload(buildProjectPackage(geometry, project));
      startBrowserDownload(download);
      handleExportUpdate({ phase: "ready", intent: "download", fileCount: download.fileCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : "TopoStack could not prepare this download.";
      handleExportUpdate({ phase: "error", intent: "download", message });
    }
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
          <label class="project-name"><span>Project name</span><Input aria-label="Project name" value={project.name} oninput={(event) => updateProject({ name: event.currentTarget.value })} /></label>
          <div class="history-actions">
            <IconButton label="Undo" onclick={undo} disabled={!history.length}><Undo2 size={17} /></IconButton>
            <IconButton label="Redo" onclick={redo} disabled={!future.length}><Redo2 size={17} /></IconButton>
            <IconButton label="Import project JSON" onclick={() => importInput.click()}><Upload size={17} /></IconButton>
            <input bind:this={importInput} class="ldt-visually-hidden" type="file" accept="application/json,.json" onchange={(event) => void importProject(event.currentTarget.files?.[0])} />
          </div>
        {/snippet}
        {#snippet actions()}
          <div class="bar-meta">{#if project.outputMode === "engraving"}<span>{project.engravingContourCount} contours</span><span>1 engrave SVG</span><span>No cut paths</span>{:else}<span>{geometry.layers.length} layers</span><span>{fabricationPanelCount} cut panels</span><span>{shownLength(totalHeight)} {shownLengthUnit} tall</span>{/if}</div>
          <div class="export-control">
            <div class="export-slot">
              <div data-atomm-export-button class:atomm-export-pending={!platformExportAvailable}></div>
              {#if !platformExportAvailable}
                <Button class="fallback-export" disabled={!exportReady || exportPhase === "preparing"} onclick={() => void downloadProject()}><Download size={15} /> {exportPhase === "preparing" ? "Preparing…" : "Download files"}</Button>
              {/if}
            </div>
            {#if exportPhase !== "idle"}
              <div class={`export-feedback export-feedback--${exportPhase}`} role="status" aria-live="polite">
                <span class="export-feedback-indicator" aria-hidden="true"></span>
                <span class="export-feedback-copy"><strong>{exportTitle}</strong><small>{exportDetail}</small></span>
              </div>
            {/if}
          </div>
          <ThemeToggle {theme} class="theme-toggle" />
        {/snippet}
      </Topbar>
      <ContextBar class="terrain-contextbar" section="Terrain" title={project.location.label.split(",")[0]} detail={project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}>
        {#snippet actions()}
          <div class="ldt-toggle-group ldt-toggle-group--sm output-mode-switch" role="radiogroup" aria-label="Output type">
            <button type="button" class="ldt-toggle-group__item" role="radio" aria-label="Layered relief" aria-checked={project.outputMode === "stack"} data-state={project.outputMode === "stack" ? "on" : "off"} tabindex={project.outputMode === "stack" ? 0 : -1} onclick={() => { mode = "3d"; void updateFabrication({ outputMode: "stack" }); }} onkeydown={navigateChoice}>
              <span class="output-mode-switch__icon" aria-hidden="true"><Layers3 size={16} strokeWidth={2.2} /></span>
              <span>Layered</span>
            </button>
            <button type="button" class="ldt-toggle-group__item" role="radio" aria-label="Flat engraving" aria-checked={project.outputMode === "engraving"} data-state={project.outputMode === "engraving" ? "on" : "off"} tabindex={project.outputMode === "engraving" ? 0 : -1} onclick={() => { mode = "engraving"; void updateFabrication({ outputMode: "engraving" }); }} onkeydown={navigateChoice}>
              <span class="output-mode-switch__icon" aria-hidden="true"><PenTool size={16} strokeWidth={2.2} /></span>
              <span>Flat</span>
            </button>
          </div>
          <span class="context-export-status" class:ready={exportReady && exportPhase !== "error"} class:error={!exportReady || exportPhase === "error"}>{exportPhase === "preparing" ? "Preparing files" : exportPhase === "ready" ? "Export ready" : exportPhase === "error" ? "Export failed" : exportReady ? "Ready to export" : "Generate before export"}</span>
        {/snippet}
      </ContextBar>
    </div>
  {/snippet}

  <Workspace class="workspace">
    {#snippet sidebar()}
    <Sidebar class="config-panel">
      <div class="panel-scroll">
        <div class="panel-intro">
          <span class="section-kicker panel-eyebrow">Project controls</span>
          <h1>{project.outputMode === "engraving" ? "Draw the landscape." : "Build the landscape."}</h1>
          <p>Work through the essentials, then open details only when you need them.</p>
          <div class="section-tools" aria-label="Section display controls">
            <button type="button" onclick={() => setAllSections(true)} disabled={CONFIG_SECTION_IDS.every((section) => openSections[section])}>Expand all</button>
            <button type="button" onclick={() => setAllSections(false)} disabled={CONFIG_SECTION_IDS.every((section) => !openSections[section])}>Collapse all</button>
          </div>
        </div>
        <Section class="config-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.setup} aria-controls="section-setup" onclick={() => toggleSection("setup")}>
            <span class="section-number">01–02</span>
            <span class="section-title">Project setup<small>{sectionSummary("setup")}</small></span>
            <ChevronDown size={16} class={openSections.setup ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-setup" class="section-content" hidden={!openSections.setup}>
            <div class="subsection-label-row">
              <div class="subsection-label">Location</div>
              <span class:pending={terrainDataStale} class="terrain-data-badge">{terrainDataStale ? "Regeneration pending" : "Requires regeneration"}</span>
            </div>
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
          <p class:pending={terrainDataStale} class="terrain-data-note" aria-live="polite">
            {#if terrainDataStale}<strong>Terrain data is from the previous map area.</strong> Generate it before export.{:else}Changing the location or map area requires terrain regeneration.{/if}
            <span>Size, map details, and linework update automatically. Vertical exaggeration requires regenerating the layer geometry.</span>
          </p>
          </div>
        </Section>

        <Section class="config-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.size} aria-controls="section-size" onclick={() => toggleSection("size")}>
            <span class="section-number">03</span>
            <span class="section-title">{project.outputMode === "engraving" ? "Artwork size" : "Cut size"}<small>{sectionSummary("size")}</small></span>
            <ChevronDown size={16} class={openSections.size ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-size" class="section-content" hidden={!openSections.size}>
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
          </div>
        </Section>

        <Section class="config-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.terrain} aria-controls="section-terrain" onclick={() => toggleSection("terrain")}>
            <span class="section-number">04</span>
            <span class="section-title">{project.outputMode === "engraving" ? "Contour design" : "Terrain layers"}<small>{sectionSummary("terrain")}</small></span>
            <ChevronDown size={16} class={openSections.terrain ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-terrain" class="section-content" hidden={!openSections.terrain}>
          {#if project.outputMode === "engraving"}
            <div class="range-field">
              <span class="range-field__label"><b>Contour density</b></span>
              <div class="range-field__row">
                <input type="range" aria-label="Contour density slider" min="4" max="40" step="1" value={project.engravingContourCount} oninput={(event) => void updateFabrication({ engravingContourCount: Number(event.currentTarget.value) })} />
                <span class="number-input number-input--compact"><NumberField label="Contour density" value={project.engravingContourCount} min={4} max={40} step={1} onValueChange={(value) => value !== project.engravingContourCount && void updateFabrication({ engravingContourCount: value })} /><em>lines</em></span>
              </div>
              <small><span>4 sparse</span><span>40 detailed</span></small>
            </div>
            <div class="field-stack">
              <Field label="Index contour" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Index contour interval" value={project.engravingIndexInterval} min={2} max={10} step={1} onValueChange={(value) => value !== project.engravingIndexInterval && void updateFabrication({ engravingIndexInterval: value })} /><em>every</em></span>{/snippet}</Field>
            </div>
            <div class="relief-summary">
              <PenTool size={20} />
              <span>
                <strong>{project.engravingContourCount} contour lines in one flat graphic</strong>
                <small>≈ {Math.round(displayElevation(contourInterval, project.units)).toLocaleString()} {shownElevationUnit} apart · every {project.engravingIndexInterval}th line emphasized</small>
              </span>
            </div>
          {:else}
          <div class="range-field">
            <span class="range-field__label vertical-exaggeration-heading"><b>Vertical exaggeration</b><span class:pending={verticalExaggerationStale} class="terrain-data-badge">{verticalExaggerationStale ? "Regeneration pending" : "Requires regeneration"}</span></span>
            <div class="range-field__row">
              <input type="range" aria-label="Vertical exaggeration slider" min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step="0.5" value={project.verticalExaggeration} oninput={(event) => updateVerticalExaggeration(Number(event.currentTarget.value))} />
              <span class="number-input number-input--compact"><NumberField label="Vertical exaggeration" value={project.verticalExaggeration} min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step={0.5} oninput={(event) => event.currentTarget.value !== "" && updateVerticalExaggeration(event.currentTarget.valueAsNumber)} onValueChange={updateVerticalExaggeration} /><em>×</em></span>
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
          {/if}
          </div>
        </Section>

        <Section class="config-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.details} aria-controls="section-details" onclick={() => toggleSection("details")}>
            <span class="section-number">05</span>
            <span class="section-title">Map details<small>{sectionSummary("details")}</small></span>
            <ChevronDown size={16} class={openSections.details ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-details" class="section-content" hidden={!openSections.details}>

          <div class="detail-group">
            <p class="subgroup-heading">Terrain features</p>
            <div class="toggle-stack">
              <Switch checked={project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label="Roads"><span class="toggle-label"><Minus size={16} />Roads</span></Switch>
              <Switch checked={project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label="Trails"><span class="toggle-label"><Minus size={16} />Trails</span></Switch>
              <Switch checked={project.showTransportationLabels} onCheckedChange={(showTransportationLabels) => void updateMapDetails({ showTransportationLabels })} aria-label="Transportation labels"><span class="toggle-label"><Minus size={16} />Transportation labels</span></Switch>
              <div class="toggle-control">
                <Switch checked={project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label="Water outlines"><span class="toggle-label"><Waves size={16} />Water outlines</span></Switch>
                {#if project.outputMode === "engraving" && project.showWater}
                  <div class="toggle-settings">
                    <p class="subgroup-heading">Water fill</p>
                    <div class="ldt-toggle-group water-pattern-options" role="radiogroup" aria-label="Water fill pattern">
                      {#each WATER_FILL_PATTERNS as option}
                        <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.waterFillPattern === option.value} data-state={project.waterFillPattern === option.value ? "on" : "off"} tabindex={project.waterFillPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ waterFillPattern: option.value })} onkeydown={navigateChoice}>{option.label}</button>
                      {/each}
                    </div>
                    <small class="depth-note">Adds fabrication-ready vector marks inside water areas. None keeps outlines only.</small>
                  </div>
                {/if}
              </div>
              <Switch checked={project.showBoundaries} onCheckedChange={(showBoundaries) => void updateMapDetails({ showBoundaries })} aria-label="State and province boundaries"><span class="toggle-label"><MapIcon size={16} />State / province boundaries</span></Switch>
              <Switch checked={project.showCoordinateGrid} onCheckedChange={(showCoordinateGrid) => void updateMapDetails({ showCoordinateGrid })} aria-label="Latitude and longitude grid"><span class="toggle-label"><Grid3X3 size={16} />Latitude / longitude grid</span></Switch>
              {#if project.outputMode === "engraving"}
                <Switch checked={project.showEngravingBorder} onCheckedChange={(showEngravingBorder) => void updateFabrication({ showEngravingBorder })} aria-label="Engraved border"><span class="toggle-label"><Square size={16} />Engraved border</span></Switch>
              {:else}
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
              {/if}
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

          {#if project.outputMode === "stack"}<div class="detail-group">
            <p class="subgroup-heading">Assembly</p>
            <div class="toggle-stack">
              <Switch checked={project.showAlignmentGuides} onCheckedChange={(showAlignmentGuides) => void updateMapDetails({ showAlignmentGuides })} aria-label="Assembly guides"><span class="toggle-label"><Layers3 size={16} />Assembly guides</span></Switch>
            </div>
          </div>{/if}

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
          </div>
        </Section>

        <Section class="config-section custom-data-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.customData} aria-controls="section-custom-data" onclick={() => toggleSection("customData")}>
            <span class="section-number">06</span>
            <span class="section-title">Custom Data<small>{sectionSummary("customData")}</small></span>
            <ChevronDown size={16} class={openSections.customData ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-custom-data" class="section-content" hidden={!openSections.customData}>
            <p class="custom-data-intro">Add your own geographic annotations. Coordinates stay attached to the project and are clipped to the selected map area during engraving.</p>

            <div class="marker-editor">
              <div class="subgroup-heading subgroup-heading--action">
                <p><MapPin size={14} />Markers <span>{project.markers.length}</span></p>
                <button type="button" class="marker-add-button" onclick={addMarker}><Plus size={13} />Add marker</button>
              </div>
              {#if project.markers.length === 0}
                <small class="marker-empty">Add a marker, enter its latitude and longitude, then choose the symbol to engrave.</small>
              {:else}
                <div class="marker-list">
                  {#each project.markers as marker, index (marker.id)}
                    <div class="marker-card">
                      <div class="marker-card__header">
                        <b>Marker {index + 1}</b>
                        <button type="button" aria-label={`Remove marker ${index + 1}`} title="Remove marker" onclick={() => removeMarker(marker.id)}><Trash2 size={14} /></button>
                      </div>
                      <div class="field-stack marker-coordinate-fields">
                        <Field label="Latitude" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`Marker ${index + 1} latitude`} value={marker.lat} min={-85.0511} max={85.0511} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && updateMarker(marker.id, { lat: event.currentTarget.valueAsNumber })} onValueChange={(lat) => lat !== marker.lat && updateMarker(marker.id, { lat })} /><em>°</em></span>{/snippet}</Field>
                        <Field label="Longitude" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`Marker ${index + 1} longitude`} value={marker.lon} min={-180} max={180} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && updateMarker(marker.id, { lon: event.currentTarget.valueAsNumber })} onValueChange={(lon) => lon !== marker.lon && updateMarker(marker.id, { lon })} /><em>°</em></span>{/snippet}</Field>
                      </div>
                      <div class="marker-symbol-options" role="radiogroup" aria-label={`Marker ${index + 1} symbol`}>
                        {#each MARKER_OPTIONS as option}
                          <button type="button" role="radio" aria-label={option.label} title={option.label} aria-checked={marker.symbol === option.value} data-state={marker.symbol === option.value ? "on" : "off"} tabindex={marker.symbol === option.value ? 0 : -1} onclick={() => updateMarker(marker.id, { symbol: option.value })} onkeydown={navigateChoice}>
                            <svg viewBox="-11 -11 22 22" aria-hidden="true">{#each option.paths as path}<path d={path.map((point, pathIndex) => `${pathIndex === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ")} />{/each}</svg>
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
              <small class="marker-note">Markers outside the selected crop remain saved but are not engraved.</small>
            </div>

            <div class="custom-line-editor">
              <div class="subgroup-heading subgroup-heading--action">
                <p><Route size={14} />Paths <span>{project.customLines.length}</span></p>
                <button type="button" class="marker-add-button" onclick={addCustomLine}><Plus size={13} />Add path</button>
              </div>
              {#if project.customLines.length === 0}
                <small class="marker-empty">Create a trail or boundary, then define its route with as many latitude/longitude points as needed.</small>
              {:else}
                <div class="marker-list">
                  {#each project.customLines as line, lineIndex (line.id)}
                    <div class="marker-card custom-line-card">
                      <div class="marker-card__header">
                        <b>Path {lineIndex + 1}</b>
                        <button type="button" aria-label={`Remove path ${lineIndex + 1}`} title="Remove path" onclick={() => removeCustomLine(line.id)}><Trash2 size={14} /></button>
                      </div>
                      <div class="custom-line-kind-options" role="radiogroup" aria-label={`Path ${lineIndex + 1} type`}>
                        {#each CUSTOM_LINE_OPTIONS as option}
                          <button type="button" role="radio" aria-checked={line.kind === option.value} data-state={line.kind === option.value ? "on" : "off"} tabindex={line.kind === option.value ? 0 : -1} onclick={() => updateCustomLine(line.id, { kind: option.value })} onkeydown={navigateChoice}>
                            {#if option.value === "trail"}<Route size={14} />{:else}<MapIcon size={14} />{/if}{option.label}
                          </button>
                        {/each}
                      </div>
                      <div class="custom-point-list">
                        {#each line.points as point, pointIndex}
                          <div class="custom-point-row">
                            <div class="custom-point-heading">
                              <span>Point {pointIndex + 1}</span>
                              <button type="button" aria-label={`Remove point ${pointIndex + 1} from path ${lineIndex + 1}`} title={line.points.length <= 2 ? "A path needs at least two points" : "Remove point"} disabled={line.points.length <= 2} onclick={() => removeCustomLinePoint(line.id, pointIndex)}><Trash2 size={12} /></button>
                            </div>
                            <div class="field-stack marker-coordinate-fields">
                              <Field label="Latitude" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`Path ${lineIndex + 1} point ${pointIndex + 1} latitude`} value={point.lat} min={-85.0511} max={85.0511} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && updateCustomLinePoint(line.id, pointIndex, { lat: event.currentTarget.valueAsNumber })} onValueChange={(lat) => lat !== point.lat && updateCustomLinePoint(line.id, pointIndex, { lat })} /><em>°</em></span>{/snippet}</Field>
                              <Field label="Longitude" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`Path ${lineIndex + 1} point ${pointIndex + 1} longitude`} value={point.lon} min={-180} max={180} step={0.0001} oninput={(event) => event.currentTarget.value !== "" && updateCustomLinePoint(line.id, pointIndex, { lon: event.currentTarget.valueAsNumber })} onValueChange={(lon) => lon !== point.lon && updateCustomLinePoint(line.id, pointIndex, { lon })} /><em>°</em></span>{/snippet}</Field>
                            </div>
                          </div>
                        {/each}
                      </div>
                      <button type="button" class="custom-point-add" onclick={() => addCustomLinePoint(line.id)}><Plus size={13} />Add point</button>
                    </div>
                  {/each}
                </div>
              {/if}
              <small class="marker-note">Custom paths render even when built-in Trails or Boundaries are switched off.</small>
            </div>
          </div>
        </Section>

        <Section class="config-section linework-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.linework} aria-controls="section-linework" onclick={() => toggleSection("linework")}>
            <span class="section-number">07</span>
            <span class="section-title">Linework<small>{sectionSummary("linework")}</small></span>
            <ChevronDown size={16} class={openSections.linework ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-linework" class="section-content" hidden={!openSections.linework}>
          <div class="line-presets" role="radiogroup" aria-label="Linework preset">
            {#each LINE_PRESETS as preset}
              <button type="button" role="radio" aria-checked={activeLinePreset === preset.value} data-state={activeLinePreset === preset.value ? "on" : "off"} onclick={() => void updateFabrication({ lineStyle: { ...preset.style } })}>
                <svg viewBox="0 0 52 24" aria-hidden="true">
                  <path d="M2 5H50" stroke-width={preset.style.contourMm * 5} />
                  <path d="M2 12H50" stroke-width={preset.style.indexContourMm * 5} />
                  <path d="M2 19H50" stroke-width={preset.style.trailMm * 5} stroke-dasharray={trailPatternDash(preset.style)} />
                </svg>
                <span><b>{preset.label}</b><small>{preset.description}</small></span>
              </button>
            {/each}
          </div>
          <button type="button" class="linework-customize" aria-expanded={lineworkOpen} onclick={() => lineworkOpen = !lineworkOpen}>
            <span>{activeLinePreset ? "Customize preset" : "Custom linework"}</span>
            <ChevronDown size={14} class={lineworkOpen ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          {#if lineworkOpen}
            <div class="linework-controls">
              {#if project.outputMode === "engraving"}
                <p class="subgroup-heading">Topography</p>
                <div class="field-stack">
                  <Field label="Minor contours" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Minor contour width" value={shownLineWidth(project.lineStyle.contourMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("contourMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                  <Field label="Index contours" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Index contour width" value={shownLineWidth(project.lineStyle.indexContourMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("indexContourMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                </div>
              {/if}
              <p class="subgroup-heading">Map features</p>
              <div class="field-stack">
                <Field label="Major roads" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Major road width" value={shownLineWidth(project.lineStyle.majorRoadMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("majorRoadMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Local roads" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Local road width" value={shownLineWidth(project.lineStyle.localRoadMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("localRoadMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Trails" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Trail width" value={shownLineWidth(project.lineStyle.trailMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("trailMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Water" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Water line width" value={shownLineWidth(project.lineStyle.waterMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("waterMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Boundaries" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Boundary line width" value={shownLineWidth(project.lineStyle.boundaryMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("boundaryMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                <Field label="Lat / long grid" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Coordinate grid line width" value={shownLineWidth(project.lineStyle.coordinateGridMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("coordinateGridMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
              </div>
              <p class="subgroup-heading">Road appearance</p>
              <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Major road style">
                {#each ROAD_STYLES as option}
                  <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.lineStyle.roadStyle === option.value} data-state={project.lineStyle.roadStyle === option.value ? "on" : "off"} tabindex={project.lineStyle.roadStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...project.lineStyle, roadStyle: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
                {/each}
              </div>
              {#if project.lineStyle.roadStyle === "outlined"}
                <div class="field-stack">
                  <Field label="Outline spacing" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Major road outline spacing" value={shownLineWidth(project.lineStyle.majorRoadSpacingMm)} min={displayLength(0.2, project.units)} max={displayLength(4, project.units)} step={project.units === "imperial" ? 0.005 : 0.05} onValueChange={(value) => void setLineWidth("majorRoadSpacingMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                </div>
              {/if}
              <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Road endpoint shape">
                {#each ROAD_CAPS as option}
                  <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.lineStyle.roadCap === option.value} data-state={project.lineStyle.roadCap === option.value ? "on" : "off"} tabindex={project.lineStyle.roadCap === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...project.lineStyle, roadCap: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
                {/each}
              </div>
              <p class="subgroup-heading">Trail pattern</p>
              <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Trail pattern">
                {#each TRAIL_PATTERNS as option}
                  <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={project.lineStyle.trailPattern === option.value} data-state={project.lineStyle.trailPattern === option.value ? "on" : "off"} tabindex={project.lineStyle.trailPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...project.lineStyle, trailPattern: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
                {/each}
              </div>
              <p class="subgroup-heading">Finishing</p>
              <div class="field-stack">
                <Field label="Labels & guides" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Annotation width" value={shownLineWidth(project.lineStyle.annotationMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("annotationMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
                {#if project.outputMode === "engraving"}<Field label="Border" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Border width" value={shownLineWidth(project.lineStyle.borderMm)} min={displayLength(0.05, project.units)} max={displayLength(1.5, project.units)} step={project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("borderMm", value)} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>{/if}
              </div>
              <small class="linework-note">Stroke widths are physical SVG values. Final engraved width also depends on focus, power, speed, material, and whether your laser software treats strokes as centerlines or filled shapes.</small>
            </div>
          {/if}
          </div>
        </Section>

        <Section class="config-section advanced-section">
          <button type="button" class="section-disclosure" aria-expanded={openSections.advanced} aria-controls="section-advanced" onclick={() => toggleSection("advanced")}>
            <span class="section-number">08</span>
            <span class="section-title">{project.outputMode === "engraving" ? "Artwork settings" : "Fabrication settings"}<small>{sectionSummary("advanced")}</small></span>
            <ChevronDown size={16} class={openSections.advanced ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
          </button>
          <div id="section-advanced" class="section-content" hidden={!openSections.advanced}>
            <div class="advanced-fields">
              <div class="toggle-stack">
                {#if project.outputMode === "stack"}<Switch checked={project.optimizeMaterialUse} onCheckedChange={(optimizeMaterialUse) => void updateFabrication({ optimizeMaterialUse })} aria-label="Material-saving nests"><span class="toggle-label"><Layers3 size={16} />Material-saving nests</span></Switch>{/if}
                <Switch checked={project.smoothing === 1} onCheckedChange={(smooth) => void updateFabrication({ smoothing: smooth ? 1 : 0 })} aria-label="Smooth contours"><span class="toggle-label"><Waves size={16} />Smooth contours</span></Switch>
              </div>
              <div class="field-stack">
                {#if project.outputMode === "stack" && project.optimizeMaterialUse}<Field label="Glue margin" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Glue margin" value={shownLength(project.glueMarginMm)} min={shownLength(2)} max={shownLength(25)} step={project.units === "imperial" ? 0.01 : 0.5} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ glueMarginMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const glueMarginMm = storedLength(value); if (glueMarginMm !== project.glueMarginMm) void updateFabrication({ glueMarginMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>{/if}
                {#if project.outputMode === "stack"}<Field label="Laser kerf" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Laser kerf" value={shownLength(project.laserKerfMm)} min={0} max={shownLength(1)} step={project.units === "imperial" ? 0.001 : 0.01} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ laserKerfMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const laserKerfMm = storedLength(value); if (laserKerfMm !== project.laserKerfMm) void updateFabrication({ laserKerfMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>{/if}
                <Field label="Minimum feature" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Minimum feature" value={shownLength(project.minimumFeatureMm)} min={shownLength(0.2)} max={shownLength(5)} step={project.units === "imperial" ? 0.01 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ minimumFeatureMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const minimumFeatureMm = storedLength(value); if (minimumFeatureMm !== project.minimumFeatureMm) void updateFabrication({ minimumFeatureMm }); }} /><em>{shownLengthUnit}</em></span>{/snippet}</Field>
              </div>
            </div>
          </div>
        </Section>
      </div>
      <div class="generate-dock">
        <div class={`status-line status-${previewBusy ? "loading" : generationState}`} role="status" aria-live="polite"><span></span>{generationState === "loading" ? status : !detailsUpdating && terrainDataStale ? terrainDataAction === "regenerate" ? "Map area changed · regenerate terrain data before export" : "Map area changed · generate terrain data before export" : !detailsUpdating && verticalExaggerationStale ? "Vertical exaggeration changed · regenerate terrain before export" : !detailsUpdating && !exportReady && geometry.sourceKind === "real" ? "Design changed · refresh before export" : status}</div>
        <Button variant="primary" class="generate-button" onclick={() => generationState === "loading" ? cancelGeneration() : void generate()}>{#if generationState === "loading"}<X size={18} /> Cancel generation{:else}<Sparkles size={18} /> {geometry.sourceKind === "real" ? terrainDataStale ? "Regenerate terrain data" : "Regenerate terrain" : "Generate terrain"}{/if}</Button>
      </div>
    </Sidebar>
    {/snippet}

    <section class="preview-panel" class:engraving-preview-panel={project.outputMode === "engraving"}>
      <div class="preview-toolbar"><div class="ldt-toggle-group mode-switch" role="radiogroup" aria-label="Preview mode">{#each previewModeOptions as option}<button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={mode === option.value} data-state={mode === option.value ? "on" : "off"} tabindex={mode === option.value ? 0 : -1} onclick={() => { if (option.value === "2d" && selectedLayer === 0) selectedLayer = featuredLayerIndex(geometry); mode = option.value as PreviewMode; }} onkeydown={navigateChoice}>{#if option.value === "map"}<MapIcon size={15} />{:else if option.value === "engraving"}<PenTool size={15} />{:else if option.value === "2d"}<Layers3 size={15} />{:else}<Box size={15} />{/if}{option.label}</button>{/each}</div><div class="preview-readout"><span>{shownLength(project.widthMm)} × {shownLength(project.heightMm)} {shownLengthUnit}</span><span>{Math.round(displayElevation(geometry.minElevationM, project.units)).toLocaleString()}–{Math.round(displayElevation(geometry.maxElevationM, project.units)).toLocaleString()} {shownElevationUnit}</span></div></div>
      <div class="preview-stage" aria-busy={previewBusy} data-road-markings={detailCounts.road} data-trail-markings={detailCounts.trail} data-transportation-label-markings={detailCounts.transportationLabel} data-water-markings={detailCounts.water} data-contour-markings={detailCounts.contour} data-alignment-markings={detailCounts.alignment} data-elevation-markings={detailCounts.elevation} data-north-markings={detailCounts.north} data-scale-markings={detailCounts.scale} data-marker-markings={detailCounts.marker} data-custom-line-markings={detailCounts.customLine}>{#if mode === "map"}{#if MapCanvas}<MapCanvas {project} onLocationChange={(lat: number, lon: number, zoom: number, bounds: GeoBounds) => updateLocation({ lat, lon, zoom, bounds, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` })} />{:else}<div class="preview-loading">Loading map…</div>{/if}{:else if mode === "engraving"}<EngravingPreview {geometry} {project} />{:else if mode === "2d"}<TwoDPreview {geometry} {selectedLayer} />{:else if ThreePreview}<ThreePreview {geometry} exploded={project.explodedPreview} />{:else}<div class="preview-loading">Loading 3D preview…</div>{/if}{#if mode !== "map"}<div class="preview-attribution">Map data © <a href={OSM_ATTRIBUTION.url} target="_blank" rel="noreferrer">{OSM_ATTRIBUTION.name}</a></div>{/if}{#if previewBusy}<div class:preview-update-overlay={detailsUpdating && generationState !== "loading"} class="generation-overlay" role="status" aria-live="polite" style:pointer-events={detailsUpdating && generationState !== "loading" ? "none" : undefined}><div class="contour-loader"><span></span><span></span><span></span></div><strong>{previewBusyLabel}</strong><small>{status}</small></div>{/if}{#if visibleWarnings.length}<div class="warning-stack">{#each visibleWarnings as warning (`${warning.code}-${warning.message}`)}<div><span>!</span>{warning.message}</div>{/each}</div>{/if}</div>
      {#if project.outputMode === "stack"}<div class="layer-dock"><div class="layer-heading"><span><Layers3 size={16} /><b>Layer {selectedLayer + 1}</b> of {geometry.layers.length}</span><strong>{layerTicks[selectedLayer]?.toLocaleString()} {shownElevationUnit}</strong></div><input class="layer-range" type="range" min="0" max={Math.max(0, geometry.layers.length - 1)} value={selectedLayer} oninput={(event) => { selectedLayer = Number(event.currentTarget.value); if (mode === "3d") mode = "2d"; }} /><div class="layer-scale"><span>{layerTicks[0]?.toLocaleString()} {shownElevationUnit}</span><span>{layerTicks[Math.floor(layerTicks.length / 2)]?.toLocaleString()} {shownElevationUnit}</span><span>{layerTicks.at(-1)?.toLocaleString()} {shownElevationUnit}</span></div>{#if mode === "3d"}<label class="explode-control"><span>Stack</span><input type="range" min="0" max="1" step="0.05" value={project.explodedPreview} oninput={(event) => updateProject({ explodedPreview: Number(event.currentTarget.value) })} /><span>Exploded</span></label>{/if}</div>{/if}
    </section>
  </Workspace>
  {#if searchOpen}<LocationDialog {project} presets={PRESETS} onChoose={choosePlace} onCoordinates={(lat, lon) => updateLocation({ lat, lon, label: "Custom coordinates" })} onClose={() => searchOpen = false} />{/if}
</AppShell>

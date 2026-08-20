<script lang="ts">
  import { onMount } from "svelte";
  import { Box, ChevronDown, Circle, Compass, Download, Layers3, Map as MapIcon, Minus, Mountain, Search, Settings2, Sparkles, Square, Undo2, Redo2, Upload, Waves, X } from "@lucide/svelte";
  import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type GeoBounds, type GeometryIRV1, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
  import { boundsForProject, loadTerrain, type PlaceResult } from "../data-provider";
  import { exportBlockReason } from "../export-policy";
  import { loadProject, parseProject, saveProject } from "../storage";
  import { connectAtomm } from "./atomm-bridge";
  import LocationDialog from "./LocationDialog.svelte";
  import MapCanvas from "./MapCanvas.svelte";
  import NumberField from "./NumberField.svelte";
  import ThreePreview from "./ThreePreview.svelte";
  import Toggle from "./Toggle.svelte";
  import TwoDPreview from "./TwoDPreview.svelte";

  type PreviewMode = "map" | "2d" | "3d";
  type GenerateState = "idle" | "loading" | "ready" | "error";
  const PRESETS: PlaceResult[] = [
    { id: "rainier", label: "Mount Rainier, Washington, USA", lat: 46.8523, lon: -121.7603 },
    { id: "grand-canyon", label: "Grand Canyon, Arizona, USA", lat: 36.1069, lon: -112.1129 },
    { id: "matterhorn", label: "Matterhorn, Alps, Switzerland", lat: 45.9763, lon: 7.6586 },
    { id: "fuji", label: "Mount Fuji, Honshu, Japan", lat: 35.3606, lon: 138.7274 },
  ];

  function previewFor(config: ProjectConfigV1): GeometryIRV1 {
    const result = generateGeometry(config, createSyntheticSource(config));
    result.warnings.push({ code: "DATA_FALLBACK", message: "Sample preview only. Generate real terrain before exporting." });
    return result;
  }

  let project = $state.raw<ProjectConfigV1>(DEFAULT_PROJECT);
  let geometry = $state.raw<GeometryIRV1>(previewFor(DEFAULT_PROJECT));
  let mode = $state<PreviewMode>("3d");
  let generationState = $state<GenerateState>("ready");
  let status = $state("Preview fixture ready");
  let selectedLayer = $state(0);
  let searchOpen = $state(false);
  let advancedOpen = $state(false);
  let atommReady = $state(false);
  let booted = $state(false);
  let history = $state.raw<ProjectConfigV1[]>([]);
  let future = $state.raw<ProjectConfigV1[]>([]);
  let importInput: HTMLInputElement;
  let requestId = 0;
  let generationAbort: AbortController | undefined;
  let geometryWorker: Worker | undefined;
  let geometryReject: ((reason?: unknown) => void) | undefined;

  const totalHeight = $derived(geometry.layers.length * project.materialThicknessMm);
  const exportReady = $derived(!exportBlockReason(geometry, project));
  const visibleWarnings = $derived(geometry.warnings.slice(0, 2));
  const layerTicks = $derived(geometry.layers.map((layer) => Math.round(layer.elevationM)));

  onMount(() => {
    let cancelled = false;
    const disconnectAtomm = connectAtomm(() => ({ geometry, project }), () => atommReady = true);
    void loadProject().then((saved) => {
      if (cancelled) return;
      if (saved) { project = saved; geometry = previewFor(saved); status = "Local project restored · generate to refresh terrain"; }
      booted = true;
    });
    return () => { cancelled = true; disconnectAtomm(); generationAbort?.abort(); geometryWorker?.terminate(); geometryReject?.(new DOMException("Generator closed", "AbortError")); };
  });

  $effect(() => {
    const current = project;
    if (!booted) return;
    const timeout = window.setTimeout(() => { void saveProject(current).catch(() => status = "Local save is unavailable in this browser"); }, 450);
    return () => window.clearTimeout(timeout);
  });

  function updateProject(patch: Partial<ProjectConfigV1>): void {
    history = [...history, project].slice(-40); future = [];
    const invalidatesBounds = "widthMm" in patch || "heightMm" in patch || "cropShape" in patch;
    project = { ...project, ...patch, ...(invalidatesBounds ? { location: { ...project.location, bounds: undefined } } : {}) };
  }
  function updateLocation(patch: Partial<ProjectConfigV1["location"]>): void {
    project = { ...project, location: { ...project.location, ...patch, ...(("lat" in patch || "lon" in patch || "zoom" in patch) && !("bounds" in patch) ? { bounds: undefined } : {}) } };
  }
  function choosePlace(place: PlaceResult): void {
    history = [...history, project].slice(-40); future = [];
    project = { ...project, name: place.label.split(",")[0] ?? "Terrain project", location: { ...project.location, lat: place.lat, lon: place.lon, label: place.label, zoom: 11, bounds: undefined } };
    searchOpen = false;
  }
  function undo(): void { const previous = history.at(-1); if (!previous) return; future = [...future, project]; history = history.slice(0, -1); project = previous; }
  function redo(): void { const next = future.at(-1); if (!next) return; history = [...history, project]; future = future.slice(0, -1); project = next; }

  function runGeometryWorker(config: ProjectConfigV1, source: SourceBundleV1): Promise<GeometryIRV1> {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const worker = new Worker(new URL("../geometry.worker.ts", import.meta.url), { type: "module" });
      geometryWorker = worker; geometryReject = reject;
      worker.onmessage = (event: MessageEvent<{ id: number; result?: GeometryIRV1; error?: string }>) => { if (event.data.id !== id) return; worker.terminate(); geometryWorker = undefined; geometryReject = undefined; if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error ?? "Geometry generation failed.")); };
      worker.onerror = (event) => { worker.terminate(); geometryWorker = undefined; geometryReject = undefined; reject(new Error(event.message)); };
      worker.postMessage({ id, config, source });
    });
  }

  async function generate(): Promise<void> {
    const controller = new AbortController(); generationAbort = controller;
    const generationProject: ProjectConfigV1 = { ...project, location: { ...project.location, bounds: boundsForProject(project) } };
    generationState = "loading"; status = "Fetching elevation tiles…";
    const progressToast = showToast({ type: "info", message: "Building terrain layers…", duration: 0 });
    try {
      const loaded = await loadTerrain(generationProject, controller.signal); status = "Tracing and repairing contours…";
      const next = await runGeometryWorker(generationProject, loaded.source);
      if (loaded.fallback) next.warnings.push({ code: "DATA_FALLBACK", message: "The map service was unavailable, so this preview uses deterministic sample terrain." });
      geometry = next; project = generationProject; selectedLayer = 0; mode = "3d"; generationState = "ready";
      const vectorUnavailable = next.vectorStatus === "unavailable" && (generationProject.showRoads || generationProject.showWater);
      status = loaded.fallback ? "Sample terrain generated · connect the map API for real elevation" : vectorUnavailable ? "Terrain ready · roads and water unavailable" : `Real terrain ready · ${next.layers.length} layers`;
      void showToast({ type: loaded.fallback || vectorUnavailable ? "warning" : "success", message: loaded.fallback ? "Preview generated with sample terrain" : vectorUnavailable ? "Terrain generated without roads or water" : "Terrain project ready" });
    } catch (error) {
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
    try { const parsed: unknown = JSON.parse(await file.text()); const candidate = parsed && typeof parsed === "object" && "project" in parsed ? (parsed as { project: unknown }).project : parsed; const imported = parseProject(candidate); history = [...history, project].slice(-40); future = []; project = imported; geometry = previewFor(imported); selectedLayer = 0; generationState = "ready"; status = "Project imported · generate to refresh its terrain"; }
    catch (error) { status = error instanceof Error ? error.message : "Could not import this project."; generationState = "error"; }
    finally { if (importInput) importInput.value = ""; }
  }
</script>

<main class="app-shell">
  <header class="app-header">
    <div class="topbar">
      <div class="brand"><strong>TopoStack</strong><span>Terrain studio</span></div>
      <label class="project-name"><span>Project</span><input aria-label="Project name" value={project.name} oninput={(event) => updateProject({ name: event.currentTarget.value })} /></label>
      <div class="history-actions"><button class="icon-button" onclick={undo} disabled={!history.length} aria-label="Undo"><Undo2 size={17} /></button><button class="icon-button" onclick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={17} /></button><button class="icon-button" onclick={() => importInput.click()} aria-label="Import project JSON"><Upload size={17} /></button><input bind:this={importInput} class="visually-hidden" type="file" accept="application/json,.json" onchange={(event) => void importProject(event.currentTarget.files?.[0])} /></div>
      <div class="bar-meta"><span>{geometry.layers.length} layers</span><span>{totalHeight.toFixed(1)} mm tall</span></div>
      <div class="export-slot"><div data-atomm-export-button class:atomm-export-pending={!atommReady}></div>{#if !atommReady}<button class="button fallback-export" disabled={!exportReady} onclick={downloadMaster}><Download size={15} /> Download SVG</button>{/if}</div>
    </div>
    <div class="contextbar"><div class="context-location"><span>Terrain</span><strong>{project.location.label.split(",")[0]}</strong><small>{project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}</small></div><div class="context-actions"><span class:ready={exportReady} class:error={!exportReady}>{exportReady ? "Ready to export" : "Generate before export"}</span></div></div>
  </header>

  <div class="workspace">
    <aside class="config-panel">
      <div class="panel-scroll">
        <section class="config-section"><p class="eyebrow">Terrain source</p><h1>Build the landscape.</h1><button class="location-card" onclick={() => searchOpen = true}><span class="location-icon"><MapIcon size={18} /></span><span><strong>{project.location.label.split(",")[0]}</strong><small>{project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}</small></span><Search size={17} /></button><div class="preset-row">{#each PRESETS.slice(0, 3) as preset}<button onclick={() => choosePlace(preset)}>{preset.label.split(",")[0].replace("Mount ", "Mt. ")}</button>{/each}</div></section>
        <section class="config-section"><div class="section-kicker"><span>01</span> Project size</div><div class="shape-switch"><button aria-pressed={project.cropShape === "rectangle"} class:active={project.cropShape === "rectangle"} onclick={() => updateProject({ cropShape: "rectangle" })}><Square size={15} /> Rectangle</button><button aria-pressed={project.cropShape === "circle"} class:active={project.cropShape === "circle"} onclick={() => updateProject({ cropShape: "circle", heightMm: project.widthMm })}><Circle size={15} /> Circle</button></div><div class="field-grid"><NumberField label="Width" value={project.widthMm} min={50} max={600} suffix="mm" onChange={(widthMm) => updateProject({ widthMm, ...(project.cropShape === "circle" ? { heightMm: widthMm } : {}) })} /><NumberField label="Height" value={project.heightMm} min={50} max={600} suffix="mm" onChange={(heightMm) => updateProject({ heightMm })} /></div></section>
        <section class="config-section"><div class="section-kicker"><span>02</span> Terrain layers</div><label class="range-field"><span><b>Layer count</b><output>{project.layerCount}</output></span><input type="range" min="2" max="24" value={project.layerCount} oninput={(event) => updateProject({ layerCount: Number(event.currentTarget.value) })} /><small><span>2</span><span>24</span></small></label><NumberField label="Material" value={project.materialThicknessMm} min={0.5} max={25} step={0.1} suffix="mm" onChange={(materialThicknessMm) => updateProject({ materialThicknessMm })} /><div class="relief-summary"><Mountain size={20} /><span><strong>{Math.round(geometry.maxElevationM - geometry.minElevationM).toLocaleString()} m relief</strong><small>≈ {Math.round((geometry.maxElevationM - geometry.minElevationM) / Math.max(1, project.layerCount - 1))} m per layer</small></span></div></section>
        <section class="config-section"><div class="section-kicker"><span>03</span> Map details</div><div class="toggle-stack"><Toggle checked={project.showRoads} onChange={(showRoads) => updateProject({ showRoads })} icon={Minus} label="Roads & trails" /><Toggle checked={project.showWater} onChange={(showWater) => updateProject({ showWater })} icon={Waves} label="Water outlines" /><Toggle checked={project.showContours} onChange={(showContours) => updateProject({ showContours })} icon={Layers3} label="Contour marks" /><Toggle checked={project.showAlignmentGuides} onChange={(showAlignmentGuides) => updateProject({ showAlignmentGuides })} icon={Layers3} label="Assembly guides" /><Toggle checked={project.showElevationLabels} onChange={(showElevationLabels) => updateProject({ showElevationLabels })} icon={Mountain} label="Elevation labels" /><Toggle checked={project.showNorthArrow} onChange={(showNorthArrow) => updateProject({ showNorthArrow })} icon={Compass} label="North arrow" /><Toggle checked={project.showScaleBar} onChange={(showScaleBar) => updateProject({ showScaleBar })} icon={Minus} label="Scale bar" /></div></section>
        <section class="config-section advanced-section"><button class="advanced-trigger" aria-expanded={advancedOpen} onclick={() => advancedOpen = !advancedOpen}><Settings2 size={16} /> Fabrication settings <ChevronDown size={16} class={advancedOpen ? "rotate" : ""} /></button>{#if advancedOpen}<div class="advanced-fields"><NumberField label="Minimum feature" value={project.minimumFeatureMm} min={0.2} max={5} step={0.1} suffix="mm" onChange={(minimumFeatureMm) => updateProject({ minimumFeatureMm })} /><NumberField label="Contour smoothing" value={project.smoothing} min={0} max={1} step={1} suffix="" onChange={(smoothing) => updateProject({ smoothing })} /><NumberField label="Label X" value={Math.round(project.elevationLabelPosition.x * 100)} min={-90} max={90} suffix="%" onChange={(x) => updateProject({ elevationLabelPosition: { ...project.elevationLabelPosition, x: x / 100 } })} /><NumberField label="Label Y" value={Math.round(project.elevationLabelPosition.y * 100)} min={-90} max={90} suffix="%" onChange={(y) => updateProject({ elevationLabelPosition: { ...project.elevationLabelPosition, y: y / 100 } })} /></div>{/if}</section>
      </div>
      <div class="generate-dock"><div class={`status-line status-${generationState}`} role="status" aria-live="polite"><span></span>{!exportReady && geometry.sourceKind === "real" ? "Settings changed · regenerate before export" : status}</div><button class="button primary generate-button" onclick={() => generationState === "loading" ? cancelGeneration() : void generate()}>{#if generationState === "loading"}<X size={18} /> Cancel generation{:else}<Sparkles size={18} /> {geometry.sourceKind === "real" ? "Regenerate terrain" : "Generate terrain"}{/if}</button></div>
    </aside>

    <section class="preview-panel">
      <div class="preview-toolbar"><div class="mode-switch" aria-label="Preview mode"><button aria-pressed={mode === "map"} class:active={mode === "map"} onclick={() => mode = "map"}><MapIcon size={15} /> Map</button><button aria-pressed={mode === "2d"} class:active={mode === "2d"} onclick={() => mode = "2d"}><Layers3 size={15} /> Cut layers</button><button aria-pressed={mode === "3d"} class:active={mode === "3d"} onclick={() => mode = "3d"}><Box size={15} /> 3D stack</button></div><div class="preview-readout"><span>{project.widthMm} × {project.heightMm} mm</span><span>{Math.round(geometry.minElevationM).toLocaleString()}–{Math.round(geometry.maxElevationM).toLocaleString()} m</span></div></div>
      <div class="preview-stage">{#if mode === "map"}<MapCanvas {project} onLocationChange={(lat: number, lon: number, zoom: number, bounds: GeoBounds) => updateLocation({ lat, lon, zoom, bounds, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` })} />{:else if mode === "2d"}<TwoDPreview {geometry} {selectedLayer} />{:else}<ThreePreview {geometry} exploded={project.explodedPreview} />{/if}{#if generationState === "loading"}<div class="generation-overlay"><div class="contour-loader"><span></span><span></span><span></span></div><strong>Building your terrain</strong><small>{status}</small></div>{/if}{#if visibleWarnings.length}<div class="warning-stack">{#each visibleWarnings as warning (`${warning.code}-${warning.message}`)}<div><span>!</span>{warning.message}</div>{/each}</div>{/if}</div>
      <div class="layer-dock"><div class="layer-heading"><span><Layers3 size={16} /><b>Layer {selectedLayer + 1}</b> of {geometry.layers.length}</span><strong>{layerTicks[selectedLayer]?.toLocaleString()} m</strong></div><input class="layer-range" type="range" min="0" max={Math.max(0, geometry.layers.length - 1)} value={selectedLayer} oninput={(event) => { selectedLayer = Number(event.currentTarget.value); if (mode === "3d") mode = "2d"; }} /><div class="layer-scale"><span>{layerTicks[0]?.toLocaleString()} m</span><span>{layerTicks[Math.floor(layerTicks.length / 2)]?.toLocaleString()} m</span><span>{layerTicks.at(-1)?.toLocaleString()} m</span></div>{#if mode === "3d"}<label class="explode-control"><span>Stack</span><input type="range" min="0" max="1" step="0.05" value={project.explodedPreview} oninput={(event) => updateProject({ explodedPreview: Number(event.currentTarget.value) })} /><span>Exploded</span></label>{/if}</div>
    </section>
  </div>
  {#if searchOpen}<LocationDialog {project} presets={PRESETS} onChoose={choosePlace} onCoordinates={(lat, lon) => updateLocation({ lat, lon, label: "Custom coordinates" })} onClose={() => searchOpen = false} />{/if}
</main>

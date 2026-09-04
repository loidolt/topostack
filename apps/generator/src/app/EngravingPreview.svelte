<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { IconButton } from "@loidolt/theme-svelte";
  import { Minus, Plus, RotateCcw } from "@lucide/svelte";
  import { labelPathData, type GeometryIRV1, type OperationPath, type Point2D, type ProjectConfigV1 } from "@topostack/core";

  let { geometry, project }: { geometry: GeometryIRV1; project: ProjectConfigV1 } = $props();
  const contourLayers = $derived(geometry.layers.slice(1));
  const markings = $derived(geometry.layers.flatMap((layer) => layer.markings)
    .filter((marking) => !marking.id.startsWith("alignment-")));
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 0.5;
  const ZOOM_SETTLE_MS = 180;
  let viewport: HTMLButtonElement;
  let panLayer: HTMLSpanElement;
  let canvas: HTMLSpanElement;
  let zoom = $state(MIN_ZOOM);
  let renderZoom = $state(MIN_ZOOM);
  let panX = $state(0);
  let panY = $state(0);
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStart: { pointerId: number; x: number; y: number; panX: number; panY: number; unitsPerPixel: number } | undefined;
  let dragFrame: number | undefined;
  let zoomCommitTimer: ReturnType<typeof setTimeout> | undefined;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let artworkSize = "";
  const baseX = $derived(-geometry.widthMm / 2 - 5);
  const baseY = $derived(-geometry.heightMm / 2 - 5);
  const baseWidth = $derived(geometry.widthMm + 10);
  const baseHeight = $derived(geometry.heightMm + 10);
  const residualScale = $derived(zoom / renderZoom);
  const visibleWidth = $derived(baseWidth / zoom);
  const visibleHeight = $derived(baseHeight / zoom);
  const renderWidth = $derived(baseWidth / renderZoom);
  const renderHeight = $derived(baseHeight / renderZoom);
  const renderX = $derived(baseX + (baseWidth - renderWidth) / 2 + panX);
  const renderY = $derived(baseY + (baseHeight - renderHeight) / 2 + panY);
  const engravingViewBox = $derived(`${renderX} ${renderY} ${renderWidth} ${renderHeight}`);

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function cancelZoomCommit(): void {
    if (zoomCommitTimer === undefined) return;
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = undefined;
  }

  function commitVectorZoom(): void {
    cancelZoomCommit();
    renderZoom = zoom;
    setPan(panX, panY, zoom);
  }

  function scheduleVectorZoom(): void {
    cancelZoomCommit();
    zoomCommitTimer = setTimeout(() => {
      zoomCommitTimer = undefined;
      renderZoom = zoom;
      setPan(panX, panY, zoom);
    }, ZOOM_SETTLE_MS);
  }

  function clampedPan(x: number, y: number, scale = renderZoom): { x: number; y: number } {
    if (scale <= MIN_ZOOM) return { x: 0, y: 0 };
    const maximumX = (baseWidth - baseWidth / scale) / 2;
    const maximumY = (baseHeight - baseHeight / scale) / 2;
    return { x: clamp(x, -maximumX, maximumX), y: clamp(y, -maximumY, maximumY) };
  }

  function setPan(x: number, y: number, scale = renderZoom): void {
    const next = clampedPan(x, y, scale);
    panX = next.x;
    panY = next.y;
  }

  function setZoom(value: number): void {
    const next = clamp(value, MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    zoom = next;
    scheduleVectorZoom();
  }

  function panUnitsPerPixel(): number | undefined {
    const scale = Math.min(canvasWidth / renderWidth, canvasHeight / renderHeight) * residualScale;
    return Number.isFinite(scale) && scale > 0 ? scale : undefined;
  }

  function cancelDragFrame(): void {
    if (dragFrame === undefined) return;
    cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }

  function resetDragLayer(): void {
    cancelDragFrame();
    dragOffsetX = 0;
    dragOffsetY = 0;
    if (panLayer) panLayer.style.transform = "translate3d(0, 0, 0)";
  }

  function scheduleDragFrame(): void {
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      panLayer.style.transform = `translate3d(${dragOffsetX}px, ${dragOffsetY}px, 0)`;
    });
  }

  function resetView(): void {
    cancelZoomCommit();
    zoom = MIN_ZOOM;
    renderZoom = MIN_ZOOM;
    panX = 0;
    panY = 0;
    resetDragLayer();
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * 0.0015));
  }

  function startPan(event: PointerEvent): void {
    if (event.button !== 0 || zoom <= MIN_ZOOM) return;
    cancelZoomCommit();
    const scale = panUnitsPerPixel();
    if (scale === undefined) return;
    viewport.setPointerCapture(event.pointerId);
    resetDragLayer();
    dragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY, unitsPerPixel: 1 / scale };
  }

  function movePan(event: PointerEvent): void {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragOffsetX = event.clientX - dragStart.x;
    dragOffsetY = event.clientY - dragStart.y;
    scheduleDragFrame();
  }

  function finishPan(event: PointerEvent): void {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    const finalOffsetX = event.type === "pointercancel" ? dragOffsetX : event.clientX - dragStart.x;
    const finalOffsetY = event.type === "pointercancel" ? dragOffsetY : event.clientY - dragStart.y;
    const nextX = dragStart.panX - finalOffsetX * dragStart.unitsPerPixel;
    const nextY = dragStart.panY - finalOffsetY * dragStart.unitsPerPixel;
    dragStart = undefined;
    resetDragLayer();
    setPan(nextX, nextY);
    commitVectorZoom();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "+" || event.key === "=") setZoom(zoom + ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") setZoom(zoom - ZOOM_STEP);
    else if (event.key === "0") resetView();
    else if (event.key === "ArrowLeft") { commitVectorZoom(); setPan(panX - visibleWidth * 0.1, panY, zoom); }
    else if (event.key === "ArrowRight") { commitVectorZoom(); setPan(panX + visibleWidth * 0.1, panY, zoom); }
    else if (event.key === "ArrowUp") { commitVectorZoom(); setPan(panX, panY - visibleHeight * 0.1, zoom); }
    else if (event.key === "ArrowDown") { commitVectorZoom(); setPan(panX, panY + visibleHeight * 0.1, zoom); }
    else return;
    event.preventDefault();
  }

  $effect(() => {
    const nextSize = `${geometry.widthMm}:${geometry.heightMm}`;
    if (artworkSize && artworkSize !== nextSize) resetView();
    artworkSize = nextSize;
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      canvasWidth = entry.contentRect.width;
      canvasHeight = entry.contentRect.height;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    cancelZoomCommit();
    cancelDragFrame();
  });

  function onBoundary(start: Point2D, end: Point2D): boolean {
    const epsilon = 0.02;
    if (project.cropShape === "circle") {
      const radius = project.widthMm / 2;
      return Math.abs(Math.hypot(start.x, start.y) - radius) <= epsilon &&
        Math.abs(Math.hypot(end.x, end.y) - radius) <= epsilon;
    }
    const halfWidth = project.widthMm / 2;
    const halfHeight = project.heightMm / 2;
    return (Math.abs(start.x - halfWidth) <= epsilon && Math.abs(end.x - halfWidth) <= epsilon) ||
      (Math.abs(start.x + halfWidth) <= epsilon && Math.abs(end.x + halfWidth) <= epsilon) ||
      (Math.abs(start.y - halfHeight) <= epsilon && Math.abs(end.y - halfHeight) <= epsilon) ||
      (Math.abs(start.y + halfHeight) <= epsilon && Math.abs(end.y + halfHeight) <= epsilon);
  }

  function contourPath(points: Point2D[]): string {
    let result = "";
    let connected = false;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]!;
      const end = points[index]!;
      if (onBoundary(start, end)) { connected = false; continue; }
      if (!connected) result += `M${start.x} ${start.y}`;
      result += `L${end.x} ${end.y}`;
      connected = true;
    }
    return result;
  }

  function linePath(points: Point2D[]): string {
    return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  }

  function markingWidth(marking: OperationPath): number {
    if (marking.transportationClass === "major-road") return geometry.lineStyle.majorRoadMm;
    if (marking.transportationClass === "local-road") return geometry.lineStyle.localRoadMm;
    if (marking.transportationClass === "trail") return geometry.lineStyle.trailMm;
    if (marking.kind === "water") return geometry.lineStyle.waterMm;
    if (marking.kind === "boundary") return geometry.lineStyle.boundaryMm;
    if (marking.kind === "grid") return geometry.lineStyle.coordinateGridMm;
    return geometry.lineStyle.annotationMm;
  }

  function trailDash(): string | undefined {
    const { trailMm, trailPattern } = geometry.lineStyle;
    if (trailPattern === "solid") return undefined;
    return trailPattern === "dotted" ? `0.01 ${Math.max(trailMm * 4, 0.7)}` : `${Math.max(trailMm * 6, 1.2)} ${Math.max(trailMm * 4, 0.8)}`;
  }

  function markingDash(marking: OperationPath): string | undefined {
    if (marking.kind === "boundary") return `${Math.max(geometry.lineStyle.boundaryMm * 8, 1.6)} ${Math.max(geometry.lineStyle.boundaryMm * 5, 1)}`;
    if (marking.kind === "grid") return `0.01 ${Math.max(geometry.lineStyle.coordinateGridMm * 5, 0.9)}`;
    return marking.transportationClass === "trail" ? trailDash() : undefined;
  }
</script>

<div class="engraving-stage">
  <div class="engraving-zoom-controls" aria-label="Engraving zoom controls">
    <IconButton label="Zoom out" size="sm" disabled={zoom <= MIN_ZOOM} onclick={() => setZoom(zoom - ZOOM_STEP)}><Minus size={15} /></IconButton>
    <span class="engraving-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
    <IconButton label="Zoom in" size="sm" disabled={zoom >= MAX_ZOOM} onclick={() => setZoom(zoom + ZOOM_STEP)}><Plus size={15} /></IconButton>
    <IconButton label="Reset engraving view" size="sm" disabled={zoom === MIN_ZOOM && panX === 0 && panY === 0} onclick={resetView}><RotateCcw size={14} /></IconButton>
  </div>
  <button
    type="button"
    bind:this={viewport}
    class="engraving-viewport"
    data-engraving-viewport
    data-zoom={zoom.toFixed(2)}
    data-render-zoom={renderZoom.toFixed(2)}
    data-rendering={zoom === renderZoom ? "sharp" : "preview"}
    aria-label="Interactive engraving preview. Scroll or use plus and minus to zoom, drag or use arrow keys to pan, and press zero to reset."
    onwheel={handleWheel}
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={finishPan}
    onpointercancel={finishPan}
    onkeydown={handleKeyDown}
  >
    <span bind:this={panLayer} class="engraving-pan-layer">
    <span bind:this={canvas} class="engraving-canvas" style:transform={`scale(${residualScale})`}>
  <svg viewBox={engravingViewBox} role="img" aria-label="Flat engraving preview">
    <defs><filter id="engraving-shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" /></filter></defs>
    {#if project.cropShape === "circle"}
      <circle cx="0" cy="0" r={project.widthMm / 2} class="engraving-surface" filter="url(#engraving-shadow)" />
    {:else}
      <rect x={-project.widthMm / 2} y={-project.heightMm / 2} width={project.widthMm} height={project.heightMm} class="engraving-surface" filter="url(#engraving-shadow)" />
    {/if}
    <g class="engraving-contours">
      {#each contourLayers as layer}
        {#each layer.polygons as polygon}
          {#each [polygon.outer, ...polygon.holes] as ring}
            <path d={contourPath(ring)} stroke-width={layer.index % project.engravingIndexInterval === 0 ? geometry.lineStyle.indexContourMm : geometry.lineStyle.contourMm} class:index-contour={layer.index % project.engravingIndexInterval === 0} />
          {/each}
        {/each}
      {/each}
    </g>
    <g class="engraving-details">
      {#each markings as marking (marking.id)}
        <g data-marking-id={marking.id} data-marking-kind={marking.kind} data-transportation-class={marking.transportationClass}>
          {#if marking.points.length > 1}<path d={linePath(marking.points)} fill={marking.knockout ? "#e8cfaa" : marking.filled ? "#2b2119" : "none"} stroke={marking.knockout ? "#e8cfaa" : undefined} stroke-width={markingWidth(marking)} stroke-dasharray={markingDash(marking)} stroke-linecap={marking.kind === "road" ? geometry.lineStyle.roadCap : undefined} stroke-linejoin={marking.kind === "road" ? "round" : undefined} />{/if}
          {#if marking.label && marking.points[0]}<path d={labelPathData(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle)} stroke-width={geometry.lineStyle.annotationMm} stroke-linecap={marking.textStyle?.font === "rounded" ? "round" : "butt"} stroke-linejoin={marking.textStyle?.font === "rounded" ? "round" : "miter"} />{/if}
        </g>
      {/each}
    </g>
    {#if project.showEngravingBorder}
      {#if project.cropShape === "circle"}<circle cx="0" cy="0" r={project.widthMm / 2} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{:else}<rect x={-project.widthMm / 2} y={-project.heightMm / 2} width={project.widthMm} height={project.heightMm} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{/if}
    {/if}
  </svg>
    </span>
    </span>
  </button>
  <div class="engraving-legend"><span><i style:--sample-width={`${Math.max(1, geometry.lineStyle.contourMm * 5)}px`}></i> Minor contour</span><span><i class="index" style:--sample-width={`${Math.max(1, geometry.lineStyle.indexContourMm * 5)}px`}></i> Index every {project.engravingIndexInterval}</span><span>{project.engravingContourCount} contours</span></div>
</div>

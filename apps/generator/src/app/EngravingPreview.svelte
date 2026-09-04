<script lang="ts">
  import { labelPathData, type GeometryIRV1, type OperationPath, type Point2D, type ProjectConfigV1 } from "@topostack/core";

  let { geometry, project }: { geometry: GeometryIRV1; project: ProjectConfigV1 } = $props();
  const contourLayers = $derived(geometry.layers.slice(1));
  const markings = $derived(geometry.layers.flatMap((layer) => layer.markings)
    .filter((marking) => !marking.id.startsWith("alignment-")));

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
  <svg viewBox={`${-geometry.widthMm / 2 - 5} ${-geometry.heightMm / 2 - 5} ${geometry.widthMm + 10} ${geometry.heightMm + 10}`} role="img" aria-label="Flat engraving preview">
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
          {#if marking.points.length > 1}<path d={linePath(marking.points)} stroke-width={markingWidth(marking)} stroke-dasharray={markingDash(marking)} />{/if}
          {#if marking.label && marking.points[0]}<path d={labelPathData(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle)} stroke-width={geometry.lineStyle.annotationMm} stroke-linecap={marking.textStyle?.font === "rounded" ? "round" : "butt"} stroke-linejoin={marking.textStyle?.font === "rounded" ? "round" : "miter"} />{/if}
        </g>
      {/each}
    </g>
    {#if project.showEngravingBorder}
      {#if project.cropShape === "circle"}<circle cx="0" cy="0" r={project.widthMm / 2} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{:else}<rect x={-project.widthMm / 2} y={-project.heightMm / 2} width={project.widthMm} height={project.heightMm} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{/if}
    {/if}
  </svg>
  <div class="engraving-legend"><span><i style:--sample-width={`${Math.max(1, geometry.lineStyle.contourMm * 5)}px`}></i> Minor contour</span><span><i class="index" style:--sample-width={`${Math.max(1, geometry.lineStyle.indexContourMm * 5)}px`}></i> Index every {project.engravingIndexInterval}</span><span>{project.engravingContourCount} contours</span></div>
</div>

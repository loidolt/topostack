<script lang="ts">
  import { displayElevation, elevationUnit, labelPathData, type GeometryIRV1 } from "@topostack/core";
  let { geometry, selectedLayer }: { geometry: GeometryIRV1; selectedLayer: number } = $props();
  const layer = $derived(geometry.layers[selectedLayer] ?? geometry.layers[0]);
  // Every sheet at or below the waterline sits under water, so the tint marks
  // which part of this sheet the basin covers.
  const submerged = $derived((geometry.waterSurfaces ?? []).filter((surface) => (layer?.index ?? 0) <= surface.layerIndex));
  function pathData(points: Array<{ x: number; y: number }>): string { return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" "); }
  function markingColor(marking: NonNullable<typeof layer>["markings"][number]): string {
    if (marking.operation === "score") return "#365c79";
    if (marking.transportationClass === "major-road") return "#24180f";
    if (marking.transportationClass === "local-road") return "#62442f";
    if (marking.transportationClass === "trail") return "#8a5e35";
    return "#2b2119";
  }
</script>

{#if layer}
  <div class="two-d-stage">
    <svg viewBox={`${-geometry.widthMm / 2 - 5} ${-geometry.heightMm / 2 - 5} ${geometry.widthMm + 10} ${geometry.heightMm + 10}`} role="img" aria-label={`Cut preview for layer ${layer.index + 1}`}>
      <defs><filter id="paper-shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" /></filter></defs>
      <g filter="url(#paper-shadow)">
        {#each layer.polygons as polygon}
          <g>
            <path d={`${pathData(polygon.outer)} Z ${polygon.holes.map((hole) => `${pathData(hole)} Z`).join(" ")}`} fill="#e7c391" stroke="none" fill-rule="evenodd" />
            <path d={`${pathData(polygon.outer)} Z`} fill="none" stroke="#ca5425" stroke-width="0.45" />
            {#each polygon.holes as hole}
              <path d={`${pathData(hole)} Z`} fill="none" stroke="#ca5425" stroke-width="0.45" />
            {/each}
          </g>
        {/each}
      </g>
      {#each submerged as surface (surface.id)}
        {#each surface.polygons as polygon}
          <path d={`${pathData(polygon.outer)} Z ${polygon.holes.map((hole) => `${pathData(hole)} Z`).join(" ")}`} fill="#7fb2cc" fill-opacity="0.38" stroke="none" fill-rule="evenodd" />
        {/each}
      {/each}
      {#each layer.markings as marking (marking.id)}
        <g data-marking-id={marking.id} data-marking-kind={marking.kind} data-transportation-class={marking.transportationClass}><path d={pathData(marking.points)} fill="none" stroke={markingColor(marking)} stroke-width="0.55" vector-effect="non-scaling-stroke" />{#if marking.label && marking.points[0]}<path d={labelPathData(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle)} fill="none" stroke={markingColor(marking)} stroke-width="0.2" stroke-linecap={marking.textStyle?.font === "rounded" ? "round" : "butt"} stroke-linejoin={marking.textStyle?.font === "rounded" ? "round" : "miter"} />{/if}</g>
      {/each}
    </svg>
    <div class="axis layer-elevation">{Math.round(displayElevation(layer.elevationM, geometry.units)).toLocaleString()} {elevationUnit(geometry.units)}</div>
  </div>
{/if}

<script lang="ts">
  import { Compass } from "@lucide/svelte";
  import { labelPathData, type GeometryIRV1 } from "@topostack/core";
  let { geometry, selectedLayer }: { geometry: GeometryIRV1; selectedLayer: number } = $props();
  const layer = $derived(geometry.layers[selectedLayer] ?? geometry.layers[0]);
  function pathData(points: Array<{ x: number; y: number }>): string { return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" "); }
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
      {#each layer.markings as marking (marking.id)}
        <g><path d={pathData(marking.points)} fill="none" stroke={marking.operation === "score" ? "#365c79" : "#2b2119"} stroke-width="0.55" vector-effect="non-scaling-stroke" />{#if marking.label && marking.points[0]}<path d={labelPathData(marking.label, marking.points[0])} fill="none" stroke="#2b2119" stroke-width="0.2" />{/if}</g>
      {/each}
    </svg>
    <div class="axis north-axis"><Compass size={13} /> N</div>
    <div class="axis layer-elevation">{Math.round(layer.elevationM).toLocaleString()} m</div>
  </div>
{/if}

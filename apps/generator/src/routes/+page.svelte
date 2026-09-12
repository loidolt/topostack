<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_PROJECT, generateGeometry, type GeometryIRV1 } from "@topostack/core";
  import { createSamplePreviewSource } from "../sample-preview";
  import App from "../app/App.svelte";
  import "../app/styles.css";

  let preview = $state.raw<GeometryIRV1>();
  let error = $state(false);
  onMount(() => {
    const source = createSamplePreviewSource();
    if (typeof Worker === "undefined") { preview = generateGeometry(DEFAULT_PROJECT, source); return; }
    const worker = new Worker(new URL("../geometry.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ result?: GeometryIRV1; error?: string }>) => {
      worker.terminate();
      if (event.data.result) preview = event.data.result;
      else error = true;
    };
    worker.onerror = () => { worker.terminate(); error = true; };
    worker.postMessage({ id: 0, config: DEFAULT_PROJECT, source });
    return () => worker.terminate();
  });
</script>

<svelte:head><title>TopoStack — Layered terrain for laser cutting</title></svelte:head>

{#if preview}
  <App initialPreview={preview} />
{:else}
  <main class="startup" aria-busy={!error}>
    <h1>Build the landscape.</h1>
    {#if error}<p role="alert">The preview could not load. Reload to try again.</p><button onclick={() => location.reload()}>Reload</button>
    {:else}<p role="status">Preparing your terrain preview…</p>{/if}
  </main>
{/if}

<style>
  .startup { min-height: 100dvh; display: grid; place-content: center; gap: 1rem; text-align: center; background: var(--loidolt-background, #161814); color: var(--loidolt-foreground, #e7e9e3); }
  h1, p { margin: 0; }
</style>

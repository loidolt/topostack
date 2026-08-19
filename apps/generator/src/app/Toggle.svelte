<script lang="ts">
  import type { Component } from "svelte";
  let { checked, label, icon: Icon, onChange }: { checked: boolean; label: string; icon: Component<{ size?: number }>; onChange: (checked: boolean) => void } = $props();
</script>

<label class="toggle-row"><span class="toggle-label"><Icon size={16} />{label}</span><input type="checkbox" {checked} onchange={(event) => onChange(event.currentTarget.checked)} /><span class="toggle-track"><span></span></span></label>

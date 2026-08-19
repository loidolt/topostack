<script lang="ts">
  let { label, value, suffix, min, max, step = 1, onChange }: { label: string; value: number; suffix: string; min: number; max: number; step?: number; onChange: (value: number) => void } = $props();
</script>

<label class="field-row">
  <span>{label}</span>
  <span class="number-input"><input type="number" {value} {min} {max} {step} oninput={(event) => { if (event.currentTarget.value !== "") onChange(Number(event.currentTarget.value)); }} /><em>{suffix}</em></span>
</label>

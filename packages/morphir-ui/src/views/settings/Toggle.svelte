<script lang="ts">
  let {
    checked,
    onChange,
    label,
  }: { checked: boolean; onChange: (value: boolean) => void; label: string } = $props()
</script>

<button
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  onclick={() => onChange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    width: 34px;
    height: 20px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    background: var(--dot);
    position: relative;
    transition: background 160ms ease;
  }
  .toggle.on {
    background: var(--accent);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--knob);
    transition: transform 160ms ease;
  }
  .toggle.on .knob {
    transform: translateX(14px);
  }
</style>

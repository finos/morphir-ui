<script lang="ts">
  import { xrayKindPresentation } from './xray-presentation.ts'

  type Props = { kind: string }

  let { kind }: Props = $props()
  const presentation = $derived(xrayKindPresentation(kind))
</script>

<span
  class="kind-badge"
  data-xray-kind={kind}
  data-kind-family={presentation.family}
  data-palette={presentation.palette}
  title={`${presentation.family} IR node`}
>
  <span class="kind-label">{presentation.label}</span>
  <span class="sr-only">{presentation.family} IR node</span>
</span>

<style>
  .kind-badge {
    --badge-color: var(--muted);

    display: inline-flex;
    align-items: center;
    min-height: 18px;
    padding: 1px 6px;
    border: 1px solid color-mix(in srgb, var(--badge-color) 55%, var(--panel-edge));
    border-radius: 999px;
    color: var(--text);
    background: color-mix(in srgb, var(--badge-color) 12%, var(--surface));
    font-size: 10px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.025em;
    white-space: nowrap;
  }

  .kind-badge[data-palette='violet'] {
    --badge-color: var(--accent2);
  }
  .kind-badge[data-palette='blue'] {
    --badge-color: var(--status-loading);
  }
  .kind-badge[data-palette='green'] {
    --badge-color: var(--status-ready);
  }
  .kind-badge[data-palette='amber'] {
    --badge-color: var(--status-stale);
  }
  .kind-badge[data-palette='magenta'] {
    --badge-color: var(--accent);
  }
  .kind-badge[data-palette='rose'] {
    --badge-color: var(--accent-text);
  }
  .kind-badge[data-palette='neutral'] {
    --badge-color: var(--muted);
  }
  .kind-badge[data-palette='red'] {
    --badge-color: var(--status-error);
  }

  .kind-badge[data-kind-family='unknown'],
  .kind-badge[data-kind-family='unrecognized'] {
    border-style: dashed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

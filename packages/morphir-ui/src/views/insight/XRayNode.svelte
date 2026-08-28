<script lang="ts">
  import XRayNode from './XRayNode.svelte'
  let { node, label = '' }: { node: unknown; label?: string } = $props()

  const isAstNode = (v: unknown): v is Record<string, unknown> & { kind: string } =>
    typeof v === 'object' && v !== null && 'kind' in v

  const children = $derived.by(() => {
    if (!isAstNode(node)) return []
    const out: { label: string; value: unknown }[] = []
    for (const [key, value] of Object.entries(node)) {
      if (key === 'kind' || key === 'attr' || key === 'raw' || key === 'tag') continue
      if (Array.isArray(value)) value.forEach((v, i) => out.push({ label: `${key}[${i}]`, value: v }))
      else if (isAstNode(value)) out.push({ label: key, value })
      else out.push({ label: key, value })
    }
    return out
  })
  const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
</script>

{#if isAstNode(node)}
  <details open class="xray-node">
    <summary>
      {#if label}<span class="label">{label}:</span>{/if}
      <span class="kind" class:unknown={node.kind === 'unknown'}>{node.kind}</span>
      {#if node.kind === 'unknown'}<span class="tag">{String(node['tag'])}</span><span class="raw-marker">raw unavailable in xray</span>{/if}
    </summary>
    <div class="children">
      {#each children as child (child.label)}
        {#if scalar(child.value) || Array.isArray(child.value)}
          <div class="scalar"><span class="label">{child.label}:</span> <span class="value">{JSON.stringify(child.value)}</span></div>
        {:else}
          <XRayNode node={child.value} label={child.label} />
        {/if}
      {/each}
    </div>
  </details>
{:else}
  <div class="scalar">{#if label}<span class="label">{label}:</span>{/if} <span class="value">{JSON.stringify(node)}</span></div>
{/if}

<style>
  .xray-node { font-family: var(--mono); font-size: 12.5px; }
  summary { cursor: pointer; padding: 1px 0; }
  .kind { color: var(--accent2); font-weight: 600; }
  .kind.unknown { color: var(--accent); }
  .tag { color: var(--muted); margin-left: 6px; }
  .raw-marker { color: var(--muted); margin-left: 6px; font-style: italic; }
  .label { color: var(--muted2); }
  .value { color: var(--text); }
  .children { padding-left: 18px; border-left: 1px solid var(--row-edge); margin-left: 4px; }
  .scalar { padding: 1px 0; font-family: var(--mono); font-size: 12.5px; }
</style>

<script lang="ts">
  import XRayNode from './XRayNode.svelte'
  let { node, label = '' }: { node: unknown; label?: string } = $props()

  const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

  // Plain records cover both AST nodes (tagged with `kind`) and the untagged pair-wrappers
  // the decoder produces for pattern-match cases, record/update-record fields, let-recursion
  // definitions, and the nested ValueDef under let-definition.definition. Both need to be
  // browsable — only the summary rendering (whether a `kind` badge is shown) differs.
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

  const isAstNode = (v: unknown): v is Record<string, unknown> & { kind: string } => isRecord(v) && 'kind' in v

  // Name is string[]; Path is Name[] (i.e. string[][]). Both should keep rendering inline
  // rather than exploding into a disclosure tree of single-string leaves.
  const isPrimitiveArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((el) => scalar(el) || isPrimitiveArray(el))

  const children = $derived.by(() => {
    if (!isRecord(node)) return []
    const out: { label: string; value: unknown }[] = []
    for (const [key, value] of Object.entries(node)) {
      if (key === 'kind' || key === 'attr' || key === 'raw' || key === 'tag') continue
      if (Array.isArray(value) && !isPrimitiveArray(value)) {
        value.forEach((v, i) => out.push({ label: `${key}[${i}]`, value: v }))
      } else {
        out.push({ label: key, value })
      }
    }
    return out
  })
</script>

{#if isRecord(node)}
  <details open class="xray-node">
    <summary>
      {#if label}<span class="label">{label}:</span>{/if}
      {#if isAstNode(node)}
        <span class="kind" class:unknown={node.kind === 'unknown'}>{node.kind}</span>
        {#if node.kind === 'unknown'}<span class="tag">{String(node['tag'])}</span><span class="raw-marker">raw unavailable in xray</span>{/if}
      {/if}
    </summary>
    <div class="children">
      {#each children as child (child.label)}
        {#if scalar(child.value) || isPrimitiveArray(child.value)}
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

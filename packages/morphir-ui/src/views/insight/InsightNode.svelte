<script lang="ts">
  import { getContext } from 'svelte'
  import type { ViewNode } from '@morphir/insight'
  import { nameToCamel, pathToTitle, type FQName, type MorphirLibrary } from '@morphir/ir'
  import InsightNode from './InsightNode.svelte'
  import ChainNode from './nodes/ChainNode.svelte'
  import FractionNode from './nodes/FractionNode.svelte'
  import IfTreeNode from './nodes/IfTreeNode.svelte'
  import TableNode from './nodes/TableNode.svelte'
  import ReferenceNode from './nodes/ReferenceNode.svelte'
  import type { InspectMeta } from './insight-context.ts'
  import { INSPECT_KEY, LIBRARY_KEY } from './insight-context.ts'

  let { node }: { node: ViewNode } = $props()

  const onInspect = getContext<((meta: InspectMeta) => void) | undefined>(INSPECT_KEY)
  const getLibrary = getContext<(() => MorphirLibrary) | undefined>(LIBRARY_KEY)

  const fqnText = (fqn: FQName) => `${pathToTitle(fqn.pkg)}.${pathToTitle(fqn.module)}.${nameToCamel(fqn.local)}`
  const findDoc = (fqn: FQName): string | undefined => {
    for (const m of getLibrary?.()?.modules ?? []) {
      if (pathToTitle(m.path) !== pathToTitle(fqn.module)) continue
      for (const e of m.values) if (nameToCamel(e.name) === nameToCamel(fqn.local)) return e.doc ?? undefined
    }
    return undefined
  }
  // Spread onto each dispatch target's root element to report it to the shell inspector.
  // Deliberately NOT given an interactive role/tabindex: several dispatch targets (notably
  // v-reference, whose display name is its OWN <button>) already contain real interactive
  // children, and layering a second `role="button"` around them breaks accessible-name
  // uniqueness (and this ReferenceNode contract's button query) rather than helping it.
  const selectProps = (kindLabel: string, fqn?: string, doc?: string) => ({
    onclick: (e: MouseEvent) => {
      e.stopPropagation()
      onInspect?.({ kindLabel, fqn, doc })
    }
  })
</script>

{#if node.kind === 'v-literal'}
  <span class="lit" class:accent={node.literalKind !== 'bool' && node.literalKind !== 'char'} {...selectProps(node.kind)}>{node.text}</span>
{:else if node.kind === 'v-variable'}
  <span class="var" {...selectProps(node.kind)}>{node.name}</span>
{:else if node.kind === 'v-unit'}
  <span class="unit" {...selectProps(node.kind)}>()</span>
{:else if node.kind === 'v-unknown'}
  <span class="unknown-chip" {...selectProps(node.kind)}>⚠ {node.tag}</span>
{:else if node.kind === 'v-field-access'}
  <span class="inline" {...selectProps(node.kind)}><InsightNode node={node.subject} />.<span class="field">{node.field}</span></span>
{:else if node.kind === 'v-prefix-call'}
  <span class="inline" {...selectProps(node.kind)}><span class="label">{node.label}</span>{#if node.args.length}(<!--
  -->{#each node.args as a, i (i)}{#if i > 0}, {/if}<InsightNode node={a} />{/each}<!--
  -->){/if}</span>
{:else if node.kind === 'v-binary-op'}
  <span class="inline" {...selectProps(node.kind)}><InsightNode node={node.left} /> <span class="op">{node.symbol}</span> <InsightNode node={node.right} /></span>
{:else if node.kind === 'v-power'}
  <span class="inline" {...selectProps(node.kind)}><InsightNode node={node.base} /><sup><InsightNode node={node.exponent} /></sup></span>
{:else if node.kind === 'v-member-of'}
  <span class="inline" {...selectProps(node.kind)}><InsightNode node={node.item} /> is one of [<!--
  -->{#each node.options as o, i (i)}{#if i > 0}, {/if}<InsightNode node={o} />{/each}<!--
  -->]</span>
{:else if node.kind === 'v-record' || node.kind === 'v-update-record'}
  <span class="record-wrap" {...selectProps(node.kind)}>
    {#if node.kind === 'v-update-record'}<InsightNode node={node.subject} /> with{/if}
    <dl class="record">
      {#each node.fields as f (f.name)}
        <dt>{f.name}</dt><dd><InsightNode node={f.value} /></dd>
      {/each}
    </dl>
  </span>
{:else if node.kind === 'v-list' || node.kind === 'v-tuple'}
  {@const items = node.kind === 'v-list' ? node.items : node.elements}
  <span class="inline" {...selectProps(node.kind)}>{node.kind === 'v-list' ? '[' : '('}<!--
  -->{#each items as item, i (i)}{#if i > 0}, {/if}<InsightNode node={item} />{/each}<!--
  -->{node.kind === 'v-list' ? ']' : ')'}</span>
{:else if node.kind === 'v-lambda'}
  <span class="inline" {...selectProps(node.kind)}><span class="pattern">{node.pattern}</span> <span class="op">→</span> <InsightNode node={node.body} /></span>
{:else if node.kind === 'v-let-group'}
  <div class="let-group" {...selectProps(node.kind)}>
    {#each node.bindings as b (b.name)}
      <div class="binding"><span class="bname">{b.name}</span> <span class="op">=</span> <InsightNode node={b.value} /></div>
    {/each}
    <div class="let-body"><InsightNode node={node.body} /></div>
  </div>
{:else if node.kind === 'v-constructor'}
  <span class="inline" {...selectProps(node.kind)}><span class="ctor">{node.name}</span>{#if node.args.length}(<!--
  -->{#each node.args as a, i (i)}{#if i > 0}, {/if}<InsightNode node={a} />{/each}<!--
  -->){/if}</span>
{:else if node.kind === 'v-pipeline'}
  <span class="inline" {...selectProps(node.kind)}><InsightNode node={node.input} />{#each node.stages as s, i (i)} <span class="op">▸</span> <span class="label">{s.label}</span> <InsightNode node={s.arg} />{/each}</span>
{:else if node.kind === 'v-arith-chain' || node.kind === 'v-logic-chain'}
  <ChainNode {node} render={renderChild} />
{:else if node.kind === 'v-fraction'}
  <FractionNode {node} render={renderChild} />
{:else if node.kind === 'v-if-tree'}
  <IfTreeNode {node} render={renderChild} />
{:else if node.kind === 'v-decision-table'}
  <TableNode {node} render={renderChild} />
{:else if node.kind === 'v-reference'}
  <span {...selectProps(node.display, fqnText(node.fqn), findDoc(node.fqn))}>
    <ReferenceNode {node} render={renderChild} />
  </span>
{/if}

{#snippet renderChild(n: ViewNode)}
  <InsightNode node={n} />
{/snippet}

<style>
  .lit { font-family: var(--mono); font-size: 12.5px; }
  .lit.accent { color: var(--accent-text); }
  .var { font-style: italic; font-size: 12.5px; }
  .unit { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }
  .unknown-chip { font-size: 11px; color: var(--accent-text); background: rgba(214, 64, 159, 0.14); border-radius: 6px; padding: 1px 6px; }
  .inline { font-size: 12.5px; }
  .field, .label, .ctor { color: var(--accent2); }
  .op { font-family: var(--mono); color: var(--muted); }
  .record { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 2px 0 2px 10px; font-size: 12.5px; }
  .record dt { color: var(--muted2); }
  .let-group { font-size: 12.5px; }
  .binding { padding: 1px 0 1px 10px; }
  .bname { color: var(--accent2); }
  .let-body { margin-top: 2px; }
</style>

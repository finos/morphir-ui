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

  const fqnText = (fqn: FQName) =>
    `${pathToTitle(fqn.pkg)}.${pathToTitle(fqn.module)}.${nameToCamel(fqn.local)}`
  const findDoc = (fqn: FQName): string | undefined => {
    for (const m of getLibrary?.()?.modules ?? []) {
      if (pathToTitle(m.path) !== pathToTitle(fqn.module)) continue
      for (const e of m.values)
        if (nameToCamel(e.name) === nameToCamel(fqn.local)) return e.doc ?? undefined
    }
    return undefined
  }
  // Spread onto each dispatch target's root element to report it to the shell inspector.
  // Keyboard-accessible: role="button" + tabindex so the selection affordance is reachable
  // without a mouse, with Enter/Space activating it like a native button would.
  const select = (kindLabel: string, fqn?: string, doc?: string) => (e: Event) => {
    e.stopPropagation()
    onInspect?.({ kindLabel, fqn, doc })
  }
  // aria-label pins the accessible name to `kindLabel` instead of letting it fall back to
  // "name from content": composite wrappers (if-tree, decision-table, ...) can contain a
  // nested v-reference <button>, and without an explicit label the wrapper's content-derived
  // name would include that button's text, colliding with `getByRole('button', { name })`
  // queries for the reference itself.
  const selectProps = (kindLabel: string, fqn?: string, doc?: string) => ({
    role: 'button' as const,
    tabindex: 0,
    'aria-label': kindLabel,
    onclick: select(kindLabel, fqn, doc),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') select(kindLabel, fqn, doc)(e)
      else if (e.key === ' ') {
        e.preventDefault() // stop the page from scrolling when Space activates selection
        select(kindLabel, fqn, doc)(e)
      }
    },
  })
  // v-reference is the one exception: its display name is already its OWN real <button>
  // (see ReferenceNode) that's keyboard-accessible for expand/collapse. Layering a SECOND
  // `role="button"` + tabindex around it would nest two interactive elements with
  // overlapping accessible names, which breaks ReferenceNode's own button-role query — so
  // this wrapper stays mouse-only and deliberately un-focusable.
  const referenceSelectProps = (kindLabel: string, fqn?: string, doc?: string) => ({
    onclick: select(kindLabel, fqn, doc),
  })
</script>

{#if node.kind === 'v-literal'}
  <span
    class="lit"
    class:accent={node.literalKind !== 'bool' && node.literalKind !== 'char'}
    {...selectProps(node.kind)}>{node.text}</span
  >
{:else if node.kind === 'v-variable'}
  <span class="var" {...selectProps(node.kind)}>{node.name}</span>
{:else if node.kind === 'v-unit'}
  <span class="unit" {...selectProps(node.kind)}>()</span>
{:else if node.kind === 'v-unknown'}
  <span class="unknown-chip" {...selectProps(node.kind)}>⚠ {node.tag}</span>
{:else if node.kind === 'v-field-access'}
  <span class="inline" {...selectProps(node.kind)}
    ><InsightNode node={node.subject} /><span class="punctuation">.</span><span class="field"
      >{node.field}</span
    ></span
  >
{:else if node.kind === 'v-prefix-call'}
  <span class="inline" {...selectProps(node.kind)}
    ><span class="label">{node.label}</span
    >{#if node.args.length}<span class="punctuation grouping">(</span><!--
  -->{#each node.args as a, i (i)}{#if i > 0}<span class="punctuation">,</span>
        {/if}<InsightNode node={a} />{/each}<!--
  --><span class="punctuation grouping">)</span>{/if}</span
  >
{:else if node.kind === 'v-binary-op'}
  <span class="inline" {...selectProps(node.kind)}
    ><InsightNode node={node.left} /> <span class="op">{node.symbol}</span>
    <InsightNode node={node.right} /></span
  >
{:else if node.kind === 'v-power'}
  <span class="inline" {...selectProps(node.kind)}
    ><InsightNode node={node.base} /><sup><InsightNode node={node.exponent} /></sup></span
  >
{:else if node.kind === 'v-member-of'}
  <span class="inline" {...selectProps(node.kind)}
    ><InsightNode node={node.item} /> is one of [<!--
  -->{#each node.options as o, i (i)}{#if i > 0}<span class="punctuation">,</span>
      {/if}<InsightNode node={o} />{/each}<!--
  -->]</span
  >
{:else if node.kind === 'v-record' || node.kind === 'v-update-record'}
  <span class="record-wrap" {...selectProps(node.kind)}>
    {#if node.kind === 'v-update-record'}<InsightNode node={node.subject} /> with{/if}
    <dl class="record">
      {#each node.fields as f (f.name)}
        <dt>{f.name}</dt>
        <dd><InsightNode node={f.value} /></dd>
      {/each}
    </dl>
  </span>
{:else if node.kind === 'v-list' || node.kind === 'v-tuple'}
  {@const items = node.kind === 'v-list' ? node.items : node.elements}
  <span class="inline" {...selectProps(node.kind)}
    ><span class="punctuation grouping">{node.kind === 'v-list' ? '[' : '('}</span><!--
  -->{#each items as item, i (i)}{#if i > 0}<span class="punctuation">,</span>
      {/if}<InsightNode node={item} />{/each}<!--
  --><span class="punctuation grouping">{node.kind === 'v-list' ? ']' : ')'}</span></span
  >
{:else if node.kind === 'v-lambda'}
  <span class="inline" {...selectProps(node.kind)}
    ><span class="pattern">{node.pattern}</span> <span class="op">→</span>
    <InsightNode node={node.body} /></span
  >
{:else if node.kind === 'v-let-group'}
  <div class="let-group" {...selectProps(node.kind)}>
    {#each node.bindings as b (b.name)}
      <div class="binding">
        <span class="bname">{b.name}</span> <span class="op">=</span>
        <InsightNode node={b.value} />
      </div>
    {/each}
    <div class="let-body"><InsightNode node={node.body} /></div>
  </div>
{:else if node.kind === 'v-constructor'}
  <span class="inline" {...selectProps(node.kind)}
    ><span class="ctor">{node.name}</span
    >{#if node.args.length}<span class="punctuation grouping">(</span><!--
  -->{#each node.args as a, i (i)}{#if i > 0}<span class="punctuation">,</span>
        {/if}<InsightNode node={a} />{/each}<!--
  --><span class="punctuation grouping">)</span>{/if}</span
  >
{:else if node.kind === 'v-pipeline'}
  <span class="inline" {...selectProps(node.kind)}
    ><InsightNode node={node.input} />{#each node.stages as s, i (i)}
      <span class="op">▸</span> <span class="label">{s.label}</span>
      <InsightNode node={s.arg} />{/each}</span
  >
{:else if node.kind === 'v-arith-chain' || node.kind === 'v-logic-chain'}
  <span {...selectProps(node.kind)}><ChainNode {node} render={renderChild} /></span>
{:else if node.kind === 'v-fraction'}
  <span {...selectProps(node.kind)}><FractionNode {node} render={renderChild} /></span>
{:else if node.kind === 'v-if-tree'}
  <div {...selectProps(node.kind)}><IfTreeNode {node} render={renderChild} /></div>
{:else if node.kind === 'v-decision-table'}
  <div {...selectProps(node.kind)}><TableNode {node} render={renderChild} /></div>
{:else if node.kind === 'v-reference'}
  <span {...referenceSelectProps(node.display, fqnText(node.fqn), findDoc(node.fqn))}>
    <ReferenceNode {node} render={renderChild} />
  </span>
{/if}

{#snippet renderChild(n: ViewNode)}
  <InsightNode node={n} />
{/snippet}

<style>
  .lit {
    font-family: var(--mono);
    font-weight: 560;
  }
  .lit.accent {
    color: var(--accent-text);
    border-bottom: 1px dotted var(--accent-text);
  }
  .var {
    font-style: italic;
    font-weight: 600;
  }
  .unit {
    font-family: var(--mono);
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .unknown-chip {
    font-size: 0.82em;
    color: var(--accent-text);
    background: var(--panel);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 1px 6px;
    font-weight: 650;
  }
  .field,
  .ctor {
    font-family: var(--mono);
    font-weight: 650;
  }
  .field,
  .label,
  .ctor {
    color: var(--accent2);
  }
  .label {
    font-family: var(--mono);
    font-weight: 600;
  }
  .op {
    font-family: var(--mono);
    color: var(--muted);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .punctuation {
    font-family: var(--mono);
    color: var(--muted2);
    font-size: 0.9em;
  }
  .grouping {
    font-weight: 700;
  }
  .record {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    margin: 2px 0 2px 10px;
  }
  .record dt {
    font-family: var(--mono);
    color: var(--muted2);
    font-size: 0.85em;
  }
  .binding {
    padding: 1px 0 1px 10px;
  }
  .bname {
    color: var(--accent2);
  }
  .let-body {
    margin-top: 2px;
  }
  :global([role='button']:focus-visible) {
    outline: 2px solid var(--accent2);
    outline-offset: 3px;
    border-radius: 4px;
  }
</style>

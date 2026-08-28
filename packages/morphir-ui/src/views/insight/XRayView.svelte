<script lang="ts">
  import XRayNode from './XRayNode.svelte'
  import { decodeTypeExpr, type ValueDef } from '@morphir/ir'
  let { def = null, typeRaw = undefined }: { def?: ValueDef | null; typeRaw?: unknown } = $props()
</script>

{#if typeRaw !== undefined}
  <XRayNode node={decodeTypeExpr(typeRaw)} />
{:else if def}
  <div class="section">inputs</div>
  {#each def.inputs as input (JSON.stringify(input.name))}
    <XRayNode node={input.tpe} label={input.name.join('-')} />
  {/each}
  <div class="section">output</div>
  <XRayNode node={def.output} />
  <div class="section">body</div>
  <XRayNode node={def.body} />
{:else}
  <p class="empty">This definition could not be decoded.</p>
{/if}

<style>
  .section {
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted2); margin: 10px 0 4px 0;
  }
  .empty { color: var(--muted); font-size: 13px; }
</style>

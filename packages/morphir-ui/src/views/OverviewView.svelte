<script lang="ts">
  import type { ModelWorkbenchData } from '../workbench/types.ts'
  let { model }: { model: ModelWorkbenchData } = $props()
</script>

<section class="card">
  <h2 class="card-title">Model Workbench</h2>
  <div class="row">
    <span class="label">Source</span><span class="value">{model.descriptor.source}</span>
  </div>
  <div class="row">
    <span class="label">Distribution</span><span class="value"
      >{model.descriptor.distribution === 'single-file' ? 'Single file' : 'Document Tree'}</span
    >
  </div>
  {#if model.ir}
    <div class="row">
      <span class="label">Package</span><span class="value">{model.ir.package.name}</span>
    </div>
    <div class="row">
      <span class="label">Modules</span><span class="value">{model.ir.package.moduleCount}</span>
    </div>
  {/if}
</section>

{#if model.manifest}
  <section class="card">
    <h2 class="card-title">Document Tree Manifest</h2>
    <pre>{JSON.stringify(model.manifest, null, 2)}</pre>
  </section>
{/if}

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
  }
  .card-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
    margin-bottom: 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--row-edge);
  }
  .label {
    color: var(--muted);
  }
  .value {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--accent-text);
  }
  pre {
    margin: 0;
    overflow: auto;
    font: 12px/1.5 var(--mono);
    color: var(--nav);
  }
</style>

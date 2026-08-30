<script lang="ts">
  import type { DevelopmentWorkbenchData } from '../workbench/types.ts'
  import { sourceKey } from '@morphir/workspace'
  let { workbench }: { workbench: DevelopmentWorkbenchData } = $props()
</script>

<section class="card wide">
  <h2>Development Workbench</h2>
  <dl>
    <dt>Root</dt>
    <dd>{workbench.descriptor.source.displayName} ({workbench.descriptor.source.providerId})</dd>
    <dt>Configuration anchor</dt>
    <dd>{workbench.snapshot.configAnchor ?? 'No project configuration found'}</dd>
  </dl>
</section>
<section class="card">
  <h2>Models</h2>
  {#each workbench.snapshot.modelSources as source (sourceKey(source))}<div class="source">
      {source.displayName}
    </div>{:else}<p>No model sources discovered.</p>{/each}
</section>
<section class="card">
  <h2>Knowledge bases</h2>
  {#each workbench.snapshot.knowledgeBaseSources as source (sourceKey(source))}<div class="source">
      {source.displayName}
    </div>{:else}<p>No knowledge-base sources discovered.</p>{/each}
</section>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  h2 {
    margin: 0 0 12px;
    color: var(--muted2);
    font: 600 10px var(--mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 8px 18px;
    margin: 0;
  }
  dt,
  p {
    color: var(--muted);
  }
  dd,
  .source {
    margin: 0;
    color: var(--accent-text);
    font: 12.5px var(--mono);
    overflow-wrap: anywhere;
  }
</style>

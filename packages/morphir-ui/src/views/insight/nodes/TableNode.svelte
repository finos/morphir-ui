<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ViewNode } from '@morphir/insight'

  let {
    node,
    render,
  }: { node: Extract<ViewNode, { kind: 'v-decision-table' }>; render: Snippet<[ViewNode]> } =
    $props()

  const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']
  const suffixFor = (i: number) => CIRCLED[i] ?? `[${i}]`
  // Task 7's column-arity fallback repeats the SAME subject node per column when the case
  // patterns are tuple-shaped but the match subject isn't a literal tuple expression (e.g.
  // `tupleCase`'s `pair`), so every header looks identical. Disambiguate with a positional
  // suffix ONLY when every header is structurally the same node; genuinely distinct headers
  // are left alone.
  const columnsIdentical = $derived(
    node.columns.length > 1 &&
      node.columns.every((c) => JSON.stringify(c) === JSON.stringify(node.columns[0])),
  )
</script>

<table class="decision-table">
  <thead>
    <tr>
      {#each node.columns as col, i (i)}
        <th
          >{@render render(col)}{#if columnsIdentical}<span class="suffix">{suffixFor(i)}</span
            >{/if}</th
        >
      {/each}
      <th class="result-head">result</th>
    </tr>
  </thead>
  <tbody>
    {#each node.rows as row, r (r)}
      <tr>
        {#each row.cells as cell, c (c)}
          <td>
            {#if cell.kind === 'cell-wildcard'}
              <span class="wildcard">anything else</span>
            {:else if cell.kind === 'cell-missing'}
              <span class="missing">—</span>
            {:else if cell.kind === 'cell-unsupported'}
              <span class="unsupported">⟨{cell.patternKind}⟩</span>
            {:else}
              {cell.text}
            {/if}
          </td>
        {/each}
        <td class="result">{@render render(row.result)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .decision-table {
    border-collapse: collapse;
  }
  th,
  td {
    padding: 4px 10px;
    border: 1px solid var(--row-edge);
    text-align: left;
  }
  th {
    font-weight: 600;
    color: var(--muted2);
    font-size: 11px;
    text-transform: uppercase;
  }
  .suffix {
    color: var(--muted2);
    margin-left: 3px;
  }
  .wildcard {
    font-style: italic;
    color: var(--muted);
  }
  .missing {
    color: var(--muted2);
  }
  .unsupported {
    color: var(--accent-text);
  }
  .result-head {
    color: var(--accent2);
  }
</style>

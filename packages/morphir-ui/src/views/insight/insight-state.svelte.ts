import { SvelteSet } from 'svelte/reactivity'

/** Tracks which drill-down references the user has toggled open, plus the currently
 * selected node (for the shell inspector — see Step 3b). */
export class InsightState {
  readonly expanded = new SvelteSet<string>()
  selectedKey: string | null = $state(null)

  toggle(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key)
    else this.expanded.add(key)
  }

  select(key: string | null): void {
    this.selectedKey = key
  }
}

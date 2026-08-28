import { SvelteSet } from 'svelte/reactivity'

/** Tracks which drill-down references the user has toggled open. */
export class InsightState {
  readonly expanded = new SvelteSet<string>()

  toggle(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key)
    else this.expanded.add(key)
  }
}

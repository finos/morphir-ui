import { SvelteSet } from 'svelte/reactivity'
import type { XRaySearchScope } from './xray-tree.ts'

/** Holds the user's XRay filters, selection, and manual expansion choices. */
export class XRayState {
  query = $state('')
  readonly scopes = new SvelteSet<XRaySearchScope>()
  readonly manualExpanded: SvelteSet<string>
  selectedPath = $state<string | null>(null)

  constructor(manualExpanded: Iterable<string> = [], selectedPath: string | null = null) {
    this.manualExpanded = new SvelteSet(manualExpanded)
    this.selectedPath = selectedPath
  }

  toggle(path: string): void {
    if (this.manualExpanded.has(path)) this.manualExpanded.delete(path)
    else this.manualExpanded.add(path)
  }

  selectScope(scope: XRaySearchScope): void {
    if (this.scopes.size === 0) {
      this.scopes.add(scope)
    } else if (this.scopes.has(scope)) {
      this.scopes.delete(scope)
    } else {
      this.scopes.add(scope)
    }
  }

  selectAllScopes(): void {
    this.scopes.clear()
  }

  expandedWith(searchExpanded: ReadonlySet<string>): ReadonlySet<string> {
    return new SvelteSet([...this.manualExpanded, ...searchExpanded])
  }

  expandAll(paths: Iterable<string>): void {
    for (const path of paths) this.manualExpanded.add(path)
  }

  collapseAll(paths: Iterable<string>): void {
    for (const path of paths) this.manualExpanded.delete(path)
  }

  select(path: string | null): void {
    this.selectedPath = path
  }

  clearFilters(): void {
    this.query = ''
    this.selectAllScopes()
  }
}

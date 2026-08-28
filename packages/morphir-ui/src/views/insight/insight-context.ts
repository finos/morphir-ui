// Svelte context keys shared between InsightView and its node components. InsightView is the
// single provider (setContext) for all three; every node component only consumes (getContext).
export const TOGGLE_KEY = 'insight-toggle'
export const INSPECT_KEY = 'insight-inspect'
export const LIBRARY_KEY = 'insight-library'

/** Passed to the shell inspector when a rendered node is clicked (Step 3b). */
export interface InspectMeta {
  readonly kindLabel: string
  readonly fqn?: string
  readonly doc?: string
}

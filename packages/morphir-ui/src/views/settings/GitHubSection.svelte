<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import type { AppServices, GitHubStatus } from '../../services/services.ts'
  let { services }: { services: AppServices } = $props()
  const github = services.github!

  let status = $state<GitHubStatus | null>(null)
  let patSelected = $state(false)
  let pat = $state('')
  let verifyResult = $state<string | null>(null)
  let error = $state<string | null>(null)

  const refresh = async () => (status = await github.status())
  $effect(() => {
    void refresh()
  })
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

  async function selectSource(source: 'none' | 'gh-cli') {
    error = null
    verifyResult = null
    patSelected = false
    try {
      await github.setSource(source)
      await refresh()
    } catch (e) {
      error = message(e)
    }
  }
  async function saveToken() {
    error = null
    try {
      await github.savePat(pat)
      pat = ''
      await refresh()
    } catch (e) {
      error = message(e)
    }
  }
  async function verify() {
    error = null
    try {
      verifyResult = `Authenticated as ${(await github.verify()).login}`
    } catch (e) {
      error = message(e)
    }
  }
  async function remove() {
    error = null
    verifyResult = null
    try {
      await github.clearPat()
      await refresh()
    } catch (e) {
      error = message(e)
    }
  }
</script>

<SettingsRow label="Token source" description="Exactly one source is active — no fallback chain.">
  {#snippet trailing()}
    <label
      ><input
        type="radio"
        checked={status?.source === 'none' && !patSelected}
        onchange={() => selectSource('none')}
      /> None</label
    >
    <label
      ><input
        type="radio"
        checked={status?.source === 'gh-cli'}
        onchange={() => selectSource('gh-cli')}
      /> gh CLI</label
    >
    <label>
      <input
        type="radio"
        checked={status?.source === 'pat' || patSelected}
        onchange={() => (patSelected = true)}
      /> Personal access token
    </label>
  {/snippet}
</SettingsRow>

{#if patSelected || status?.source === 'pat'}
  <SettingsRow
    label="Personal access token"
    description="Stored encrypted in the OS keychain. Never written to config or logs."
  >
    {#snippet trailing()}
      <input class="pat" type="password" placeholder="ghp_… or github_pat_…" bind:value={pat} />
      <button class="action" onclick={saveToken} disabled={pat.trim().length === 0}
        >Save token</button
      >
    {/snippet}
  </SettingsRow>
{/if}

{#if status?.tokenDisplay}
  <SettingsRow label="Stored token" description="Only the redacted form is ever displayed.">
    {#snippet trailing()}
      <span>{status?.tokenDisplay}</span>
      <button class="action" onclick={remove}>Remove</button>
    {/snippet}
  </SettingsRow>
{/if}

<SettingsRow label="Verification" description="Calls GET /user with the active source.">
  {#snippet trailing()}
    <button class="action" onclick={verify}>Verify</button>
    {#if verifyResult}<span class="ok">{verifyResult}</span>{/if}
    {#if error}<span class="err">{error}</span>{/if}
  {/snippet}
</SettingsRow>

<style>
  .pat {
    width: 260px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--code-bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .action {
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--hover-soft);
    color: var(--text);
    cursor: pointer;
    font-size: 12.5px;
  }
  .action:hover {
    background: var(--hover);
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
    font-family: var(--sans, inherit);
    font-size: 13px;
  }
  .ok {
    color: var(--accent2);
  }
  .err {
    color: var(--accent);
  }
</style>

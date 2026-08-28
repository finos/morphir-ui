<script lang="ts" module>
  export type IconName = 'sidebar' | 'panelRight' | 'panelBottom' | 'gear' | 'back' | 'restore'
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props()
</script>

{#if name === 'sidebar'}
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <rect
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      x="3"
      y="3"
      width="18"
      height="18"
      rx="3"
    />
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="9.5"
      y1="3"
      x2="9.5"
      y2="21"
    />
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="5.5"
      y1="8"
      x2="7"
      y2="8"
    />
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="5.5"
      y1="12"
      x2="7"
      y2="12"
    />
  </svg>
{:else if name === 'panelRight'}
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <rect
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      x="3"
      y="3"
      width="18"
      height="18"
      rx="3"
    />
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="14.5"
      y1="3"
      x2="14.5"
      y2="21"
    />
  </svg>
{:else if name === 'panelBottom'}
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <rect
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      x="3"
      y="3"
      width="18"
      height="18"
      rx="3"
    />
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="3"
      y1="14.5"
      x2="21"
      y2="14.5"
    />
  </svg>
{:else if name === 'gear'}
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="2.0"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
    />
    <circle fill="none" stroke="currentColor" stroke-width="2.0" cx="12" cy="12" r="3" />
  </svg>
{:else if name === 'back'}
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <line
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      x1="19"
      y1="12"
      x2="5"
      y2="12"
    />
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 19l-7-7 7-7"
    />
  </svg>
{:else}
  <!-- restore renders at 15×15 in morphir-scala — keep it. -->
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3 12a9 9 0 1 0 3-6.7L3 8"
    />
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3 3v5h5"
    />
  </svg>
{/if}

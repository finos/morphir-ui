<script lang="ts">
  import Icon from '../icons/Icon.svelte'
  import type { NavItem } from './nav.ts'
  let {
    navItems,
    activeNav,
    onNavSelect,
    onOpenSettings,
  }: {
    navItems: NavItem[]
    activeNav: string
    onNavSelect: (id: string) => void
    onOpenSettings: () => void
  } = $props()
</script>

<nav class="sidebar">
  <div class="nav-section">Workspace</div>
  {#each navItems as item (item.id)}
    <button
      class="nav-item"
      class:active={item.id === activeNav}
      onclick={() => onNavSelect(item.id)}
    >
      <span class="nav-dot"></span>{item.label}
    </button>
  {/each}
  <div class="sidebar-foot">
    <button class="icon-btn" id="settings-button" onclick={onOpenSettings} title="Settings">
      <Icon name="gear" />
    </button>
  </div>
</nav>

<style>
  .sidebar {
    width: 224px;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 6px 12px 18px 12px;
    overflow: hidden;
  }
  .nav-section {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
    padding: 16px 10px 6px 10px;
    text-align: left;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    margin: 1px 0;
    border-radius: 8px;
    color: var(--nav);
    font-weight: 500;
    font-size: 14px;
    background: none;
    border: none;
    text-align: left;
    width: 100%;
    -webkit-app-region: no-drag;
  }
  .nav-item:hover {
    background: var(--hover-soft);
    color: var(--text);
  }
  .nav-item.active {
    background: linear-gradient(
      to right,
      rgba(214, 64, 159, 0.16) 0%,
      rgba(139, 92, 246, 0.1) 100%
    );
    color: var(--text-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .nav-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dot);
    flex-shrink: 0;
  }
  .nav-item.active .nav-dot {
    background: var(--accent);
  }
  .sidebar-foot {
    margin: auto 0 0 0;
    padding: 6px 4px 0 4px;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--hover);
    color: var(--text);
  }
</style>

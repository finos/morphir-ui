<script lang="ts">
  let {
    name,
    message,
    actionLabel = 'Retry',
    onRetry,
  }: { name: string; message: string; actionLabel?: string; onRetry: () => void } = $props()
</script>

<section class="error-card" role="alert">
  <h2>Could not load {name}</h2>
  <p>{message}</p>
  <button type="button" onclick={onRetry}>{actionLabel}</button>
</section>

<style>
  .error-card {
    grid-column: 1 / -1;
    max-width: 680px;
    padding: 20px;
    border: 1px solid var(--panel-edge);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    background: var(--panel);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--text-strong);
  }
  p {
    color: var(--muted);
  }
  button {
    padding: 7px 14px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    background: var(--hover-soft);
    color: var(--text);
    cursor: pointer;
  }
</style>

<script lang="ts">
  let {
    edge,
    currentSize,
    onResize,
  }: { edge: 'left' | 'right' | 'bottom'; currentSize: number; onResize: (px: number) => void } =
    $props()
  let start = 0
  let startSize = 0

  function down(e: PointerEvent) {
    start = edge !== 'bottom' ? e.clientX : e.clientY
    startSize = currentSize
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add(edge !== 'bottom' ? 'resizing-col' : 'resizing-row')
  }
  function move(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const delta = (edge !== 'bottom' ? e.clientX : e.clientY) - start
    onResize(edge === 'left' ? startSize + delta : startSize - delta)
  }
  function up(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing-col', 'resizing-row')
  }
</script>

<div
  class="resize-handle {edge !== 'bottom' ? 'resize-vertical' : 'resize-horizontal'}"
  role="separator"
  aria-orientation={edge !== 'bottom' ? 'vertical' : 'horizontal'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
></div>

<style>
  .resize-handle {
    flex: 0 0 5px;
    align-self: stretch;
  }
  .resize-vertical {
    cursor: col-resize;
  }
  .resize-horizontal {
    cursor: row-resize;
  }
  .resize-handle:hover {
    background: var(--edge);
  }
</style>

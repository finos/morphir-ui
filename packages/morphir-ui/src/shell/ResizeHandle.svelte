<script lang="ts">
  let {
    edge,
    currentSize,
    onResize,
    label = 'Resize panel',
  }: {
    edge: 'left' | 'right' | 'bottom'
    currentSize: number
    onResize: (px: number) => void
    label?: string
  } = $props()
  let start = 0
  let startSize = 0
  let separator: HTMLElement | undefined = $state()
  let activePointerId: number | null = null

  function cleanupDrag() {
    const pointerId = activePointerId
    activePointerId = null
    document.body.classList.remove('resizing-col', 'resizing-row')
    if (pointerId !== null && separator?.hasPointerCapture(pointerId)) {
      separator.releasePointerCapture(pointerId)
    }
  }

  $effect(() => cleanupDrag)

  function down(e: PointerEvent) {
    cleanupDrag()
    start = edge !== 'bottom' ? e.clientX : e.clientY
    startSize = currentSize
    separator = e.currentTarget as HTMLElement
    activePointerId = e.pointerId
    separator.setPointerCapture(e.pointerId)
    document.body.classList.add(edge !== 'bottom' ? 'resizing-col' : 'resizing-row')
  }
  function move(e: PointerEvent) {
    if (activePointerId !== e.pointerId || !separator?.hasPointerCapture(e.pointerId)) return
    const delta = (edge !== 'bottom' ? e.clientX : e.clientY) - start
    onResize(edge === 'left' ? startSize + delta : startSize - delta)
  }
</script>

<div
  bind:this={separator}
  class="resize-handle {edge !== 'bottom' ? 'resize-vertical' : 'resize-horizontal'}"
  role="separator"
  aria-label={label}
  aria-orientation={edge !== 'bottom' ? 'vertical' : 'horizontal'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={cleanupDrag}
  onpointercancel={cleanupDrag}
  onlostpointercapture={cleanupDrag}
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

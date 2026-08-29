<script lang="ts">
  let {
    edge,
    currentSize,
    onResize,
    min,
    max,
    step = 10,
    label = 'Resize panel',
  }: {
    edge: 'left' | 'right' | 'bottom'
    currentSize: number
    onResize: (px: number) => void
    min: number
    max: number
    step?: number
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

  const resize = (size: number): void => onResize(Math.max(min, Math.min(max, Math.round(size))))

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
    resize(edge === 'left' ? startSize + delta : startSize - delta)
  }

  function keydown(e: KeyboardEvent) {
    let nextSize: number
    if (e.key === 'Home') nextSize = min
    else if (e.key === 'End') nextSize = max
    else if (edge === 'left' && e.key === 'ArrowLeft') nextSize = currentSize - step
    else if (edge === 'left' && e.key === 'ArrowRight') nextSize = currentSize + step
    else if (edge === 'right' && e.key === 'ArrowLeft') nextSize = currentSize + step
    else if (edge === 'right' && e.key === 'ArrowRight') nextSize = currentSize - step
    else if (edge === 'bottom' && e.key === 'ArrowUp') nextSize = currentSize + step
    else if (edge === 'bottom' && e.key === 'ArrowDown') nextSize = currentSize - step
    else return

    e.preventDefault()
    resize(nextSize)
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (ARIA separator is keyboard operable) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (ARIA separator owns pointer and keyboard interaction) -->
<div
  bind:this={separator}
  class="resize-handle {edge !== 'bottom' ? 'resize-vertical' : 'resize-horizontal'}"
  role="separator"
  aria-label={label}
  aria-orientation={edge !== 'bottom' ? 'vertical' : 'horizontal'}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={currentSize}
  aria-valuetext={`${currentSize} pixels`}
  tabindex="0"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={cleanupDrag}
  onpointercancel={cleanupDrag}
  onlostpointercapture={cleanupDrag}
  onkeydown={keydown}
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

import { cleanup, render, within } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { expectedDecodedNodeKinds } from '../../morphir-ir/test/support/xray-all-kinds-v3.ts'
import XRayKindBadge from '../src/views/insight/XRayKindBadge.svelte'
import { XRAY_NODE_PRESENTATIONS } from '../src/views/insight/xray-presentation.ts'

afterEach(() => cleanup())

describe('XRayKindBadge', () => {
  test.each(expectedDecodedNodeKinds)('renders the %s catalog entry', (kind) => {
    const { container } = render(XRayKindBadge, { props: { kind } })

    const presentation = XRAY_NODE_PRESENTATIONS[kind]
    const badge = within(container).getByText(presentation.label).closest('.kind-badge')

    expect(badge).not.toBeNull()
    expect(badge?.querySelector('.kind-label')?.textContent).toBe(presentation.label)
    expect(badge?.querySelector('.sr-only')?.textContent).toBe(`${presentation.family} IR node`)
    expect(badge?.getAttribute('title')).toBe(`${presentation.family} IR node`)
    expect(badge?.getAttribute('data-kind-family')).toBe(presentation.family)
    expect(badge?.getAttribute('data-palette')).toBe(presentation.palette)
  })

  test('renders an unfamiliar kind verbatim as unrecognized', () => {
    const { container } = render(XRayKindBadge, { props: { kind: 'future-node' } })

    const badge = within(container).getByText('future-node').closest('.kind-badge')

    expect(badge).not.toBeNull()
    expect(badge?.querySelector('.kind-label')?.textContent).toBe('future-node')
    expect(badge?.querySelector('.sr-only')?.textContent).toBe('unrecognized IR node')
    expect(badge?.getAttribute('title')).toBe('unrecognized IR node')
    expect(badge?.getAttribute('data-kind-family')).toBe('unrecognized')
    expect(badge?.getAttribute('data-palette')).toBe('red')
  })
})

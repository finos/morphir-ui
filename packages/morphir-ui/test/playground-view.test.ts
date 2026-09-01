import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import PlaygroundView from '../src/views/playground/PlaygroundView.svelte'
import { defaultUiConfig, makeAppServices, type CapabilityCatalog } from '../src/index.ts'
import { makeFakeCore, makeFakePipeline } from './support/fake-services.ts'
import type { JsonValue } from '@morphir/workspace'

// See ir-explorer.test.ts: readFileSync(new URL(rel, import.meta.url)) breaks under Vite's
// import-analysis in this happy-dom environment. Resolve manually instead.
const insightFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8',
)

// This project has no vitest globals, so @testing-library/svelte never registers its
// auto-cleanup. Without this, DOM from each render() bleeds into the next test.
afterEach(() => cleanup())

const provider = (id: string) => ({
  extensionId: id,
  extensionName: id,
  version: '1.0.0',
  origin: 'installed' as const,
  invocationMode: 'spawned-process',
})

const catalog = (overrides?: Partial<CapabilityCatalog>): CapabilityCatalog => ({
  frontends: [
    {
      languageId: 'elm',
      displayName: 'Morphir Elm',
      fileExtensions: ['.elm'],
      irVersions: ['3'],
      compile: true,
      incremental: null,
      fragments: null,
      provider: provider('morphir-elm'),
    },
  ],
  targets: [
    {
      target: 'scala',
      displayName: 'Scala',
      irVersions: ['3'],
      generate: true,
      provider: provider('morphir-scala'),
    },
    {
      target: 'future',
      displayName: 'Future',
      irVersions: ['4'],
      generate: true,
      provider: provider('morphir-future'),
    },
  ],
  ...overrides,
})

/** The catalog arrives after mount, so every option-dependent assertion has to wait for
 * the target select to be populated before touching it. */
const catalogLoaded = async (targets = 2) => {
  const select = (await screen.findByLabelText('Generation target')) as HTMLSelectElement
  await waitFor(() => expect(select.options.length).toBe(targets + 1))
  return select
}

const setup = async (opts?: {
  pipeline?: ReturnType<typeof makeFakePipeline>
  withoutPipeline?: boolean
}) => {
  const { core, store } = makeFakeCore()
  const fake = opts?.pipeline ?? makeFakePipeline({ catalog: catalog() })
  const services = opts?.withoutPipeline
    ? await makeAppServices({ core })
    : await makeAppServices({ core, pipeline: fake.pipeline })
  const rendered = render(PlaygroundView, { props: { services } })
  return { services, store, calls: fake.calls, ...rendered }
}

describe('PlaygroundView without a pipeline', () => {
  test('explains the missing capability and disables both actions', async () => {
    await setup({ withoutPipeline: true })

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/no compilation pipeline/i)
    expect(screen.getByRole('button', { name: 'Compile' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('PlaygroundView', () => {
  test('offers the catalog frontends as source languages', async () => {
    await setup()

    const select = (await screen.findByLabelText('Source language')) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBe(1))
    expect(select.options[0]!.textContent).toContain('Morphir Elm')
    expect(select.value).toBe('elm')
  })

  // Requirement: null is not false. An install record that carries no incremental or
  // fragment flag must read as unknown, visibly distinct from a refusal.
  test('reports an undeterminable capability as unknown, not unsupported', async () => {
    await setup()

    const incremental = await screen.findByTestId('capability-incremental')
    expect(incremental.textContent).toContain('Unknown')
    expect(incremental.classList.contains('capability-unknown')).toBe(true)
    expect(incremental.classList.contains('capability-no')).toBe(false)
    expect(incremental.getAttribute('title')).toMatch(/could not determine/i)
    expect(screen.getByTestId('capability-fragments').textContent).toContain('Unknown')
  })

  test('an explicit refusal reads differently from an unknown', async () => {
    const fake = makeFakePipeline({
      catalog: catalog({
        frontends: [
          {
            languageId: 'elm',
            displayName: 'Morphir Elm',
            fileExtensions: ['.elm'],
            irVersions: ['3'],
            compile: true,
            incremental: false,
            fragments: true,
            provider: provider('morphir-elm'),
          },
        ],
      }),
    })
    await setup({ pipeline: fake })

    const incremental = await screen.findByTestId('capability-incremental')
    await waitFor(() => expect(incremental.textContent).toContain('Not supported'))
    expect(incremental.classList.contains('capability-no')).toBe(true)
    expect(incremental.classList.contains('capability-unknown')).toBe(false)
    expect(screen.getByTestId('capability-fragments').textContent).toContain('Supported')
  })

  // Requirement: an incompatible target is disabled with its reason visible, never hidden.
  test('keeps an incompatible target listed, disabled, with its reason on screen', async () => {
    await setup()

    const select = await catalogLoaded()
    const future = Array.from(select.options).find((option) => option.value === 'future')
    expect(future).toBeTruthy()
    expect(future!.disabled).toBe(true)
    expect(future!.title).toContain('requires Morphir IR 4')
    expect(Array.from(select.options).find((option) => option.value === 'scala')!.disabled).toBe(
      false,
    )
    const reasons = await screen.findByTestId('target-refusals')
    expect(reasons.textContent).toContain('Future requires Morphir IR 4')
    expect(reasons.textContent).toContain('Morphir Elm emits 3')
  })

  // Requirement: compiling is explicit. A compile may start an extension process, so no
  // keystroke or debounce may trigger one.
  test('typing never compiles; only the button does', async () => {
    const { calls } = await setup()
    await screen.findByLabelText('Source language')

    const editor = document.querySelector('.cm-content') as HTMLElement | null
    if (editor) {
      await userEvent.click(editor)
      await userEvent.keyboard('x')
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(calls.compile.length).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))

    await waitFor(() => expect(calls.compile.length).toBe(1))
  })

  test('a compile sends the selected language, its documents and an agreed IR version', async () => {
    const { calls } = await setup()
    await userEvent.selectOptions(await catalogLoaded(), 'scala')

    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))

    await waitFor(() => expect(calls.compile.length).toBe(1))
    const input = calls.compile[0]!
    expect(input.languageId).toBe('elm')
    expect(input.irVersion).toBe('3')
    expect(input.documents.length).toBe(1)
    expect(input.documents[0]!.languageId).toBe('elm')
    expect(input.package.exposedModules).toEqual(['Main'])
  })

  test('shows the compiled IR as pretty-printed JSON', async () => {
    const fake = makeFakePipeline({
      catalog: catalog(),
      compileResult: {
        success: true,
        irVersion: '3',
        ir: JSON.parse(insightFixture) as JsonValue,
        diagnostics: [],
        modules: ['Morphir.Ui.Fixtures.Insight'],
      },
    })
    await setup({ pipeline: fake })
    await screen.findByLabelText('Source language')
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))

    await userEvent.click(await screen.findByRole('tab', { name: 'IR JSON' }))

    const json = await screen.findByTestId('ir-json')
    expect(json.textContent).toContain('"formatVersion": 3')
  })

  test('renders the compiled IR through the existing Insight and XRay views', async () => {
    const fake = makeFakePipeline({
      catalog: catalog(),
      compileResult: {
        success: true,
        irVersion: '3',
        ir: JSON.parse(insightFixture) as JsonValue,
        diagnostics: [],
        modules: ['Morphir.Ui.Fixtures.Insight'],
      },
    })
    await setup({ pipeline: fake })
    await screen.findByLabelText('Source language')
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))

    const definitions = (await screen.findByLabelText('Definition')) as HTMLSelectElement
    await userEvent.selectOptions(
      definitions,
      'definition:value:Morphir.Ui.Fixtures:Insight:usesHelper',
    )

    expect((await screen.findAllByText(/helperFn/)).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('tab', { name: 'XRay' }))
    expect(await screen.findByText('inputs')).toBeTruthy()
  })

  test('lists compile diagnostics under the editor', async () => {
    const fake = makeFakePipeline({
      catalog: catalog(),
      compileResult: {
        success: false,
        irVersion: null,
        ir: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'E01',
            message: 'Naming a thing is hard',
            location: {
              uri: 'morphir-playground:/Main.elm',
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            },
          },
        ],
        modules: [],
      },
    })
    await setup({ pipeline: fake })
    await screen.findByLabelText('Source language')

    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))

    const list = await screen.findByTestId('diagnostics')
    expect(list.textContent).toContain('Naming a thing is hard')
    expect(list.textContent).toContain('E01')
  })

  test('generate stays disabled until a successful compile and a compatible target', async () => {
    const { calls } = await setup()
    const targets = await catalogLoaded()
    const generate = screen.getByRole('button', { name: 'Generate' })
    expect(generate.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(calls.compile.length).toBe(1))
    expect(generate.hasAttribute('disabled')).toBe(true)

    await userEvent.selectOptions(targets, 'scala')

    await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false))
    await userEvent.click(generate)
    await waitFor(() => expect(calls.generate.length).toBe(1))
    expect(calls.generate[0]!.target).toBe('scala')
    expect(calls.generate[0]!.irVersion).toBe('3')
  })

  test('offers each generated artifact for download', async () => {
    const fake = makeFakePipeline({
      catalog: catalog(),
      generateResult: {
        success: true,
        artifacts: [{ path: 'src/main/scala/Main.scala', content: 'object Main', binary: false }],
        diagnostics: [],
      },
    })
    await setup({ pipeline: fake })
    const targets = await catalogLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))
    await userEvent.selectOptions(targets, 'scala')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('src/main/scala/Main.scala')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download src/main/scala/Main.scala' })).toBeTruthy()
  })

  test('persists the edited document and both selections to config', async () => {
    const { store } = await setup()

    await userEvent.selectOptions(await catalogLoaded(), 'scala')

    await waitFor(() => expect(store.config.playground.target).toBe('scala'), { timeout: 2000 })
    expect(store.config.playground.languageId).toBe('elm')
    expect(store.config.playground.documents.length).toBe(1)
  })

  test('restores persisted work instead of the sample source', async () => {
    const { core } = makeFakeCore({
      config: {
        ...defaultUiConfig,
        playground: {
          documents: [
            {
              id: 'main',
              uri: 'morphir-playground:/Main.elm',
              languageId: 'elm',
              version: 4,
              text: 'restoredFromConfig = 1',
            },
          ],
          activeDocumentId: 'main',
          languageId: 'elm',
          target: 'scala',
        },
      },
    })
    const fake = makeFakePipeline({ catalog: catalog() })
    const services = await makeAppServices({ core, pipeline: fake.pipeline })
    render(PlaygroundView, { props: { services } })

    await waitFor(() =>
      expect((screen.getByLabelText('Generation target') as HTMLSelectElement).value).toBe('scala'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(fake.calls.compile.length).toBe(1))
    expect(fake.calls.compile[0]!.documents[0]!.text).toBe('restoredFromConfig = 1')
  })
})

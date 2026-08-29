import { describe, expect, test } from 'bun:test'
import { LaunchRequestQueue, parseOpenSources } from '../src/main/launch-requests.ts'

describe('parseOpenSources', () => {
  test('packaged launch accepts several positional sources', () => {
    expect(parseOpenSources(['/Applications/Morphir', '/a.json', '/dev'], true)).toEqual([
      '/a.json',
      '/dev',
    ])
  })

  test('development launch removes the Electron app entry', () => {
    expect(parseOpenSources(['/electron', '.', '/a.json'], false)).toEqual(['/a.json'])
  })

  test('double dash permits a path beginning with a dash', () => {
    expect(parseOpenSources(['/Applications/Morphir', '--', '-model.json'], true)).toEqual([
      '-model.json',
    ])
  })

  test('Electron switches are not treated as paths', () => {
    expect(parseOpenSources(['/electron', '.', '--inspect=9229', '/a.json'], false)).toEqual([
      '/a.json',
    ])
  })
})

describe('LaunchRequestQueue', () => {
  test('takes initial requests only once and deduplicates each pushed batch', () => {
    const queue = new LaunchRequestQueue(['/a.json', '/a.json', '/dev'])

    expect(queue.takeInitial()).toEqual(['/a.json', '/dev'])
    expect(queue.takeInitial()).toEqual([])
    expect(queue.push(['/b.json', '/b.json'])).toEqual(['/b.json'])
  })

  test('collects paths pushed before the renderer takes its initial batch', () => {
    const queue = new LaunchRequestQueue(['/a.json'])

    expect(queue.push(['/dev'])).toEqual([])
    expect(queue.takeInitial()).toEqual(['/a.json', '/dev'])
  })
})

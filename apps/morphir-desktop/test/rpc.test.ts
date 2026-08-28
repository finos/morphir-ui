import { describe, expect, test } from 'bun:test'
import { METHOD_NOT_FOUND, RpcRegistry, WIRE_CODE, WIRE_MESSAGE } from '../src/main/rpc.ts'

describe('RpcRegistry', () => {
  test('dispatches to a registered handler', async () => {
    const registry = new RpcRegistry()
    registry.register('morphir/test/echo', async (params) => ({ echoed: params }))
    const response = await registry.dispatch({
      id: 7,
      method: 'morphir/test/echo',
      params: { a: 1 },
    })
    expect(response).toEqual({ id: 7, result: { echoed: { a: 1 } } })
  })

  test('unknown method returns METHOD_NOT_FOUND', async () => {
    const registry = new RpcRegistry()
    const response = await registry.dispatch({ id: 1, method: 'nope' })
    expect(response.error!.code).toBe(METHOD_NOT_FOUND)
  })

  test('handler failure maps to the morphir wire error with detail in data', async () => {
    const registry = new RpcRegistry()
    registry.register('morphir/test/boom', async () => {
      throw new Error('workspace not found: /x')
    })
    const response = await registry.dispatch({ id: 2, method: 'morphir/test/boom' })
    expect(response.error).toEqual({
      code: WIRE_CODE,
      message: WIRE_MESSAGE,
      data: 'workspace not found: /x',
    })
  })

  test('malformed message still yields a response envelope', async () => {
    const registry = new RpcRegistry()
    const response = await registry.dispatch('garbage')
    expect(response.id).toBe(-1)
    expect(response.error!.code).toBe(METHOD_NOT_FOUND)
  })
})

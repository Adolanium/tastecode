import type { DomainEvent } from '@harness/contracts'
import type {
  JsonRpcRequestOptions,
  JsonRpcValue,
  ParsedJsonRpcRequestOptions,
  ServerRequestHandler,
} from '@harness/proc'
import { describe, expect, it, vi } from 'vitest'
import { AcpAdapter, type AcpRpc } from './adapter.js'
import type { ToolKind } from './protocol.js'

vi.mock('@harness/proc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@harness/proc')>()),
  spawnCli: vi.fn(() => ({ pid: 1 })),
  StdioJsonRpc: class {
    constructor() {
      if (!rpc) throw new Error('fake ACP RPC was not installed')
      return rpc
    }
  },
}))

/**
 * Approval lifecycle under a faithful in-memory transport. It drives
 * session/request_permission and prompt completion through the same public
 * interface as the stdio JSON-RPC transport.
 */

class FakeAcpRpc implements AcpRpc {
  #onServerRequest: ServerRequestHandler = (_method, _params, respond) => respond(null)
  #resolvePrompt: ((result: JsonRpcValue) => void) | undefined
  readonly calls: Array<{ method: string; params: unknown }> = []

  onStderr(): void {}
  onNotification(): void {}

  onServerRequest(handler: ServerRequestHandler): void {
    this.#onServerRequest = handler
  }

  request(
    method: string,
    params?: unknown,
    options?: JsonRpcRequestOptions,
  ): Promise<JsonRpcValue | undefined>
  request<Result>(
    method: string,
    params: unknown,
    options: ParsedJsonRpcRequestOptions<Result>,
  ): Promise<Result>
  request<Result>(
    method: string,
    params: unknown = {},
    options: JsonRpcRequestOptions | ParsedJsonRpcRequestOptions<Result> = {},
  ): Promise<JsonRpcValue | undefined | Result> {
    this.calls.push({ method, params })
    const parse = (value: JsonRpcValue) =>
      'result' in options ? options.result.parse(value) : value
    if (method === 'initialize') {
      return Promise.resolve(
        parse({
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: true } },
        }),
      )
    }
    if (method === 'session/new') {
      return Promise.resolve(
        parse({
          sessionId: 'sess-1',
          models: {
            currentModelId: 'nous:glm-flash',
            availableModels: [
              { modelId: 'nous:glm-flash', name: 'Nous · glm-flash' },
              { modelId: 'deepseek:flash', name: 'deepseek · flash' },
            ],
          },
        }),
      )
    }
    if (method === 'session/prompt') {
      return new Promise<JsonRpcValue>((resolve) => {
        this.#resolvePrompt = resolve
      }).then(parse)
    }
    return Promise.resolve(parse({}))
  }

  notify(): void {}
  dispose(): void {}

  requestPermission(kind: ToolKind): Promise<JsonRpcValue> {
    return new Promise((resolve) => {
      this.#onServerRequest(
        'session/request_permission',
        {
          sessionId: 'sess-1',
          toolCall: { toolCallId: 'tc-1', title: 'do something', kind },
          options: [
            { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
            { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
          ],
        },
        resolve,
      )
    })
  }

  resolvePrompt(result: JsonRpcValue): void {
    const resolve = this.#resolvePrompt
    if (!resolve) throw new Error('no ACP prompt is pending')
    this.#resolvePrompt = undefined
    resolve(result)
  }
}

let rpc: FakeAcpRpc | undefined

function adapter(): AcpAdapter {
  rpc = new FakeAcpRpc()
  return new AcpAdapter('gemini', {
    name: 'Gemini',
    command: 'gemini',
  })
}

function activeRpc(): FakeAcpRpc {
  if (!rpc) throw new Error('ACP test transport is not connected')
  return rpc
}

async function startedAdapter(approval: 'ask' | 'auto') {
  const current = adapter()
  const events: DomainEvent[] = []
  current.on('event', (event) => events.push(event))
  await current.startThread('C:\\repo', { approval })
  const threadId = 'acp-gemini-sess-1'
  const turnId = await current.sendTurn(threadId, 'go')
  return { adapter: current, events, turnId }
}

describe('ACP approval lifecycle', () => {
  it('does not start a turn when attachment preparation fails', async () => {
    const current = adapter()
    const events: DomainEvent[] = []
    current.on('event', (event) => events.push(event))
    await current.startThread('C:\\repo')

    await expect(
      current.sendTurn('acp-gemini-sess-1', 'review', ['preview.png']),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(events).toEqual([])
  })

  it('answers an abandoned approval with cancelled when the turn ends', async () => {
    const { events, turnId } = await startedAdapter('ask')
    const answered = activeRpc().requestPermission('execute')

    activeRpc().resolvePrompt({ stopReason: 'end_turn' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(answered).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval.resolved' }))
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turn.completed', turnId, status: 'completed' }),
    )
  })

  it('auto mode only waves through reads — mutations stay questions', async () => {
    const { events } = await startedAdapter('auto')

    const read = activeRpc().requestPermission('read')
    await expect(read).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })

    for (const kind of ['execute', 'edit', 'delete', 'move', 'fetch'] as const) {
      void activeRpc().requestPermission(kind)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const asked = events.filter((event) => event.type === 'approval.requested')
    expect(asked).toHaveLength(5)
  })
})

describe('ACP session model selection', () => {
  it('uses session/set_model when the agent has no launch flag or config option', async () => {
    const current = adapter()
    await current.startThread('C:\\repo', { model: 'nous:glm-flash' })
    expect(activeRpc().calls).toContainEqual({
      method: 'session/set_model',
      params: { sessionId: 'sess-1', modelId: 'nous:glm-flash' },
    })
    expect(activeRpc().calls.some((call) => call.method === 'session/set_config_option')).toBe(
      false,
    )
  })

  it('skips session/set_model when the agent already takes --model at launch', async () => {
    rpc = new FakeAcpRpc()
    const current = new AcpAdapter('gemini')
    await current.startThread('C:\\repo', { model: 'gemini-3-flash-preview' })
    expect(activeRpc().calls.some((call) => call.method === 'session/set_model')).toBe(false)
    expect(activeRpc().calls.some((call) => call.method === 'session/set_config_option')).toBe(
      false,
    )
  })

  it('exposes models advertised on session/new', async () => {
    const current = adapter()
    await current.startThread('C:\\repo')
    expect(current.sessionModels()).toEqual([
      {
        id: 'nous:glm-flash',
        displayName: 'Nous · glm-flash',
        isDefault: true,
        reasoningEfforts: [],
        serviceTiers: [],
      },
      {
        id: 'deepseek:flash',
        displayName: 'deepseek · flash',
        isDefault: false,
        reasoningEfforts: [],
        serviceTiers: [],
      },
    ])
  })

  it('keeps Kimi on session/set_config_option', async () => {
    rpc = new FakeAcpRpc()
    const current = new AcpAdapter('kimi')
    await current.startThread('C:\\repo', { model: 'kimi-code/k3' })
    expect(activeRpc().calls).toContainEqual({
      method: 'session/set_config_option',
      params: { sessionId: 'sess-1', configId: 'model', value: 'kimi-code/k3' },
    })
  })
})

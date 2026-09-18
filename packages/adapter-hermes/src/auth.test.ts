import { describe, expect, it } from 'vitest'
import { parseHermesAuthList } from './auth.js'

describe('Hermes auth list', () => {
  it('treats pooled credentials as signed in without reading secret values', () => {
    expect(
      parseHermesAuthList(`
nous (1 credentials):
  #1  device_code          oauth   id=6df28c priority=0 device_code ←

deepseek (1 credentials):
  #1  DEEPSEEK_API_KEY     api_key id=e42c11 priority=0 env:DEEPSEEK_API_KEY ←
`),
    ).toEqual({ signedIn: true })
  })

  it('reports signed out when the CLI lists no credentials', () => {
    expect(parseHermesAuthList('')).toEqual({ signedIn: false })
    expect(parseHermesAuthList('No pooled credentials.')).toEqual({ signedIn: false })
    expect(parseHermesAuthList('nous (0 credentials):')).toEqual({ signedIn: false })
  })
})

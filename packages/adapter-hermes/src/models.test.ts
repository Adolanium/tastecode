import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hermesCommand, hermesHome } from './command.js'
import {
  discoverHermesModels,
  encodeHermesChoice,
  parseHermesAliases,
  parseHermesConfiguredModels,
  parseHermesProviders,
} from './models.js'

describe('Hermes configured model catalog', () => {
  it('encodes ACP picker ids as provider:model', () => {
    expect(encodeHermesChoice('nous', 'z-ai/glm-5.3-flash')).toBe('nous:z-ai/glm-5.3-flash')
    expect(encodeHermesChoice('', 'local-model')).toBe('local-model')
    expect(encodeHermesChoice('Nous', '  ')).toBe('')
  })

  it('reads named provider model lists without touching other keys', () => {
    expect(
      parseHermesProviders(`
deepseek:
  models:
  - deepseek-v4.1-flash-expires-on-0910
  api_key: should-not-be-read
copilot:
  models:
  - gpt-5.4
  - claude-opus-4.8
empty:
  models: []
`),
    ).toEqual([
      { provider: 'deepseek', models: ['deepseek-v4.1-flash-expires-on-0910'] },
      { provider: 'copilot', models: ['gpt-5.4', 'claude-opus-4.8'] },
    ])
  })

  it('parses alias lines from hermes config get', () => {
    expect(parseHermesAliases('v41flash: deepseek/deepseek-v4.1-flash-expires-on-0910\n')).toEqual([
      { id: 'v41flash', resolved: 'deepseek/deepseek-v4.1-flash-expires-on-0910' },
    ])
  })

  it('marks the configured default and lists provider models plus aliases', () => {
    expect(
      parseHermesConfiguredModels({
        defaultModel: 'z-ai/glm-5.3-flash',
        defaultProvider: 'nous',
        providersText: `
deepseek:
  models:
  - deepseek-v4.1-flash-expires-on-0910
`,
        aliasesText: 'v41flash: deepseek/deepseek-v4.1-flash-expires-on-0910',
      }),
    ).toEqual([
      {
        id: 'nous:z-ai/glm-5.3-flash',
        displayName: 'nous · z-ai/glm-5.3-flash',
        isDefault: true,
        reasoningEfforts: [],
        serviceTiers: [],
      },
      {
        id: 'deepseek:deepseek-v4.1-flash-expires-on-0910',
        displayName: 'deepseek · deepseek-v4.1-flash-expires-on-0910',
        isDefault: false,
        reasoningEfforts: [],
        serviceTiers: [],
      },
      {
        id: 'v41flash',
        displayName: 'v41flash → deepseek/deepseek-v4.1-flash-expires-on-0910',
        isDefault: false,
        reasoningEfforts: [],
        serviceTiers: [],
      },
    ])
  })

  it('reads live config through the injected CLI runner', async () => {
    const calls: string[][] = []
    const configValue = (key: string) => {
      if (key === 'model.default') return 'z-ai/glm-5.3-flash'
      if (key === 'model.provider') return 'nous'
      if (key === 'providers') return 'deepseek:\n  models:\n  - deepseek-flash\n'
      return ''
    }
    await expect(
      discoverHermesModels({
        command: 'hermes',
        run: async (_command, args) => {
          calls.push(args)
          return { code: 0, stdout: configValue(args[2] ?? '') }
        },
      }),
    ).resolves.toMatchObject([
      { id: 'nous:z-ai/glm-5.3-flash', isDefault: true },
      { id: 'deepseek:deepseek-flash', isDefault: false },
    ])
    expect(calls.map((entry) => entry[2]).sort()).toEqual([
      'model.aliases',
      'model.default',
      'model.provider',
      'providers',
    ])
  })

  it('does not advertise a default when Hermes has no configured model', () => {
    expect(
      parseHermesConfiguredModels({
        defaultModel: '',
        defaultProvider: '',
        providersText: '',
      }),
    ).toEqual([])
  })
})

describe('Hermes command resolution', () => {
  it('names the installer home next to the binary fallback', () => {
    expect(
      hermesHome(
        { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
        'C:\\Users\\tester',
        'win32',
      ),
    ).toBe(path.win32.join('C:\\Users\\tester\\AppData\\Local', 'hermes'))
    expect(hermesHome({}, '/Users/tester', 'darwin')).toBe(
      path.posix.join('/Users/tester', '.hermes'),
    )
    expect(typeof hermesCommand()).toBe('string')
  })
})

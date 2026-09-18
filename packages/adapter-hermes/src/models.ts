import type { Model } from '@harness/contracts'
import { runCli } from '@harness/proc'
import { hermesCommand } from './command.js'

type ConfigRun = (
  command: string,
  args: string[],
  timeoutMs?: number,
) => Promise<{ code: number | null; stdout: string; stderr?: string | undefined }>

export type HermesModelDiscovery = {
  command?: string | undefined
  run?: ConfigRun | undefined
}

/**
 * Model rows TasteCode can actually apply. `hermes config get` reports the
 * configured default, named providers, and aliases without reading secrets.
 * ACP `session/set_model` accepts `provider:model` choice ids in the same
 * shape Hermes's own ACP picker emits.
 */
export async function discoverHermesModels(options: HermesModelDiscovery = {}): Promise<Model[]> {
  const command = options.command ?? hermesCommand()
  const run = options.run ?? runCli
  const [defaultModel, defaultProvider, providersText, aliasesText] = await Promise.all([
    readConfig(run, command, 'model.default'),
    readConfig(run, command, 'model.provider'),
    readConfig(run, command, 'providers'),
    readConfig(run, command, 'model.aliases'),
  ])
  return parseHermesConfiguredModels({
    defaultModel,
    defaultProvider,
    providersText,
    aliasesText,
  })
}

export function parseHermesConfiguredModels(input: {
  defaultModel: string
  defaultProvider: string
  providersText: string
  aliasesText?: string | undefined
}): Model[] {
  const defaultProvider = input.defaultProvider.trim().toLowerCase()
  const defaultModel = input.defaultModel.trim()
  const rows: Model[] = []
  const seen = new Set<string>()

  const add = (provider: string, model: string, displayName: string, isDefault: boolean) => {
    const id = encodeHermesChoice(provider, model)
    if (!id || seen.has(id)) return
    seen.add(id)
    rows.push({
      id,
      displayName,
      isDefault,
      reasoningEfforts: [],
      serviceTiers: [],
    })
  }

  if (defaultModel) {
    add(
      defaultProvider,
      defaultModel,
      defaultProvider ? `${defaultProvider} · ${defaultModel}` : defaultModel,
      true,
    )
  }

  for (const entry of parseHermesProviders(input.providersText)) {
    for (const model of entry.models) {
      add(
        entry.provider,
        model,
        `${entry.provider} · ${model}`,
        Boolean(defaultModel) && entry.provider === defaultProvider && model === defaultModel,
      )
    }
  }

  for (const alias of parseHermesAliases(input.aliasesText ?? '')) {
    if (seen.has(alias.id) || seen.has(alias.resolved)) continue
    add('', alias.id, `${alias.id} → ${alias.resolved}`, false)
  }

  if (rows.length > 0 && !rows.some((row) => row.isDefault)) {
    const first = rows[0]
    if (first) first.isDefault = true
  }
  return rows
}

export function encodeHermesChoice(provider: string, model: string): string {
  const trimmedModel = model.trim()
  if (!trimmedModel) return ''
  const trimmedProvider = provider.trim().toLowerCase()
  return trimmedProvider ? `${trimmedProvider}:${trimmedModel}` : trimmedModel
}

export function parseHermesProviders(text: string): Array<{ provider: string; models: string[] }> {
  const result: Array<{ provider: string; models: string[] }> = []
  let current: { provider: string; models: string[] } | undefined
  let inModels = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ')
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const provider = /^(?! )([^\s:][^:]*):\s*$/.exec(line)
    if (provider) {
      const name = provider[1]?.trim().toLowerCase()
      current = name ? { provider: name, models: [] } : undefined
      inModels = false
      if (current) result.push(current)
      continue
    }
    if (!current) continue
    if (/^\s+models:\s*$/.test(line)) {
      inModels = true
      continue
    }
    const item = /^\s+-\s+(\S.*?)\s*$/.exec(line)
    if (inModels && item?.[1]) {
      const model = stripYamlScalar(item[1])
      if (model) current.models.push(model)
      continue
    }
    if (!/^\s/.test(line)) {
      current = undefined
      inModels = false
    } else if (!/^\s+-/.test(line) && !/^\s+models:\s*$/.test(line)) {
      inModels = false
    }
  }

  return result.filter((entry) => entry.models.length > 0)
}

export function parseHermesAliases(text: string): Array<{ id: string; resolved: string }> {
  const aliases: Array<{ id: string; resolved: string }> = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([^:\s][^:]*):\s+(\S.*?)\s*$/.exec(line)
    if (!match?.[1] || !match[2]) continue
    const id = match[1].trim()
    const resolved = stripYamlScalar(match[2])
    if (id && resolved) aliases.push({ id, resolved })
  }
  return aliases
}

async function readConfig(run: ConfigRun, command: string, key: string): Promise<string> {
  try {
    const result = await run(command, ['config', 'get', key], 8_000)
    const text = result.stdout
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('⚠') && !/^Did you mean:/i.test(line.trim()))
      .join('\n')
      .trim()
    if (result.code && result.code !== 0) return ''
    if (/^Config key not set:/i.test(text)) return ''
    return text
  } catch {
    return ''
  }
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

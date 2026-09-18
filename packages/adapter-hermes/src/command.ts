import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** ACP stdio plus auto-accept for hook prompts a GUI session cannot answer. */
export const HERMES_ACP_ARGS = ['acp', '--accept-hooks'] as const

/** Resolve the binary: PATH name normally, the installer's home as a fallback. */
export function hermesCommand(): string {
  const name = process.platform === 'win32' ? 'hermes.exe' : 'hermes'
  for (const candidate of hermesBinaries(name)) {
    if (existsSync(candidate)) return candidate
  }
  return 'hermes'
}

export function hermesHome(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const join = platform === 'win32' ? path.win32.join : path.posix.join
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA?.trim()
    return join(local && local.length > 0 ? local : join(home, 'AppData', 'Local'), 'hermes')
  }
  return join(home, '.hermes')
}

function hermesBinaries(name: string): string[] {
  return [path.join(hermesHome(), 'bin', name)]
}

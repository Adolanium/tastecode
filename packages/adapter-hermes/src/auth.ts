import { runCli } from '@harness/proc'
import { hermesCommand } from './command.js'

export type HermesAccount = { signedIn: boolean }

/** Auth as `hermes auth list` reports it — labels only, never secret values. */
export async function hermesAccount(): Promise<HermesAccount> {
  try {
    const result = await runCli(hermesCommand(), ['auth', 'list'], 8_000)
    return parseHermesAuthList(result.stdout)
  } catch {
    return { signedIn: false }
  }
}

export function parseHermesAuthList(output: string): HermesAccount {
  return { signedIn: /\([1-9]\d* credentials?\):/i.test(output) }
}

/** `hermes logout` clears the active provider's stored credentials. */
export async function signOutHermes(): Promise<void> {
  await runCli(hermesCommand(), ['logout'], 10_000)
}

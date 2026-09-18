import type { Capabilities } from '@harness/contracts'

export const HERMES_CAPABILITIES: Capabilities = {
  steer: false,
  fork: false,
  interrupt: true,
  reasoningItems: true,
  approvals: true,
  images: true,
}

export const HERMES_SUPPORTED_VERSION = '0.21'

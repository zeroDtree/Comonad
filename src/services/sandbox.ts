import { Context, Service } from 'cordis'
import { runSandboxed, type SandboxResult } from '../sandbox/run.ts'
import type { NetworkPolicy, SandboxProfile } from '../sandbox/sbpl.ts'

export class Sandbox extends Service {
  static inject = []

  constructor(ctx: Context) {
    super(ctx, 'sandbox')
  }

  run(
    command: string[],
    profile: SandboxProfile,
    network: NetworkPolicy,
    cwd: string,
    timeoutSeconds: number,
  ): Promise<SandboxResult> {
    return runSandboxed(command, profile, network, cwd, timeoutSeconds)
  }
}

export default Sandbox

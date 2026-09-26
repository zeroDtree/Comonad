import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { bwrapArguments, buildSbpl, type NetworkPolicy, type SandboxProfile } from './sbpl.ts'

export interface SandboxResult {
  returncode: number
  stdout: string
  stderr: string
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

export function runProcess(argv: string[], cwd: string, timeoutMs: number): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ returncode: code ?? 1, stdout, stderr })
    })
  })
}

export async function runSandboxed(
  command: string[],
  profile: SandboxProfile,
  network: NetworkPolicy,
  cwd: string,
  timeoutSeconds: number,
): Promise<SandboxResult> {
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000
  if (platform() === 'darwin') {
    if (!existsSync(SANDBOX_EXEC)) throw new Error('sandbox-exec is not available')
    const profileText = buildSbpl(profile, network)
    return runProcess([SANDBOX_EXEC, '-p', profileText, '--', ...command], cwd, timeoutMs)
  }
  if (platform() === 'linux') {
    const bwrap = '/usr/bin/bwrap'
    if (!existsSync(bwrap)) throw new Error('bubblewrap (bwrap) is not available')
    return runProcess(bwrapArguments(bwrap, command, profile, network, cwd), cwd, timeoutMs)
  }
  throw new Error(`No sandbox runner available for platform: ${platform()}`)
}

export function formatResult(result: SandboxResult, limit = 20_000): string {
  const clip = (text: string) => text.length > limit ? `${text.slice(0, limit)}\n[...truncated, ${text.length} chars total]` : text
  const parts = [`exit_code: ${result.returncode}`]
  if (result.stdout) parts.push(`stdout:\n${clip(result.stdout)}`)
  if (result.stderr) parts.push(`stderr:\n${clip(result.stderr)}`)
  return parts.join('\n')
}

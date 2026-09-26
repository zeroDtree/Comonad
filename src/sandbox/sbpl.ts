import { existsSync } from 'node:fs'
import { delimiter, dirname } from 'node:path'

export interface SandboxProfile {
  readonly: boolean
  readPaths: string[]
  writePaths: string[]
  denyReadPaths: string[]
}

export interface NetworkPolicy {
  enabled: boolean
}

function quote(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

const SYSTEM_READ_PREFIXES = [
  '/usr',
  '/bin',
  '/sbin',
  '/private/tmp',
  '/var',
  '/etc',
  '/opt',
  '/Library',
  '/System',
  '/Applications',
  '/dev',
]

export function buildSbpl(profile: SandboxProfile, network: NetworkPolicy): string {
  const lines = ['(version 1)', '(allow default)']
  if (profile.readonly || profile.writePaths.length === 0) lines.push('(deny file-write*)')
  for (const writePath of profile.writePaths) {
    lines.push(`(allow file-write* (subpath "${quote(writePath)}"))`)
  }
  lines.push('(allow file-write* (literal "/dev/null"))')
  for (const readPath of profile.readPaths) {
    lines.push(`(allow file-read* (subpath "${quote(readPath)}"))`)
  }
  for (const denyPath of profile.denyReadPaths) {
    lines.push(`(deny file-read* (subpath "${quote(denyPath)}"))`)
    lines.push(`(deny file-write* (subpath "${quote(denyPath)}"))`)
  }
  const prefixes = [...SYSTEM_READ_PREFIXES, dirname(process.execPath)]
  for (const prefix of prefixes) {
    if (!prefix) continue
    lines.push(`(allow file-read* (subpath "${quote(prefix)}"))`)
  }
  if (network.enabled) lines.push('(allow network*)')
  else {
    lines.push('(deny network*)')
    lines.push('(allow network* (local unix-socket))')
  }
  return lines.join('\n')
}

export function shellProfile(workspace: string, writable: boolean, denyReadPaths: string[]): SandboxProfile {
  return {
    readonly: !writable,
    readPaths: [workspace],
    writePaths: writable ? [workspace] : [],
    denyReadPaths,
  }
}

export function bwrapArguments(
  bwrap: string,
  command: string[],
  profile: SandboxProfile,
  network: NetworkPolicy,
  cwd: string,
): string[] {
  const args = [bwrap, '--die-with-parent', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp']
  if (!network.enabled) args.push('--unshare-net')
  for (const prefix of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt', '/System', '/opt/homebrew']) {
    if (existsSync(prefix)) args.push('--ro-bind', prefix, prefix)
  }
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const entry of pathEntries) {
    if (existsSync(entry)) args.push('--ro-bind', entry, entry)
  }
  args.push(profile.readonly ? '--ro-bind' : '--bind', cwd, cwd)
  for (const denyPath of profile.denyReadPaths) {
    if (existsSync(denyPath)) args.push('--ro-bind', '/dev/null', denyPath)
  }
  args.push('--chdir', cwd, '--', ...command)
  return args
}

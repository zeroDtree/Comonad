export type AppMode = 'cli' | 'idle'

export function appMode(): AppMode {
  const args = process.argv.slice(2)
  if (args.includes('--cli') || process.stdin.isTTY) return 'cli'
  return 'idle'
}

#!/usr/bin/env bash
# Link this package into a SillyTavern checkout and turn server plugins on.
# Usage: install_to_st.sh <sillytavern-root>
set -euo pipefail

if [[ $# -ne 1 || $1 == -* ]]; then
  echo "usage: install_to_st.sh <sillytavern-root>" >&2
  exit 2
fi

repo=$(cd "$(dirname "$0")/.." && pwd)
st=$(cd "$1" && pwd)

if [[ ! -f $st/src/server-main.js || ! -f $st/default/config.yaml ]]; then
  echo "not a SillyTavern root: $st" >&2
  exit 1
fi

cd "$repo"
npm ci
npm run build

plugin=$st/plugins/comonad
if [[ -L $plugin ]]; then
  rm "$plugin"
elif [[ -e $plugin && ! -f $plugin/.comonad-install ]]; then
  echo "plugins/comonad already exists and was not installed by this script" >&2
  exit 1
fi
mkdir -p "$plugin"
ln -sfn "$repo/package.json" "$plugin/package.json"
ln -sfn "$repo/dist" "$plugin/dist"
ln -sfn "$repo/node_modules" "$plugin/node_modules"
ln -sfn "$repo/cordis.yml" "$plugin/cordis.yml"

# A directory of links is not a git root, so SillyTavern's plugin auto-update
# will not pull this checkout. The real package is what Node loads.
layout=$(node --input-type=module - "$st" <<'EOF'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parseDocument } from 'yaml'

const st = process.argv[2]
const configPath = resolve(st, 'config.yaml')
if (!existsSync(configPath)) copyFileSync(resolve(st, 'default/config.yaml'), configPath)
const doc = parseDocument(readFileSync(configPath, 'utf8'))
const previous = doc.get('enableServerPlugins') === true
doc.set('enableServerPlugins', true)
writeFileSync(configPath, String(doc))
const dataRoot = doc.get('dataRoot') ?? './data'
const root = isAbsolute(String(dataRoot)) ? String(dataRoot) : resolve(st, String(dataRoot))
process.stdout.write(JSON.stringify({ flipped: !previous, dataRoot: root }))
EOF
)
flipped=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).flipped ? "1" : "0")' "$layout")
data_root=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).dataRoot)' "$layout")
printf 'repo=%s\nflipped=%s\n' "$repo" "$flipped" > "$plugin/.comonad-install"

mkdir -p "$data_root"
linked=0
shopt -s nullglob
for user in "$data_root"/*/; do
  name=$(basename "$user")
  [[ $name == .* || $name == _* ]] && continue
  [[ -f ${user}settings.json ]] || continue
  dest=${user}extensions/comonad
  if [[ -e $dest && ! -L $dest ]]; then
    echo "not a symlink, leaving it alone: $dest" >&2
    exit 1
  fi
  if [[ -L $dest && $(readlink "$dest") != "$repo/extension" ]]; then
    echo "extension link points elsewhere: $dest" >&2
    exit 1
  fi
  mkdir -p "${user}extensions"
  ln -sfn "$repo/extension" "$dest"
  linked=$((linked + 1))
done

if [[ $linked -eq 0 ]]; then
  dest=$data_root/default-user/extensions/comonad
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$repo/extension" "$dest"
fi

echo "installed into $st"
echo "restart SillyTavern"

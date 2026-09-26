#!/usr/bin/env bash
# Remove the links install_to_st.sh created. Does not touch chats or this repo.
# Usage: uninstall_from_st.sh <sillytavern-root>
set -euo pipefail

if [[ $# -ne 1 || $1 == -* ]]; then
  echo "usage: uninstall_from_st.sh <sillytavern-root>" >&2
  exit 2
fi

repo=$(cd "$(dirname "$0")/.." && pwd)
st=$(cd "$1" && pwd)
plugin=$st/plugins/comonad

if [[ ! -f $st/src/server-main.js ]]; then
  echo "not a SillyTavern root: $st" >&2
  exit 1
fi
if [[ ! -f $plugin/.comonad-install ]]; then
  echo "comonad is not installed in $st" >&2
  exit 1
fi

installed=$(sed -n 's/^repo=//p' "$plugin/.comonad-install")
flipped=$(sed -n 's/^flipped=//p' "$plugin/.comonad-install")
if [[ $installed != "$repo" ]]; then
  echo "plugins/comonad was installed from $installed" >&2
  exit 1
fi

rm -f "$plugin/package.json" "$plugin/dist" "$plugin/node_modules" "$plugin/cordis.yml" "$plugin/.comonad-install"
rmdir "$plugin"

data_root=$(node --input-type=module - "$st" <<'EOF'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parseDocument } from 'yaml'

const st = process.argv[2]
const configPath = resolve(st, 'config.yaml')
if (!existsSync(configPath)) process.exit(0)
const doc = parseDocument(readFileSync(configPath, 'utf8'))
const dataRoot = doc.get('dataRoot') ?? './data'
const root = isAbsolute(String(dataRoot)) ? String(dataRoot) : resolve(st, String(dataRoot))
process.stdout.write(root)
EOF
)

if [[ -n $data_root ]]; then
  shopt -s nullglob
  for link in "$data_root"/*/extensions/comonad; do
    [[ -L $link && $(readlink "$link") == "$repo/extension" ]] || continue
    rm "$link"
  done
fi

if [[ $flipped == 1 && -f $st/config.yaml ]]; then
  others=0
  if [[ -d $st/plugins ]]; then
    shopt -s nullglob
    for entry in "$st/plugins"/*; do
      others=$((others + 1))
    done
  fi
  if [[ $others -eq 0 ]]; then
    node --input-type=module - "$st/config.yaml" <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
const path = process.argv[2]
const doc = parseDocument(readFileSync(path, 'utf8'))
doc.set('enableServerPlugins', false)
writeFileSync(path, String(doc))
EOF
  fi
fi

echo "removed from $st"
echo "restart SillyTavern"

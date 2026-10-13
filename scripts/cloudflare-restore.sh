#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -eq 0 ] || [ "${1-}" = "--help" ] || [ "${1-}" = "-h" ]; then
  cd "$repo_dir"
  exec node_modules/.bin/tsx scripts/cloudflare-restore.ts "$@"
fi
backup_path=${1:?Usage: cloudflare-restore.sh BACKUP.json --config wrangler.jsonc --confirm-restore}
case "$backup_path" in
  /*) ;;
  *) backup_path="$(pwd)/$backup_path" ;;
esac
shift
cd "$repo_dir"
exec node_modules/.bin/tsx scripts/cloudflare-restore.ts "$backup_path" "$@"

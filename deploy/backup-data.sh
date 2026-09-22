#!/bin/sh
# Read-only snapshot. Does not delete source data and does not upload anywhere.
# Usage: deploy/backup-data.sh /data /root/backups
set -eu
src="${1:?data root, for example /data}"
dest_dir="${2:?directory that will receive the tar.gz}"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest_dir"
archive="$dest_dir/p2e-data-$stamp.tar.gz"
includes=""
for name in raw cleaned jobs quota.json; do
  if [ -e "$src/$name" ]; then
    includes="$includes $name"
  fi
done
if [ -z "$includes" ]; then
  echo "nothing to back up under $src" >&2
  exit 1
fi
# shellcheck disable=SC2086
tar -C "$src" -czf "$archive" --exclude='.ingests' $includes
echo "$archive"

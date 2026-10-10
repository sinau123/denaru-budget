#!/usr/bin/env bash
# Weekly / pre-migration backup for Supabase Free (no automatic backups).
# Requires: supabase CLI linked to the project (`supabase link`), gpg.
# Produces an encrypted archive of roles, schema and data, including auth.users
# so user identity mapping can be restored. Store it OUTSIDE the project.
set -euo pipefail

OUT_DIR="${BACKUP_DIR:-$HOME/denaru-backups}"
RECIPIENT="${BACKUP_GPG_RECIPIENT:?Set BACKUP_GPG_RECIPIENT to a gpg key id/email}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT_DIR"
pnpm exec supabase db dump --linked --role-only -f "$WORK/roles.sql"
pnpm exec supabase db dump --linked -f "$WORK/schema.sql"
pnpm exec supabase db dump --linked --data-only --use-copy -f "$WORK/data.sql"

tar -C "$WORK" -czf - roles.sql schema.sql data.sql \
  | gpg --encrypt --recipient "$RECIPIENT" --output "$OUT_DIR/denaru-$STAMP.tar.gz.gpg"

echo "Backup written to $OUT_DIR/denaru-$STAMP.tar.gz.gpg"

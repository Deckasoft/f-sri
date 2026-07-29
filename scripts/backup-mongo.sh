#!/usr/bin/env bash
# Nightly MongoDB Atlas backup, run via cron on the VPS. This is the ONLY
# backup for production data: MONGO_URI points at Atlas M0 (free tier), which
# has no built-in snapshots. A silently failing cron here means silently
# having no backup at all, which is why every exit path pings a healthcheck
# URL — see the $BACKUP_PING_URL section below.
#
# Requires: mongodump (mongodb-database-tools), aws CLI, both configured with
# access to $MONGO_URI and the S3 bucket respectively. Intended to run from
# the same directory as compose.prod.yml, sourcing .env.production for
# MONGO_URI/AWS credentials/S3_BUCKET — but does NOT touch the running
# containers; it dumps directly against Atlas over the network.
#
# Crontab entry (VPS, as the deploy user):
#   0 3 * * * /path/to/f-sri/scripts/backup-mongo.sh >> /var/log/f-sri-backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.production}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

: "${MONGO_URI:?MONGO_URI must be set (in .env.production or the environment)}"
: "${S3_BUCKET:?S3_BUCKET must be set (in .env.production or the environment)}"

DATE="$(date -u +%Y-%m-%d)"
ARCHIVE="/tmp/f-sri-mongo-$DATE.archive.gz"
S3_KEY="backups/mongo/$DATE.archive.gz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

ping_healthcheck() {
  # $1: URL suffix, e.g. "" for success, "/fail" for failure. Silently
  # no-ops if BACKUP_PING_URL isn't configured — the ping is a nice-to-have
  # alerting layer, not a hard dependency of the backup itself.
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}${1:-}" >/dev/null 2>&1 || true
  fi
}

echo "[$(date -u -Iseconds)] Starting mongodump for $DATE"

if ! mongodump --uri="$MONGO_URI" --archive="$ARCHIVE" --gzip; then
  echo "[$(date -u -Iseconds)] mongodump failed" >&2
  ping_healthcheck "/fail"
  exit 1
fi

echo "[$(date -u -Iseconds)] Uploading to s3://$S3_BUCKET/$S3_KEY"

if ! aws s3 cp "$ARCHIVE" "s3://$S3_BUCKET/$S3_KEY"; then
  echo "[$(date -u -Iseconds)] S3 upload failed" >&2
  ping_healthcheck "/fail"
  exit 1
fi

echo "[$(date -u -Iseconds)] Backup complete: s3://$S3_BUCKET/$S3_KEY"
ping_healthcheck

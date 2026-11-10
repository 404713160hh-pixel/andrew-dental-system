#!/usr/bin/env bash
# Deploy only the website, keeping API, database and HTTPS containers in place.
set -euo pipefail
umask 077
EXPECTED=${1:?Usage: deploy-public-web.sh FULL_COMMIT_SHA}
[[ "$EXPECTED" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 2; }
BRANCH=codex/deploy-public-site-20261110
BASE=/opt/andrew-preview
CONFIG=/opt/andrew-config/.env.public
RELEASE="/opt/andrew-web-${EXPECTED:0:12}"
test -r "$CONFIG"
mkdir -p /opt/andrew-backups
exec 9>/opt/andrew-backups/public-web.lock
flock -n 9 || { echo 'Another website deployment is active' >&2; exit 1; }
git -C "$BASE" fetch --quiet origin "$BRANCH"
test "$(git -C "$BASE" rev-parse FETCH_HEAD)" = "$EXPECTED"
if test ! -e "$RELEASE"; then git -C "$BASE" worktree add --detach "$RELEASE" "$EXPECTED"; fi
test "$(git -C "$RELEASE" rev-parse HEAD)" = "$EXPECTED"
test -z "$(git -C "$RELEASE" status --porcelain)"
WEB=$(docker ps -q --filter label=com.docker.compose.project=andrew-preview --filter label=com.docker.compose.service=web)
test -n "$WEB" && test "$(printf '%s\n' "$WEB" | wc -l)" = 1
OLD_WEB=$(docker inspect --format '{{.Image}}' "$WEB")
OLD_REF=$(docker inspect --format '{{.Config.Image}}' "$WEB")
OLD_FILES=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$WEB")
IFS=',' read -ra OLD_PATHS <<< "$OLD_FILES"
OLD_COMPOSE=(docker compose -p andrew-preview --env-file "$CONFIG")
for file in "${OLD_PATHS[@]}"; do test -f "$file"; OLD_COMPOSE+=(-f "$file"); done
API_BEFORE=$(docker inspect --format '{{.Id}}' andrew-preview-api-1)
PG_BEFORE=$(docker inspect --format '{{.Id}}' andrew-preview-postgres-1)
EDGE_BEFORE=$(docker inspect --format '{{.Id}}' andrew-preview-https-1)
curl -fsS --max-time 20 https://andrewdental.top/api/v1/health >/dev/null
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/opt/andrew-backups/public-web-$STAMP"
mkdir -m 700 "$BACKUP"
docker tag "$OLD_WEB" "andrew-public-web-rollback:$STAMP"
declare -p OLD_WEB OLD_REF OLD_COMPOSE CONFIG > "$BACKUP/rollback-state.sh"
cat > "$BACKUP/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/rollback-state.sh"
docker tag "$OLD_WEB" "$OLD_REF"
"${OLD_COMPOSE[@]}" up -d --no-build --no-deps --force-recreate web
docker exec andrew-preview-https-1 nginx -t
docker exec andrew-preview-https-1 nginx -s reload
curl -fsS --max-time 20 https://andrewdental.top/api/v1/health
ROLLBACK
chmod 700 "$BACKUP/rollback.sh"
SWITCHED=0
rollback_on_error() {
  local result=$?
  if test "$SWITCHED" = 1; then bash "$BACKUP/rollback.sh" || echo "Rollback needs attention: $BACKUP/rollback.sh" >&2; fi
  exit "$result"
}
trap rollback_on_error ERR
COMPOSE=(docker compose -p andrew-preview -f "$RELEASE/compose.yaml" --env-file "$CONFIG")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" build web
SWITCHED=1
"${COMPOSE[@]}" up -d --no-deps --no-build web
for attempt in $(seq 1 20); do
  if docker exec andrew-preview-web-1 wget -q -O /dev/null http://127.0.0.1/; then break; fi
  if test "$attempt" = 20; then false; fi
  sleep 2
done
docker exec andrew-preview-web-1 nginx -t
docker exec andrew-preview-https-1 nginx -t
docker exec andrew-preview-https-1 nginx -s reload
curl -fsS --retry 3 --max-time 20 "https://andrewdental.top/site-release.json?v=$EXPECTED" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["release"]=="andrew-public-20261110-r1"; print(json.dumps(d))'
curl -fsS --max-time 20 https://andrewdental.top/api/v1/health
test "$(docker inspect --format '{{.Id}}' andrew-preview-api-1)" = "$API_BEFORE"
test "$(docker inspect --format '{{.Id}}' andrew-preview-postgres-1)" = "$PG_BEFORE"
test "$(docker inspect --format '{{.Id}}' andrew-preview-https-1)" = "$EDGE_BEFORE"
SWITCHED=0
trap - ERR
printf '\nWebsite deployed: %s\nRollback: bash %s/rollback.sh\nAPI, PostgreSQL and HTTPS containers retained.\n' "$EXPECTED" "$BACKUP"

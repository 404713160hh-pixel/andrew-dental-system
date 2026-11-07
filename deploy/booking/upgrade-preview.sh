#!/usr/bin/env bash
# Upgrade the existing course preview without replacing its PostgreSQL volume.
set -Eeuo pipefail
umask 077

if [[ ${1:-} != --env-file || $# != 2 || ${ANDREW_PREVIEW_UPGRADE:-} != 1 ]]; then
  printf 'Usage: ANDREW_PREVIEW_UPGRADE=1 bash deploy/booking/upgrade-preview.sh --env-file /absolute/env\n' >&2
  exit 2
fi
env_file=$(realpath -e -- "$2")
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ "$root" == /opt/andrew-release-* ]] || { printf 'A separate /opt/andrew-release-* checkout is required\n' >&2; exit 2; }
[[ -f "$env_file" ]] || exit 2
cd -- "$root"
[[ -z $(git status --porcelain --untracked-files=no) ]] || { printf 'Release checkout has tracked changes\n' >&2; exit 2; }
project=andrew-preview
for service in api postgres web; do
  container="$project-$service-1"
  [[ $(docker inspect "$container" --format '{{ index .Config.Labels "com.docker.compose.project" }}') == "$project" ]] || exit 2
done
compose=(docker compose -p "$project" -f "$root/compose.yaml" --env-file "$env_file")
"${compose[@]}" config --quiet
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/opt/andrew-backups/upgrade-$stamp"
mkdir -m 700 -- "$backup_dir"
backup="$backup_dir/database.dump"
cp -p -- "$env_file" "$backup_dir/env.before"
git rev-parse HEAD > "$backup_dir/target-commit.txt"
docker inspect "$project-api-1" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' > "$backup_dir/previous-release.txt"
for service in api web; do
  image=$(docker inspect "$project-$service-1" --format '{{.Image}}')
  docker image tag "$image" "andrew-rollback-$service:$stamp"
done
docker exec "$project-postgres-1" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
test -s "$backup"
docker exec -i "$project-postgres-1" pg_restore --file=/dev/null < "$backup"
sha256sum "$backup" > "$backup_dir/database.sha256"
cat > "$backup_dir/rollback.yaml" <<EOF
services:
  api:
    image: andrew-rollback-api:$stamp
  web:
    image: andrew-rollback-web:$stamp
EOF
printf 'Verified backup: %s\n' "$backup"

switched=0
finish() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    printf 'Upgrade failed; backup and log retained in %s\n' "$backup_dir" >&2
    if (( switched )); then
      docker compose -p "$project" -f "$root/compose.yaml" -f "$backup_dir/rollback.yaml" --env-file "$env_file" up --no-build --no-deps -d api web || true
      docker exec "$project-https-1" nginx -s reload || true
      printf 'Previous application images restored; database backup was not overwritten.\n' >&2
    fi
  fi
  exit "$result"
}
trap finish EXIT

# Sequential builds keep peak memory lower on the existing 2 GiB machine.
"${compose[@]}" build api
"${compose[@]}" build web
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" run --rm --no-deps provision
switched=1
"${compose[@]}" up --no-build --no-deps -d api
healthy=0
for (( attempt=0; attempt<60; attempt++ )); do
  if [[ $(docker inspect "$project-api-1" --format '{{.State.Health.Status}}') == healthy ]]; then healthy=1; break; fi
  sleep 2
done
(( healthy )) || { printf 'API health check failed\n' >&2; exit 1; }
"${compose[@]}" up --no-build --no-deps -d web
docker exec "$project-web-1" nginx -t
docker exec "$project-https-1" nginx -t
docker exec "$project-https-1" nginx -s reload
if [[ ${ANDREW_PREVIEW_COMPENSATION_DEMO:-0} == 1 ]]; then
  "${compose[@]}" run --rm --no-deps -e NODE_ENV=development -e ANDREW_DEMO_COMPENSATION=1 migrate \
    node booking-api/dist/booking-api/src/cli.js demo-compensation
fi
curl --fail --silent --show-error --retry 3 --retry-delay 2 --max-time 15 https://andrewdental.top/api/v1/health
printf '\nDeployed commit: %s\n' "$(git rev-parse HEAD)"
printf 'Rollback files: %s\n' "$backup_dir"
docker ps --filter "label=com.docker.compose.project=$project" --format '{{.Names}} {{.Status}}'

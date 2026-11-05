#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--apply" || "$#" != 1 ]]; then
  printf 'Usage: bash deploy/booking/apply-demo-passwords.sh --apply\n' >&2
  exit 2
fi
if [[ "$EUID" != 0 ]]; then
  printf 'Run from the root Workbench terminal.\n' >&2
  exit 2
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo"
test -r /opt/andrew-config/.env.public
test -s /opt/andrew-backups/before-demo-passwords-20261105.dump
docker image inspect andrew-demo-password-maintenance:20261105 >/dev/null

docker compose -p andrew-preview -f compose.yaml \
  -f deploy/booking/compose.demo-passwords.yaml \
  --env-file /opt/andrew-config/.env.public \
  run --rm --no-deps -T migrate

umask 077
install -m 600 /dev/stdin /opt/andrew-config/dental-demo-accounts.txt <<'ACCOUNTS'
Andrew Dental 线上演示账号（虚构资料）
统一演示密码：admin123
总部管理员：hq
店长：manager.a
前台：front.a
医生：doctor.a
患者A：patient.a
患者B：patient.b
员工入口：https://andrewdental.top/login
患者入口：微信小程序 → 我的 → 登录
ACCOUNTS
printf 'DEMO_PASSWORDS_APPLIED\n'

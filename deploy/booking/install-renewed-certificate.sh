#!/bin/sh
# Certbot deploy hook. Pass: TLS directory, repository, env file, Compose project.
set -eu
if [ "$#" -ne 4 ]; then
  printf '%s\n' 'Usage: install-renewed-certificate.sh TLS_DIR PROJECT_DIR ENV_FILE COMPOSE_PROJECT' >&2
  exit 2
fi
tls_dir=$1
project_dir=$2
env_file=$3
compose_project=$4
lineage=${RENEWED_LINEAGE:?Run as a Certbot deploy hook, or set RENEWED_LINEAGE for initial installation}
case "$tls_dir" in /*) ;; *) printf '%s\n' 'TLS_DIR must be absolute' >&2; exit 2;; esac
case "$project_dir" in /*) ;; *) printf '%s\n' 'PROJECT_DIR must be absolute' >&2; exit 2;; esac
[ "$tls_dir" != / ] && [ -d "$tls_dir" ] && [ -f "$project_dir/compose.yaml" ]
openssl x509 -in "$lineage/fullchain.pem" -checkend 0 -noout
cert_key=$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
private_key=$(openssl pkey -in "$lineage/privkey.pem" -pubout -outform DER | sha256sum)
[ "$cert_key" = "$private_key" ] || { printf '%s\n' 'Certificate and private key do not match' >&2; exit 1; }
stage=$(mktemp -d "$tls_dir/.renewal.XXXXXX")
trap 'rm -f "$stage/fullchain.pem" "$stage/privkey.pem" "$stage/old-fullchain.pem" "$stage/old-privkey.pem"; rmdir "$stage"' EXIT
install -m 644 "$lineage/fullchain.pem" "$stage/fullchain.pem"
install -m 600 "$lineage/privkey.pem" "$stage/privkey.pem"
had_certificate=false
if [ -f "$tls_dir/fullchain.pem" ] && [ -f "$tls_dir/privkey.pem" ]; then
  had_certificate=true
  cp -p "$tls_dir/fullchain.pem" "$stage/old-fullchain.pem"
  cp -p "$tls_dir/privkey.pem" "$stage/old-privkey.pem"
fi
mv "$stage/fullchain.pem" "$tls_dir/fullchain.pem"
mv "$stage/privkey.pem" "$tls_dir/privkey.pem"
cd "$project_dir"
edge=$(docker compose -p "$compose_project" --env-file "$env_file" --profile https ps -q --status running https)
# First installation can happen before the HTTPS gateway starts.
if [ -z "$edge" ]; then exit 0; fi
if ! docker compose -p "$compose_project" --env-file "$env_file" --profile https exec -T https nginx -t ||
   ! docker compose -p "$compose_project" --env-file "$env_file" --profile https exec -T https nginx -s reload; then
  if [ "$had_certificate" = true ]; then
    mv "$stage/old-fullchain.pem" "$tls_dir/fullchain.pem"
    mv "$stage/old-privkey.pem" "$tls_dir/privkey.pem"
  fi
  printf '%s\n' 'Nginx validation or reload failed; certificate files were restored when available' >&2
  exit 1
fi

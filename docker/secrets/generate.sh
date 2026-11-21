#!/usr/bin/env bash
# Creates and checks the secrets of a production deployment (docker-compose.prod.yml;
# docs/Deployment.md; ASVS V13.2.1, V13.2.3, V13.3.1, V12.3.1).
#
#   docker/secrets/generate.sh                 create what is missing: random passwords for
#                                              MongoDB and its three users, the connection
#                                              address of each service, and the MongoDB TLS
#                                              certificate authority and server certificate.
#                                              Never overwrites a file that already exists.
#   docker/secrets/generate.sh set NAME        store a secret that comes from a provider
#                                              (smtp_pass, openrouter_api_key,
#                                              data_go_th_api_key, google_credentials). The
#                                              value is read from the terminal without echo,
#                                              or from standard input when piped:
#                                                pass show b2g/smtp | docker/secrets/generate.sh set smtp_pass
#                           NAME --from-file F    copy it from a file (a Google service-account key)
#                           NAME --unused         record that this feature is not used here
#   docker/secrets/generate.sh renew-mongo-cert  issue a new MongoDB server certificate from the
#                                              existing authority (they last 365 days)
#   docker/secrets/generate.sh check           verify everything docker-compose.prod.yml needs
#
# Where: $SECRETS_DIR, default ./secrets in the repository root (git ignores it). Every
# secret is one file; the file name is the secret's name; no value is ever printed.
#
# Needs openssl (1.1.1 or newer, or LibreSSL 3.1 or newer).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dir="${SECRETS_DIR:-$repo_root/secrets}"
ca_dir="$dir/ca"
db_name="b2gvendor"
mongo_host="mongo"

# What compose mounts, by name.
generated="mongo_root_password mongo_api_password mongo_worker_password mongo_api_uri mongo_worker_uri mongo_ca_pem mongo_server_pem"
provided="smtp_pass openrouter_api_key data_go_th_api_key google_credentials"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need_openssl() {
  command -v openssl >/dev/null 2>&1 || die "openssl is not installed"
}

random_password() {
  # 40 letters and digits (about 238 bits): long, and safe inside a connection address.
  openssl rand -base64 60 | tr -d '/+=\n' | cut -c1-40
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

# The directory is private to the person who runs this (0700). The files are readable
# (0644) because a container's user is not the host user: Docker mounts the host file
# as it is, so a container running as "node" or "mongodb" must be able to read it. Nobody
# else on the host can get at them, because they cannot enter the directory.
ensure_dir() {
  mkdir -p "$dir" "$ca_dir"
  chmod 0700 "$dir" "$ca_dir"
}

write_secret() { # name, value
  local name="$1" value="$2" tmp
  [ -n "$value" ] || die "refusing to store an empty $name"
  tmp="$(mktemp "$dir/.tmp.XXXXXX")"
  printf '%s\n' "$value" > "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$dir/$name"
}

have() { [ -s "$dir/$1" ]; }

# ---------------------------------------------------------------- generate

make_ca() {
  say "  creating the MongoDB certificate authority (valid 5 years)"
  openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 1825 \
    -keyout "$ca_dir/ca.key" -out "$ca_dir/ca.pem" \
    -subj "/O=B2G Vendor/CN=B2G Vendor MongoDB CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
  chmod 0600 "$ca_dir/ca.key"
  chmod 0644 "$ca_dir/ca.pem"
}

make_server_certificate() {
  say "  issuing the MongoDB server certificate (valid 365 days)"
  local work
  work="$(mktemp -d "$dir/.tls.XXXXXX")"
  openssl genrsa -out "$work/server.key" 2048 >/dev/null 2>&1
  openssl req -new -key "$work/server.key" -subj "/O=B2G Vendor/CN=$mongo_host" -out "$work/server.csr"
  cat > "$work/server.ext" <<EOF
subjectAltName=DNS:$mongo_host,DNS:localhost
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
  openssl x509 -req -sha256 -days 365 -in "$work/server.csr" \
    -CA "$ca_dir/ca.pem" -CAkey "$ca_dir/ca.key" -CAcreateserial -CAserial "$ca_dir/ca.srl" \
    -extfile "$work/server.ext" -out "$work/server.crt" >/dev/null 2>&1
  # mongod wants the certificate and its private key in one PEM file.
  cat "$work/server.crt" "$work/server.key" > "$work/server.pem"
  chmod 0644 "$work/server.pem"
  mv "$work/server.pem" "$dir/mongo_server_pem"
  rm -rf "$work"
}

connection_address() { # service
  printf 'mongodb://b2g_%s:%s@%s:27017/%s?authSource=%s&tls=true&tlsCAFile=/run/secrets/mongo_ca_pem' \
    "$1" "$(head -n 1 "$dir/mongo_$1_password")" "$mongo_host" "$db_name" "$db_name"
}

cmd_generate() {
  need_openssl
  ensure_dir
  say "Secrets directory: $dir"

  for name in mongo_root_password mongo_api_password mongo_worker_password; do
    if have "$name"; then say "  keeping $name"; else say "  generating $name"; write_secret "$name" "$(random_password)"; fi
  done

  for service in api worker; do
    if have "mongo_${service}_uri"; then say "  keeping mongo_${service}_uri"; else say "  building mongo_${service}_uri"; write_secret "mongo_${service}_uri" "$(connection_address "$service")"; fi
  done

  if [ -s "$ca_dir/ca.pem" ] && [ -s "$ca_dir/ca.key" ]; then say "  keeping the certificate authority"; else make_ca; fi
  cp "$ca_dir/ca.pem" "$dir/mongo_ca_pem"
  chmod 0644 "$dir/mongo_ca_pem"
  if have mongo_server_pem; then say "  keeping mongo_server_pem"; else make_server_certificate; fi

  say ""
  missing=""
  for name in $provided; do have "$name" || missing="$missing $name"; done
  if [ -n "$missing" ]; then
    say "Still to store (these come from your providers, nothing here can invent them):"
    for name in $missing; do say "  docker/secrets/generate.sh set $name        (or: set $name --unused)"; done
  else
    say "All provider secrets are stored."
  fi
  say "Then run: docker/secrets/generate.sh check"
}

# ---------------------------------------------------------------- set

cmd_set() {
  local name="${1:-}" mode="${2:-}" value=""
  case " $provided " in *" $name "*) ;; *) die "unknown secret '${name}'. One of: $provided" ;; esac
  ensure_dir

  case "$mode" in
    --unused) value="unused" ;;
    --from-file)
      [ -f "${3:-}" ] || die "--from-file needs a file that exists"
      value="$(cat "$3")" ;;
    "")
      if [ -t 0 ]; then
        printf 'Value for %s (not shown): ' "$name" >&2
        IFS= read -r -s value
        printf '\n' >&2
      else
        value="$(cat)"
      fi ;;
    *) die "unknown option '$mode'" ;;
  esac

  value="${value%$'\n'}"
  [ -n "$value" ] || die "nothing was given for $name"
  write_secret "$name" "$value"
  say "stored $name"
}

# ---------------------------------------------------------------- renew

cmd_renew() {
  need_openssl
  [ -s "$ca_dir/ca.key" ] || die "no certificate authority in $ca_dir (run this script without arguments first)"
  rm -f "$dir/mongo_server_pem"
  make_server_certificate
  say "Restart MongoDB to use it: docker compose -f docker-compose.yml -f docker-compose.prod.yml restart mongo"
}

# ---------------------------------------------------------------- check

failures=0
ok() { say "  ok    $*"; }
bad() { say "  FAIL  $*"; failures=$((failures + 1)); }

cmd_check() {
  need_openssl
  say "Checking $dir"
  [ -d "$dir" ] || die "$dir does not exist: run this script without arguments first"

  for name in $generated $provided; do
    if [ ! -s "$dir/$name" ]; then bad "$name is missing or empty"; continue; fi
    local mode
    mode="$(file_mode "$dir/$name")"
    case "$mode" in *[2367]) bad "$name is writable by everyone (mode $mode)" ;; *) ok "$name exists (mode $mode)" ;; esac
  done

  # Strong, different passwords, and nothing that looks like a default credential (V13.2.3).
  local seen=""
  for name in mongo_root_password mongo_api_password mongo_worker_password; do
    [ -s "$dir/$name" ] || continue
    local password
    password="$(head -n 1 "$dir/$name")"
    if [ "${#password}" -lt 32 ]; then bad "$name is shorter than 32 characters"; else ok "$name is ${#password} characters"; fi
    case "$(printf '%s' "$password" | tr '[:upper:]' '[:lower:]')" in
      admin|root|password|changeme|secret|mongo|mongodb|b2gvendor) bad "$name is a default credential" ;;
    esac
    case " $seen " in *" $password "*) bad "$name repeats another password: each user needs its own" ;; esac
    seen="$seen $password"
  done

  # The address each service gets must hold ITS user, the right password, and demand TLS.
  for service in api worker; do
    [ -s "$dir/mongo_${service}_uri" ] && [ -s "$dir/mongo_${service}_password" ] || continue
    local uri
    uri="$(head -n 1 "$dir/mongo_${service}_uri")"
    if [ "$uri" = "$(connection_address "$service")" ]; then ok "mongo_${service}_uri is b2g_${service}'s address, with its password, requiring TLS"; else bad "mongo_${service}_uri does not match mongo_${service}_password (regenerate: delete it and run the script)"; fi
  done

  # The certificates: signed by our authority, valid for the host name, not about to expire.
  if [ -s "$dir/mongo_server_pem" ] && [ -s "$dir/mongo_ca_pem" ]; then
    local cert
    cert="$(mktemp "$dir/.check.XXXXXX")"
    openssl x509 -in "$dir/mongo_server_pem" -out "$cert" 2>/dev/null || bad "mongo_server_pem holds no certificate"
    if openssl verify -CAfile "$dir/mongo_ca_pem" -verify_hostname "$mongo_host" "$cert" >/dev/null 2>&1; then ok "the MongoDB server certificate is signed by the authority and valid for '$mongo_host'"; else bad "the MongoDB server certificate does not verify against mongo_ca_pem for '$mongo_host'"; fi
    if openssl x509 -in "$cert" -noout -checkend $((30 * 86400)) >/dev/null 2>&1; then ok "the server certificate is valid for at least 30 more days"; else bad "the server certificate expires within 30 days (docker/secrets/generate.sh renew-mongo-cert)"; fi
    if openssl x509 -in "$dir/mongo_ca_pem" -noout -checkend $((90 * 86400)) >/dev/null 2>&1; then ok "the authority is valid for at least 90 more days"; else bad "the certificate authority expires within 90 days"; fi
    if grep -q 'PRIVATE KEY' "$dir/mongo_server_pem"; then ok "mongo_server_pem holds the private key mongod needs"; else bad "mongo_server_pem holds no private key"; fi
    if grep -q 'PRIVATE KEY' "$dir/mongo_ca_pem"; then bad "mongo_ca_pem contains a private key: it must hold the certificate only"; else ok "mongo_ca_pem holds no private key"; fi
    rm -f "$cert"
  fi

  if [ "$failures" -eq 0 ]; then say "All good."; else say "$failures problem(s)."; exit 1; fi
}

case "${1:-generate}" in
  generate) cmd_generate ;;
  set) shift; cmd_set "$@" ;;
  renew-mongo-cert) cmd_renew ;;
  check) cmd_check ;;
  -h|--help|help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (generate, set, renew-mongo-cert, check, help)" ;;
esac

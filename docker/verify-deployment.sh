#!/usr/bin/env bash
# Proves that a deployment is configured as docs/Deployment.md says (ASVS V3.5.4,
# V4.1.2, V12.1.1, V12.1.2, V12.2.1, V12.2.2, V12.3.1, V13.2.1-V13.2.3, V13.3.1, V13.3.2).
#
#   docker/verify-deployment.sh probe --app app.example.com --api api.example.com
#       Looks at a RUNNING deployment from the outside: certificate, TLS versions and
#       cipher suites, the HTTP -> HTTPS behaviour of each host, HSTS, CORS. Run it
#       against the real server once DNS points at it; without --cacert the certificate
#       must be one the system trusts, which is what proves it is publicly trusted
#       (Let's Encrypt). Options:
#         --connect IP     connect to this address instead of resolving the names
#         --https-port N   (default 443)      --http-port N   (default 80)
#         --cacert FILE    trust this CA file (for the local rehearsal below)
#
#   docker/verify-deployment.sh local [--keep]
#       A full rehearsal on THIS machine, with nothing public needed: throw-away secrets
#       and settings, the production compose files, host names under .localhost and
#       Caddy's own test CA (TLS_ISSUER=internal). It builds and starts MongoDB, the
#       API, the worker, the website and the edge proxy, runs the probe above against the
#       edge and then checks what only the inside can show: who runs as root, which
#       ports are published, what each service may read, and what each MongoDB user may
#       do. It removes everything again unless --keep is given.
#       (Real certificate issuance by Let's Encrypt cannot be rehearsed here: that needs
#       a public domain. That is the only thing `local` cannot show.)
#
# Needs: curl, openssl, perl; `local` also needs Docker with the compose plugin.
# Exit status is 0 only when no check failed.

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
passed=0; failed=0; skipped=0

pass() { passed=$((passed + 1)); printf '  PASS  %s\n' "$*"; }
fail() { failed=$((failed + 1)); printf '  FAIL  %s\n' "$*"; }
skip() { skipped=$((skipped + 1)); printf '  SKIP  %s\n' "$*"; }
section() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
with_timeout() { local seconds="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"; }

# ======================================================================== probe

APP=""; API=""; CONNECT_IP=""; HTTPS_PORT=443; HTTP_PORT=80; CACERT=""

url_port() { # port scheme-default -> ":port" unless it is the default
  case "$1:$2" in 443:https|80:http) printf '' ;; *) printf ':%s' "$1" ;; esac
}

# curl to https://host/path, to the address under test
https_curl() { # host path [curl args...]
  local host="$1" path="$2"; shift 2
  local args=(-sS --max-time 20)
  [ -n "$CACERT" ] && args+=(--cacert "$CACERT")
  [ -n "$CONNECT_IP" ] && args+=(--connect-to "$host:$HTTPS_PORT:$CONNECT_IP:$HTTPS_PORT")
  curl "${args[@]}" "$@" "https://$host$(url_port "$HTTPS_PORT" https)$path"
}

http_curl() { # host path [curl args...]  (never follows a redirect)
  local host="$1" path="$2"; shift 2
  local args=(-sS --max-time 20)
  [ -n "$CONNECT_IP" ] && args+=(--connect-to "$host:$HTTP_PORT:$CONNECT_IP:$HTTP_PORT")
  curl "${args[@]}" "$@" "http://$host$(url_port "$HTTP_PORT" http)$path"
}

# One TLS handshake. Prints "OK <protocol> <cipher>", "REFUSED" (the server said no) or
# "UNSUPPORTED" (this machine's openssl cannot even try, which must not count as a refusal).
handshake() { # host openssl-args...
  local host="$1"; shift
  local out
  out="$(printf '' | with_timeout 20 openssl s_client -connect "${CONNECT_IP:-$host}:$HTTPS_PORT" -servername "$host" ${CACERT:+-CAfile "$CACERT"} "$@" 2>&1)" || true
  if grep -qiE 'Error with command|no cipher match|no ciphers available|unknown option|unrecognized option|Option unknown|no protocols available|inappropriate fallback|bad ssl|cipher string' <<<"$out" && ! grep -q 'alert' <<<"$out"; then
    printf 'UNSUPPORTED'; return
  fi
  local line
  line="$(grep -m1 -E '^New, ' <<<"$out" || true)"
  if grep -q 'New, TLSv' <<<"$line"; then
    local protocol cipher
    protocol="$(sed -E 's/^New, (TLSv[0-9.]+),.*/\1/' <<<"$line")"
    cipher="$(sed -E 's/.*Cipher is ([A-Za-z0-9_-]+).*/\1/' <<<"$line")"
    printf 'OK %s %s' "$protocol" "$cipher"
  else
    printf 'REFUSED'
  fi
}

# What Mozilla's "intermediate" configuration allows (the Go TLS stack in Caddy offers the ECDHE ones).
tls12_allowed=" ECDHE-ECDSA-AES128-GCM-SHA256 ECDHE-RSA-AES128-GCM-SHA256 ECDHE-ECDSA-AES256-GCM-SHA384 ECDHE-RSA-AES256-GCM-SHA384 ECDHE-ECDSA-CHACHA20-POLY1305 ECDHE-RSA-CHACHA20-POLY1305 DHE-RSA-AES128-GCM-SHA256 DHE-RSA-AES256-GCM-SHA384 DHE-RSA-CHACHA20-POLY1305 "
tls13_allowed=" TLS_AES_128_GCM_SHA256 TLS_AES_256_GCM_SHA384 TLS_CHACHA20_POLY1305_SHA256 "

# A refusal only means something if the same client CAN speak the protocol to a server that
# allows it. So each old protocol is first tried against a throw-away local server that
# accepts it; if that fails, the client is the limit and the check is skipped, not passed.
control_cache=""
client_can_speak() { # protocol option, e.g. tls1_1
  case "$control_cache" in *" $1:yes "*) return 0 ;; *" $1:no "*) return 1 ;; esac
  local dir port server out
  dir="$(mktemp -d)"; port=$((20000 + RANDOM % 10000))
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$dir/k.pem" -out "$dir/c.pem" -days 1 -subj /CN=control >/dev/null 2>&1
  openssl s_server -quiet -accept "$port" -cert "$dir/c.pem" -key "$dir/k.pem" "-$1" -cipher 'ALL:COMPLEMENTOFALL:@SECLEVEL=0' >/dev/null 2>&1 &
  server=$!
  sleep 1
  out="$(printf '' | with_timeout 10 openssl s_client -connect "127.0.0.1:$port" "-$1" -cipher 'ALL:COMPLEMENTOFALL:@SECLEVEL=0' 2>&1)" || true
  kill "$server" >/dev/null 2>&1 || true; wait "$server" 2>/dev/null || true
  rm -rf "$dir"
  if grep -q 'New, TLSv' <<<"$out"; then control_cache="$control_cache $1:yes "; return 0; fi
  control_cache="$control_cache $1:no "; return 1
}

probe_tls() { # host
  local host="$1" result
  section "TLS: $host"

  result="$(handshake "$host" -verify_return_error -verify_hostname "$host")"
  case "$result" in OK*) pass "a TLS connection with certificate checking succeeds (the certificate is trusted and is valid for $host)" ;; *) fail "no verified TLS connection to $host ($result)"; return ;; esac

  result="$(handshake "$host")"
  case "$result" in "OK TLSv1.3"*) pass "TLS 1.3 is negotiated when the client supports it (it is preferred)" ;; *) fail "the preferred protocol is not TLS 1.3 ($result)" ;; esac

  result="$(handshake "$host" -tls1_2)"
  case "$result" in OK*) pass "TLS 1.2 is accepted" ;; *) fail "TLS 1.2 is refused ($result)" ;; esac

  for old in tls1_1 tls1; do
    if ! client_can_speak "$old"; then
      skip "$old: this machine's openssl cannot speak it (not even to a server that allows it), so a refusal would prove nothing here. Run the probe from a machine whose openssl can."
      continue
    fi
    result="$(handshake "$host" "-$old" -cipher 'ALL:COMPLEMENTOFALL:@SECLEVEL=0')"
    case "$result" in
      REFUSED) pass "$old is refused (and this client does speak it: a server that allows it was reached)" ;;
      UNSUPPORTED) skip "$old could not be tried" ;;
      *) fail "$old is accepted ($result)" ;;
    esac
  done

  # Every TLS 1.2 cipher suite this client knows: any one the server accepts must be a recommended one.
  local accepted="" unexpected="" tried=0 cipher
  for cipher in $(openssl ciphers -tls1_2 'ALL:COMPLEMENTOFALL:@SECLEVEL=0' 2>/dev/null | tr ':' ' '); do
    case "$cipher" in @*|TLS_*) continue ;; esac
    result="$(handshake "$host" -tls1_2 -cipher "$cipher:@SECLEVEL=0")"
    case "$result" in
      OK*) accepted="$accepted $cipher"; tried=$((tried + 1))
           case "$tls12_allowed" in *" $cipher "*) ;; *) unexpected="$unexpected $cipher" ;; esac ;;
      REFUSED) tried=$((tried + 1)) ;;
    esac
  done
  if [ "$tried" -lt 20 ]; then skip "TLS 1.2 cipher suites: only $tried could be tried with this openssl"
  elif [ -n "$unexpected" ]; then fail "TLS 1.2 accepts cipher suites outside the recommended list:$unexpected"
  elif [ -z "$accepted" ]; then fail "TLS 1.2 accepts no cipher suite at all"
  else pass "of $tried TLS 1.2 cipher suites tried, only recommended forward-secret ones are accepted:$accepted"; fi

  local suite accepted13="" unexpected13=""
  for suite in TLS_AES_128_GCM_SHA256 TLS_AES_256_GCM_SHA384 TLS_CHACHA20_POLY1305_SHA256 TLS_AES_128_CCM_SHA256 TLS_AES_128_CCM_8_SHA256; do
    result="$(handshake "$host" -tls1_3 -ciphersuites "$suite")"
    case "$result" in
      OK*) accepted13="$accepted13 $suite"; case "$tls13_allowed" in *" $suite "*) ;; *) unexpected13="$unexpected13 $suite" ;; esac ;;
    esac
  done
  if [ -n "$unexpected13" ]; then fail "TLS 1.3 accepts suites outside the recommended list:$unexpected13"
  elif [ -z "$accepted13" ]; then fail "TLS 1.3 accepts no suite"
  else pass "TLS 1.3 suites accepted:$accepted13"; fi
}

probe_http() {
  section "HTTP behaviour"

  local out status location
  out="$(http_curl "$APP" '/some/page?x=1' -o /dev/null -D - 2>&1)" || { fail "the website did not answer on plain HTTP ($out)"; out=""; }
  status="$(head -n 1 <<<"$out" | awk '{print $2}')"
  location="$(grep -i '^location:' <<<"$out" | head -n 1 | tr -d '\r' | sed 's/^[Ll]ocation: *//')"
  case "$status" in
    301|302|307|308) case "$location" in https://"$APP"*/some/page?x=1) pass "the website redirects HTTP to HTTPS ($status) and keeps the path and query" ;; *) fail "the website redirects to the wrong place: $location" ;; esac ;;
    *) fail "the website does not redirect plain HTTP to HTTPS (status ${status:-none})" ;;
  esac

  out="$(http_curl "$API" '/health' -D - 2>&1)" || true
  status="$(head -n 1 <<<"$out" | awk '{print $2}')"
  location="$(grep -i '^location:' <<<"$out" | head -n 1)"
  if [ -n "$location" ]; then fail "the API redirects plain HTTP: $location"
  elif [ -z "$status" ]; then pass "the API gives no answer to plain HTTP at all"
  elif [ "$status" -ge 400 ] 2>/dev/null; then pass "the API refuses plain HTTP, with no redirect (status $status)"
  else fail "the API answers plain HTTP with status $status"; fi
  if grep -q '"status"' <<<"$out"; then fail "the API served real content over plain HTTP"; else pass "the API served nothing over plain HTTP"; fi
}

probe_https() {
  section "HTTPS behaviour"
  [ "$APP" != "$API" ] && pass "the website ($APP) and the API ($API) are on different host names" || fail "the website and the API share one host name"

  local headers
  headers="$(https_curl "$API" '/health' -D - -o /tmp/b2g-health.$$ 2>&1)" || { fail "https://$API/health did not answer: $headers"; return; }
  local body; body="$(cat /tmp/b2g-health.$$ 2>/dev/null || true)"; rm -f /tmp/b2g-health.$$
  grep -q '^HTTP/[0-9.]* 200' <<<"$headers" && pass "the API answers over HTTPS" || fail "the API's /health did not answer 200"
  if grep -q '"db":"connected"' <<<"$body"; then pass "and reports its database connected (the login and TLS to MongoDB work)"; else fail "the API does not report its database connected: $body"; fi

  local host hsts age
  for host in "$APP" "$API"; do
    hsts="$(https_curl "$host" '/' -D - -o /dev/null 2>/dev/null | grep -i '^strict-transport-security:' | head -n 1 | tr -d '\r' || true)"
    age="$(sed -nE 's/.*max-age=([0-9]+).*/\1/p' <<<"$hsts")"
    if [ -n "$age" ] && [ "$age" -ge 15552000 ]; then pass "$host sends Strict-Transport-Security with a max-age of at least 180 days ($age s)"; else fail "$host sends no adequate Strict-Transport-Security header (${hsts:-none})"; fi
  done

  local status
  status="$(https_curl "$APP" '/' -o /dev/null -w '%{http_code}' 2>/dev/null || true)"
  case "$status" in 2??|3??|404) pass "the website answers over HTTPS ($status)" ;; *) fail "the website does not answer over HTTPS (status ${status:-none})" ;; esac

  # The browser calls the API from the website's origin: CORS must allow exactly that one.
  local allow
  allow="$(https_curl "$API" '/health' -D - -o /dev/null -H "Origin: https://$APP" 2>/dev/null | grep -i '^access-control-allow-origin:' | head -n 1 | tr -d '\r' | sed 's/^[^:]*: *//' || true)"
  if [ "$allow" = "https://$APP" ]; then pass "the API allows the website's origin (CORS) and no other"; else fail "CORS does not allow the website's origin: '${allow:-none}'"; fi
  allow="$(https_curl "$API" '/health' -D - -o /dev/null -H 'Origin: https://evil.example' 2>/dev/null | grep -i '^access-control-allow-origin:' | head -n 1 || true)"
  if [ -z "$allow" ]; then pass "an unlisted origin is not allowed"; else fail "an unlisted origin is allowed: $allow"; fi
}

run_probe() {
  need curl; need openssl; need perl
  [ -n "$APP" ] && [ -n "$API" ] || die "probe needs --app and --api"
  printf 'Probing https://%s and https://%s%s\n' "$APP" "$API" "${CONNECT_IP:+ (at $CONNECT_IP)}"
  probe_tls "$APP"
  [ "$API" != "$APP" ] && probe_tls "$API"
  probe_http
  probe_https
}

# ======================================================================== local rehearsal

project="b2g-verify"
work=""
keep=0

compose() {
  docker compose -p "$project" -f "$repo_root/docker-compose.yml" -f "$repo_root/docker-compose.prod.yml" -f "$work/test-override.yml" "$@"
}

cleanup() {
  [ -n "$work" ] || return 0
  if [ "$keep" -eq 1 ]; then printf '\nLeft running (--keep). Remove with: docker compose -p %s down -v   and delete %s\n' "$project" "$work"; return; fi
  printf '\nCleaning up...\n'
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}

# Node, run INSIDE a service's container, so it sees exactly what that service sees.
node_in() { # service script
  compose exec -T "$1" node -e "$2" 2>&1
}

# One MongoDB attempt from inside a service: prints OK or the error name.
mongo_attempt() { # service uri-transform(js expression on `uri`) action(js)
  node_in "$1" "
const fs = require('fs'); const mongoose = require('mongoose');
(async () => {
  let uri = fs.readFileSync(process.env.MONGODB_URI_FILE, 'utf8').trim();
  uri = $2;
  try {
    const c = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 8000 }).asPromise();
    try { const r = await ($3)(c); console.log('RESULT ' + r); } finally { await c.close(); }
  } catch (e) { console.log('ERROR ' + (e.codeName || e.code || e.name) + ' ' + String(e.message).split('\n')[0].slice(0, 90)); }
})();"
}

run_local() {
  need docker; need curl; need openssl; need perl
  docker compose version >/dev/null 2>&1 || die "docker compose is required"
  work="$(mktemp -d "${TMPDIR:-/tmp}/b2g-verify.XXXXXX")"
  trap cleanup EXIT

  local app="app.localhost" api="api.localhost" http_port="${EDGE_HTTP_PORT:-18080}" https_port="${EDGE_HTTPS_PORT:-18443}"

  section "Preparing throw-away secrets and settings in $work"
  SECRETS_DIR="$work/secrets" "$repo_root/docker/secrets/generate.sh" >/dev/null || die "could not generate secrets"
  for name in smtp_pass openrouter_api_key data_go_th_api_key google_credentials; do
    SECRETS_DIR="$work/secrets" "$repo_root/docker/secrets/generate.sh" set "$name" --unused >/dev/null
  done
  SECRETS_DIR="$work/secrets" "$repo_root/docker/secrets/generate.sh" check >/dev/null && pass "docker/secrets/generate.sh check is satisfied" || fail "docker/secrets/generate.sh check failed"

  # Empty settings files: the real Backend/.env (it holds real credentials) must not be used here.
  printf '# rehearsal: no settings\n' > "$work/empty.env"
  cat > "$work/test-override.yml" <<EOF
services:
  backend:
    env_file: !override ["$work/empty.env"]
  ingestion-worker:
    env_file: !override ["$work/empty.env"]
  frontend:
    env_file: !override ["$work/empty.env"]
EOF

  export APP_HOST="$app" API_HOST="$api" ACME_EMAIL="ops@example.test" TLS_ISSUER="internal"
  export SECRETS_DIR="$work/secrets" EDGE_HTTP_PORT="$http_port" EDGE_HTTPS_PORT="$https_port"

  section "Building and starting MongoDB, the API, the website and the edge proxy"
  compose build 2>&1 | tail -n 3
  compose up -d --wait --wait-timeout 420 mongo backend frontend edge 2>&1 | tail -n 12 || fail "the stack did not become healthy"
  compose up -d --no-deps ingestion-worker 2>&1 | tail -n 2
  sleep 6

  # Caddy's rehearsal CA: the one thing the clients below must trust.
  compose cp edge:/data/caddy/pki/authorities/local/root.crt "$work/caddy-root.crt" >/dev/null 2>&1 || die "could not read the edge's test CA"

  APP="$app"; API="$api"; CONNECT_IP="127.0.0.1"; HTTPS_PORT="$https_port"; HTTP_PORT="$http_port"; CACERT="$work/caddy-root.crt"
  probe_tls "$APP"
  probe_tls "$API"
  probe_http
  probe_https

  local_inside
  local_application
}

local_inside() {
  section "Ports: only the edge is reachable from outside"
  local published
  published="$(compose ps --format '{{.Service}} {{.Ports}}' 2>/dev/null | grep -E '0\.0\.0\.0|\[::\]|127\.0\.0\.1' | grep -v '^alertmanager' || true)"
  if [ "$(grep -c . <<<"$published")" -eq 1 ] && grep -q '^edge ' <<<"$published"; then pass "only the edge publishes ports"; else fail "ports are published by something other than the edge: $published"; fi
  (exec 3<>/dev/tcp/127.0.0.1/27017) 2>/dev/null && fail "MongoDB answers on the host's port 27017" || pass "MongoDB is not reachable from the host"

  section "Containers run as an unprivileged user"
  local service uid
  for service in backend ingestion-worker frontend edge mongo; do
    # mongo's main process is mongod; the others' main process is what `id` reports for PID 1's user
    if [ "$service" = "mongo" ]; then
      uid="$(compose exec -T mongo sh -c 'ps -o user= -C mongod | head -n 1' 2>/dev/null | tr -d ' \r')"
      [ "$uid" = "mongodb" ] && pass "mongo: mongod runs as the 'mongodb' user" || fail "mongo: mongod runs as '${uid:-unknown}'"
    else
      uid="$(compose exec -T "$service" id -u 2>/dev/null | tr -d '\r')"
      [ -n "$uid" ] && [ "$uid" != "0" ] && pass "$service runs as uid $uid" || fail "$service runs as root or could not be checked (uid '${uid:-?}')"
    fi
  done
  local cap
  for service in backend ingestion-worker frontend edge; do
    cap="$(compose exec -T "$service" sh -c 'grep CapEff /proc/1/status' 2>/dev/null | awk '{print $2}' | tr -d '\r')"
    [ "$cap" = "0000000000000000" ] && pass "$service holds no Linux capability" || fail "$service holds capabilities ($cap)"
    compose exec -T "$service" sh -c 'touch /app/probe 2>/dev/null || touch /etc/probe 2>/dev/null' >/dev/null 2>&1 && fail "$service can write to its own file system" || pass "$service cannot change its own files"
  done

  section "Secrets: each service sees only its own, and none are in the environment"
  listed() { compose exec -T "$1" sh -c 'ls /run/secrets 2>/dev/null | sort | tr "\n" " "' | tr -d '\r'; }
  [ "$(listed backend)" = "data_go_th_api_key mongo_api_uri mongo_ca_pem smtp_pass " ] && pass "backend gets: $(listed backend)" || fail "backend gets: $(listed backend)"
  [ "$(listed ingestion-worker)" = "data_go_th_api_key google_credentials mongo_ca_pem mongo_worker_uri openrouter_api_key smtp_pass " ] && pass "ingestion-worker gets: $(listed ingestion-worker)" || fail "ingestion-worker gets: $(listed ingestion-worker)"
  [ -z "$(listed frontend)" ] && pass "frontend gets no secret" || fail "frontend gets: $(listed frontend)"
  [ "$(listed mongo)" = "mongo_api_password mongo_ca_pem mongo_root_password mongo_server_pem mongo_worker_password " ] && pass "mongo gets: $(listed mongo)" || fail "mongo gets: $(listed mongo)"
  for service in backend ingestion-worker; do
    local env_names
    env_names="$(compose exec -T "$service" sh -c 'env | cut -d= -f1 | sort | tr "\n" " "' | tr -d '\r')"
    case "$env_names" in
      *" MONGODB_URI "*|*" SMTP_PASS "*|*" OPENROUTER_API_KEY "*|*" DATA_GO_TH_API_KEY "*) fail "$service has a secret in its environment" ;;
      *) pass "$service has no secret value in its environment (only NAME_FILE paths)" ;;
    esac
  done
  local env_dump
  env_dump="$(compose exec -T frontend sh -c 'env' | tr -d '\r')"
  grep -qiE 'password|secret|MONGODB_URI|SMTP_PASS|API_KEY' <<<"$env_dump" && fail "the frontend environment contains something that looks like a secret" || pass "the frontend environment holds nothing secret"

  section "MongoDB: a login, TLS, and least privilege (from inside each service)"
  local result
  result="$(mongo_attempt backend "uri" "async c => (await c.db.listCollections().toArray()).length")"
  case "$result" in *"RESULT "*) pass "backend: b2g_api connects over TLS and can use the application database" ;; *) fail "backend: could not use its own address: $result" ;; esac

  result="$(mongo_attempt backend "uri.replace(/\/\/[^@]*@/, '//')" "async c => (await c.db.listCollections().toArray()).length")"
  case "$result" in *"ERROR "*Unauthorized*|*"ERROR "*13*) pass "backend: the same address WITHOUT the login is refused (Unauthorized)" ;; *) fail "backend: a connection without a login was not refused: $result" ;; esac

  result="$(mongo_attempt backend "uri.replace(/[?&]tls=true/, '').replace(/&tlsCAFile=[^&]*/, '')" "async c => (await c.db.listCollections().toArray()).length")"
  case "$result" in *"ERROR "*) pass "backend: the same address WITHOUT TLS cannot connect" ;; *) fail "backend: plain (non-TLS) MongoDB was accepted: $result" ;; esac

  # MongoDB does not refuse listDatabases to a limited user: it lists only the databases
  # the user has rights on. So the proof is that ONLY the application database shows up.
  result="$(mongo_attempt backend "uri" "async c => (await c.getClient().db('admin').admin().listDatabases()).databases.map(d => d.name).join(',')")"
  case "$result" in "RESULT b2gvendor") pass "backend: b2g_api sees only the application database (not admin, local or config)" ;; *) fail "backend: b2g_api sees more than its own database: $result" ;; esac
  result="$(mongo_attempt backend "uri" "async c => (await c.getClient().db('admin').collection('system.users').find().toArray()).length")"
  case "$result" in *"ERROR "*Unauthorized*|*"ERROR "*13*) pass "backend: b2g_api may not read the admin database (the user accounts)" ;; *) fail "backend: b2g_api can read the admin database: $result" ;; esac

  result="$(mongo_attempt backend "uri" "async c => { await c.getClient().db('another_database').collection('x').insertOne({a: 1}); return 'wrote'; }")"
  case "$result" in *"ERROR "*Unauthorized*|*"ERROR "*13*) pass "backend: b2g_api may not write to any other database" ;; *) fail "backend: b2g_api wrote to another database: $result" ;; esac

  result="$(mongo_attempt backend "uri" "async c => { await c.getClient().db('b2gvendor').command({ createUser: 'intruder', pwd: 'x', roles: [] }); return 'created'; }")"
  case "$result" in *"ERROR "*Unauthorized*|*"ERROR "*13*) pass "backend: b2g_api may not create users" ;; *) fail "backend: b2g_api can create users: $result" ;; esac

  result="$(mongo_attempt ingestion-worker "uri" "async c => { await c.db.collection('probe').insertOne({a: 1}); await c.db.collection('probe').drop(); return 'ok'; }")"
  case "$result" in *"RESULT ok"*) pass "worker: b2g_worker connects over TLS and can read and write the application database" ;; *) fail "worker: could not use its own address: $result" ;; esac
  result="$(mongo_attempt ingestion-worker "uri" "async c => (await c.getClient().db('admin').admin().listDatabases()).databases.map(d => d.name).join(',')")"
  case "$result" in "RESULT b2gvendor") pass "worker: b2g_worker sees only the application database either" ;; *) fail "worker: b2g_worker sees more than its own database: $result" ;; esac
  result="$(mongo_attempt ingestion-worker "uri" "async c => (await c.getClient().db('admin').collection('system.users').find().toArray()).length")"
  case "$result" in *"ERROR "*Unauthorized*|*"ERROR "*13*) pass "worker: b2g_worker may not read the admin database" ;; *) fail "worker: b2g_worker can read the admin database: $result" ;; esac

  local logs
  logs="$(compose logs --no-color ingestion-worker 2>&1 | tail -n 40)"
  grep -q 'connected to MongoDB' <<<"$logs" && pass "the worker started and connected with REQUIRE_SECURE_BACKENDS on" || fail "the worker did not report a MongoDB connection"
}

# The application itself, through the edge: the website and the API on different host
# names, a real sign-in, the session cookie, CORS. This also shows that the least-privilege
# MongoDB user is enough for real work (it creates and reads accounts).
local_application() {
  section "The application works through the edge (separate host names, cookie, CORS)"
  local email="rehearsal@example.test" password seed headers status cookie_line
  password="Rehearsal-$(openssl rand -hex 8)-Aa1"

  seed="$(compose exec -T -e SEED_SUPERADMIN_EMAIL="$email" -e SEED_SUPERADMIN_PASSWORD="$password" backend node dist/scripts/seedSuperAdmin.js 2>&1)"
  if grep -qiE 'created|promoted|already a superadmin' <<<"$seed"; then pass "the first Super Admin is created from inside the hardened API container (node dist/scripts/seedSuperAdmin.js)"; else fail "could not create the first Super Admin: $(tail -n 3 <<<"$seed" | cut -c1-150)"; return; fi

  if compose exec -T backend node dist/scripts/seedGovSites.js >/dev/null 2>&1 && compose exec -T backend node dist/scripts/seedTags.js >/dev/null 2>&1; then pass "the government sites and the tag vocabulary are seeded the same way (seedGovSites.js, seedTags.js)"; else fail "seeding the sites and tags from inside the container failed"; fi

  local jar="$work/cookies.txt"
  headers="$(https_curl "$API" '/api/v1/auth/login' -X POST -H 'Content-Type: application/json' -H "Origin: https://$APP" -d "{\"email\":\"$email\",\"password\":\"$password\"}" -c "$jar" -D - -o "$work/login.json" 2>&1)" || true
  status="$(head -n 1 <<<"$headers" | awk '{print $2}')"
  [ "$status" = "200" ] && pass "signing in over HTTPS through the edge works (200)" || fail "sign-in answered $status: $(cut -c1-150 "$work/login.json" 2>/dev/null)"

  cookie_line="$(grep -i '^set-cookie:' <<<"$headers" | head -n 1 | tr -d '\r')"
  if grep -qi '__Host-' <<<"$cookie_line" && grep -qi 'secure' <<<"$cookie_line" && grep -qi 'httponly' <<<"$cookie_line" && grep -qi 'samesite=lax' <<<"$cookie_line" && grep -qi 'path=/' <<<"$cookie_line" && ! grep -qi 'domain=' <<<"$cookie_line"; then
    pass "the session cookie is __Host- prefixed, Secure, HttpOnly, SameSite=Lax, Path=/ and has no Domain"
  else fail "the session cookie is not as expected: ${cookie_line:-none}"; fi

  grep -qi "^access-control-allow-origin: https://$APP" <<<"$headers" && grep -qi '^access-control-allow-credentials: true' <<<"$headers" && pass "the sign-in response allows the website's origin with credentials (CORS)" || fail "CORS headers are missing from the sign-in response"

  status="$(https_curl "$API" '/api/v1/auth/me' -b "$jar" -H "Origin: https://$APP" -o "$work/me.json" -w '%{http_code}' 2>/dev/null || true)"
  if [ "$status" = "200" ] && grep -q '"role":"superadmin"' "$work/me.json"; then pass "the cookie from the API host is accepted by the API (a sibling of the website's host)"; else fail "/auth/me with the cookie answered $status"; fi

  status="$(https_curl "$API" '/api/v1/auth/me' -o /dev/null -w '%{http_code}' 2>/dev/null || true)"
  [ "$status" = "401" ] && pass "without the cookie the same call is refused (401)" || fail "/auth/me without a cookie answered $status"

  headers="$(https_curl "$API" '/api/v1/auth/login' -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example' -d "{\"email\":\"$email\",\"password\":\"$password\"}" -D - -o /dev/null 2>&1)" || true
  head -n 1 <<<"$headers" | grep -q ' 403' && pass "a sign-in from another origin is blocked (CSRF_BLOCKED)" || fail "a cross-origin sign-in was not blocked: $(head -n 1 <<<"$headers")"
}

# ======================================================================== main

command="${1:-}"
[ -n "$command" ] && shift
case "$command" in
  probe)
    while [ $# -gt 0 ]; do
      case "$1" in
        --app) APP="$2"; shift 2 ;;
        --api) API="$2"; shift 2 ;;
        --connect) CONNECT_IP="$2"; shift 2 ;;
        --https-port) HTTPS_PORT="$2"; shift 2 ;;
        --http-port) HTTP_PORT="$2"; shift 2 ;;
        --cacert) CACERT="$2"; shift 2 ;;
        *) die "unknown option $1" ;;
      esac
    done
    run_probe ;;
  local)
    [ "${1:-}" = "--keep" ] && keep=1
    run_local ;;
  *) sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

printf '\n%s passed, %s failed, %s skipped\n' "$passed" "$failed" "$skipped"
[ "$failed" -eq 0 ]

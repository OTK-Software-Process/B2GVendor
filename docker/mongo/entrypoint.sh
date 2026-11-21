#!/bin/bash
# MongoDB for a production deployment (docker-compose.prod.yml, service "mongo";
# docs/Deployment.md). Runs as root, as the official image's entrypoint does, ONLY to
# prepare its secrets; the image's own entrypoint then starts mongod as the
# unprivileged "mongodb" user.
#
# Docker secrets arrive as files under /run/secrets, owned by whoever owns them on
# the host. mongod cannot be assumed able to read those, and a private key should not
# stay readable by every user. So each one is copied, in memory only (these two
# directories are tmpfs mounts, they never touch the disk), to a place that only the
# "mongodb" user can read.
set -euo pipefail

tls=/etc/mongo-tls
init=/etc/mongo-init
secrets=/run/secrets

# The certificate the server presents (certificate + private key in one PEM file), and
# the authority that signed it, which the health check uses.
install -d -m 0750 -o mongodb -g mongodb "$tls"
install -m 0400 -o mongodb -g mongodb "$secrets/mongo_server_pem" "$tls/server.pem"
install -m 0444 "$secrets/mongo_ca_pem" "$tls/ca.pem"

# The passwords of the two application users. init-users.sh reads them on the first
# start only, to create the users.
install -d -m 0700 -o mongodb -g mongodb "$init"
for service in api worker; do
  install -m 0400 -o mongodb -g mongodb "$secrets/mongo_${service}_password" "$init/${service}_password"
done

exec docker-entrypoint.sh "$@"

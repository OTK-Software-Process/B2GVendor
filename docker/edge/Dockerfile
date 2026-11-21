# Caddy, run as an unprivileged user (ASVS V13.2.2). The official image runs as root so
# it can open ports 80 and 443; docker-compose.prod.yml instead lets this user open
# them (sysctl net.ipv4.ip_unprivileged_port_start=0) and drops every capability.
FROM caddy:2.10-alpine

# The caddy binary ships with the file capability cap_net_bind_service (so that a
# non-root user could still bind 80 and 443). That is not needed here, because the
# sysctl above lets any user bind them, and it is harmful: a binary whose file
# capabilities are missing from the container's capability set (every one is dropped)
# will not even start ("exec /usr/bin/caddy: operation not permitted"). Remove it.
#
# /data holds the certificates and the ACME account (losing it means asking Let's
# Encrypt for new certificates, which is rate limited), /config the autosaved config.
# Both are volumes in compose; creating them here, owned by this user, makes a new
# volume start out writable by it.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap \
 && addgroup -S -g 10001 edge \
 && adduser -S -u 10001 -G edge -H -s /sbin/nologin edge \
 && mkdir -p /data/caddy /config/caddy \
 && chown -R edge:edge /data /config

USER edge

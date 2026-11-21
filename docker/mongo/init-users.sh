# Creates the application's MongoDB users. NOT run by hand: the official mongo image
# SOURCES every script in /docker-entrypoint-initdb.d/ once, on the very first start
# (an empty data directory), while a temporary mongod listens on localhost only.
# `mongo` (the shell command), `_js_escape` and MONGO_INITDB_DATABASE come from that
# entrypoint (docker-compose.prod.yml mounts this file there as 10-app-users.sh).
#
# One user per service (ASVS V13.2.1), each with the readWrite role on the
# application's own database and nothing else (ASVS V13.2.2): not root, not another
# database, no administration commands. The root user the image just created is for
# operators only; no application is given its password.
#
#   b2g_api     the API
#   b2g_worker  the ingestion worker
#
# Two users rather than one, although their rights are alike, so that a leaked
# credential can be revoked for one service without stopping the other, and so that
# the database's own log says which service did what.

for b2g_service in api worker; do
  b2g_user="b2g_${b2g_service}"
  b2g_password="$(< "/etc/mongo-init/${b2g_service}_password")"

  "${mongo[@]}" "$MONGO_INITDB_DATABASE" <<-EOJS
		db.createUser({
			user: $(_js_escape "$b2g_user"),
			pwd: $(_js_escape "$b2g_password"),
			roles: [ { role: 'readWrite', db: $(_js_escape "$MONGO_INITDB_DATABASE") } ]
		})
	EOJS

  echo "created MongoDB user ${b2g_user} (readWrite on ${MONGO_INITDB_DATABASE})"
done

unset b2g_service b2g_user b2g_password

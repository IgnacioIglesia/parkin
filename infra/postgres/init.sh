#!/bin/bash
# Crea una base por microservicio (database-per-service).
set -e

for db in "$USUARIOS_DB" "$COCHERAS_DB" "$RESERVAS_DB" "$PAGOS_DB"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "CREATE DATABASE \"$db\";"
done

# Reservas usa un exclusion constraint sobre rangos de tiempo (btree_gist)
# para impedir solapamientos a nivel de base de datos.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$RESERVAS_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"

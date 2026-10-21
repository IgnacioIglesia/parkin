#!/usr/bin/env bash
# Genera el par de claves RS256 para firmar y verificar los JWT. No se commitean (*.pem).
set -euo pipefail
cd "$(dirname "$0")"

if [ -f jwt_private.pem ]; then
  echo "Ya existen las claves en infra/jwt; no se pisan."
  exit 0
fi

openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
echo "Claves generadas en infra/jwt/"

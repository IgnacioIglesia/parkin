#!/usr/bin/env bash
# Falla si algún commit del rango BASE..HEAD, o la descripción del PR, atribuye a Claude/Anthropic.
# Uso: verificar-atribucion.sh <base> <head>   (PR_BODY opcional por entorno)
set -u

base="$1"
head="$2"
patron='(co-authored-by:.*(claude|anthropic))|(generated with .*claude)|(noreply@anthropic\.com)'
fallo=0

while read -r sha; do
  mensaje="$(git log -1 --format='%B' "$sha")"
  autoria="$(git log -1 --format='%an <%ae>%n%cn <%ce>' "$sha")"
  if printf '%s\n%s' "$mensaje" "$autoria" | grep -Eiq "$patron"; then
    echo "::error::El commit ${sha:0:7} atribuye a Claude/Anthropic: $(git log -1 --format='%s' "$sha")"
    fallo=1
  fi
done < <(git rev-list "$base..$head")

if printf '%s' "${PR_BODY:-}" | grep -Eiq "$patron"; then
  echo "::error::La descripción del PR contiene atribución a Claude/Anthropic"
  fallo=1
fi

if [ "$fallo" -eq 1 ]; then
  echo "Corregí el mensaje con 'git commit --amend' (último commit) o 'git rebase -i' (varios), y volvé a pushear con --force-with-lease."
  exit 1
fi
echo "OK: sin atribución a Claude/Anthropic."

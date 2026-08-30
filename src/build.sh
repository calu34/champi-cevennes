#!/usr/bin/env bash
# Assemble the standalone HTML from the sources in this folder.
set -e
cd "$(dirname "$0")"
F="../carte-champignons.html"
{
  echo '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1">'
  echo '<title>Conditions de pousse — cèpes & girolles — Cévennes</title>'
  echo '<style>'; cat vendor/leaflet.css; echo '</style><style>'; cat app.css
  echo '</style></head><body>'
  cat body.html
  echo '<script>'; cat vendor/leaflet.js
  echo '</script><script>window.DEPS={'
  first=1
  for c in 07 12 30 34 48 81; do
    [ $first -eq 0 ] && echo ','; first=0
    printf '"%s":' "$c"; cat "data/dep-$c.geojson"
  done
  echo '};</script><script>'; cat app.js; echo '</script></body></html>'
} > "$F"
echo "écrit : $F ($(wc -c < "$F") octets)"

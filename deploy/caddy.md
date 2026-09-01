# Accès HTTPS (obligatoire pour installer l'appli sur téléphone)

Une PWA ne s'installe et ne fonctionne hors-ligne **que servie en HTTPS** (ou sur
`localhost`). Le tunnel SSH suffit pour un coup d'œil au PC, pas pour le téléphone.

On met **Caddy** devant `champi-web` (qui écoute `127.0.0.1:8123`) : certificat
Let's Encrypt automatique, renouvellement automatique.

## 1. Un nom de domaine

- Un vrai domaine (OVH, Gandi…) : créer un enregistrement **A** vers l'IP du VPS.
- Ou gratuit : **DuckDNS** (`champi-cevennes.duckdns.org`) — créer le sous-domaine
  sur duckdns.org, le pointer sur l'IP du VPS.

## 2. Ouvrir les ports (en root)

```bash
ufw allow 80
ufw allow 443
```

## 3. Installer Caddy

```bash
apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy
```

## 4. Configurer

`/etc/caddy/Caddyfile` :

```
champi-cevennes.duckdns.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8123
}
```

> `encode gzip` divise `api/now.json` (~65 Ko) et `data.js` (~800 Ko) par ~4 sur le réseau.

Puis :

```bash
systemctl reload caddy
```

Caddy obtient le certificat en quelques secondes. Vérifier :
`curl -I https://champi-cevennes.duckdns.org` → `HTTP/2 200`.

## 5. (option) mot de passe

Pour ne pas laisser la carte publique :

```bash
caddy hash-password           # saisir un mot de passe, copier le hash
```

```
champi-cevennes.duckdns.org {
    basic_auth {
        charles $2a$14$...le_hash...
    }
    encode zstd gzip
    reverse_proxy 127.0.0.1:8123
}
```

⚠ Avec `basic_auth`, l'app mobile redemande le mot de passe à chaque
réinstallation du service worker — acceptable, mais si ça gêne, laisser ouvert et
compter sur l'URL peu devinable.

## 6. `champi-web` reste en local

Ne pas exposer `serve.mjs` directement (`HOST=127.0.0.1` par défaut, à garder).
Caddy est le seul point d'entrée public.

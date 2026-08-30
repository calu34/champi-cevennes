# Déploiement VPS — poller radar + carte

Cible : un petit VPS Debian 12 (Hetzner CX22 ~4,35 €/mois, ou OVH/Scaleway).
Le VPS fait tout : poller 5 min, collecte quotidienne, service de la carte.
Ton PC ne sert plus qu'à consulter (tunnel SSH).

---

## 1. Créer le VPS

- Image **Debian 12**, 1-2 vCPU / 2-4 Go / 20 Go — le plus petit tier suffit.
- Ajouter ta **clé SSH publique** (`C:\Users\Dell\.ssh\id_ed25519.pub` ; si absente :
  `ssh-keygen -t ed25519` dans PowerShell).

## 2. Base système (en root)

```bash
ssh root@<IP>

apt update && apt -y upgrade
apt -y install git ufw curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node --version          # v20.x

ufw allow OpenSSH && ufw --force enable
apt -y install unattended-upgrades

adduser --disabled-password --gecos "" champi
```

## 3. Le code

Dépôt GitHub **privé** (recommandé — sert aussi de sauvegarde). Sur ton PC :
```bash
cd C:\Users\Dell\Documents\Claude\champi-cevennes
git init && git add -A && git commit -m "v0.2 + poller radar"
# crée un repo privé sur github.com, puis :
git remote add origin https://github.com/<toi>/champi-cevennes.git
git push -u origin main
```

Sur le VPS :
```bash
su - champi
git clone https://github.com/<toi>/champi-cevennes.git
cd champi-cevennes
npm install             # h5wasm + proj4
node collect/run.mjs    # 1re collecte (proxy) -> web/data.js
exit
```

## 4. Le secret Météo-France (en root)

```bash
cat > /etc/champi.env <<'EOF'
CHAMPI_SOURCE=antilope
CHAMPI_MF_APPID=REMPLACER_PAR_L_APPLICATION_ID
EOF
chmod 600 /etc/champi.env
```

> `CHAMPI_MF_APPID` = l'**APPLICATION ID** du portail (mode OAuth2). Le poller
> l'utilise pour renouveler son jeton tout seul. À défaut, `CHAMPI_MF_TOKEN=<token>`
> fonctionne mais expire en 1 h (dépannage seulement).

## 5. Services systemd (en root)

```bash
cd /home/champi/champi-cevennes/deploy
cp champi-*.service champi-*.timer /etc/systemd/system/
systemctl daemon-reload

systemctl enable --now champi-web.service
systemctl enable --now champi-poller.timer
systemctl enable --now champi-daily.timer
```

Vérifs :
```bash
systemctl start champi-poller.service      # forcer une passe
journalctl -u champi-poller -n 20 --no-pager
systemctl list-timers 'champi*'
ls -la /home/champi/champi-cevennes/data/store/radar/
```

Le fichier `data/store/radar/AAAA-MM-JJ.json` doit se remplir (`"slots"` grandit,
~288 en fin de journée). Dès qu'un jour atteint ~258 passes, `collect/run.mjs`
remplace la pluie proxy de ce jour par la **lame d'eau radar** — automatique.

## 6. Consulter la carte

Depuis ton PC :
```bash
ssh -L 8123:localhost:8123 champi@<IP>
```
Laisse la fenêtre ouverte, ouvre <http://localhost:8123>.

*(Option confort : Caddy + nom de domaine pour un accès HTTPS direct avec mot de
passe — à ajouter plus tard, voir `deploy/caddy.md`.)*

## 7. Mises à jour du code

Sur ton PC : `git commit` + `git push`.
Sur le VPS : `su - champi -c 'cd champi-cevennes && git pull && npm install'`
puis `systemctl restart champi-web`.

---

## Coût réel

- Téléchargement radar : ~1 Mo × 480 passes/j ≈ **0,5-1 Go/jour** (le timer tourne
  toutes les 3 min pour la redondance ; chaque trame 5 min est dédupliquée).
- Stockage : quelques Mo (on ne garde que les totaux journaliers, ~80 jours).
- CPU : négligeable (décodage HDF5 ~1 s / passe).

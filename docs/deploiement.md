# Mise en ligne d'Isoloir

Isoloir s'installe sur un serveur (un petit VPS suffit) avec Docker, derrière un reverse proxy qui gère le domaine et le HTTPS : ce guide prend [Caddy](https://caddyserver.com), qui obtient seul ses certificats. Le reverse proxy reçoit les visiteurs sur les ports 80/443 et transmet à Isoloir, qui écoute seulement sur `127.0.0.1:8084`, invisible depuis Internet. D'autres sites peuvent tourner sur le même serveur, derrière le même Caddy.

```
membre ──HTTPS──▶ Caddy du serveur ──HTTP──▶ 127.0.0.1:8084 ──▶ Isoloir (docker-compose.prod.shared.yml)
                                                                  └─ app : Node 24 + SQLite (volume isoloir_data)
```

Dans ce guide, le domaine est `isoloir.exemple.fr` : remplace-le partout par le tien (un sous-domaine du site de l'association convient très bien). Les étapes 1 et 2 se font hors du serveur, et peuvent se faire en parallèle : le DNS met du temps à se propager.

## 1. Le domaine

Chez le registrar, ajoute un enregistrement DNS :

| Type | Nom | Valeur |
|------|-----|--------|
| A | `isoloir` (le sous-domaine) | l'IPv4 du VPS |

Pour vérifier depuis ta machine : `dig +short isoloir.exemple.fr` doit répondre l'IP du VPS.

## 2. L'application Discord

Sur https://discord.com/developers/applications :

1. **New Application**, nomme-la (le nom s'affiche sur l'écran « Autoriser » que voient les membres : « Vote AG », par exemple).
2. **OAuth2** : note le *Client ID*, clique *Reset Secret* et note le *Client Secret*. Dans *Redirects*, ajoute exactement `https://isoloir.exemple.fr/auth/discord/callback` (et `http://localhost:8890/auth/discord/callback` si tu veux tester la vraie connexion en local).
3. Pas besoin de bot : l'application ne lit que l'identité du membre et, si tu le demandes, son appartenance au serveur et ses rôles.

Les identifiants dont tu auras besoin (Discord → *Paramètres → Avancés → Mode développeur*, puis clic droit → *Copier l'identifiant*) :

- le tien (et ceux des autres admins du scrutin) → `ADMIN_IDS` ;
- facultatif, celui du serveur de l'association → `GUILD_ID` : seuls ses membres pourront se connecter ;
- facultatif, celui du rôle des votants (ex. « Adhérent à jour ») → `VOTER_ROLE_ID` : seuls les membres qui ont ce rôle reçoivent un bulletin.

## 3. Le serveur (une seule fois)

Docker et le plugin Compose doivent être installés (`docker compose version` répond). Puis :

```bash
git clone https://github.com/jarash/isoloir.git   # ou ton fork
cd isoloir
cp .env.local.dist .env.local
chmod 600 .env.local
nano .env.local
```

Remplis chaque valeur en suivant les commentaires du fichier. `HTTP_PORT` doit être un port libre sur le serveur.

### Aux couleurs de l'association (facultatif)

`ORG_NAME` et `ORG_URL` (dans `.env.local`) affichent le nom et le site de l'association dans l'en-tête et le pied de page. Pour le logo, un bandeau d'accueil et les couleurs, copie le modèle et adapte-le :

```bash
cp -r custom.example custom
# puis : custom/logo.svg (ou .png), custom/banner.jpg, et les variables de custom/theme.css
```

Le dossier `custom/` reste sur le serveur, hors du dépôt git : il est monté dans le conteneur, un rechargement de la page suffit après une modification.

## 4. Le Caddy du serveur

Pas encore de Caddy sur le serveur ? Sur Debian ou Ubuntu : [installe le paquet officiel](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) (`sudo apt install caddy` une fois son dépôt ajouté) ; il démarre tout seul et lit `/etc/caddy/Caddyfile`. Un autre reverse proxy (nginx, Traefik…) convient aussi : il doit transmettre en HTTP à `127.0.0.1:8084` et gérer le HTTPS.

Ajoute ce bloc à la configuration de Caddy (`/etc/caddy/Caddyfile`) :

```
isoloir.exemple.fr {
    reverse_proxy 127.0.0.1:8084
}
```

Puis recharge-le : `sudo systemctl reload caddy`. Caddy obtient tout seul le certificat HTTPS. Les en-têtes de sécurité (HSTS, CSP…) sont posés par l'application elle-même : rien d'autre à ajouter. S'il tourne lui-même dans Docker, `127.0.0.1` désigne son conteneur et non le serveur : mets `HTTP_BIND_IP=172.17.0.1` (l'adresse du pont Docker, donnée par `ip -4 addr show docker0`) dans le `.env.local`, et `reverse_proxy 172.17.0.1:8084` dans le bloc.

## 5. Premier lancement

```bash
make prod-up
docker compose -f docker-compose.prod.shared.yml ps   # app est "Up (healthy)"
docker logs isoloir_app                               # {"event":"started",...}
```

Ouvre `https://isoloir.exemple.fr`, connecte-toi avec Discord : comme ton identifiant est dans `ADMIN_IDS`, tu arrives sur **Administration**.

## 6. Les sauvegardes

Le script `.docker/backup.sh` sauvegarde la base dans `/var/backups/isoloir` et garde 14 jours. La base est tout.

```bash
sudo mkdir -p /var/backups/isoloir && sudo chown "$USER" /var/backups/isoloir
.docker/backup.sh
```

Pendant l'AG, une sauvegarde juste après la clôture du vote suffit. Pour une sauvegarde chaque nuit : `crontab -e`, et la ligne (avec le vrai chemin du dépôt) :

```
15 4 * * * /home/TON_USER/isoloir/.docker/backup.sh >> /var/backups/isoloir/backup.log 2>&1
```

### Restaurer une sauvegarde

Cela **remplace** les données actuelles.

```bash
docker compose -f docker-compose.prod.shared.yml stop app
gunzip -c /var/backups/isoloir/db_AAAA-MM-JJ_HHMM.sqlite.gz > /tmp/isoloir.db
docker cp /tmp/isoloir.db isoloir_app:/data/isoloir.db && rm /tmp/isoloir.db
docker compose -f docker-compose.prod.shared.yml start app
```

## 7. Mettre à jour

```bash
cd isoloir
.docker/deploy.sh main        # ou un tag : .docker/deploy.sh v1.1.0
```

Le script fait une sauvegarde, récupère la version, reconstruit et relance le conteneur, puis attend que `/health` réponde. S'il échoue, il affiche les derniers logs ; pour revenir en arrière, relance-le avec la version d'avant.

**Pas de mise à jour pendant un vote ouvert** : le redémarrage déconnecte les membres une poignée de secondes (leurs sessions et les votes sont gardés, mais c'est stressant en pleine AG).

Les données sont dans le volume Docker `isoloir_data` : elles survivent aux reconstructions. Ne lance jamais `docker compose down -v` : le `-v` supprime ce volume.

## 8. Les logs

```bash
docker logs -f isoloir_app
```

Une ligne JSON par requête (méthode, chemin, statut, durée) : jamais le contenu d'un formulaire, donc jamais un choix de vote.

## Après l'AG

1. Dans **Administration** (vote clos) : **Télécharger les résultats**, à joindre au procès-verbal.
2. Une fois le délai de contestation passé (celui annoncé dans `RETENTION`, souvent deux mois) : **Effacer toutes les données** (taper `EFFACER`). La base est vidée et réécrite, rien n'y reste récupérable.
3. Les sauvegardes, elles, sont hors de portée du site. Supprime-les, et retire la ligne cron si tu l'avais mise :

   ```bash
   rm -f /var/backups/isoloir/db_*.sqlite.gz
   ```

   Si tu avais copié des sauvegardes ailleurs (`scp`), supprime-les aussi.
4. Les logs (`docker logs isoloir_app`) ne contiennent ni nom ni vote : seulement l'heure et les pages visitées. Ils
   disparaissent à la reconstruction du conteneur (`make prod-up`).

## Avant l'AG

- [ ] Les mentions légales et le contact remplis dans `.env.local` (`LEGAL_*`, `CONTACT_EMAIL`, `RETENTION`) : `https://isoloir.exemple.fr/confidentialite` ne montre plus de « à renseigner ».
- [ ] `https://isoloir.exemple.fr` s'ouvre avec un cadenas, et `https://isoloir.exemple.fr/health` répond `{"status":"ok"}`.
- [ ] La connexion Discord marche avec ton compte (admin) et avec celui d'un membre (et elle est refusée à un compte hors du serveur, si `GUILD_ID` est rempli).
- [ ] Une répétition : un poste de test, deux candidats, ouvrir, voter à deux, clore, regarder les résultats, puis **Nouveau tour** pour tout effacer.
- [ ] Les postes, les candidats et les procurations saisis.
- [ ] Une sauvegarde lancée à la main.

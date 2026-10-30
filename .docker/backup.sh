#!/usr/bin/env bash
# Sauvegarde d'Isoloir, à lancer sur le serveur (voir docs/deploiement.md) : la base SQLite (db_<date>.sqlite.gz).
# La base est tout. Les sauvegardes de plus de KEEP_DAYS jours (14 par défaut) sont supprimées.
#
# Usage : .docker/backup.sh [dossier]   (par défaut /var/backups/<INSTANCE_NAME>)
set -euo pipefail

# L'instance de ce dossier (INSTANCE_NAME du .env.local, "isoloir" par défaut) : son conteneur, son dossier.
cd "$(dirname "$0")/.."
INSTANCE="${INSTANCE_NAME:-$(sed -n 's/^INSTANCE_NAME=//p' .env.local 2>/dev/null | tr -d "\"'" | tail -n 1)}"
INSTANCE="${INSTANCE:-isoloir}"
DEST="${1:-/var/backups/$INSTANCE}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"

# L'émargement (qui a voté) est une donnée personnelle : lisible par l'utilisateur qui sauvegarde, et lui seul.
umask 077
mkdir -p "$DEST"

# Une copie cohérente faite dans le conteneur, puis rapatriée. Écrite d'abord sous un nom temporaire : une sauvegarde
# ratée ne laisse pas un fichier tronqué qui aurait l'air bon.
docker exec "${INSTANCE}_app" node --disable-warning=ExperimentalWarning scripts/backup.js /tmp/backup.sqlite
docker exec "${INSTANCE}_app" cat /tmp/backup.sqlite | gzip > "$DEST/db_$STAMP.sqlite.gz.part"
docker exec "${INSTANCE}_app" rm -f /tmp/backup.sqlite
mv "$DEST/db_$STAMP.sqlite.gz.part" "$DEST/db_$STAMP.sqlite.gz"

find "$DEST" -maxdepth 1 -name 'db_*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '*.part' -delete

echo "Sauvegarde $STAMP : $(du -h "$DEST/db_$STAMP.sqlite.gz" | cut -f1), dans $DEST."

#!/usr/bin/env bash
# Déploie une version d'Isoloir sur ce serveur (voir docs/deploiement.md) : sauvegarde, récupère le code, reconstruit
# et relance le conteneur, puis attend que le site réponde.
#
# Usage : .docker/deploy.sh <version>   où <version> est "main", un commit complet (40 caractères) ou un tag (v1.2.0)
set -euo pipefail

# Lit une valeur du .env.local de cette installation.
setting() {
    sed -n "s/^$1=//p" .env.local 2>/dev/null | tr -d "\"'" | tail -n 1
}

# Tout dans une fonction : le script est lu en entier avant que "git checkout" ne le remplace.
main() {
    cd "$(dirname "$0")/.."
    local ref="${1:-}"
    # Rien d'autre qu'une version : ce qui arrive ici peut venir de l'extérieur (SSH).
    if [[ ! "$ref" =~ ^(main|[0-9a-f]{40}|v[0-9][0-9A-Za-z.-]{0,40})$ ]]; then
        echo "Usage : .docker/deploy.sh <main | commit complet | tag vX.Y.Z>" >&2
        exit 2
    fi
    [ "$ref" = "main" ] && ref="origin/main"

    local instance bind port
    instance="$(setting INSTANCE_NAME)"; instance="${instance:-isoloir}"
    # L'adresse où le site écoute sur le serveur : 127.0.0.1, ou celle du pont Docker si le Caddy du serveur est un conteneur.
    bind="$(setting HTTP_BIND_IP)"; bind="${bind:-127.0.0.1}"
    port="$(setting HTTP_PORT)"; port="${port:-8084}"

    # Une sauvegarde juste avant, si l'installation tourne déjà.
    if docker inspect "${instance}_app" > /dev/null 2>&1; then
        echo "==> Sauvegarde avant déploiement"
        .docker/backup.sh
    fi

    echo "==> Récupération de $ref"
    git fetch --tags --prune --force origin
    git checkout --detach "$ref"

    echo "==> Construction et relance de $instance ($(git describe --tags --always))"
    make prod-up

    echo "==> Attente du site ($bind:$port)"
    for _ in $(seq 1 24); do
        if curl -fsS -o /dev/null "http://$bind:$port/health"; then
            echo "==> $instance répond : déployé en $(git describe --tags --always)."
            exit 0
        fi
        sleep 5
    done

    echo "Le site ne répond pas après 2 minutes. Derniers logs :" >&2
    docker logs --tail 40 "${instance}_app" >&2 || true
    exit 1
}

main "$@"

# Isoloir : l'image de production (docker-compose.prod.shared.yml). Node 24 apporte SQLite : aucune dépendance native.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/isoloir.db \
    TZ=Europe/Paris

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# Le volume de la base appartient à l'utilisateur non root qui fait tourner le site.
RUN mkdir -p /data && chown node:node /data
# Le commit construit (make prod-up), affiché en pied de page : on peut le comparer au code publié.
ARG APP_VERSION=inconnue
ENV APP_VERSION=$APP_VERSION

USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]

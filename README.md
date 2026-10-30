# Isoloir

Le vote à bulletin secret de l'élection du bureau, pour une AG qui se tient sur Discord.

- **Connexion avec Discord**, réservable aux membres du serveur de l'association et à un rôle (ex. « Adhérent »).
- **Un bulletin par poste** : un candidat ou vote blanc ; pour une candidature unique, Pour / Contre / Blanc. Majorité relative des suffrages exprimés (les blancs ne comptent pas dans les %).
- **Anonyme** : l'émargement (qui a voté) et l'urne (les choix) sont deux tables sans aucun lien. Chaque choix est une ligne à part, à clé aléatoire, sans date : même l'admin, même avec la base sous les yeux, ne peut pas savoir qui a voté quoi.
- **Procurations** : l'admin enregistre « X donne procuration à Y ». Y reçoit un bulletin par voix (le sien, puis un par procuration), X ne peut plus voter lui-même. Au plus `MAX_PROXIES` procurations par mandataire (1 par défaut), pas de procuration en cascade, et pas de procuration pour quelqu'un qui a déjà voté.
- **Résultats visuels** à partager en écran pendant l'AG, et un résumé tout prêt à coller dans un salon Discord.

Node 24 (SQLite intégré), Express, rendu côté serveur, une seule dépendance.

## Développer

```bash
make up      # http://localhost:8890, avec une connexion d'essai sans Discord
make logs
make test    # ou, hors Docker : npm test
make down
```

La connexion d'essai (`DEV_LOGIN=1`, jamais en production) demande un pseudo ; coche « Administrateur·rice » pour gérer le scrutin. Ouvre plusieurs fenêtres privées pour jouer plusieurs membres. La base de dev est `var/isoloir.db` : supprime-la pour repartir de zéro.

## Mettre en ligne

Voir [docs/deploiement.md](docs/deploiement.md) : application Discord, `.env.local`, bloc du Caddy du serveur, `make prod-up`, sauvegardes.

## Le déroulé d'une AG

1. **Avant** (état *En préparation*) : dans **Administration**, renommer le scrutin, créer les postes et leurs candidats, saisir les procurations reçues. Les procurations peuvent encore être ajoutées pendant le vote, pour les retardataires.
2. **Ouvrir le vote** : postes et candidats sont figés. Les membres se connectent et votent ; la participation s'affiche en direct, et l'émargement donne la liste de qui a voté (jamais pour qui).
3. **Clore le vote** : les résultats apparaissent pour les admins. Partage ton écran sur Discord pour les annoncer, puis, si tu veux, **Publier aux membres** et copie le résumé dans un salon.
4. **Nouveau tour** (s'il faut départager une égalité, ou pour un second tour) : efface votes et émargement. Pense à copier les résultats d'abord. Postes, candidats et procurations restent, et redeviennent modifiables.

5. **Fin d'AG** : dans **Administration**, *Télécharger les résultats* (un fichier texte pour le PV), puis *Effacer toutes les données* (taper `EFFACER`). Membres, émargement, procurations, bulletins, postes : il ne reste rien dans la base, et tout le monde est déconnecté. Les sauvegardes du serveur sont à supprimer à la main (voir [docs/deploiement.md](docs/deploiement.md#après-lag)).

Un vote est définitif : pas de modification une fois le bulletin déposé.

## Ce que l'anonymat suppose

Le site ne garde jamais le lien entre un membre et son bulletin. Il reste deux limites, propres à tout vote en ligne :

- quelqu'un qui administre le serveur pourrait, en modifiant le code ou en observant la base en direct pendant le vote, rapprocher votes et votants. Confie l'hébergement à une personne de confiance, et ne la laisse pas seule à regarder ;
- avec très peu de votants, les résultats eux-mêmes peuvent trahir des votes (si tout le monde a voté pareil, par exemple).

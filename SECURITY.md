# Sécurité

Isoloir sert à des votes à bulletin secret : une faille peut fausser une élection ou lever l'anonymat des votants.
Merci de la signaler **en privé**, jamais dans une issue publique.

## Signaler une faille

Sur GitHub, onglet **Security** du dépôt, puis **Report a vulnerability** : le message n'est visible que des
mainteneurs. Indiquez ce que vous avez observé, comment le reproduire, et la version concernée (le numéro de commit
affiché en pied de page du site).

Vous recevrez une réponse sous une semaine. Une fois la correction publiée, la faille est décrite dans l'avis de
sécurité, avec votre nom si vous le souhaitez.

## Ce qui nous intéresse en priorité

- Tout moyen de relier un bulletin à un votant (base de données, journaux, temps de réponse, ordre des lignes…).
- Voter deux fois, voter à la place d'un autre membre, ou utiliser une procuration qui n'est pas la sienne.
- Voir les résultats avant la clôture, ou accéder à l'administration sans être admin.
- Contourner la connexion Discord ou les restrictions de serveur et de rôle.
- Les failles web classiques : injection, XSS, CSRF, fixation de session.

## Hors du champ

- Une personne qui administre le serveur peut toujours, en modifiant le code ou en observant la base pendant le vote,
  rapprocher votes et votants : c'est une limite connue de tout vote en ligne de ce type (voir le README).
- Les failles de Discord, de Docker ou du reverse proxy eux-mêmes : signalez-les à leurs auteurs.
- La connexion d'essai (`DEV_LOGIN=1`) : elle est refusée en production.

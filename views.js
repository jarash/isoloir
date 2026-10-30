// Isoloir : les pages HTML, rendues côté serveur.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const STATUS_LABELS = { draft: 'En préparation', open: 'Vote ouvert', closed: 'Vote clos' };
const pct = (value) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${e(csrf)}">`;

function button(action, csrf, label, { kind = '', confirm = '', fields = '' } = {}) {
  return `<form method="post" action="${e(action)}" class="inline"${confirm ? ` data-confirm="${e(confirm)}"` : ''}>
    ${csrfField(csrf)}${fields}<button class="${e(kind)}">${label}</button></form>`;
}

function layout({ title, user, csrf, flash, dev }, pageTitle, body, { wide = false } = {}) {
  const account = user
    ? `<div class="account">
        ${user.avatar ? `<img src="${e(user.avatar)}" alt="" width="28" height="28">` : ''}
        <span>${e(user.name)}</span>
        ${user.isAdmin ? '<a href="/admin">Admin</a>' : ''}
        ${button('/logout', csrf, 'Déconnexion', { kind: 'link' })}
      </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(pageTitle)} · ${e(title)}</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="/app.js" defer></script>
</head>
<body>
  <header class="top">
    <a class="brand" href="/"><img src="/favicon.svg" alt="" width="24" height="24"> Isoloir</a>
    ${account}
  </header>
  ${dev ? '<p class="dev">Mode essai : connexion sans Discord. Ne pas utiliser pour le vrai vote.</p>' : ''}
  <main class="${wide ? 'wide' : ''}">
    ${flash ? `<p class="flash ${e(flash.type)}" role="status">${e(flash.text)}</p>` : ''}
    ${body}
  </main>
</body>
</html>`;
}

export function error(message) {
  return layout({ title: 'Isoloir' }, 'Oups', `<section class="card"><h1>Oups</h1><p>${e(message)}</p><p><a href="/">Retour à l’accueil</a></p></section>`);
}

// --- Accueil ----------------------------------------------------------------------------------------------------

export function home(data) {
  const { user, status, voices, resultsPublic, title } = data;
  let body;
  if (!user) {
    body = `<section class="card hero">
      <h1>${e(title)}</h1>
      <p>Le vote est anonyme : l’application note que vous avez voté, jamais pour qui.</p>
      <p class="status ${e(status)}">${STATUS_LABELS[status]}</p>
      <a class="button primary big" href="/login">Se connecter avec Discord</a>
    </section>`;
  } else if (!user.canVote) {
    body = `<section class="card"><h1>${e(title)}</h1>
      <p>Vous êtes connecté·e en tant qu’administrateur·rice, sans droit de vote (rôle Discord des votants absent).</p>
      <p><a class="button primary" href="/admin">Administrer le scrutin</a></p></section>`;
  } else {
    const list = voices.map((v) => `<li>${e(v.label)} :
      ${v.voted ? '<strong class="ok">a voté ✓</strong>'
        : v.givenTo ? `procuration donnée à ${e(v.givenTo)}`
          : '<strong>à voter</strong>'}</li>`).join('');
    const remaining = voices.filter((v) => v.usable).length;
    let action = '';
    if (status === 'open' && remaining) action = `<a class="button primary big" href="/vote">Voter (${plural(remaining, 'bulletin', 'bulletins')})</a>`;
    else if (status === 'draft') action = '<p class="muted">Le vote n’est pas encore ouvert. Gardez cette page ouverte et rechargez-la quand le bureau l’annonce.</p>';
    else if (status === 'closed' && resultsPublic) action = '<a class="button primary big" href="/resultats">Voir les résultats</a>';
    else if (status === 'closed') action = '<p class="muted">Le vote est clos. Les résultats seront annoncés pendant l’AG.</p>';
    body = `<section class="card">
      <h1>${e(title)}</h1>
      <p class="status ${e(status)}">${STATUS_LABELS[status]}</p>
      <h2>Vos voix</h2>
      <ul class="voices">${list}</ul>
      ${action}
    </section>`;
  }
  return layout(data, 'Accueil', body);
}

export function devLogin(data) {
  return layout(data, 'Connexion d’essai', `<section class="card">
    <h1>Connexion d’essai</h1>
    <form method="post" action="/dev-login" class="stack">
      ${csrfField(data.csrf)}
      <label>Pseudo <input name="username" required maxlength="32" pattern="[A-Za-z0-9._]+" autofocus></label>
      <label class="check"><input type="checkbox" name="admin" value="1"> Administrateur·rice</label>
      <button class="primary">Se connecter</button>
    </form>
  </section>`);
}

// --- Bulletins --------------------------------------------------------------------------------------------------

function ballotForm(voice, positions, csrf) {
  const fieldsets = positions.map((p) => {
    const single = p.candidates.length === 1;
    const options = single
      ? [[String(p.candidates[0].id), `Pour (${p.candidates[0].name})`], ['against', 'Contre']]
      : p.candidates.map((c) => [String(c.id), c.name]);
    options.push(['blank', 'Vote blanc']);
    const name = `pos_${p.id}`;
    return `<fieldset>
      <legend>${e(p.name)}${single ? ` <span class="muted">· candidature unique : ${e(p.candidates[0].name)}</span>` : ''}</legend>
      ${options.map(([value, label]) => `<label class="choice${value === 'blank' ? ' blank' : ''}">
        <input type="radio" name="${name}" value="${e(value)}" required> <span>${e(label)}</span></label>`).join('')}
    </fieldset>`;
  }).join('');
  return `<form method="post" action="/vote" class="card ballot" data-confirm="Déposer ce bulletin ? Un vote est définitif.">
    ${csrfField(csrf)}
    <input type="hidden" name="voice" value="${e(voice.key)}">
    <h2>Bulletin · ${e(voice.label)}</h2>
    ${fieldsets}
    <button class="primary big">Déposer ce bulletin</button>
  </form>`;
}

export function vote(data) {
  const { status, voices, positions, csrf, title } = data;
  if (status !== 'open') {
    return layout(data, 'Vote', `<section class="card"><h1>${e(title)}</h1>
      <p>Le vote n’est pas ouvert (${STATUS_LABELS[status].toLowerCase()}).</p><p><a href="/">Retour à l’accueil</a></p></section>`);
  }
  const done = voices.filter((v) => !v.usable).map((v) => `<li>${e(v.label)} :
    ${v.voted ? '<strong class="ok">a voté ✓</strong>' : `procuration donnée à ${e(v.givenTo)}`}</li>`).join('');
  const forms = voices.filter((v) => v.usable).map((v) => ballotForm(v, positions, csrf)).join('');
  const intro = voices.length > 1
    ? '<p>Vous détenez plusieurs voix : chacune a son propre bulletin, à remplir selon les consignes de votre mandant.</p>'
    : '';
  return layout(data, 'Vote', `<h1>${e(title)}</h1>
    ${intro}
    ${done ? `<ul class="voices card">${done}</ul>` : ''}
    ${forms || '<section class="card"><p><strong class="ok">Toutes vos voix ont voté. Merci !</strong></p><p class="muted">Les résultats seront annoncés à la clôture.</p></section>'}`);
}

// --- Résultats --------------------------------------------------------------------------------------------------

function bar(row, max) {
  // Largeur relative au premier : la barre la plus longue occupe toute la piste.
  const width = max ? Math.max((row.n / max) * 100, row.n ? 1.5 : 0) : 0;
  // Des largeurs en % dans les attributs SVG : la CSP interdit les attributs style.
  return `<svg class="bar" width="100%" height="16" aria-hidden="true">
    <rect class="track" x="0" y="0" width="100%" height="16" rx="4"/>
    ${row.n ? `<rect class="fill${row.against ? ' against' : ''}" x="0" y="0" width="${width.toFixed(2)}%" height="16" rx="4"><title>${e(row.label)} : ${row.n} voix (${pct(row.pct)})</title></rect>` : ''}
  </svg>`;
}

function positionResult(p) {
  const max = Math.max(0, ...p.rows.map((r) => r.n));
  let verdict;
  if (p.total === 0) verdict = '<p class="verdict muted">Aucun bulletin.</p>';
  else if (p.tie) verdict = `<p class="verdict tie">⚠ Égalité entre ${p.elected.map(e).join(' et ')} : à départager.</p>`;
  else if (p.elected.length) verdict = `<p class="verdict elected">✓ <strong>${e(p.elected[0])}</strong> est élu·e.</p>`;
  else verdict = `<p class="verdict rejected">✗ ${e(p.candidate)} n’est pas élu·e.</p>`;

  const rows = p.rows.map((r) => `<tr class="${r.winner && !p.tie ? 'is-winner' : ''}">
      <th scope="row">${e(r.label)}${r.winner && !p.tie ? ' <span class="badge">Élu·e</span>' : ''}</th>
      <td class="bar-cell">${bar(r, max)}</td>
      <td class="num">${r.n}</td>
      <td class="num pct">${pct(r.pct)}</td>
    </tr>`).join('');
  return `<section class="card result">
    <h2>${e(p.name)}${p.single ? ` <span class="muted">· ${e(p.candidate)}</span>` : ''}</h2>
    ${verdict}
    <table class="bars">
      <caption class="sr-only">Résultats du poste ${e(p.name)}</caption>
      <thead><tr><th scope="col">${p.single ? 'Réponse' : 'Candidat·e'}</th><th scope="col"><span class="sr-only">Graphique</span></th><th scope="col" class="num">Voix</th><th scope="col" class="num">%</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted small">${plural(p.expressed, 'suffrage exprimé', 'suffrages exprimés')} · ${plural(p.blank, 'vote blanc', 'votes blancs')} (non comptés dans les %)</p>
  </section>`;
}

export function discordSummary(title, results) {
  const { participation: part } = results;
  const lines = [`**${title} — résultats**`, `Participation : ${plural(part.total, 'voix', 'voix')}${part.proxies ? ` (dont ${plural(part.proxies, 'procuration', 'procurations')})` : ''}`, ''];
  for (const p of results.positions) {
    let head;
    if (p.tie) head = `égalité entre ${p.elected.join(' et ')}`;
    else if (p.elected.length) head = `**${p.elected[0]}** élu·e`;
    else head = p.total ? `${p.candidate} non élu·e` : 'aucun bulletin';
    const detail = p.rows.map((r) => `${r.label} ${r.n} (${pct(r.pct)})`).join(' · ');
    lines.push(`**${p.name}** : ${head}`, `> ${detail} · blancs : ${p.blank}`, '');
  }
  return lines.join('\n').trimEnd();
}

export function results(data) {
  const { results: r, title, user, csrf, resultsPublic } = data;
  const part = r.participation;
  const admin = user?.isAdmin
    ? `<section class="card no-print">
        <h2>Partager</h2>
        <p>${resultsPublic ? 'Les résultats sont visibles par tous les membres connectés.' : 'Seuls les admins voient cette page.'}</p>
        ${button('/admin/publish', csrf, resultsPublic ? 'Masquer aux membres' : 'Publier aux membres', { kind: resultsPublic ? '' : 'primary', fields: `<input type="hidden" name="public" value="${resultsPublic ? '0' : '1'}">` })}
        <label class="stack">Résumé à coller dans Discord
          <textarea id="summary" rows="8" readonly>${e(discordSummary(title, r))}</textarea></label>
        <button type="button" data-copy="summary">Copier le résumé</button>
      </section>`
    : '';
  return layout(data, 'Résultats', `
    <header class="results-head">
      <h1>${e(title)}</h1>
      <p class="kpis">
        <span><strong>${part.total}</strong> ${part.total > 1 ? 'voix exprimées' : 'voix exprimée'}</span>
        <span><strong>${part.proxies}</strong> par procuration</span>
      </p>
    </header>
    <div class="results-grid">${r.positions.map(positionResult).join('')}</div>
    ${admin}`, { wide: true });
}

// --- Administration ---------------------------------------------------------------------------------------------

export function admin(data) {
  const { status, positions, proxies, participation: part, csrf, title, resultsPublic, maxProxies } = data;
  const draft = status === 'draft';

  const actions = {
    draft: button('/admin/open', csrf, 'Ouvrir le vote', { kind: 'primary big', confirm: 'Ouvrir le vote ? Les postes et candidats ne seront plus modifiables.' }),
    open: button('/admin/close', csrf, 'Clore le vote', { kind: 'danger big', confirm: 'Clore le vote ? Plus personne ne pourra voter.' }),
    closed: `<a class="button primary big" href="/resultats">Voir les résultats</a>
      ${button('/admin/reset', csrf, 'Nouveau tour', { confirm: 'Effacer tous les votes et repasser en préparation ? Copiez les résultats avant : ils seront perdus.' })}`,
  }[status];

  const positionList = positions.map((p) => `<li class="position">
      <div class="row"><strong>${e(p.name)}</strong>
        ${draft ? button(`/admin/positions/${p.id}/delete`, csrf, 'Supprimer le poste', { kind: 'link danger', confirm: `Supprimer le poste « ${p.name} » et ses candidats ?` }) : ''}</div>
      <ul class="candidates">
        ${p.candidates.map((c) => `<li>${e(c.name)} ${draft ? button(`/admin/candidates/${c.id}/delete`, csrf, '✕', { kind: 'link danger', confirm: `Retirer ${c.name} ?` }) : ''}</li>`).join('') || '<li class="muted">Aucun candidat</li>'}
      </ul>
      ${p.candidates.length === 1 ? '<p class="muted small">Candidature unique : on votera Pour / Contre / Blanc.</p>' : ''}
      ${draft ? `<form method="post" action="/admin/positions/${p.id}/candidates" class="row">
          ${csrfField(csrf)}<input name="name" placeholder="Nom du candidat ou de la candidate" required maxlength="100" aria-label="Nouveau candidat pour ${e(p.name)}">
          <button>Ajouter</button></form>` : ''}
    </li>`).join('');

  const canEditProxies = status !== 'closed';
  const proxyRows = proxies.map((p) => `<tr>
      <td>${e(p.mandant_name)}${p.mandant_label ? `<br><span class="muted small">${e(p.mandant_label)}</span>` : '<br><span class="warn small">sans compte Discord : non bloqué</span>'}</td>
      <td>${e(p.mandataire_label)}</td>
      <td>${p.used ? '<span class="ok">utilisée ✓</span>' : 'non utilisée'}</td>
      <td>${canEditProxies && !p.used ? button(`/admin/proxies/${p.id}/delete`, csrf, 'Retirer', { kind: 'link danger', confirm: 'Retirer cette procuration ?' }) : ''}</td>
    </tr>`).join('');

  return layout(data, 'Administration', `
    <h1>Administration</h1>
    <section class="card">
      <div class="row spread">
        <h2>Scrutin</h2>
        <span class="status ${e(status)}">${STATUS_LABELS[status]}</span>
      </div>
      ${draft ? `<form method="post" action="/admin/title" class="row">${csrfField(csrf)}
          <input name="title" value="${e(title)}" required maxlength="120" aria-label="Titre du scrutin"><button>Renommer</button></form>`
        : `<p><strong>${e(title)}</strong></p>`}
      <div class="row">${actions}</div>
      ${status === 'closed' ? `<p class="muted small">${resultsPublic ? 'Résultats publiés aux membres.' : 'Résultats visibles des seuls admins.'}</p>` : ''}
    </section>

    <section class="card">
      <h2>Participation</h2>
      <p class="kpi" id="participation" data-src="${status === 'open' ? '/admin/participation' : ''}">
        <strong data-field="total">${part.total}</strong> ${part.total > 1 ? 'voix ont' : 'voix a'} voté,
        dont <strong data-field="proxies">${part.proxies}</strong> par procuration</p>
      <details><summary>Émargement (qui a voté, jamais pour qui)</summary>
        <ul class="columns">${part.names.map((n) => `<li>${e(n)}</li>`).join('') || '<li class="muted">Personne pour l’instant.</li>'}</ul>
        <p class="muted small">Rechargez la page pour mettre la liste à jour.</p>
      </details>
    </section>

    <section class="card">
      <h2>Postes et candidats</h2>
      ${draft ? '' : '<p class="muted small">Modifiables seulement en préparation (après « Nouveau tour » une fois le vote clos).</p>'}
      <ul class="positions">${positionList || '<li class="muted">Aucun poste pour l’instant.</li>'}</ul>
      ${draft ? `<form method="post" action="/admin/positions" class="row">${csrfField(csrf)}
          <input name="name" placeholder="Nouveau poste (Président·e, Trésorier·e…)" required maxlength="100" aria-label="Nouveau poste">
          <button class="primary">Ajouter le poste</button></form>` : ''}
    </section>

    <section class="card">
      <h2>Procurations</h2>
      <p class="muted small">Un mandataire peut détenir au plus ${plural(maxProxies, 'procuration', 'procurations')} (MAX_PROXIES).
        Il recevra un bulletin par voix. Identifiez les personnes par leur identifiant Discord
        (clic droit sur le profil → Copier l’identifiant, mode développeur activé) ou leur nom d’utilisateur.</p>
      ${proxies.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>Mandant (absent)</th><th>Mandataire (vote pour lui)</th><th>État</th><th></th></tr></thead>
        <tbody>${proxyRows}</tbody></table></div>` : '<p class="muted">Aucune procuration.</p>'}
      ${canEditProxies ? `<form method="post" action="/admin/proxies" class="grid-form">${csrfField(csrf)}
          <label>Nom du mandant <input name="mandant_name" required maxlength="100" placeholder="Camille Durand"></label>
          <label>Discord du mandant <span class="muted">(recommandé)</span> <input name="mandant_ref" maxlength="64" placeholder="camille.d ou 1234…"></label>
          <label>Discord du mandataire <input name="mandataire_ref" required maxlength="64" placeholder="alex_42 ou 5678…"></label>
          <button class="primary">Enregistrer la procuration</button>
        </form>
        <p class="muted small">Sans compte Discord renseigné, le mandant n’est pas empêché de voter lui-même : vérifiez à l’émargement.</p>` : ''}
    </section>`);
}

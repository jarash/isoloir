// Isoloir : les pages HTML, rendues côté serveur.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Une empreinte du contenu dans l'adresse des fichiers statiques : après une modification, le navigateur ne garde pas
// l'ancienne version en cache.
// En production, calculée une fois ; en dev, à chaque page, pour suivre les modifications.
const fingerprints = new Map();
function asset(file) {
  if (!fingerprints.has(file) || process.env.NODE_ENV !== 'production') {
    const content = readFileSync(new URL(`public/${file}`, import.meta.url));
    fingerprints.set(file, `/${file}?v=${createHash('sha256').update(content).digest('hex').slice(0, 10)}`);
  }
  return fingerprints.get(file);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const STATUS_LABELS = { draft: 'En préparation', open: 'Vote ouvert', closed: 'Vote clos' };
const pct = (value) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Des icônes au trait, dans la couleur du texte (currentColor).
const icon = (d) => `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  admin: icon('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  logout: icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
  login: icon('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M14 17l5-5-5-5"/><path d="M19 12H8"/>'),
};

// La version qui tourne : le commit, pour vérifier que le serveur exécute bien le code publié.
function version() {
  const value = process.env.APP_VERSION || 'dev';
  const [sha, modified] = value.split('-');
  if (!/^[0-9a-f]{40}$/.test(sha)) return `version ${e(value)}`;
  const label = `version <code>${sha.slice(0, 7)}</code>`;
  const repo = process.env.REPO_URL?.replace(/\/+$/, '');
  const link = repo ? `<a href="${e(repo)}/tree/${sha}" title="Voir le code de cette version">${label}</a>` : label;
  return modified ? `${link} <span class="warn" title="Le serveur tourne avec des modifications non commitées : ce code n’est pas celui publié.">(modifiée)</span>` : link;
}

// La description saisie par l'admin, en texte simple : paragraphes séparés par une ligne vide, lignes « - » en liste,
// **gras**, liens http(s). Tout est échappé d'abord : aucun HTML saisi ne passe.
export function richText(text) {
  const inline = (line) => e(line)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" rel="noopener noreferrer">${url}</a>`);
  return String(text ?? '').split(/\n\s*\n/).filter((block) => block.trim()).map((block) => {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

function about(description, { collapsed = false } = {}) {
  if (!description) return '';
  return collapsed
    ? `<details class="card about"><summary><strong>Infos du scrutin</strong></summary><div class="rich">${richText(description)}</div></details>`
    : `<section class="card about"><div class="rich">${richText(description)}</div></section>`;
}

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${e(csrf)}">`;

function button(action, csrf, label, { kind = '', confirm = '', fields = '' } = {}) {
  return `<form method="post" action="${e(action)}" class="inline"${confirm ? ` data-confirm="${e(confirm)}"` : ''}>
    ${csrfField(csrf)}${fields}<button class="${e(kind)}">${label}</button></form>`;
}

function layout({ title, user, csrf, flash, dev, path }, pageTitle, body, { wide = false } = {}) {
  const initial = user ? e([...user.name][0]?.toUpperCase() ?? '?') : '';
  const navLink = (href, label, icon) => `<a class="top-button${path === href || path?.startsWith(`${href}/`) ? ' active' : ''}" href="${href}"${path === href ? ' aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  const account = user
    ? `<nav class="account" aria-label="Compte">
        ${user.isAdmin ? navLink('/admin', 'Admin', ICONS.admin) : ''}
        <span class="user-chip" title="${e(user.name)}">
          ${user.avatar ? `<img src="${e(user.avatar)}" alt="" width="28" height="28">` : `<span class="avatar-initial" aria-hidden="true">${initial}</span>`}
          <span class="user-name">${e(user.name)}</span>
        </span>
        <form method="post" action="/logout" class="inline">${csrfField(csrf)}
          <button class="top-button icon-only" aria-label="Déconnexion" title="Déconnexion">${ICONS.logout}</button></form>
      </nav>`
    : (!path || path === '/' ? '' : `<nav class="account"><a class="top-button" href="/login">${ICONS.login}<span>Se connecter</span></a></nav>`);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(pageTitle)} · ${e(title)}</title>
  <link rel="stylesheet" href="${asset('style.css')}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="${asset('app.js')}" defer></script>
</head>
<body>
  <header class="top">
    <a class="brand" href="/"><img src="/img/logo-frc.png" alt="" width="31" height="36"><span><small>FrenchCraft</small><strong>Isoloir</strong></span></a>
    ${account}
  </header>
  ${dev ? '<p class="dev">Mode essai : connexion sans Discord. Ne pas utiliser pour le vrai vote.</p>' : ''}
  <main class="${wide ? 'wide' : ''}">
    ${flash ? `<p class="flash ${e(flash.type)}" role="status">${e(flash.text)}</p>` : ''}
    ${body}
  </main>
  <footer class="bottom">Isoloir · le vote de l’AG de <a href="https://french-craft.com/">FrenchCraft</a> · <a href="/confidentialite">Confidentialité et mentions légales</a> · ${version()}</footer>
</body>
</html>`;
}

export function error(message) {
  return layout({ title: 'Isoloir' }, 'Oups', `<section class="card"><h1>Oups</h1><p>${e(message)}</p><p><a href="/">Retour à l’accueil</a></p></section>`);
}

// --- Accueil ----------------------------------------------------------------------------------------------------

export function home(data) {
  const { user, status, voices, resultsPublic, title, description } = data;
  let body;
  if (!user) {
    body = `<section class="card hero">
      <img class="banner" src="/img/bandeau.jpg" alt="FrenchCraft" width="2560" height="276">
      <h1>${e(title)}</h1>
      <p>Le vote est anonyme : l’application note que vous avez voté, jamais pour qui.</p>
      <p class="status ${e(status)}">${STATUS_LABELS[status]}</p>
      <a class="button primary big" href="/login">Se connecter avec Discord</a>
      <p class="muted small"><a href="/confidentialite">Ce que l’application fait de vos données</a></p>
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
    </section>
    ${about(description)}`;
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
    options.push(['blank', 'Vote blanc'], ['abstain', 'Abstention (ne pas se prononcer)']);
    const name = `pos_${p.id}`;
    return `<fieldset>
      <legend>${e(p.name)}${single ? ` <span class="muted">· candidature unique : ${e(p.candidates[0].name)}</span>` : ''}</legend>
      ${options.map(([value, label]) => `<label class="choice${value === 'blank' || value === 'abstain' ? ' blank' : ''}">
        <input type="radio" name="${name}" value="${e(value)}"> <span>${e(label)}</span></label>`).join('')}
    </fieldset>`;
  }).join('');
  return `<form method="post" action="/vote" class="card ballot" data-ballot data-confirm="Déposer ce bulletin ? Un vote est définitif.">
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
    ${about(data.description, { collapsed: true })}
    ${intro}
    ${done ? `<ul class="voices card">${done}</ul>` : ''}
    ${forms || '<section class="card"><p><strong class="ok">Toutes vos voix ont voté. Merci !</strong></p><p class="muted">Les résultats seront annoncés à la clôture.</p></section>'}`);
}

// --- Résultats --------------------------------------------------------------------------------------------------

// Une teinte par candidat, dans l'ordre fixe de la palette (jamais recyclée) ; le blanc est toujours gris.
const slot = (i) => (i < 8 ? `s${i + 1}` : 'other');

function bar(row, max, color) {
  // Largeur relative au premier : la barre la plus longue occupe toute la piste.
  const width = max ? Math.max((row.n / max) * 100, row.n ? 1.5 : 0) : 0;
  // Des largeurs en % dans les attributs SVG : la CSP interdit les attributs style.
  return `<svg class="bar" width="100%" height="16" aria-hidden="true">
    <rect class="track" x="0" y="0" width="100%" height="16" rx="4"/>
    ${row.n ? `<rect class="fill ${color}" x="0" y="0" width="${width.toFixed(2)}%" height="16" rx="4"><title>${e(row.label)} : ${row.n} voix (${pct(row.pct)})</title></rect>` : ''}
  </svg>`;
}

// La répartition de tous les bulletins du poste, blancs compris, sur une seule barre ; le repère marque la majorité
// absolue des suffrages exprimés.
function distribution(p, index) {
  if (p.total === 0) return '';
  const parts = [...p.rows.map((r, i) => ({ label: r.label, n: r.n, color: slot(i) })), { label: 'Blanc', n: p.blank, color: 'blank' }];
  let x = 0;
  const segments = parts.filter((part) => part.n).map((part) => {
    const width = (part.n / p.total) * 100;
    const rect = `<rect class="seg ${part.color}" x="${x.toFixed(2)}%" y="6" width="${width.toFixed(2)}%" height="20"><title>${e(part.label)} : ${plural(part.n, 'bulletin', 'bulletins')} sur ${p.total} (${pct(width)})</title></rect>`;
    x += width;
    return rect;
  }).join('');
  const majority = p.expressed ? (p.expressed / 2 / p.total) * 100 : null;
  const threshold = Math.floor(p.expressed / 2) + 1;
  return `<figure class="distribution">
    <svg width="100%" height="32" role="img" aria-label="Répartition des ${p.total} bulletins du poste ${e(p.name)}">
      <defs><clipPath id="clip-${index}"><rect x="0" y="6" width="100%" height="20" rx="4"/></clipPath></defs>
      <g clip-path="url(#clip-${index})">${segments}</g>
      ${majority !== null ? `<line class="majority" x1="${majority.toFixed(2)}%" x2="${majority.toFixed(2)}%" y1="0" y2="32"/>` : ''}
    </svg>
    <figcaption class="muted small">Répartition des ${p.total} bulletins${majority !== null ? ` · <span class="majority-key" aria-hidden="true"></span> majorité absolue : ${plural(threshold, 'voix', 'voix')}` : ''}</figcaption>
  </figure>`;
}

function positionResult(p, index) {
  const max = Math.max(0, ...p.rows.map((r) => r.n));
  let verdict;
  if (p.total === 0) verdict = '<p class="verdict muted">Aucun bulletin.</p>';
  else if (p.tie) verdict = `<p class="verdict tie">⚠ Égalité entre ${p.elected.map(e).join(' et ')} : à départager.</p>`;
  else if (p.elected.length) {
    const top = Math.max(...p.rows.map((r) => r.n));
    const kind = p.single || top > p.expressed / 2 ? 'majorité absolue' : 'majorité relative';
    verdict = `<p class="verdict elected">✓ <strong>${e(p.elected[0])}</strong> est élu·e <span class="muted">(${kind})</span>.</p>`;
  } else verdict = `<p class="verdict rejected">✗ ${e(p.candidate)} n’est pas élu·e.</p>`;

  const rows = p.rows.map((r, i) => `<tr class="${r.winner && !p.tie ? 'is-winner' : ''}">
      <th scope="row"><span class="swatch ${slot(i)}" aria-hidden="true"></span>${e(r.label)}${r.winner && !p.tie ? ' <span class="badge">Élu·e</span>' : ''}</th>
      <td class="bar-cell">${bar(r, max, slot(i))}</td>
      <td class="num">${r.n}</td>
      <td class="num pct">${pct(r.pct)}</td>
    </tr>`).join('');
  const blankRow = `<tr class="blank-row">
      <th scope="row"><span class="swatch blank" aria-hidden="true"></span>Blanc</th>
      <td></td>
      <td class="num">${p.blank}</td>
      <td class="num pct" title="Les blancs ne comptent pas dans les suffrages exprimés">–</td>
    </tr>`;
  return `<section class="card result">
    <h2>${e(p.name)}${p.single ? ` <span class="muted">· ${e(p.candidate)}</span>` : ''}</h2>
    ${verdict}
    ${distribution(p, index)}
    <table class="bars">
      <caption class="sr-only">Résultats du poste ${e(p.name)}</caption>
      <thead><tr><th scope="col">${p.single ? 'Réponse' : 'Candidat·e'}</th><th scope="col"><span class="sr-only">Graphique</span></th><th scope="col" class="num">Voix</th><th scope="col" class="num">% exprimés</th></tr></thead>
      <tbody>${rows}${blankRow}</tbody>
    </table>
    <p class="muted small">${plural(p.expressed, 'suffrage exprimé', 'suffrages exprimés')}${p.abstain ? ` · ${plural(p.abstain, 'abstention', 'abstentions')}` : ''} · blancs et abstentions ne comptent pas dans les %</p>
  </section>`;
}

// --- Quorum -----------------------------------------------------------------------------------------------------

export function quorumLabel(q) {
  if (!q.set) return 'Quorum non renseigné';
  const detail = `${q.total} présents ou représentés sur ${plural(q.required, 'requis', 'requis')}`;
  if (!q.counted) return `Quorum : ${plural(q.required, 'membre requis', 'membres requis')}, nombre de présents à saisir`;
  return q.reached ? `Quorum atteint ✓ (${detail})` : `Quorum non atteint : ${detail}, il en manque ${q.required - q.total}`;
}

export const quorumDetail = (q) => `${plural(q.present ?? 0, 'présent', 'présents')} + ${plural(q.represented, 'représenté par procuration', 'représentés par procuration')}`;

// La jauge va de 0 aux inscrits (ou au quorum si on ne les connaît pas) ; le repère marque le quorum.
const meterScale = (q) => q.members ?? q.required;
export const quorumMeterWidth = (q) => (q.set ? `${Math.min(100, (q.total / meterScale(q)) * 100).toFixed(2)}%` : '0%');

function quorumMeter(q) {
  if (!q.set) return '';
  const mark = (q.required / meterScale(q)) * 100;
  return `<svg class="quorum-meter" width="100%" height="28" aria-hidden="true">
    <rect class="track" x="0" y="6" width="100%" height="16" rx="4"/>
    <rect class="fill" data-meter x="0" y="6" width="${quorumMeterWidth(q)}" height="16" rx="4"/>
    <line class="majority" x1="${mark.toFixed(2)}%" x2="${mark.toFixed(2)}%" y1="0" y2="28"/>
  </svg>`;
}

function quorumBlock(q, { live = false } = {}) {
  if (!q.set) return '';
  return `<div class="quorum ${q.reached ? 'reached' : 'missing'}"${live ? ' data-quorum' : ''}>
    <p class="quorum-label"><span data-field="quorumLabel">${e(quorumLabel(q))}</span></p>
    ${quorumMeter(q)}
    <p class="muted small"><span data-field="quorumDetail">${e(quorumDetail(q))}</span> ·
      <span class="majority-key" aria-hidden="true"></span> quorum : ${q.unit === 'percent' ? `${q.value} % de ${q.members} membres, soit ` : ''}${plural(q.required, 'membre', 'membres')}${q.members && q.unit !== 'percent' ? ` sur ${q.members} inscrits` : ''}</p>
  </div>`;
}

export function discordSummary(title, results) {
  const { participation: part } = results;
  const q = results.quorum;
  const lines = [`**${title} — résultats**`, `Participation : ${plural(part.total, 'voix', 'voix')}${part.proxies ? ` (dont ${plural(part.proxies, 'procuration', 'procurations')})` : ''}`];
  if (q.set) lines.push(quorumLabel(q), ...(q.counted ? [`> ${quorumDetail(q)}`] : []));
  lines.push('');
  for (const p of results.positions) {
    let head;
    if (p.tie) head = `égalité entre ${p.elected.join(' et ')}`;
    else if (p.elected.length) head = `**${p.elected[0]}** élu·e`;
    else head = p.total ? `${p.candidate} non élu·e` : 'aucun bulletin';
    const detail = p.rows.map((r) => `${r.label} ${r.n} (${pct(r.pct)})`).join(' · ');
    lines.push(`**${p.name}** : ${head}`, `> ${detail} · blancs : ${p.blank}${p.abstain ? ` · abstentions : ${p.abstain}` : ''}`, '');
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
        ${r.quorum.rate !== null ? `<span><strong>${pct(r.quorum.rate)}</strong> des ${r.quorum.members} membres présents ou représentés</span>` : ''}
      </p>
      ${r.quorum.set ? `<p class="flash ${r.quorum.reached ? 'ok' : 'error'}">${e(quorumLabel(r.quorum))}${r.quorum.reached ? '' : '. Vérifiez ce que prévoient vos statuts.'}${r.quorum.counted ? `<br><span class="small">${e(quorumDetail(r.quorum))}</span>` : ''}</p>` : ''}
    </header>
    <div class="results-grid">${r.positions.map(positionResult).join('')}</div>
    ${admin}`, { wide: true });
}

// --- Administration ---------------------------------------------------------------------------------------------

const DESCRIPTION_EXAMPLE = `Bienvenue à l’AG !

- Le vote ouvre après la présentation des candidats, et dure 15 minutes.
- **Quorum** : la moitié des membres à jour de cotisation, présents ou représentés.
- Une procuration par membre au plus.

Vote blanc ou abstention possibles poste par poste.`;

export function admin(data) {
  const { status, positions, proxies, participation: part, quorum: q, csrf, title, resultsPublic, maxProxies } = data;
  const draft = status === 'draft';

  const actions = {
    draft: button('/admin/open', csrf, 'Ouvrir le vote', { kind: 'primary big', confirm: 'Ouvrir le vote ? Les postes et candidats ne seront plus modifiables.' }),
    open: button('/admin/close', csrf, 'Clore le vote', { kind: 'danger big', confirm: 'Clore le vote ? Plus personne ne pourra voter.' }),
    closed: `<a class="button primary big" href="/resultats">Voir les résultats</a>
      ${button('/admin/reset', csrf, 'Nouveau tour', { confirm: 'Effacer tous les votes et repasser en préparation ? Copiez les résultats avant : ils seront perdus.' })}`,
  }[status];

  const positionList = positions.map((p, i) => `<li class="position">
      <div class="position-head">
        <div>
          <span class="eyebrow">Poste ${i + 1}</span>
          <h3>${e(p.name)}</h3>
        </div>
        ${draft ? button(`/admin/positions/${p.id}/delete`, csrf, 'Supprimer le poste', { kind: 'link danger', confirm: `Supprimer le poste « ${p.name} » et ses candidats ?` }) : ''}
      </div>
      <div class="position-body">
        <span class="eyebrow">${p.candidates.length > 1 ? `${p.candidates.length} candidats` : p.candidates.length ? '1 candidat' : 'Candidats'}</span>
        <ul class="candidates">
          ${p.candidates.map((c) => `<li><span class="person" aria-hidden="true">👤</span> ${e(c.name)}
            ${draft ? button(`/admin/candidates/${c.id}/delete`, csrf, 'Retirer', { kind: 'link danger small', confirm: `Retirer ${c.name} ?` }) : ''}</li>`).join('') || '<li class="muted empty">Aucun candidat pour l’instant</li>'}
        </ul>
        ${p.candidates.length === 1 ? '<p class="muted small">Candidature unique : on votera Pour / Contre / Blanc.</p>' : ''}
        ${draft ? `<form method="post" action="/admin/positions/${p.id}/candidates" class="row">
            ${csrfField(csrf)}<input name="name" placeholder="Nom du candidat ou de la candidate" required maxlength="100" aria-label="Nouveau candidat au poste ${e(p.name)}">
            <button>+ Ajouter le candidat</button></form>` : ''}
      </div>
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
      <form method="post" action="/admin/description" class="stack description-form">${csrfField(csrf)}
        <label>Description <span class="muted small">(affichée aux membres connectés : accueil et bulletin)</span>
          <textarea name="description" rows="8" maxlength="4000" placeholder="${e(DESCRIPTION_EXAMPLE)}">${e(data.description)}</textarea></label>
        <p class="muted small">Une ligne vide sépare les paragraphes · une ligne qui commence par « - » fait une liste · **gras** · les liens https:// sont cliquables.</p>
        <div><button>Enregistrer la description</button></div>
      </form>
      ${status === 'closed' ? `<p class="muted small">${resultsPublic ? 'Résultats publiés aux membres.' : 'Résultats visibles des seuls admins.'}</p>` : ''}
    </section>

    <section class="card">
      <h2>Participation</h2>
      <p class="kpi" id="participation" data-src="${status === 'open' ? '/admin/participation' : ''}">
        <strong data-field="total">${part.total}</strong> ${part.total > 1 ? 'voix ont' : 'voix a'} voté,
        dont <strong data-field="proxies">${part.proxies}</strong> par procuration</p>
      ${quorumBlock(q, { live: true })}
      ${q.set ? `<form method="post" action="/admin/present" class="row present-form">${csrfField(csrf)}
          <label for="present">Membres présents (comptés sur Discord)</label>
          <input id="present" name="present" type="number" min="0" step="1" inputmode="numeric" value="${e(q.present ?? '')}" placeholder="24">
          <button class="primary">Mettre à jour</button>
        </form>
        <p class="muted small">Les ${plural(q.represented, 'procuration enregistrée s’ajoute', 'procurations enregistrées s’ajoutent')} automatiquement aux présents. Ne comptez pas les mandants : ils sont absents.</p>` : ''}
      <details class="quorum-settings"${q.set ? '' : ' open'}><summary>${q.set ? 'Modifier le quorum' : 'Renseigner le quorum'}</summary>
        <form method="post" action="/admin/quorum" class="grid-form">${csrfField(csrf)}
          <label>Membres inscrits <input name="members" type="number" min="1" step="1" inputmode="numeric" value="${e(q.members ?? '')}" placeholder="52"></label>
          <label>Quorum <input name="quorum_value" type="number" min="1" step="1" inputmode="numeric" value="${e(q.value ?? '')}" placeholder="50"></label>
          <label>Exprimé en
            <select name="quorum_unit">
              <option value="percent"${q.unit !== 'count' ? ' selected' : ''}>% des membres inscrits</option>
              <option value="count"${q.unit === 'count' ? ' selected' : ''}>nombre de membres</option>
            </select></label>
          <button>Enregistrer</button>
        </form>
        <p class="muted small">Quorum = membres présents (saisis ci-dessus) + membres représentés (procurations). « 50 % » signifie au moins la moitié, arrondie au membre supérieur ; pour « plus de la moitié », indiquez le nombre exact. Laissez vide pour ne pas suivre de quorum.</p>
      </details>
      <details><summary>Émargement (qui a voté, jamais pour qui)</summary>
        <ul class="columns">${part.names.map((n) => `<li>${e(n)}</li>`).join('') || '<li class="muted">Personne pour l’instant.</li>'}</ul>
        <p class="muted small">Rechargez la page pour mettre la liste à jour.</p>
      </details>
    </section>

    <section class="card">
      <h2>Postes et candidats</h2>
      ${draft ? '' : '<p class="muted small">Modifiables seulement en préparation (après « Nouveau tour » une fois le vote clos).</p>'}
      <ul class="positions">${positionList || '<li class="muted">Aucun poste pour l’instant : créez-en un ci-dessous.</li>'}</ul>
    </section>

    ${draft ? `<section class="card new-position">
      <h2>Créer un poste</h2>
      <form method="post" action="/admin/positions" class="row">${csrfField(csrf)}
        <input name="name" placeholder="Président·e, Trésorier·e, Secrétaire…" required maxlength="100" aria-label="Nom du nouveau poste">
        <button class="primary">+ Créer le poste</button>
      </form>
      <p class="muted small">Ajoutez ensuite ses candidats dans le bloc du poste.</p>
    </section>` : ''}

    ${status !== 'open' ? `<section class="card danger-zone">
      <h2>Fin d’AG : effacer les données</h2>
      <p>Efface <strong>tout</strong> : membres connectés, émargement, procurations, bulletins, postes et candidats.
        Tout le monde est déconnecté. Irréversible.</p>
      <p><a class="button" href="/admin/resultats.txt" download>Télécharger les résultats (pour le PV)</a></p>
      <form method="post" action="/admin/wipe" class="row" data-confirm="Effacer définitivement toutes les données du scrutin ?">${csrfField(csrf)}
        <input name="confirm" required autocomplete="off" placeholder="Tapez EFFACER" aria-label="Tapez EFFACER pour confirmer" pattern="EFFACER">
        <button class="danger">Effacer toutes les données</button>
      </form>
      <p class="muted small">Les sauvegardes du serveur (/var/backups/isoloir) ne sont pas touchées : supprimez-les à la main.</p>
    </section>` : ''}

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

export function wiped() {
  return layout({ title: 'Isoloir' }, 'Données effacées', `<section class="card hero">
    <h1>Données effacées</h1>
    <p>Toutes les données du scrutin ont été supprimées de la base. Merci et à la prochaine AG !</p>
    <p><a class="button" href="/">Retour à l’accueil</a></p>
  </section>`);
}

// --- Confidentialité et mentions légales ---------------------------------------------------------------------

export function privacy(data) {
  const { legal } = data;
  const value = (text, key) => (text ? e(text) : `<span class="warn">à renseigner (${key} dans .env.local)</span>`);
  const contact = legal.contact
    ? `<a href="mailto:${e(legal.contact)}">${e(legal.contact)}</a>`
    : value('', 'CONTACT_EMAIL');
  return layout(data, 'Confidentialité et mentions légales', `
    <h1>Confidentialité et mentions légales</h1>

    <section class="card rich">
      <h2>En bref</h2>
      <ul>
        <li><strong>Votre vote est secret.</strong> L’application enregistre <em>que</em> vous avez voté, jamais <em>pour qui</em> : les bulletins sont rangés à part, sans aucun lien avec votre compte.</li>
        <li>Elle ne garde que le strict nécessaire (votre compte Discord et l’émargement), et l’efface après l’AG.</li>
        <li>Aucune publicité, aucune mesure d’audience, aucun cookie autre que celui de la connexion.</li>
      </ul>
    </section>

    <section class="card rich">
      <h2>Qui est responsable ?</h2>
      <p>${value(legal.publisher, 'LEGAL_PUBLISHER')}${legal.address ? `, ${e(legal.address)}` : ''}, qui organise le vote de son assemblée générale.
        Pour toute question sur vos données : ${contact}.</p>
    </section>

    <section class="card rich">
      <h2>Pourquoi et sur quelle base ?</h2>
      <p>Pour organiser les votes de l’assemblée générale prévus par les statuts de l’association : vérifier qui peut voter,
        empêcher les votes en double, gérer les procurations, établir l’émargement et le procès-verbal.
        La base légale est la relation d’adhésion qui vous lie à l’association et ses statuts.</p>
    </section>

    <section class="card rich">
      <h2>Quelles données ?</h2>
      <ul>
        <li><strong>Votre compte Discord</strong> : son identifiant, votre nom d’utilisateur et le nom affiché. Votre avatar est affiché depuis Discord, il n’est pas enregistré.</li>
        ${legal.guild ? `<li><strong>Votre appartenance au serveur de l’association</strong>${legal.role ? ' et vos rôles' : ''} : vérifiés à la connexion pour savoir si vous pouvez voter, puis oubliés.</li>` : ''}
        <li><strong>L’émargement</strong> : le fait que vous avez voté (et, pour une procuration, au nom de qui).</li>
        <li><strong>Les procurations</strong> saisies par le bureau : le nom de la personne absente et le compte Discord de la personne qui vote pour elle (${plural(legal.maxProxies, 'procuration', 'procurations')} au plus par personne).</li>
        <li><strong>Les bulletins</strong>, anonymes : pour chaque poste, le choix fait, sans nom, sans date, sans lien avec l’émargement.
          Même les administrateurs ne peuvent pas savoir qui a voté quoi.</li>
      </ul>
      <p>L’application n’enregistre ni votre adresse e-mail, ni votre adresse IP, ni votre mot de passe Discord (la connexion se fait chez Discord).</p>
    </section>

    <section class="card rich">
      <h2>Qui y a accès ?</h2>
      <ul>
        <li>Les administrateurs du scrutin, désignés par le bureau : l’émargement et les procurations.</li>
        <li>Les membres : les résultats, anonymes, s’ils sont publiés, et le procès-verbal de l’AG (résultats et liste des votants).</li>
        <li><strong>Discord</strong> (Discord Inc., États-Unis) assure la connexion et l’affichage des avatars, selon sa propre
          <a href="https://discord.com/privacy" rel="noopener noreferrer">politique de confidentialité</a>. Aucune autre donnée ne lui est transmise.</li>
      </ul>
    </section>

    <section class="card rich">
      <h2>Combien de temps ?</h2>
      <p>Les données du scrutin (comptes, émargement, procurations, bulletins) sont effacées au plus tard <strong>${e(legal.retention)}</strong>,
        le temps qu’une éventuelle contestation puisse être examinée. Seul le procès-verbal de l’AG est conservé par l’association.
        La connexion expire après 12 heures ; les sauvegardes techniques sont supprimées au bout de 14 jours.</p>
    </section>

    <section class="card rich">
      <h2>Vos droits</h2>
      <p>Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement, ou vous opposer à leur traitement,
        en écrivant à ${contact}. Un bulletin déposé ne peut ni être retrouvé ni modifié : c’est la garantie du secret du vote.
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la <a href="https://www.cnil.fr/fr/plaintes" rel="noopener noreferrer">CNIL</a>.</p>
    </section>

    <section class="card rich">
      <h2>Cookies</h2>
      <p>Un seul cookie, <code>sid</code>, qui vous garde connecté·e pendant l’AG et protège les formulaires. Il est indispensable au fonctionnement du site
        et ne sert à rien d’autre : il ne demande donc pas de consentement.</p>
    </section>

    <section class="card rich">
      <h2>Mentions légales</h2>
      <ul>
        <li><strong>Éditeur</strong> : ${value(legal.publisher, 'LEGAL_PUBLISHER')}${legal.address ? `, ${e(legal.address)}` : ''}</li>
        <li><strong>Directeur·rice de la publication</strong> : ${value(legal.director, 'LEGAL_DIRECTOR')}</li>
        <li><strong>Hébergeur</strong> : ${value(legal.host, 'LEGAL_HOST')}</li>
        <li><strong>Contact</strong> : ${contact}</li>
      </ul>
    </section>`);
}


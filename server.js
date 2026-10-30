// Isoloir : le serveur web (Express). Connexion avec Discord, bulletins, administration du scrutin, résultats.
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as store from './db.js';
import * as views from './views.js';

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECURE = BASE_URL.startsWith('https://');
const ADMIN_IDS = (env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DEV_LOGIN = env.DEV_LOGIN === '1' && env.NODE_ENV !== 'production';
const SESSION_TTL = 12 * 3600 * 1000;
const DISCORD_API = 'https://discord.com/api/v10';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

if (!DEV_LOGIN && (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)) {
  console.error('DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET sont obligatoires (voir .env.local.dist).');
  process.exit(1);
}
if (ADMIN_IDS.length === 0 && !DEV_LOGIN) {
  console.warn('ADMIN_IDS est vide : personne ne pourra administrer le scrutin.');
}

const app = express();
app.disable('x-powered-by');
// Le Caddy du serveur est devant : on croit ce qu'il dit du visiteur (IP, HTTPS).
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Journal des requêtes : jamais le contenu des formulaires, donc jamais un choix de vote.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    console.log(JSON.stringify({
      time: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start,
    }));
  });
  next();
});

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; frame-ancestors 'none'; form-action 'self' https://discord.com; base-uri 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  if (SECURE) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.get('/health', (req, res) => {
  try {
    store.db.prepare('SELECT 1').get();
    res.json({ status: 'ok', version: process.env.APP_VERSION || 'dev' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.use(express.static('public', { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// --- Sessions (en base, cookie httpOnly) et protection CSRF --------------------------------------------------------

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v));
}

function writeSession(req, res) {
  if (!req.sid) req.sid = randomBytes(32).toString('base64url');
  store.saveSession(req.sid, req.session, SESSION_TTL);
  res.append('Set-Cookie',
    `sid=${req.sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${SECURE ? '; Secure' : ''}`);
}

// À la connexion, une nouvelle session : un identifiant connu avant ne sert plus à rien.
function renewSession(req, res, data) {
  if (req.sid) store.deleteSession(req.sid);
  req.sid = null;
  req.session = { ...data, csrf: randomBytes(24).toString('base64url') };
  writeSession(req, res);
}

app.use((req, res, next) => {
  const sid = parseCookies(req.headers.cookie).sid;
  const data = sid ? store.loadSession(sid) : null;
  req.sid = data ? sid : null;
  req.session = data ?? {};
  if (!req.session.csrf) {
    req.session.csrf = randomBytes(24).toString('base64url');
    writeSession(req, res);
  }
  const user = req.session.user;
  req.user = user ? { ...user, isAdmin: ADMIN_IDS.includes(user.id) || !!user.devAdmin } : null;
  next();
});

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const sent = Buffer.from(String(req.body?._csrf ?? ''));
  const expected = Buffer.from(req.session.csrf);
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    return res.status(403).send(views.error('Formulaire expiré : rechargez la page et recommencez.'));
  }
  next();
});

function flash(req, res, type, text) {
  req.session.flash = { type, text };
  writeSession(req, res);
}

function render(req, res, page, data = {}) {
  const message = req.session.flash;
  if (message) {
    delete req.session.flash;
    writeSession(req, res);
  }
  res.send(page({ ...data, user: req.user, csrf: req.session.csrf, flash: message, title: store.setting('title'), description: store.setting('description'), dev: DEV_LOGIN, path: req.path }));
}

const requireLogin = (req, res, next) => (req.user ? next() : res.redirect('/'));
const requireAdmin = (req, res, next) => (req.user?.isAdmin ? next() : res.status(404).send(views.error('Page introuvable.')));

// Une action d'admin : ses erreurs métier reviennent en message sur la page d'admin.
function adminAction(handler, success) {
  return (req, res) => {
    try {
      handler(req);
      if (success) flash(req, res, 'ok', success);
    } catch (error) {
      if (!(error instanceof store.VoteError)) throw error;
      flash(req, res, 'error', error.message);
    }
    res.redirect('/admin');
  };
}

// --- Connexion Discord ----------------------------------------------------------------------------------------

app.get('/login', (req, res) => {
  if (DEV_LOGIN) return res.redirect('/dev-login');
  req.session.oauthState = randomBytes(24).toString('base64url');
  writeSession(req, res);
  const scope = env.GUILD_ID ? 'identify guilds.members.read' : 'identify';
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope, state: req.session.oauthState, prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

async function discord(path, token) {
  const response = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Discord ${path} : ${response.status}`);
  return response.json();
}

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  const expected = req.session.oauthState;
  delete req.session.oauthState;
  if (!code || !expected || state !== expected) {
    return res.status(400).send(views.error('Connexion interrompue ou expirée : recommencez depuis l’accueil.'));
  }

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code', code: String(code), redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenResponse.ok) {
    console.error(JSON.stringify({ event: 'oauth_token_failed', status: tokenResponse.status }));
    return res.status(502).send(views.error('Discord a refusé la connexion. Réessayez dans un instant.'));
  }
  const { access_token: token } = await tokenResponse.json();
  const me = await discord('/users/@me', token);

  const isAdmin = ADMIN_IDS.includes(me.id);
  let member = null;
  if (env.GUILD_ID) {
    member = await discord(`/users/@me/guilds/${env.GUILD_ID}/member`, token);
    if (!member && !isAdmin) {
      return res.status(403).send(views.error('Ce compte Discord n’est pas membre du serveur de l’association.'));
    }
  }
  const canVote = !env.VOTER_ROLE_ID || !!member?.roles?.includes(env.VOTER_ROLE_ID);
  if (!canVote && !isAdmin) {
    return res.status(403).send(views.error('Votre compte Discord n’a pas le rôle des membres votants. Voyez avec le bureau.'));
  }

  const user = {
    id: me.id,
    username: me.username,
    name: member?.nick || me.global_name || me.username,
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
    canVote,
  };
  store.rememberUser(user);
  renewSession(req, res, { user });
  res.redirect(isAdmin ? '/admin' : '/');
});

app.post('/logout', (req, res) => {
  if (req.sid) store.deleteSession(req.sid);
  res.append('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
  res.redirect('/');
});

// Connexion factice pour essayer ou répéter l'AG sans Discord. Jamais en production.
if (DEV_LOGIN) {
  console.warn('DEV_LOGIN actif : connexion sans Discord, pour les essais uniquement.');
  app.get('/dev-login', (req, res) => render(req, res, views.devLogin));
  app.post('/dev-login', (req, res) => {
    const username = store.normRef(req.body.username).replace(/[^a-z0-9._]/g, '').slice(0, 32);
    if (!username) return res.redirect('/dev-login');
    const user = { id: `dev-${username}`, username, name: username, avatar: null, canVote: true, devAdmin: req.body.admin === '1' };
    store.rememberUser(user);
    renewSession(req, res, { user });
    res.redirect(user.devAdmin ? '/admin' : '/');
  });
}

// --- Membres ----------------------------------------------------------------------------------------------------

app.get('/', (req, res) => {
  render(req, res, views.home, {
    status: store.status(),
    voices: req.user?.canVote ? store.voicesOf(req.user) : [],
    resultsPublic: store.setting('results_public') === '1',
  });
});

app.get('/vote', requireLogin, (req, res) => {
  if (!req.user.canVote) return res.redirect('/');
  render(req, res, views.vote, { status: store.status(), voices: store.voicesOf(req.user), positions: store.positions() });
});

app.post('/vote', requireLogin, (req, res) => {
  try {
    if (!req.user.canVote) throw new store.VoteError('Votre compte n’a pas le droit de vote.');
    store.castVote(req.user, String(req.body.voice ?? ''), req.body);
    flash(req, res, 'ok', 'A voté ! Votre bulletin est déposé dans l’urne.');
  } catch (error) {
    if (!(error instanceof store.VoteError)) throw error;
    flash(req, res, 'error', error.message);
  }
  res.redirect('/vote');
});

app.get('/resultats', (req, res) => {
  const visible = store.status() === 'closed' && (req.user?.isAdmin || store.setting('results_public') === '1');
  if (!visible) return res.status(404).send(views.error('Les résultats ne sont pas encore publiés.'));
  render(req, res, views.results, { results: store.results(), resultsPublic: store.setting('results_public') === '1' });
});

// --- Administration ---------------------------------------------------------------------------------------------

app.get('/admin', requireAdmin, (req, res) => {
  render(req, res, views.admin, {
    status: store.status(),
    positions: store.positions(),
    proxies: store.proxies(),
    participation: store.participation(),
    quorum: store.quorum(),
    resultsPublic: store.setting('results_public') === '1',
    maxProxies: store.MAX_PROXIES,
  });
});

app.get('/admin/participation', requireAdmin, (req, res) => {
  const { total, proxies } = store.participation();
  const q = store.quorum();
  res.json({
    total, proxies, status: store.status(),
    quorumLabel: views.quorumLabel(q), quorumDetail: views.quorumDetail(q), quorumReached: q.reached, meter: views.quorumMeterWidth(q),
  });
});

const id = (req) => Number(req.params.id);
app.post('/admin/quorum', requireAdmin, adminAction((req) => store.setQuorum({
  members: req.body.members, value: req.body.quorum_value, unit: req.body.quorum_unit,
}), 'Quorum enregistré.'));
app.post('/admin/present', requireAdmin, adminAction((req) => store.setPresent(req.body.present), 'Nombre de présents enregistré.'));
app.post('/admin/description', requireAdmin, adminAction((req) => store.setDescription(req.body.description), 'Description enregistrée.'));
app.post('/admin/title', requireAdmin, adminAction((req) => store.setTitle(req.body.title), 'Titre enregistré.'));
app.post('/admin/positions', requireAdmin, adminAction((req) => store.addPosition(req.body.name)));
app.post('/admin/positions/:id/delete', requireAdmin, adminAction((req) => store.deletePosition(id(req))));
app.post('/admin/positions/:id/candidates', requireAdmin, adminAction((req) => store.addCandidate(id(req), req.body.name)));
app.post('/admin/candidates/:id/delete', requireAdmin, adminAction((req) => store.deleteCandidate(id(req))));
app.post('/admin/proxies', requireAdmin, adminAction((req) => store.addProxy({
  mandantName: req.body.mandant_name, mandantRef: req.body.mandant_ref, mandataireRef: req.body.mandataire_ref,
}), 'Procuration enregistrée.'));
app.post('/admin/proxies/:id/delete', requireAdmin, adminAction((req) => store.deleteProxy(id(req)), 'Procuration retirée.'));
app.post('/admin/open', requireAdmin, adminAction(() => store.openVote(), 'Le vote est ouvert.'));
app.post('/admin/close', requireAdmin, adminAction(() => store.closeVote(), 'Le vote est clos : les résultats sont prêts.'));
app.post('/admin/publish', requireAdmin, adminAction((req) => store.setResultsPublic(req.body.public === '1')));
// Les résultats en texte, à garder pour le procès-verbal avant d'effacer les données.
app.get('/admin/resultats.txt', requireAdmin, (req, res) => {
  const title = store.setting('title');
  const date = new Date().toISOString().slice(0, 10);
  const results = store.results();
  const summary = views.discordSummary(title, results).replace(/\*\*/g, '').replace(/^> /gm, '  ');
  // L'émargement : qui a voté (jamais pour qui), les voix par procuration avec leur mandataire.
  const { names } = results.participation;
  const voters = names.length ? names.map((name) => `- ${name}`).join('\n') : '(personne)';
  res.attachment(`resultats-${date}.txt`).type('text/plain; charset=utf-8')
    .send(`${summary}\n\nListe des votants (${names.length}) :\n${voters}\n`);
});

app.post('/admin/wipe', requireAdmin, (req, res) => {
  if (String(req.body.confirm ?? '').trim() !== 'EFFACER') {
    flash(req, res, 'error', 'Tapez EFFACER (en capitales) pour confirmer.');
    return res.redirect('/admin');
  }
  try {
    store.wipeAll();
  } catch (error) {
    if (!(error instanceof store.VoteError)) throw error;
    flash(req, res, 'error', error.message);
    return res.redirect('/admin');
  }
  console.log(JSON.stringify({ time: new Date().toISOString(), event: 'wipe' }));
  // Les sessions sont effacées avec le reste : l'admin aussi est déconnecté.
  res.append('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
  res.send(views.wiped());
});

app.post('/admin/reset', requireAdmin, adminAction(() => store.newRound(), 'Nouveau tour : les votes ont été effacés.'));

app.use((req, res) => res.status(404).send(views.error('Page introuvable.')));

app.use((error, req, res, next) => {
  console.error(JSON.stringify({ event: 'error', path: req.path, message: error.message, stack: error.stack }));
  res.status(500).send(views.error('Une erreur est survenue. Réessayez ; si elle persiste, prévenez l’admin.'));
});

store.purgeSessions();
setInterval(store.purgeSessions, 3600 * 1000).unref();

app.listen(PORT, () => console.log(JSON.stringify({ event: 'started', port: PORT, baseUrl: BASE_URL, devLogin: DEV_LOGIN })));

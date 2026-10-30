// La base SQLite d'Isoloir et toutes ses requêtes.
//
// Anonymat : l'émargement (« qui a voté », table voters) et les bulletins (« quoi », table ballots) ne partagent
// aucune colonne. Chaque choix d'un bulletin est une ligne à part, à clé aléatoire, sans date ni rowid : ni l'ordre
// d'arrivée ni le regroupement par votant ne peuvent être reconstruits.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const path = process.env.DB_PATH || 'var/isoloir.db';
mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);

// secure_delete : ce qui est effacé (un tour remis à zéro) est écrasé sur le disque, pas seulement marqué libre.
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS positions (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS candidates (
    id          INTEGER PRIMARY KEY,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    name        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    discord_id   TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    display_name TEXT NOT NULL,
    last_login   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proxies (
    id             INTEGER PRIMARY KEY,
    mandant_name   TEXT NOT NULL,
    mandant_ref    TEXT,
    mandataire_ref TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS voters (
    voice_key TEXT PRIMARY KEY,
    label     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ballots (
    id          TEXT PRIMARY KEY,
    position_id INTEGER NOT NULL,
    choice      TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sessions (
    id      TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

export const MAX_PROXIES = Math.max(1, Number(process.env.MAX_PROXIES) || 1);

export class VoteError extends Error {}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// --- Réglages ---------------------------------------------------------------------------------------------------

const DEFAULTS = { title: 'Élection du bureau', status: 'draft', results_public: '0' };

export function setting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// draft : on prépare (postes, candidats) ; open : on vote ; closed : on dépouille.
export const status = () => setting('status');

function requireStatus(...allowed) {
  if (!allowed.includes(status())) {
    throw new VoteError(allowed.includes('draft')
      ? 'Impossible pendant ou après le vote : lancez d’abord un nouveau tour.'
      : 'Action impossible dans l’état actuel du scrutin.');
  }
}

// --- Sessions ---------------------------------------------------------------------------------------------------

export function loadSession(id) {
  const row = db.prepare('SELECT data FROM sessions WHERE id = ? AND expires > ?').get(id, Date.now());
  return row ? JSON.parse(row.data) : null;
}

export function saveSession(id, data, ttl) {
  db.prepare(`INSERT INTO sessions (id, data, expires) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires = excluded.expires`)
    .run(id, JSON.stringify(data), Date.now() + ttl);
}

export function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
}

// --- Membres ----------------------------------------------------------------------------------------------------

export function rememberUser({ id, username, name }) {
  db.prepare(`INSERT INTO users (discord_id, username, display_name, last_login) VALUES (?, ?, ?, ?)
              ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username,
                display_name = excluded.display_name, last_login = excluded.last_login`)
    .run(id, username, name, Date.now());
}

// Une référence Discord saisie par l'admin : un identifiant (123456789012345678) ou un nom d'utilisateur (@alice).
export const normRef = (ref) => String(ref ?? '').trim().replace(/^@/, '').toLowerCase();

export function matchesUser(ref, user) {
  const r = normRef(ref);
  return r !== '' && (r === user.id || r === user.username.toLowerCase());
}

// La même personne, qu'on l'ait saisie par son identifiant ou par son nom : l'identifiant si elle s'est déjà connectée.
function refKey(ref) {
  const r = normRef(ref);
  if (!r) return null;
  const user = db.prepare('SELECT discord_id FROM users WHERE discord_id = ? OR lower(username) = ?').get(r, r);
  return user ? user.discord_id : r;
}

function describeRef(ref) {
  const r = normRef(ref);
  const user = db.prepare('SELECT display_name, username FROM users WHERE discord_id = ? OR lower(username) = ?').get(r, r);
  return user ? `${user.display_name} (@${user.username})` : String(ref).trim();
}

// --- Postes et candidats ----------------------------------------------------------------------------------------

export function positions() {
  const list = db.prepare('SELECT id, name FROM positions ORDER BY id').all();
  const candidates = db.prepare('SELECT id, position_id, name FROM candidates ORDER BY id').all();
  return list.map((p) => ({ ...p, candidates: candidates.filter((c) => c.position_id === p.id) }));
}

const clean = (text, max = 100) => String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export function setTitle(title) {
  requireStatus('draft');
  const t = clean(title, 120);
  if (!t) throw new VoteError('Le titre ne peut pas être vide.');
  setSetting('title', t);
}

export function addPosition(name) {
  requireStatus('draft');
  const n = clean(name);
  if (!n) throw new VoteError('Donnez un nom au poste.');
  db.prepare('INSERT INTO positions (name) VALUES (?)').run(n);
}

export function deletePosition(id) {
  requireStatus('draft');
  db.prepare('DELETE FROM positions WHERE id = ?').run(id);
}

export function addCandidate(positionId, name) {
  requireStatus('draft');
  const n = clean(name);
  if (!n) throw new VoteError('Donnez le nom du candidat ou de la candidate.');
  if (!db.prepare('SELECT 1 FROM positions WHERE id = ?').get(positionId)) throw new VoteError('Poste introuvable.');
  db.prepare('INSERT INTO candidates (position_id, name) VALUES (?, ?)').run(positionId, n);
}

export function deleteCandidate(id) {
  requireStatus('draft');
  db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
}

// --- Procurations -----------------------------------------------------------------------------------------------

export function proxies() {
  const used = new Set(db.prepare("SELECT voice_key FROM voters WHERE voice_key LIKE 'proxy:%'").all().map((r) => r.voice_key));
  return db.prepare('SELECT * FROM proxies ORDER BY id').all().map((p) => ({
    ...p,
    mandant_label: p.mandant_ref ? describeRef(p.mandant_ref) : null,
    mandataire_label: describeRef(p.mandataire_ref),
    used: used.has(`proxy:${p.id}`),
  }));
}

export function addProxy({ mandantName, mandantRef, mandataireRef }) {
  requireStatus('draft', 'open');
  const name = clean(mandantName);
  const mandantKey = refKey(mandantRef);
  const mandataireKey = refKey(mandataireRef);
  if (!name) throw new VoteError('Indiquez le nom du mandant (la personne absente).');
  if (!mandataireKey) throw new VoteError('Indiquez l’identifiant ou le pseudo Discord du mandataire.');
  if (mandantKey === mandataireKey) throw new VoteError('On ne peut pas se donner procuration à soi-même.');

  const existing = db.prepare('SELECT * FROM proxies').all()
    .map((p) => ({ mandant: refKey(p.mandant_ref), mandataire: refKey(p.mandataire_ref) }));
  if (mandantKey && existing.some((p) => p.mandant === mandantKey)) {
    throw new VoteError('Ce mandant a déjà donné une procuration.');
  }
  if (existing.some((p) => p.mandant && p.mandant === mandataireKey)) {
    throw new VoteError('Ce mandataire a lui-même donné procuration : il ne peut pas en recevoir.');
  }
  if (mandantKey && existing.some((p) => p.mandataire === mandantKey)) {
    throw new VoteError('Ce mandant détient déjà une procuration : il ne peut pas en donner une à son tour.');
  }
  if (existing.filter((p) => p.mandataire === mandataireKey).length >= MAX_PROXIES) {
    throw new VoteError(`Ce mandataire détient déjà ${MAX_PROXIES} procuration(s) : c’est le maximum.`);
  }
  if (mandantKey && db.prepare('SELECT 1 FROM voters WHERE voice_key = ?').get(`self:${mandantKey}`)) {
    throw new VoteError('Ce mandant a déjà voté lui-même : sa procuration n’a plus d’objet.');
  }
  db.prepare('INSERT INTO proxies (mandant_name, mandant_ref, mandataire_ref) VALUES (?, ?, ?)')
    .run(name, normRef(mandantRef) || null, normRef(mandataireRef));
}

export function deleteProxy(id) {
  requireStatus('draft', 'open');
  if (db.prepare('SELECT 1 FROM voters WHERE voice_key = ?').get(`proxy:${id}`)) {
    throw new VoteError('Cette procuration a déjà servi à voter : elle ne peut plus être retirée.');
  }
  db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
}

// --- Vote -------------------------------------------------------------------------------------------------------

// Les voix d'un membre : la sienne (sauf s'il a donné procuration) et celles qu'on lui a confiées.
export function voicesOf(user) {
  const all = db.prepare('SELECT * FROM proxies ORDER BY id').all();
  const voted = (key) => !!db.prepare('SELECT 1 FROM voters WHERE voice_key = ?').get(key);
  const given = all.find((p) => p.mandant_ref && matchesUser(p.mandant_ref, user));
  const voices = [{
    key: `self:${user.id}`,
    label: 'Ma voix',
    voterLabel: user.name,
    givenTo: given ? describeRef(given.mandataire_ref) : null,
  }];
  for (const p of all.filter((p) => matchesUser(p.mandataire_ref, user))) {
    voices.push({
      key: `proxy:${p.id}`,
      label: `Procuration de ${p.mandant_name}`,
      voterLabel: `${p.mandant_name} (procuration à ${user.name})`,
    });
  }
  return voices.map((v) => ({ ...v, voted: voted(v.key), usable: !v.givenTo && !voted(v.key) }));
}

export function castVote(user, voiceKey, answers) {
  return transaction(() => {
    if (status() !== 'open') throw new VoteError('Le vote n’est pas ouvert.');
    const voice = voicesOf(user).find((v) => v.key === voiceKey);
    if (!voice) throw new VoteError('Cette voix n’est pas la vôtre.');
    if (voice.voted) throw new VoteError('Cette voix a déjà voté.');
    if (voice.givenTo) throw new VoteError(`Vous avez donné procuration à ${voice.givenTo} : c’est à cette personne de voter.`);

    const ballot = positions().map((p) => {
      const choice = String(answers[`pos_${p.id}`] ?? '');
      const valid = ['blank', ...p.candidates.map((c) => String(c.id))];
      if (p.candidates.length === 1) valid.push('against');
      if (!valid.includes(choice)) throw new VoteError(`Choisissez une réponse pour le poste « ${p.name} ».`);
      return { positionId: p.id, choice };
    });

    db.prepare('INSERT INTO voters (voice_key, label) VALUES (?, ?)').run(voice.key, voice.voterLabel);
    const insert = db.prepare('INSERT INTO ballots (id, position_id, choice) VALUES (?, ?, ?)');
    for (const b of ballot) insert.run(randomUUID(), b.positionId, b.choice);
  });
}

// --- Déroulé du scrutin -----------------------------------------------------------------------------------------

export function openVote() {
  requireStatus('draft');
  const list = positions();
  if (list.length === 0) throw new VoteError('Ajoutez au moins un poste avant d’ouvrir le vote.');
  const empty = list.find((p) => p.candidates.length === 0);
  if (empty) throw new VoteError(`Le poste « ${empty.name} » n’a pas de candidat.`);
  setSetting('status', 'open');
}

export function closeVote() {
  requireStatus('open');
  setSetting('status', 'closed');
}

export function setResultsPublic(value) {
  requireStatus('closed');
  setSetting('results_public', value ? '1' : '0');
}

// Un nouveau tour efface les votes et l'émargement ; postes, candidats et procurations restent, modifiables.
export function newRound() {
  requireStatus('closed');
  transaction(() => {
    db.exec('DELETE FROM ballots; DELETE FROM voters;');
    setSetting('status', 'draft');
    setSetting('results_public', '0');
  });
  db.exec('VACUUM');
}

export function participation() {
  const voters = db.prepare('SELECT voice_key, label FROM voters ORDER BY label COLLATE NOCASE').all();
  return {
    total: voters.length,
    proxies: voters.filter((v) => v.voice_key.startsWith('proxy:')).length,
    names: voters.map((v) => v.label),
  };
}

// --- Résultats --------------------------------------------------------------------------------------------------

export function results() {
  const counts = new Map();
  for (const row of db.prepare('SELECT position_id, choice, COUNT(*) AS n FROM ballots GROUP BY position_id, choice').all()) {
    counts.set(`${row.position_id}:${row.choice}`, Number(row.n));
  }
  const count = (p, choice) => counts.get(`${p.id}:${choice}`) ?? 0;

  const list = positions().map((p) => {
    const blank = count(p, 'blank');
    const single = p.candidates.length === 1;
    const rows = single
      ? [{ label: 'Pour', n: count(p, p.candidates[0].id) }, { label: 'Contre', n: count(p, 'against'), against: true }]
      : p.candidates.map((c) => ({ label: c.name, n: count(p, c.id) }));
    const expressed = rows.reduce((sum, r) => sum + r.n, 0);
    for (const r of rows) r.pct = expressed ? (r.n / expressed) * 100 : 0;

    let elected = [];
    if (single) {
      if (rows[0].n > rows[1].n) elected = [p.candidates[0].name];
    } else {
      const max = Math.max(...rows.map((r) => r.n));
      if (max > 0) elected = rows.filter((r) => r.n === max).map((r) => r.label);
      for (const r of rows) r.winner = max > 0 && r.n === max;
    }
    if (single) rows[0].winner = elected.length === 1;

    return {
      name: p.name,
      single,
      candidate: single ? p.candidates[0].name : null,
      rows,
      blank,
      expressed,
      total: expressed + blank,
      elected,
      tie: elected.length > 1,
    };
  });
  return { positions: list, participation: participation() };
}

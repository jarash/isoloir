// Les règles du scrutin : procurations, vote unique par voix, anonymat, dépouillement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'isoloir-')), 'test.db');
process.env.MAX_PROXIES = '1';
const store = await import('../db.js');

const member = (username) => {
  const user = { id: `id-${username}`, username, name: username[0].toUpperCase() + username.slice(1) };
  store.rememberUser(user);
  return user;
};
const alice = member('alice');
const bob = member('bob');
const carole = member('carole');
const dan = member('dan');

store.addPosition('Présidence');
store.addPosition('Trésorerie');
const [presidence, tresorerie] = store.positions();
store.addCandidate(presidence.id, 'Alice');
store.addCandidate(presidence.id, 'Bob');
store.addCandidate(tresorerie.id, 'Carole');
const [pAlice, pBob] = store.positions()[0].candidates;
const [tCarole] = store.positions()[1].candidates;

test('les procurations respectent leurs règles', () => {
  store.addProxy({ mandantName: 'Dan', mandantRef: '@dan', mandataireRef: 'id-alice' });
  assert.throws(() => store.addProxy({ mandantName: 'Dan', mandantRef: 'id-dan', mandataireRef: 'bob' }), /déjà donné/);
  assert.throws(() => store.addProxy({ mandantName: 'Eve', mandataireRef: 'alice' }), /maximum/);
  assert.throws(() => store.addProxy({ mandantName: 'Alice', mandantRef: 'alice', mandataireRef: 'bob' }), /détient déjà/);
  assert.throws(() => store.addProxy({ mandantName: 'Bob', mandantRef: 'bob', mandataireRef: 'dan' }), /a lui-même donné/);
  assert.throws(() => store.addProxy({ mandantName: 'Bob', mandantRef: 'bob', mandataireRef: '@BOB' }), /soi-même/);
});

test('on ne vote pas avant l’ouverture', () => {
  assert.throws(() => store.castVote(bob, `self:${bob.id}`, {}), /pas ouvert/);
});

test('chaque voix vote une fois, le mandant ne vote pas', () => {
  store.openVote();
  assert.throws(() => store.addPosition('Secrétariat'), /nouveau tour/);

  const voices = store.voicesOf(alice);
  assert.deepEqual(voices.map((v) => v.key), [`self:${alice.id}`, 'proxy:1']);

  store.castVote(alice, `self:${alice.id}`, { [`pos_${presidence.id}`]: String(pAlice.id), [`pos_${tresorerie.id}`]: String(tCarole.id) });
  store.castVote(alice, 'proxy:1', { [`pos_${presidence.id}`]: String(pBob.id), [`pos_${tresorerie.id}`]: 'against' });
  assert.throws(() => store.castVote(alice, 'proxy:1', { [`pos_${presidence.id}`]: 'blank', [`pos_${tresorerie.id}`]: 'blank' }), /déjà voté/);
  assert.throws(() => store.castVote(dan, `self:${dan.id}`, { [`pos_${presidence.id}`]: 'blank', [`pos_${tresorerie.id}`]: 'blank' }), /procuration/);
  assert.throws(() => store.castVote(bob, 'proxy:1', {}), /pas la vôtre/);
  assert.throws(() => store.castVote(bob, `self:${bob.id}`, { [`pos_${presidence.id}`]: 'against', [`pos_${tresorerie.id}`]: 'blank' }), /Présidence/);

  store.castVote(bob, `self:${bob.id}`, { [`pos_${presidence.id}`]: String(pAlice.id), [`pos_${tresorerie.id}`]: String(tCarole.id) });
  store.castVote(carole, `self:${carole.id}`, { [`pos_${presidence.id}`]: 'blank', [`pos_${tresorerie.id}`]: String(tCarole.id) });
  // Eve s'abstient à la présidence (poste laissé vide) et à la trésorerie (« Abstention »).
  const eve = member('eve');
  store.castVote(eve, `self:${eve.id}`, { [`pos_${tresorerie.id}`]: 'abstain' });
  assert.throws(() => store.addProxy({ mandantName: 'Carole', mandantRef: 'carole', mandataireRef: 'bob' }), /déjà voté/);
});

test('les bulletins ne gardent aucun lien avec les votants', () => {
  const columns = (table) => store.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.deepEqual(columns('ballots'), ['id', 'position_id', 'choice']);
  assert.deepEqual(columns('voters'), ['voice_key', 'label']);
  assert.throws(() => store.db.prepare('SELECT rowid FROM ballots').get());
});

test('le dépouillement', () => {
  store.closeVote();
  const { positions, participation } = store.results();
  assert.equal(participation.total, 5);
  assert.equal(participation.proxies, 1);

  const [pres, treso] = positions;
  assert.deepEqual(pres.rows.map((r) => [r.label, r.n]), [['Alice', 2], ['Bob', 1]]);
  assert.equal(pres.blank, 1);
  assert.equal(pres.abstain, 1);
  assert.equal(treso.abstain, 1);
  assert.equal(pres.expressed, 3);
  assert.deepEqual(pres.elected, ['Alice']);
  assert.equal(Math.round(pres.rows[0].pct), 67);

  assert.ok(treso.single);
  assert.deepEqual(treso.rows.map((r) => [r.label, r.n]), [['Pour', 3], ['Contre', 1]]);
  assert.deepEqual(treso.elected, ['Carole']);
});

test('l’effacement de fin d’AG est refusé pendant le vote', () => {
  store.setSetting('status', 'open');
  assert.throws(() => store.wipeAll(), /ouvert/);
  store.setSetting('status', 'closed');
});

test('un nouveau tour efface les votes, garde postes et procurations', () => {
  store.newRound();
  assert.equal(store.status(), 'draft');
  assert.equal(store.participation().total, 0);
  assert.equal(store.positions().length, 2);
  assert.equal(store.proxies().length, 1);
});

test('l’effacement de fin d’AG ne laisse rien', () => {
  store.saveSession('x', { user: alice }, 60000);
  store.wipeAll();
  for (const table of ['ballots', 'voters', 'proxies', 'candidates', 'positions', 'users', 'sessions', 'settings']) {
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal(store.status(), 'draft');
});


'use strict';

/**
 * The MemPalace wake-up digest is an OPT-IN SessionStart hook, default OFF.
 *
 * Why this test exists: the shim is written unconditionally by `ensureHive`, so
 * "the shim exists" can never be the guard — that would make the feature always
 * on, and a rebuild for some unrelated reason would silently start injecting
 * ~800 tokens of digest into every agent spawn with nobody connecting the two.
 * The guard is an explicit `HIVE_MEMPALACE_WAKEUP=1`.
 *
 * Both assertions read the settings.json that a real `ensureAgent` generated —
 * the file `claude` is actually handed via `--settings` — not a reconstruction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-mp-wakeup-'));
}

/** Generate a real agent settings.json under `env` and return its SessionStart. */
async function sessionStartFor(t, envValue) {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const prev = process.env.HIVE_MEMPALACE_WAKEUP;
  if (envValue === undefined) delete process.env.HIVE_MEMPALACE_WAKEUP;
  else process.env.HIVE_MEMPALACE_WAKEUP = envValue;
  t.after(() => {
    if (prev === undefined) delete process.env.HIVE_MEMPALACE_WAKEUP;
    else process.env.HIVE_MEMPALACE_WAKEUP = prev;
  });

  const hive = new HiveManager(() => home);
  const inj = await hive.ensureAgent({
    id: 'wake-1', name: 'Wake', provider: 'claude', cwd: home
  });
  const i = inj.args.indexOf('--settings');
  assert.ok(i >= 0, 'claude spawn carries --settings');
  const settings = JSON.parse(fs.readFileSync(inj.args[i + 1], 'utf8'));
  return { home, sessionStart: settings.hooks.SessionStart };
}

const isWakeup = (e) =>
  (e.hooks || []).some((h) => /mp-wakeup\.cjs/.test(h.command || ''));

test('default OFF: an unset HIVE_MEMPALACE_WAKEUP writes NO wake-up SessionStart entry', async (t) => {
  const { home, sessionStart } = await sessionStartFor(t, undefined);
  assert.equal(sessionStart.length, 1, 'only the hive shim hook is registered');
  assert.ok(!sessionStart.some(isWakeup), 'no mp-wakeup entry in agent settings');
  // The shim is still on disk — proving shim-existence is NOT what gates it.
  assert.ok(
    fs.existsSync(path.join(home, 'hive', 'bin', 'mp-wakeup.cjs')),
    'shim is written regardless, so toggling the var needs no re-bootstrap'
  );
});

test('a non-"1" value is still OFF (no accidental truthiness)', async (t) => {
  for (const v of ['0', 'true', 'yes', '']) {
    const { sessionStart } = await sessionStartFor(t, v);
    assert.ok(!sessionStart.some(isWakeup), `HIVE_MEMPALACE_WAKEUP=${JSON.stringify(v)} must stay off`);
  }
});

test('opt-in: HIVE_MEMPALACE_WAKEUP=1 adds the wake-up entry alongside the hive shim', async (t) => {
  const { sessionStart } = await sessionStartFor(t, '1');
  assert.equal(sessionStart.length, 2, 'hive shim + wake-up digest');
  assert.ok(sessionStart.some(isWakeup), 'mp-wakeup entry present');
  // The hive's own SessionStart shim must survive untouched either way.
  assert.ok(
    sessionStart.some((e) => (e.hooks || []).some((h) => /cth-hook\.cjs/.test(h.command || ''))),
    'the hive shim hook is never displaced by the digest'
  );
});

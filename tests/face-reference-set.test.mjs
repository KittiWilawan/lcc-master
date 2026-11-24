import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relative, stubs = {}) {
  const filename = resolve(relative);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const module = { exports: {} }; const original = createRequire(filename);
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : original(name),
    Date, Set, Uint8Array }, { filename });
  return module.exports;
}
const transaction = await load('src/lib/referenceSetTransaction.ts');
const poses = ['front', 'left', 'right']; const photos = { front: 'a', left: 'b', right: 'c' };
test('an interrupted upload preserves every active old reference and discards only drafts', async () => {
  const active = { front: 'old', left: 'old', right: 'old' }; const removed = []; let commits = 0;
  await assert.rejects(transaction.commitReferenceSet({ poses, photos, stillActive: async () => true,
    stage: async pose => { if (pose === 'left') throw new Error('Interrupted'); return 'draft/' + pose; },
    commit: async paths => { commits++; Object.assign(active, paths); }, discard: async paths => removed.push(...paths), onStaged() {} }));
  assert.deepEqual(active, { front: 'old', left: 'old', right: 'old' }); assert.equal(commits, 0);
  assert.deepEqual(removed, ['draft/front']);
});
test('complete staging precedes exactly one active-set commit', async () => {
  const order = [];
  await transaction.commitReferenceSet({ poses, photos, stillActive: async () => true,
    stage: async pose => { order.push(pose); return 'draft/' + pose; },
    commit: async paths => { assert.deepEqual(Object.keys(paths), poses); order.push('commit'); },
    discard: async () => { throw new Error('Committed images cannot be deleted'); }, onStaged() {} });
  assert.deepEqual(order, [...poses, 'commit']);
});
test('ambiguous commit transport failure preserves potentially committed evidence', async () => {
  let removed = false;
  await assert.rejects(transaction.commitReferenceSet({ poses, photos, stillActive: async () => true,
    stage: async pose => pose, commit: async () => { throw new Error('Response lost after server commit'); },
    discard: async () => { removed = true; }, onStaged() {} }));
  assert.equal(removed, false);
});
test('owner or lifecycle change before commit cannot replace active references', async () => {
  let active = true; let commits = 0;
  await assert.rejects(transaction.commitReferenceSet({ poses, photos, stillActive: async () => active,
    stage: async pose => { active = false; return pose; }, commit: async () => { commits++; }, discard: async () => {}, onStaged() {} }));
  assert.equal(commits, 0);
});

async function repositoryHarness({ failUpload, failCommit, committedBeforeError = false, consent = true, currentUser = 'user', family = 'family' } = {}) {
  const uploads = []; const commits = []; const removed = []; let serial = 0;
  const member = { select: () => member, eq: () => member, is: () => member, single: async () => ({ data: { identity_consent_at: consent ? 'synthetic-consent' : null } }) };
  const rows = { select: () => rows, eq: () => rows, in: async () => ({ data: committedBeforeError && commits.length ? commits[0] : poses.map(pose => ({ pose, storage_path: 'old/' + pose })) }),
    upsert: async value => { commits.push(value); return { error: failCommit ? new Error('Commit response lost') : null }; } };
  const bucket = { upload: async path => { uploads.push(path); return { error: uploads.length === failUpload ? new Error('Upload failed') : null }; },
    remove: async paths => { removed.push([...paths]); return {}; } };
  const api = await load('src/lib/identityReferences.ts', {
    './referenceSetTransaction': transaction, uuid: { v4: () => 'draft-' + ++serial },
    '@react-native-async-storage/async-storage': { getItem: async () => family },
    './supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }),
      getSession: async () => ({ data: { session: { user: { id: currentUser } } } }) }, from: name => name === 'family_members' ? member : rows,
      storage: { from: () => bucket } } },
  });
  const jpeg = Buffer.from([255, 216, 255, 217]).toString('base64');
  return { api, uploads, commits, removed, input: { familyId: 'family', memberId: 'member', photos: Object.fromEntries(poses.map(pose => [pose, jpeg])), options: { isActive: () => true, onProgress() {} } } };
}
test('the repository publishes three active rows with one bulk upsert after all uploads', async () => {
  const h = await repositoryHarness(); await h.api.saveIdentityReferenceSet(h.input);
  assert.equal(h.uploads.length, 3); assert.equal(h.commits.length, 1); assert.equal(h.commits[0].length, 3);
  assert.deepEqual(Array.from(h.commits[0], row => row.storage_path), h.uploads);
  assert.deepEqual(h.removed, [['old/front', 'old/left', 'old/right']]);
});
test('failed draft upload cannot mutate the active database rows or delete old images', async () => {
  const h = await repositoryHarness({ failUpload: 2 }); await assert.rejects(h.api.saveIdentityReferenceSet(h.input));
  assert.equal(h.commits.length, 0); assert.ok(h.removed.flat().every(path => !path.startsWith('old/')));
});
test('unconfirmed database result cannot delete newly published images', async () => {
  const h = await repositoryHarness({ failCommit: true }); await assert.rejects(h.api.saveIdentityReferenceSet(h.input));
  assert.equal(h.removed.length, 0);
});
test('a lost success response reconciles exact committed paths instead of publishing a second set', async () => {
  const h = await repositoryHarness({ failCommit: true, committedBeforeError: true });
  await h.api.saveIdentityReferenceSet(h.input);
  assert.equal(h.commits.length, 1); assert.equal(h.uploads.length, 3);
  assert.deepEqual(h.removed, [['old/front', 'old/left', 'old/right']]);
});
test('consent, account and family scope are checked before draft uploads', async () => {
  for (const options of [{ consent: false }, { currentUser: 'other' }, { family: 'other' }]) {
    const h = await repositoryHarness(options); await assert.rejects(h.api.saveIdentityReferenceSet(h.input));
    assert.equal(h.uploads.length, 0); assert.equal(h.commits.length, 0);
  }
});

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function scopeRevision(camera) {
  return JSON.stringify([camera.allPeopleMode, camera.assigned_member_id, camera.family_members?.identity_consent_at, camera.identityReferenceSignature]);
}

export function openOutbox(config, directory = join(homedir(), '.looklancare', 'events')) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const scope = createHash('sha256').update(JSON.stringify([config.supabaseUrl, config.familyId, config.deviceCredentialsFile, config.email])).digest('hex');
  const path = join(directory, scope + '.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA secure_delete=ON');
  db.exec('CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY, camera TEXT, revision TEXT, result TEXT, mime TEXT, image BLOB)');
  const insert = db.prepare('INSERT OR IGNORE INTO pending VALUES(?,?,?,?,?,?)');
  const remove = db.prepare('DELETE FROM pending WHERE id=?');
  return {
    enqueue(events, camera, image) {
      if (!events.length) return;
      db.exec('BEGIN');
      try {
        for (const event of events) insert.run(event.eventId, camera.id, scopeRevision(camera), JSON.stringify(event), image.contentType, image.bytes);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async deliver(cameras, publish) {
      for (const { id } of db.prepare('SELECT id FROM pending ORDER BY rowid').all()) {
        const row = db.prepare('SELECT * FROM pending WHERE id=?').get(id);
        if (!row) continue;
        const camera = cameras.find(item => item.id === row.camera && scopeRevision(item) === row.revision);
        if (camera) await publish(camera, { contentType: row.mime, bytes: Buffer.from(row.image) }, JSON.parse(row.result));
        remove.run(id);
      }
    },
    close() { db.close(); },
  };
}

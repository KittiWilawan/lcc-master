import { nextAlertState } from './core.mjs';
import { randomUUID } from 'node:crypto';

export function advanceEpisodes(state, people, camera, now, config) {
  const current = new Map();
  const events = [];
  for (const person of people) {
    const position = person.positions.at(-1);
    if (!Number.isSafeInteger(position) || current.has(position)) continue;
    const track = state.tracks?.get(person.positions.at(-2)) ??
      { id: randomUUID(), confirmations: 0, lastAlertAt: -Infinity, alerting: false };
    const named = !camera.allPeopleMode && Boolean(camera.assigned_member_id && camera.family_members?.identity_consent_at && person.confirmed === true);
    const result = {
      status: person.falling && (camera.allPeopleMode || named) ? 'fall' : 'normal',
      confidence: person.confidence, peopleCount: people.length,
      fallingPersonMatch: named ? 'confirmed_target' : 'uncertain', verifiedByFace: named,
      reason: 'ตรวจจากลำดับท่าทางของคนที่อยู่ในขอบเขต',
    };
    const next = nextAlertState(track, result, now, config);
    if (person.falling && track.alerting) next.alerting = true;
    current.set(position, { ...track, ...next });
    if (next.alert) events.push({ ...result, trackId: track.id, eventId: randomUUID(), observedAt: new Date(now).toISOString() });
  }
  state.tracks = current;
  return events;
}

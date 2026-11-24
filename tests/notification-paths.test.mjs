import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual Edge handler with an in-memory family and a simulated push transport.
const root = 'supabase/functions/native-camera-events/';
const attempt = '77d08e23-76cb-4711-8bc1-baf258493852';
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true };
const compile = async name => ts.transpileModule(await readFile(root + name, 'utf8'), { compilerOptions: options }).outputText;
const [handlerCode, policyCode, rawConfig] = await Promise.all([compile('index.ts'), compile('deliveryPolicy.ts'), readFile(root + 'config.json', 'utf8')]);
const policy = {}; vm.runInNewContext(policyCode, { exports: policy });

async function simulate(body, accepted = true) {
  let handler;
  let sent;
  const receivedAt = '2026-11-21T02:00:01Z';
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'caregiver' } } }) },
    from(table) {
      let fields;
      const predicates = {};
      const selectResult = () => {
        if (table === 'profiles' && predicates.id === 'caregiver') return { data: { expo_push_token: 'fixture-device' } };
        if (table === 'fall_events' && predicates.id === attempt) return { data: { family_id: 'test-family' } };
        if (table === 'family_members' && predicates.family_id === 'test-family') {
          if (fields === 'id' && predicates.user_id === 'caregiver') return { count: 1 };
          return { data: [{ user_id: 'caregiver', display_name: 'ผู้ดูแลทดสอบ' }] };
        }
        if (table === 'native_monitor_deliveries' && predicates.event_id === attempt) return { data: { last_result: 'receipt_pending', push_tickets: [] } };
        if (table === 'native_notification_receipts' && predicates.event_id === attempt) return { data: [{ user_id: 'caregiver', received_at: receivedAt }] };
        throw new Error('Unexpected query');
      };
      return {
        select(columns) { fields = columns; return this; },
        eq(key, value) { predicates[key] = value; return this; },
        in(key, values) { predicates[key] = values; return this; },
        order() { return this; },
        maybeSingle: async () => selectResult(),
        then(resolve, reject) { return Promise.resolve().then(selectResult).then(resolve, reject); },
      };
    },
  };
  const deps = {
    'npm:@supabase/supabase-js@2.108.2': { createClient: () => db }, './config.json': JSON.parse(rawConfig),
    './deliveryPolicy.ts': policy, './eventImage.ts': {},
  };
  vm.runInNewContext(handlerCode, { exports: {}, require: key => deps[key], Request, Response, TextEncoder, AbortSignal, crypto,
    Deno: { env: { get: () => 'fixture' }, serve: callback => { handler = callback; } },
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body);
      return Response.json({ data: accepted ? { status: 'ok', id: 'test-ticket' } : { status: 'error' } });
    },
  });
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify(body),
  }));
  assert.equal(response.status, 200);
  return { result: await response.json(), sent, receivedAt };
}

test('a self-test binds the push payload and response to the same request on the signed-in caregiver profile', async () => {
  const { result, sent } = await simulate({ action: 'push-self-test', testId: attempt });
  assert.equal(sent.to, 'fixture-device');
  assert.deepEqual(sent.data, { type: 'notification_test', testId: attempt, userId: 'caregiver' });
  assert.equal(result.testId, attempt);
  assert.equal(result.remoteAccepted, true);
  assert.equal(result.observedAt, undefined);
  assert.equal((await simulate({ action: 'push-self-test', testId: attempt }, false)).result.remoteAccepted, false);
});
test('event delivery shows the family display name and the time from the stored phone acknowledgement', async () => {
  const { result, receivedAt } = await simulate({ action: 'delivery-status', eventId: attempt });
  assert.equal(result.receivedCount, 1);
  assert.deepEqual(result.receipts, [{ name: 'ผู้ดูแลทดสอบ', acknowledgedAt: receivedAt }]);
});

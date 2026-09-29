import assert from 'node:assert/strict';
import test from 'node:test';
import { describeEventAttribution, describeEventDetails, selectMonitoredCameras } from './cloud.mjs';

test('only cameras assigned to a selected care recipient are analyzed', () => {
  const camera = (id, member) => ({
    id, type: 'rtsp', snapshot_url: `http://localhost/${id}.jpg`,
    assigned_member_id: member ? id : null, family_members: member,
  });
  const cameras = [
    camera('selected', { display_name: 'คุณยาย', is_tracked: true, user_id: null }),
    camera('paused', { display_name: 'คุณตา', is_tracked: false, user_id: null }),
    camera('caregiver', { display_name: 'ผู้ดูแล', is_tracked: true, user_id: 'user-id' }),
    camera('unassigned', null),
    { ...camera('phone', { is_tracked: true, user_id: null }), type: 'device' },
    { ...camera('no-snapshot', { is_tracked: true, user_id: null }), snapshot_url: null },
  ];
  assert.deepEqual(selectMonitoredCameras(cameras).map((item) => item.id), ['selected']);
});

test('analyzes every ready camera when no care recipient is selected', () => {
  const cameras = [
    {
      id: 'living-room', type: 'rtsp', snapshot_url: 'http://localhost/living-room.jpg',
      assigned_member_id: null, family_members: null,
    },
    {
      id: 'bedroom', type: 'rtsp', snapshot_url: 'http://localhost/bedroom.jpg',
      assigned_member_id: 'paused',
      family_members: { display_name: 'คุณตา', is_tracked: false, user_id: null },
    },
    { id: 'phone', type: 'device', snapshot_url: null, assigned_member_id: null, family_members: null },
    { id: 'offline', type: 'rtsp', snapshot_url: null, assigned_member_id: null, family_members: null },
  ];
  const selected = selectMonitoredCameras(cameras, false);
  assert.deepEqual(selected.map((item) => item.id), ['living-room', 'bedroom']);
  assert.equal(selected.every((item) => item.allPeopleMode), true);
  assert.equal(describeEventAttribution(selected[0], {
    fallingPersonMatch: 'uncertain', identityConfidence: 0,
  }, 0.8), 'บุคคลที่ตรวจพบ · โหมดตรวจทุกคน');
});

test('does not name a person without a confident identity match', () => {
  const camera = { family_members: { display_name: 'คุณยาย' } };
  assert.equal(describeEventAttribution(camera, {
    peopleCount: 1, subjectContinuity: 'single_continuous_person',
    fallingPersonMatch: 'uncertain', identityConfidence: 0,
  }, 0.8), 'ยังไม่ยืนยันตัวบุคคล · กำลังเฝ้าดู คุณยาย');
  assert.equal(describeEventAttribution(camera, {
    peopleCount: 2, subjectContinuity: 'multiple_people',
    fallingPersonMatch: 'possible_target', identityConfidence: 0.7,
  }, 0.8), 'ยังไม่ยืนยันตัวบุคคล · กำลังเฝ้าดู คุณยาย');
  assert.equal(describeEventAttribution(camera, {
    peopleCount: 3, subjectContinuity: 'multiple_people',
    fallingPersonMatch: 'confirmed_target', identityConfidence: 0.91,
  }, 0.8), 'AI เปรียบเทียบแล้วว่าอาจเป็น คุณยาย');
  assert.equal(describeEventDetails({
    peopleCount: 2, subjectContinuity: 'multiple_people', reason: 'พบบุคคลอยู่บนพื้น',
    fallingPersonMatch: 'uncertain', identityConfidence: 0,
  }), 'พบบุคคลอยู่บนพื้น · พบ 2 คนในภาพ · ยังยืนยันตัวบุคคลไม่ได้');
});

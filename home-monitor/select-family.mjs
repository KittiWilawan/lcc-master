import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { requireString } from './core.mjs';

const environmentPath = fileURLToPath(new URL('.env', import.meta.url));
const familyIdKey = 'HOME_MONITOR_FAMILY_ID';

async function saveFamilyId(familyId) {
  const lines = (await readFile(environmentPath, 'utf8')).split('\n');
  let replaced = false;
  const updated = lines.map((line) => {
    if (!line.startsWith(`${familyIdKey}=`)) return line;
    replaced = true;
    return `${familyIdKey}=${familyId}`;
  });
  if (!replaced) updated.push(`${familyIdKey}=${familyId}`);
  await writeFile(environmentPath, updated.join('\n'), 'utf8');
}

async function chooseFamily(families) {
  if (families.length === 1) return families[0];
  console.log('\nครอบครัวที่บัญชีนี้เข้าถึงได้');
  families.forEach((family, index) => {
    const recipients = (family.family_members ?? []).filter((member) => member.user_id === null);
    const tracked = recipients.filter((member) => member.is_tracked === true);
    console.log(`${index + 1}. ${family.name} · ผู้รับการดูแล ${recipients.length} คน · เปิดเฝ้าดู ${tracked.length} คน`);
  });

  const prompt = createInterface({ input, output });
  try {
    const answer = (await prompt.question(`เลือกหมายเลข 1-${families.length}: `)).trim();
    const selectedIndex = Number(answer) - 1;
    if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= families.length) {
      throw new Error('หมายเลขครอบครัวไม่ถูกต้อง');
    }
    return families[selectedIndex];
  } finally {
    prompt.close();
  }
}

async function main() {
  const client = createClient(
    requireString('SUPABASE_URL', process.env),
    requireString('SUPABASE_ANON_KEY', process.env),
    { auth: { persistSession: false } },
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: requireString('HOME_MONITOR_EMAIL', process.env),
    password: requireString('HOME_MONITOR_PASSWORD', process.env),
  });
  if (signInError) throw signInError;

  try {
    const { data, error } = await client.from('families')
      .select('id,name,created_at,family_members(id,user_id,is_tracked)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!data?.length) throw new Error('บัญชีนี้ยังไม่ได้สร้างหรือเข้าร่วมครอบครัวในแอป');
    const family = await chooseFamily(data);
    await saveFamilyId(family.id);
    console.log(`\nเชื่อมคอม AI กับ “${family.name}” แล้ว`);
  } finally {
    await client.auth.signOut();
  }
}

main().catch((error) => {
  console.error(`ตั้งค่าครอบครัวไม่สำเร็จ: ${error.message}`);
  process.exitCode = 1;
});

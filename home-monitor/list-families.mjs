import { createClient } from '@supabase/supabase-js';
import { requireString } from './core.mjs';

async function main() {
  const supabase = createClient(
    requireString('SUPABASE_URL', process.env),
    requireString('SUPABASE_ANON_KEY', process.env),
    { auth: { persistSession: false } },
  );
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: requireString('HOME_MONITOR_EMAIL', process.env),
    password: requireString('HOME_MONITOR_PASSWORD', process.env),
  });
  if (authError) throw authError;
  const { data, error } = await supabase.from('families').select('id,name').order('created_at');
  if (error) throw error;
  for (const family of data || []) console.log(`${family.name}: ${family.id}`);
  if (!data?.length) console.log('บัญชีนี้ยังไม่ได้เข้าร่วมครอบครัวในแอป');
  await supabase.auth.signOut();
}

main().catch((error) => {
  console.error('อ่านรายชื่อครอบครัวไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});

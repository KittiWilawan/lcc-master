const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!url || !key) throw new Error('กรุณาตั้งค่า EXPO_PUBLIC_SUPABASE_URL และ EXPO_PUBLIC_SUPABASE_ANON_KEY');

const endpoint = new URL('/auth/v1/settings', url);
if (endpoint.protocol !== 'https:') throw new Error('Supabase URL ต้องใช้ HTTPS');
const response = await fetch(endpoint, { headers: { apikey: key } });
if (!response.ok) throw new Error(`เชื่อม Supabase project ไม่สำเร็จ (HTTP ${response.status})`);
console.log('เชื่อม Supabase project สำเร็จ ข้อมูลในฐานข้อมูลจะอ่านได้หลังเข้าสู่ระบบเท่านั้น');

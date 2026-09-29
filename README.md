# LookLanCare

ระบบช่วยเฝ้าดูผู้สูงอายุด้วยกล้อง บันทึกเหตุการณ์ที่ AI สงสัยว่าอาจล้ม และแจ้งผู้ดูแลผ่านแอปมือถือ

## เริ่มต้น

```powershell
npm install
npm start
```

สแกน QR Code ด้วย Expo Go เพื่อทดลองแอปบนมือถือที่เชื่อม Wi-Fi วงเดียวกับคอม

## เอกสาร

- [คู่มือใช้งานภาษาไทย](./USER_GUIDE_TH.md)
- [Use Cases](./USE_CASES.md)
- [รายงานผลทดสอบล่าสุด](./TEST_REPORT.md)

## คำสั่งตรวจระบบ

```powershell
npm run lint
npx tsc --noEmit
npm run db:check
node --test home-monitor/core.test.mjs home-monitor/cloud.test.mjs
```

ระบบตรวจจับบนคอมบ้าน:

```powershell
npm run monitor:credentials
npm run monitor:doctor
npm run monitor:camera-check -- http://ที่อยู่กล้อง/snapshot.jpg
npm run monitor:model-check -- D:\ภาพทดสอบ\normal.jpg
npm run monitor:start
```

คำสั่ง `monitor:credentials` ตรวจบัญชีและให้เลือกครอบครัวที่ถูกต้องเป็นหมายเลขโดยอัตโนมัติ จึงไม่ต้องคัดลอก Family ID เอง

ดูขั้นตอนตั้งค่ากล้อง บัญชีคอมบ้าน และ Ollama ในคู่มือภาษาไทยก่อนเปิดใช้งานจริง

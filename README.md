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
npm run monitor:hub
```

บน Windows สามารถดับเบิลคลิก `Start LookLanCare Hub.cmd` แทนการพิมพ์คำสั่งได้ ครั้งแรกให้สร้างรหัสเชื่อมคอมในหน้า **ตรวจความพร้อม** ของแอป แล้วกรอกรหัสในหน้าต่าง Hub ระบบจะตรวจความพร้อมและเปิด AI ให้เอง

กล้อง HLS หรือ MJPEG ใช้ URL ช่องเดียวได้ URL ภาพนิ่งเป็นตัวเลือกเพิ่มเติม หาก URL มาจากคอม ให้ใช้ IP ของคอมแทน `localhost` บนมือถือ

ดูขั้นตอนตั้งค่ากล้อง เชื่อมคอมบ้าน และติดตั้งโมเดลในคู่มือภาษาไทยก่อนเปิดใช้งานจริง

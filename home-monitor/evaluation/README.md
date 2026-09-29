# การทดสอบ AI ด้วยคลิปแทนกล้อง

ระบบทดสอบนี้อ่านคลิปที่มีคำตอบจริง จากนั้นดึงภาพก่อนเหตุการณ์และภาพล่าสุดมาส่งผ่านเส้นทางวิเคราะห์เดียวกับระบบกล้องจริง ผลลัพธ์ประกอบด้วย confusion matrix, accuracy, precision, recall, specificity, F1, false positive rate และ latency

## เตรียมชุด UR Fall

เก็บไฟล์คลิปและ `urfall-cam0-falls.csv` ไว้ใน `D:\lcc-ai-benchmark\urfall` แล้วเรียก:

```powershell
npm run monitor:dataset-prepare -- D:\lcc-ai-benchmark\urfall test-artifacts\ai-evaluation\urfall-pilot
```

## รันทดสอบ

```powershell
npm run monitor:dataset-evaluate -- test-artifacts\ai-evaluation\urfall-pilot\manifest.json test-artifacts\ai-evaluation\urfall-pilot\results.json
```

ระบบสร้างผลดิบ `.json` และรายงานอ่านง่าย `.md` โดยไม่เดาอายุหรือเพศจากภาพ ช่องดังกล่าวต้องมาจาก metadata ของชุดข้อมูลหรือข้อมูลที่ผู้เข้าร่วมให้ไว้เท่านั้น

## เกณฑ์ก่อนใช้จริง

ต้องทดสอบชุดข้อมูลที่ไม่เคยใช้ปรับคำสั่งโมเดล แยกผลตามมุมกล้อง แสง การบัง จำนวนคน กลุ่มอายุ และเพศที่ผู้เข้าร่วมระบุเอง พร้อมทดสอบในห้องจริง การผ่านชุดนำร่องเพียงชุดเดียวไม่ถือว่าเพียงพอสำหรับระบบดูแลความปลอดภัย

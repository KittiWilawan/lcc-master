# รายงานแก้ไข LookLanCare 1.0.5

จัดทำเมื่อ 2026-10-06T16:58:49.579942+00:00 · ทดสอบใน emulator แยกแบบซ่อนบนไดรฟ์ D

## ผลรอบสุดท้าย

อ่านและวิเคราะห์ครบ 12 คลิป รวม 131 เฟรม ตรวจล้มได้ 5/6 พลาด 1 และแจ้งผิด 0/6 คลิปไม่ล้ม

ผลนี้เป็นชุดคลิปขนาดเล็กที่ใช้เปรียบเทียบระหว่างพัฒนา ไม่ใช่ผลทดสอบอิสระ ไม่ใช้รับรองความแม่นยำทั่วไป 95% หรือความพร้อมเฝ้าระวังจริงทุกห้อง

แก้การแสดงข้อผิดพลาดล็อกอินและเส้นทางแจ้งเตือนเบื้องหลังแล้ว แต่ยังต้องทดสอบเข้าสู่ระบบด้วยบัญชีผู้ใช้บนมือถือจริง ตั้งค่า Firebase และรับแจ้งเตือนบนมือถือผู้ดูแลจริง

ทดสอบ native pipeline ด้วย Release APK สำหรับ x86_64 ใน emulator แยก ส่วนไฟล์ส่งให้ผู้ใช้เป็น ARM64 จาก source เดียวกัน ยังไม่ได้ติดตั้งไฟล์ ARM64 บนมือถือจริง


## สิ่งที่แก้

รักษารหัสและสถานะจากข้อผิดพลาดระบบบัญชี แยกรหัสผ่านผิด ระบบส่วนกลางไม่พร้อม และคำขอตอบช้าออกจากกัน ไม่แจ้งว่าล็อกอินล้มเหลวเมื่อเข้าสู่ระบบแล้วแต่โหลดครอบครัวไม่ได้

ป้องกันการส่งล็อกอินซ้ำ แยกเวลาเครือข่าย Supabase ออกจากเวลาอ่านกล้อง และจำกัดเวลารอทั้งส่วนหัวและเนื้อหาคำตอบโดยไม่ส่งคำขอแก้ข้อมูลซ้ำอัตโนมัติ

เตรียมตัวตรวจจับก่อนรับภาพ ใช้ตัวตรวจจับแยกตามกล้อง ล้างประวัติเมื่อเปลี่ยนแหล่งภาพหรือครอบครัว และจัดการการเริ่ม AI ไม่สำเร็จโดยไม่ปล่อยให้บริการ crash

เริ่มประเมินได้เมื่อมีภาพท่าทางจริงอย่างน้อย 3 ภาพ เติมเฉพาะประวัติเริ่มต้นด้วยภาพแรกของ track ให้ครบหน้าต่างโมเดล 4 ภาพ เกณฑ์ confidence 0.56 และการยืนยันสองครั้งยังคงเดิม

เพิ่มช่องทาง Android ส่งเหตุและภาพจากคิวส่วนตัวไป Supabase ขณะ React Native พัก ใช้ ID เดิมในการลองส่งซ้ำ และเก็บสถานะการตอบรับของ Expo แยกจากการแสดงแจ้งเตือนบนเครื่อง

สิทธิ์ส่งเหตุผูกกับเครื่อง ผู้ใช้ และครอบครัว มีอายุ 30 วัน บนอุปกรณ์เข้ารหัสด้วย Android Keystore และไม่เก็บรหัสผ่านหรือ refresh token ในส่วนนี้ ระบบส่วนกลางเก็บเพียง hash ของสิทธิ์เครื่อง

Logout หยุดการตรวจ ล้างสิทธิ์บนเครื่อง ขอถอนสิทธิ์ที่ระบบส่วนกลาง และล้างโทเคนรับแจ้งเตือนของบัญชี การถอนบนส่วนกลางยังต้องมีเครือข่าย

แสดงความพร้อมแจ้งเตือนบนเครื่องแยกจากรับแจ้งจากเครื่องอื่น ไม่อ้างว่าลงทะเบียนสำเร็จเมื่อบันทึกโทเคนในโปรไฟล์ไม่ได้ และซ่อนรายละเอียดแจ้งเตือนบนหน้าจอล็อก


## การเลือกวิธี AI

ทดลอง VIDEO tracking แล้วพบผลแย่กว่าตัวเลือกที่ใช้โมเดลเดิม จึงไม่ได้ใช้ VIDEO เป็นค่าตั้งต้นของ APK นี้

รุ่นสุดท้ายใช้ IMAGE กับ MediaPipe Pose Lite และตัวจำแนกเดิม อ่านภาพทุก 300 ms สูงสุด 2 กล้อง ข้ามเฟรมเมื่อประมวลผลไม่ทัน

รอบนี้ปรับเส้นทางรับภาพและประวัติของโมเดล ไม่ได้ฝึกโมเดลใหม่ การระบุบุคคลจากรูปอ้างอิงยังไม่รองรับใน AI บนอุปกรณ์ จึงไม่เดาชื่อจากกล้องหรือกรอบ track

ผลมีความไวต่อเฟรมที่อ่านได้จริงจากสตรีม โดยเฉพาะคลิปสั้นและคนถูกบัง ผลรายคลิปมาจากการรันรอบสุดท้ายครั้งเดียว ยังไม่ได้วัดอัตราการผ่านซ้ำหรือความเสถียรระยะยาว


## ผลดับหน้าจอและความปลอดภัย

ผลทดสอบต่อไปนี้ตรวจทั้งเวลาเฟรมล่าสุด เหตุที่บันทึกจริง และ OS notification ไม่ถือว่าการมีข้อความ foreground service เพียงอย่างเดียวผ่าน

เครื่องทดสอบเป็น Android Emulator API 36 ที่เสียบไฟ ผลนี้ไม่ครอบคลุม Deep Doze บนแบตเตอรี่ ความร้อน การจำกัดพื้นหลังของแต่ละยี่ห้อ หรือการทดสอบ 24 ชั่วโมง

การทดสอบ 2 นาทีใช้ IMAGE กับช่วงอ่านภาพ 400 ms ระหว่างพัฒนา ส่วนการทดสอบ 10 นาทีใช้ค่ารุ่นสุดท้าย 300 ms ตัวจำแนกและเกณฑ์ยืนยันล้มเหมือนกัน


## image-screen-off-120000.log

ผ่าน: ปิดจอ 2 นาที ตรวจ 60 จุด ภาพวิเคราะห์ล่าสุดมีอายุ 53 ms สถานะกล้อง ready จอยังดับระหว่างตรวจ

หลังเปลี่ยนเป็นคลิปล้ม บันทึกเหตุและตรวจพบ OS notification จริงภายใน 2.308 วินาทีจากเริ่มคลิป

{"test": "screen-off", "durationMs": 120000, "analysisAgeMs": 53, "checkpoints": 60, "screenInteractive": false, "state": "ready", "postFallState": {"cameraId": "pipeline-background-camera", "state": "ended"}, "fallAlertAfterScreenOff": true, "eventAt": 1791303486642, "clipStartToAlertMs": 2308}


## final-screen-off-600000.log

ผ่าน: ปิดจอ 10 นาที ตรวจ 299 จุด ภาพวิเคราะห์ล่าสุดมีอายุ 127 ms สถานะกล้อง ready จอยังดับระหว่างตรวจ

หลังเปลี่ยนเป็นคลิปล้ม บันทึกเหตุและตรวจพบ OS notification จริงภายใน 2.203 วินาทีจากเริ่มคลิป

จำนวนเหตุล้มผิดระหว่างคลิปปกติที่เล่นวน: 0

{"test": "screen-off", "durationMs": 600000, "analysisAgeMs": 127, "checkpoints": 299, "screenInteractive": false, "state": "ready", "unexpectedNormalEvents": 0, "postFallState": {"cameraId": "pipeline-background-camera", "state": "ready", "analysis": {"status": "fall", "confidence": 0.9973551143287345, "reason": "ประเมินท่าทางต่อเนื่องบนอุปกรณ์ · ยังไม่ยืนยันตัวบุคคล", "peopleCount": 1, "subjectContinuity": "single_continuous_person", "fallingPersonMatch": "uncertain", "detections": [{"label": "person", "trackId": 0, "state": "fall", "confidence": 0.9973551143287345, "x": 0.5312222242355347, "y": 0.4874690771102905, "width": 0.1011703610420227, "height": 0.18612253665924072}], "fallDetected": true}, "lastFrameAt": 1791305519720, "lastAnalysisAt": 1791305519774, "inferenceMs": 47, "frameWidth": 640, "frameHeight": 360, "hasPendingEvent": true}, "fallAlertAfterScreenOff": true, "eventAt": 1791305519790, "clipStartToAlertMs": 2203}


## final-credential-test.log

ผ่าน: เขียน/อ่านสิทธิ์เครื่องได้ ไฟล์ที่เก็บไม่เปิดเผย token และข้อมูลครอบครัวในข้อความปกติ และอ่านสิทธิ์ไม่ได้หลังล้างออก

{"test": "device-credential-encryption", "encrypted": true, "cleared": true}


## ข้อจำกัดจากหน้าจอ emulator

หลังจบรอบดับจอ พบหน้าต่าง Pixel Launcher และ System UI ไม่ตอบสนองค้างอยู่บนหน้าจอ Log ของ Android บันทึก ANR เหล่านี้ระหว่างเริ่ม emulator ก่อนรอบดับจอ 10 นาที ดู emulator-anr-events.log และภาพด้านล่าง

เปิด MainActivity ของแอปและเห็นหน้าเข้าสู่ระบบใต้หน้าต่าง Android ได้ แต่หน้าต่างระบบขวางการเดินใช้งาน จึงยังไม่ถือว่ารอบนี้ผ่านการล็อกอินและการทดสอบหน้าจอเต็มเส้นทาง ผล native pipeline และ OS notification ที่รายงานด้านบนตรวจด้วย instrumentation แยกจากการกดหน้าจอ


![หน้าต่าง Pixel Launcher ไม่ตอบสนองหลังจบรอบดับจอ](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/current-app-screen.png)

หน้าต่าง Pixel Launcher ไม่ตอบสนองหลังจบรอบดับจอ

![เปิด LookLanCare แล้วเห็นหน้าเข้าสู่ระบบใต้หน้าต่าง Pixel Launcher](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/app-launch.png)

เปิด LookLanCare แล้วเห็นหน้าเข้าสู่ระบบใต้หน้าต่าง Pixel Launcher

![หลังปิดเฉพาะ Launcher ในเครื่องทดสอบ ยังมีหน้าต่าง System UI ที่ค้างอยู่](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/login-screen.png)

หลังปิดเฉพาะ Launcher ในเครื่องทดสอบ ยังมีหน้าต่าง System UI ที่ค้างอยู่

## ระบบส่วนกลาง

ติดตั้ง native-camera-events และตารางสิทธิ์เครื่อง/การส่งเหตุแล้ว ตรวจ API จริง 7 กรณี: ปฏิเสธคำขอไม่มีสิทธิ์และ token ปลอม และปฏิเสธอ่านตารางภายในด้วยสิทธิ์ anonymous

ตารางภายในเปิด RLS และไม่ให้ anonymous/authenticated อ่านหรือเขียน ใช้ได้เฉพาะบริการส่วนกลางที่ตรวจสมาชิกครอบครัวและกล้องก่อนทำรายการ ข้อสังเกต RLS ไม่มี policy ของสองตารางนี้เป็นการปิดการเข้าถึงโดยตั้งใจ

Supabase Advisor ยังมีคำเตือนเดิมว่าการตรวจรหัสผ่านรั่วไหลไม่ได้เปิดใช้งาน รอบนี้ไม่ได้เปลี่ยนการตั้งค่านั้น ผลตรวจ API 7 กรณีจึงไม่ใช่การรับรองความปลอดภัยของแอปทั้งหมด

ตรวจคำขอเมื่อ 2026-10-06T16:00:06.540Z ผล: [{"case": "register-without-authorization", "status": 401, "code": "unauthorized"}, {"case": "event-without-authorization", "status": 401, "code": "unauthorized"}, {"case": "revoke-user-without-authorization", "status": 401, "code": "unauthorized"}, {"case": "revoke-without-authorization", "status": 401, "code": "unauthorized"}, {"case": "invalid-device-token", "status": 401, "code": "device_expired"}, {"case": "native_monitor_devices-anonymous-read", "status": 401}, {"case": "native_monitor_deliveries-anonymous-read", "status": 401}]

ยังไม่ผ่านการทดสอบบัญชีจริงสองครอบครัว การส่งภาพไปฐานข้อมูลด้วยบัญชีจริง และการรับแจ้งเตือนข้ามมือถือ ไม่มีการส่งแจ้งเตือนไปผู้ใช้จริงระหว่างรอบนี้


## ผลรายคลิปและภาพ

firstFallMs วัดจากเริ่มเล่นคลิป ไม่ใช่เวลาจากจุดเริ่มล้ม ภาพประกอบเป็นเฟรมที่ถอดจริงจาก HLS ไม่ใช่ screenshot หน้าจอแอป

| คลิป | ป้ายกำกับ | ผล AI | เฟรม | เริ่มแจ้งล้มจากเริ่มคลิป (ms) | AI median (ms) |
| --- | --- | --- | --- | --- | --- |
| 01-fall | fall | ล้ม | 5 | 2538 | 32 |
| 02-fall | fall | ล้ม | 5 | 2365 | 45 |
| 03-fall | fall | ไม่แจ้งล้ม | 5 | — | 35 |
| 04-fall | fall | ล้ม | 5 | 1914 | 45 |
| 05-fall | fall | ล้ม | 12 | 2838 | 41 |
| 06-fall | fall | ล้ม | 9 | 3126 | 57 |
| 07-normal | normal | ไม่แจ้งล้ม | 6 | — | 44 |
| 08-normal | normal | ไม่แจ้งล้ม | 5 | — | 64 |
| 09-normal | normal | ไม่แจ้งล้ม | 5 | — | 39 |
| 10-normal | normal | ไม่แจ้งล้ม | 6 | — | 56 |
| 11-normal | normal | ไม่แจ้งล้ม | 37 | — | 37 |
| 12-normal | normal | ไม่แจ้งล้ม | 31 | — | 38 |

### 01-fall

{"subject_id": "1", "location_id": "1", "action_id": "10", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![01-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-01-fall.jpg)

### 02-fall

{"subject_id": "1", "location_id": "1", "action_id": "11", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![02-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-02-fall.jpg)

### 03-fall

{"subject_id": "1", "location_id": "1", "action_id": "1", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![03-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-03-fall.jpg)

### 04-fall

{"subject_id": "1", "location_id": "1", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![04-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-04-fall.jpg)

### 05-fall

{}

![05-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-05-fall.jpg)

### 06-fall

{}

![06-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-06-fall.jpg)

### 07-normal

{"subject_id": "1", "location_id": "3", "action_id": "13", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![07-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-07-normal.jpg)

### 08-normal

{"subject_id": "1", "location_id": "3", "action_id": "14", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![08-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-08-normal.jpg)

### 09-normal

{"subject_id": "1", "location_id": "3", "action_id": "15", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![09-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-09-normal.jpg)

### 10-normal

{"subject_id": "1", "location_id": "3", "action_id": "16", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![10-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-10-normal.jpg)

### 11-normal

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![11-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-11-normal.jpg)

### 12-normal

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![12-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/final-fix/pipeline-12-normal.jpg)

## ไฟล์ติดตั้งและตรวจสอบ

APK C:/Users/USER/Desktop/lcc-master/dist-android/LookLanCare-1.0.5-camera-fix-arm64.apk · version 1.0.5 · package com.looklancare.app · ARM64 · 72.42 MiB

SHA256: 4274de0f73290c417c94ecf13031b810c5bce1924f565fd1d51c231f6ee0bcff

ตรวจ TypeScript และ ESLint ผ่าน ชุด JavaScript 16 รายการและ JVM 4 รายการผ่าน native encrypted credential test ผ่าน ตรวจ asset โมเดล/ค่าตั้ง 5 ไฟล์ตรงกับ source และ native libraries 28 ไฟล์รองรับการจัดแนว 16 KB ตรวจลายเซ็น APK และ ZIP alignment ผ่าน ดู log และ apk-fix-verification.json ในโฟลเดอร์หลักฐาน

APK เป็นแอป Android ติดตั้งได้โดยตรง ฟีเจอร์ native นี้ใช้กับ Expo Go ไม่ได้

สิ่งที่ต้องทำต่อ: ส่ง google-services.json และตั้งค่า FCM V1 ใน EAS ทดสอบล็อกอินและแจ้งเตือนบนมือถือจริง และปรับโมเดลจากข้อมูลที่มีเวลาเหตุและบุคคล/ห้องแยกสำหรับทดสอบก่อนกล่าวอ้างความแม่นยำ


## หลังจบการทดสอบ

ปิด emulator กล้องจำลอง และตัวเข้ารหัสวิดีโอที่เริ่มสำหรับรอบนี้แล้ว ตรวจว่าไม่มีบริการดังกล่าวเหลืออยู่ โปรแกรมอื่นของผู้ใช้ไม่ได้ถูกปิด

ระบบส่วนกลางยังเปิดใช้งาน: ACTIVE_HEALTHY ตรวจเมื่อ 2026-10-06 16:58:19 UTC ดู fix-final-state.json

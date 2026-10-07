# รายงาน HLS ลิงก์เดียวและความเสถียร LookLanCare 1.0.4

วันที่ 6 ตุลาคม 2026 · ทดสอบเบื้องหลัง ไม่ใช้เมาส์หรือคีย์บอร์ดของผู้ใช้

## ผลสรุป

เส้นทางอ่าน HLS → ภาพ → AI ทำงานครบ 12/12 คลิป รวม 108 เฟรมที่วิเคราะห์ ไม่มี crash ในรอบคลิปหลังแก้ไข

AI ตรวจพบการล้ม 2/6 คลิป พลาด 4 คลิป แจ้งผิด 0/6 คลิปปกติ ผลถูก 8/12 (66.7%) ความไวต่อการล้มในชุดนี้ 33.3%

ระบบรับภาพดีขึ้น แต่ AI ชุดนี้ยังไม่เหมาะกับการเฝ้าระวังที่พึ่งการแจ้งอัตโนมัติเพียงอย่างเดียว ยังรับรองความแม่นยำ 95% หรือความเสถียร 24 ชั่วโมงไม่ได้

เปิด Supabase โปรเจกต์ Looklancare67 เดิมกลับจาก INACTIVE เป็น ACTIVE_HEALTHY แล้ว ตรวจ SQL และ Auth health HTTP 200 สำเร็จ แต่ยังไม่ได้ทดสอบเข้าสู่ระบบสองครอบครัว ซิงก์ภาพ/เหตุ และแจ้งมือถือผู้ดูแลอีกเครื่อง


## การเปิดฐานข้อมูลกลับและผลตรวจ

โปรเจกต์เดิม wpcxqlnprpknxfsbqbeu · status=ACTIVE_HEALTHY · ตรวจเมื่อ 2026-10-06 15:03:09 UTC · SQL verified=True · Auth health HTTP=200

คำสั่ง restore ของ Supabase สำเร็จ ไม่สร้างโปรเจกต์ใหม่ ไม่ย้ายฐานข้อมูล และไม่เปลี่ยน schema หรือข้อมูลผู้ใช้

ช่วงก่อนบริการพร้อมเคยตรวจ Auth health ไม่สำเร็จ หลังบริการกลับมาแล้วตรวจซ้ำได้ HTTP 200

ตรวจ metadata พบช่องข้อมูล cameras, family_members และ fall_events ที่โค้ดใช้ครบ ตาราง public 8 ตารางเปิด RLS และ bucket fall-evidence / identity-references เป็น private ข้อนี้ยังไม่ใช่ผลทดสอบแยกข้อมูลสองครอบครัวหรือสิทธิ์เขียนจริง


## สิ่งที่เปลี่ยน

ในโหมด app_background บน Android APK ใช้ HLS เพียงลิงก์เดียว ไม่ต้องมีลิงก์ภาพนิ่ง ตัวถอดวิดีโอและ AI ทำงานในบริการ Android โดยไม่ผูกกับหน้าจอกล้องหรือวงรอบ JavaScript

รวม MediaPipe Pose Lite และตัวจำแนกที่เคยฝึกไว้ใน APK ตรวจด้วย CPU บนอุปกรณ์ ไม่เรียก AI ภายนอกสำหรับเส้นทาง HLS นี้ รอบนี้เป็นการย้ายโมเดลและทดสอบระบบ ไม่ได้ฝึกโมเดลใหม่

รองรับ 2 กล้องพร้อมกัน สูงสุด 6 ท่าทางต่อภาพ สุ่มภาพทุก 400 มิลลิวินาทีและข้ามเฟรมเมื่อประมวลผลไม่ทัน ภาพแสดงพร้อมกรอบมาจากเฟรมเดียวกับที่ AI วิเคราะห์ ไม่ใช่วิดีโอแสดงผล 30 เฟรมต่อวินาที

มี timeout การอ่านภาพ ตรวจภาพค้าง 12 วินาที และเชื่อมต่อใหม่ด้วยเวลารอ 1–30 วินาที หยุดรายงานภาพสดเมื่อวิดีโอสิ้นสุด

ทดสอบกล้องจากภาพที่ถอดได้จริง ข้อมูลที่อ้างว่าเป็น JPEG แต่ไม่ใช่รูปจะไม่ผ่าน native decoder ป้องกันการเพิ่มกล้องซ้ำจากการกดรัว

เก็บเหตุและรูปในพื้นที่ส่วนตัวของแอปที่ไม่สำรองขึ้นระบบ backup จำกัดคิว 30 เหตุ ใช้เวลา/ID เดิมเมื่อซิงก์ ไม่อ้างว่าส่งแจ้งแล้วเมื่อระบบปิดสิทธิ์ เก็บประวัติที่ยังไม่ซิงก์ร่วมกับประวัติบนฐานข้อมูล

ล้างสถานะภาพเมื่อหยุด/ออกจากระบบ จำกัดการส่งรูปตัวอย่างเฉพาะหน้าที่กำลังดู แยกภาพที่ MediaPipe เป็นเจ้าของเพื่อแก้ crash จากภาพถูก recycle ก่อนแสดงหรือเก็บหลักฐาน

แก้การปิดตัวถอดภาพให้คืนเฉพาะ context/surface ของกล้องนั้น ไม่ terminate EGL display ที่แชร์กับกล้องอื่นและหน้าจอแอป

อัปเดต MediaPipe เป็น 0.10.29 ซึ่งตรวจไฟล์จริงแล้วมี x86_64 และ ARM64 ไฟล์ AI ARM64 มี ELF alignment 16 KB ตรวจ signature และ zip alignment ของ APK ที่ส่งแล้ว

การเลือกชื่อในเส้นทาง AI บนอุปกรณ์ใช้เลือกพื้นที่กล้อง ยังไม่ใช่การยืนยันคนจากใบหน้าหรือรูปอ้างอิง ปรับข้อความในแอปให้บอกข้อจำกัดนี้


## การเชื่อมต่อหลุด

จำลองกล้องตอบ HTTP 503 เป็นเวลา 16 วินาที หลังเปิดกลับได้รับภาพใหม่ภายใน 5.548 วินาที และพบสถานะ reconnecting จริง

ผลนี้เป็นหนึ่งครั้งในเครือข่ายทดสอบบนเครื่องเดียว ยังไม่ใช่การทดสอบ packet loss, Wi-Fi หลุดจริง หรือการทำงานหลายวัน


## สองกล้องและการคืนทรัพยากร

เปิดตัวถอด HLS สองตัวพร้อมกัน แล้วปิดตัวแรก ตัวที่สองยังรับภาพต่อจาก 1 เป็น 7 เฟรม โดย reconnect 0 ครั้ง

กรณีนี้ตรวจการถอดภาพและทรัพยากรสองกล้อง ไม่ใช่การวัดความเร็ว AI สองกล้องหรือการติดตามหลายคนเดินตัดกัน


## การดับจอด้วย release build

ดับจอ 2 นาที: state=ready, อายุผลล่าสุด 365 ms, ตรวจสถานะ 60 ครั้ง, screenInteractive=False

การรับภาพและ AI ต่อเนื่องผ่าน แต่การฉีดคลิปล้มยังไม่สร้างเหตุ: การแจ้งเตือนหลังดับจอไม่ผ่าน

ดับจอ 10 นาที: state=ready, อายุผลล่าสุด 162 ms, ตรวจสถานะ 300 ครั้ง, screenInteractive=False

การรับภาพและ AI ต่อเนื่องผ่าน แต่การฉีดคลิปล้มยังไม่สร้างเหตุ: การแจ้งเตือนหลังดับจอไม่ผ่าน

รอบ 2 และ 10 นาทีข้างต้นเป็น baseline ก่อนแก้การ terminate display ส่วนผลทวน build ล่าสุดระบุแยกด้านล่าง

ใช้ Android 16 emulator แบบไม่มีหน้าต่าง แยก package ทดสอบจากแอปจริง พร้อมข้อมูล user/family สมมติ เครื่องจำลองแสดง mIsPowered=true จึงไม่ใช่การรับรอง Deep Doze หรือระบบประหยัดแบตเตอรี่ของมือถือจริง

ทดสอบบริการ native ด้วยการใส่ configuration ผ่าน instrumentation ระหว่างรอบแรก backend ยัง INACTIVE หลังเปิด backend กลับยังไม่ได้ทวนการตั้งค่า HLS ผ่านหน้าแอปด้วยบัญชีจริง

การแจ้งบนเครื่องที่ตรวจและการแจ้งไปเครื่องอื่นเป็นคนละเส้นทาง เส้นทาง HLS ใหม่นี้ยังไม่มีการส่งเหตุข้ามเครื่องขณะ JavaScript พัก การซิงก์ทำเมื่อ React กลับมาทำงาน


## ทวนการดับจอหลังแก้ทรัพยากรภาพ

ดับจอ 2 นาที: state=ready, อายุผลล่าสุด 443 ms, ตรวจสถานะ 60 ครั้ง, screenInteractive=False

การแจ้งเหตุล้มหลังดับจอยังไม่ผ่าน แม้การรับภาพและวิเคราะห์ต่อเนื่องทำงาน


## สาเหตุที่การแจ้งล้มยังไม่ผ่าน

05-fall: trace เก็บผลไม่ซ้ำ 9 ผล พบ possible_fall 1 ผล ไม่พบ pose คน 2 ผล fallDetected 0 ผล

06-fall: trace เก็บผลไม่ซ้ำ 3 ผล พบ possible_fall 0 ผล ไม่พบ pose คน 1 ผล fallDetected 0 ผล

ภาพของคลิปถูกถอดและวิเคราะห์จนจบ แต่ท่าล้มไม่ผ่านการยืนยันต่อเนื่อง ในรอบที่เก็บ trace จึงไม่ถึงขั้นสร้างเหตุหรือโพสต์ notification แม้สิทธิ์ POST_NOTIFICATIONS ของ package ทดสอบเปิดอยู่

ผลต่างจากรอบอ่าน 12 คลิปชี้ว่าผลยังไวต่อจังหวะสุ่มเฟรมและการพบ landmark ไม่ควรลดเกณฑ์ยืนยันเพื่อทำให้ชุดทดสอบเล็กผ่านโดยไม่มีข้อมูลความเสี่ยงการแจ้งผิด

โมเดลเดิมฝึกจาก pose และเฟรมที่เลือกตลอดคลิป แต่ runtime นี้ใช้ MediaPipe Tasks แบบหลาย pose กับหน้าต่าง 4 เฟรมต่อเนื่อง ต้องฝึกและตรวจด้วยเส้นทางเก็บภาพ/landmark เดียวกับแอป แล้วประเมินบนคนและห้องที่ไม่อยู่ในชุดฝึก


## ปัญหาที่เหลือและการทำซ้ำ

HLS-AI-01 · สูง: เล่นคลิป fall ทั้ง 6 ผ่าน HLS จริง คาดว่าพบทั้ง 6 แต่พบ 2/6 ต้องปรับชุดฝึกและการตรวจท่าทาง ไม่ใช่ปัญหาการอ่านลิงก์เพียงอย่างเดียว

HLS-AI-02 · สูง: เปิด live HLS จน ready ดับจอ 2/10 นาที แล้วเปลี่ยนเป็น 05/06-fall คาดว่ามีเหตุและ OS notification แต่ไม่มีเหตุภายใน 40 วินาที ดู release-screen-off logs และ service fall traces

HLS-REMOTE-01 · สูง: เครื่องตรวจปิดจอและ React พัก เส้นทาง native ใหม่นี้แจ้งเฉพาะเครื่องตรวจ ยังไม่มีการส่งเหตุถึงเครื่องผู้ดูแลในช่วงนั้น ต้องมีการส่ง backend จาก native ก่อนใช้งานข้ามเครื่อง

HLS-BACKEND-01 · แก้การพักระบบแล้ว: Supabase ACTIVE_HEALTHY และ Auth health HTTP 200 เหลือทวนตั้งค่ากล้อง/ซิงก์เหตุผ่านบัญชีจริงและการแยกข้อมูลสองครอบครัว

HLS-ID-01 · สูงสำหรับการตรวจเฉพาะคน: เลือกชื่อในห้องหลายคนยังเป็นการเลือกพื้นที่กล้อง ไม่ใช่ยืนยันตัวบุคคล ต้องทำระบบ identity ที่ตรวจได้ก่อนอ้างว่าตรวจเฉพาะผู้สูงอายุคนนั้น


## หลักฐาน AI รายคลิป

คลิปเดิมที่มีป้ายกำกับ 6 ล้มและ 6 ไม่ล้ม จาก Figshare, FallVision และ GMD ไม่ใช่ชุดทดสอบใหม่แบบปิดผล ไม่มีป้ายกำกับอายุ เพศ หรือเวลาที่เริ่มล้มครบทุกคลิป และไม่ครอบคลุมบ้านพักคนชราจริงทั้งหมด

บางคลิปยาวประมาณ 1.9 วินาที ถอดได้เพียง 4 เฟรม ขณะที่ระบบใช้หน้าต่าง 4 เฟรมและยืนยันสองครั้ง จึงมีข้อจำกัดการยืนยันก่อนคลิปจบ ส่วนกรณีอื่นที่พลาดยังต้องตรวจ landmark/โดเมนของโมเดลเพิ่มเติม

firstFallMs วัดจากเริ่มเล่นคลิป ไม่ใช่เวลาหลังร่างกายเริ่มล้ม inferenceMedianMs เป็นเวลาคำนวณ AI ต่อเฟรมใน emulator ไม่ใช่เวลาตั้งแต่กล้องถึงการแจ้งเตือนหรือความเร็วบนมือถือ


| คลิป | ป้ายกำกับ | ผล AI | เฟรม | เริ่มเห็นล้ม (ms) | AI median (ms) |
| --- | --- | --- | --- | --- | --- |
| 01-fall | fall | ไม่แจ้งล้ม | 4 | — | 92 |
| 02-fall | fall | ไม่แจ้งล้ม | 4 | — | 99 |
| 03-fall | fall | ไม่แจ้งล้ม | 5 | — | 63 |
| 04-fall | fall | ไม่แจ้งล้ม | 5 | — | 75 |
| 05-fall | fall | ล้ม | 9 | 2915 | 45 |
| 06-fall | fall | ล้ม | 8 | 3523 | 64 |
| 07-normal | normal | ไม่แจ้งล้ม | 4 | — | 42 |
| 08-normal | normal | ไม่แจ้งล้ม | 5 | — | 40 |
| 09-normal | normal | ไม่แจ้งล้ม | 4 | — | 87 |
| 10-normal | normal | ไม่แจ้งล้ม | 6 | — | 45 |
| 11-normal | normal | ไม่แจ้งล้ม | 30 | — | 45 |
| 12-normal | normal | ไม่แจ้งล้ม | 24 | — | 49 |

### 01-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "1", "action_id": "10", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![01-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-01-fall.jpg)

### 02-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "1", "action_id": "11", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![02-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-02-fall.jpg)

### 03-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "1", "action_id": "1", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![03-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-03-fall.jpg)

### 04-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "1", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![04-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-04-fall.jpg)

### 05-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {}

![05-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-05-fall.jpg)

### 06-fall

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {}

![06-fall](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-06-fall.jpg)

### 07-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "3", "action_id": "13", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![07-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-07-normal.jpg)

### 08-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "3", "action_id": "14", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![08-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-08-normal.jpg)

### 09-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "3", "action_id": "15", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![09-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-09-normal.jpg)

### 10-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "1", "location_id": "3", "action_id": "16", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![10-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-10-normal.jpg)

### 11-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![11-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-11-normal.jpg)

### 12-normal

เฟรมแรกที่ถอดจาก HLS จริง ไม่ใช่ screenshot หน้าแอป · {"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![12-normal](C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence/pipeline-12-normal.jpg)

## การตรวจโค้ดและข้อจำกัด

TypeScript และ ESLint ผ่าน ชุดทดสอบ JavaScript 26/26 ผ่าน JVM unit test 4/4 ผ่าน ตัวจำแนก Android เทียบ Python 64 ตัวอย่างได้ผลตรงกัน (เป็นการตรวจการแปลงโมเดล ไม่ใช่ความแม่นยำ 100%)

SHA256 โมเดลต้นทาง: 0abf237c0c2bb17eebc7c9718ec239d3a59ffac127b900c68618ea66358b689d · threshold=0.56 · featureVariant=invariant_temporal

เคยพบ JNI ไม่รองรับ x86_64 และ crash จาก recycled bitmap ทั้งสองแก้และทวนการอ่านคลิปแล้ว พบ debug activity รอ idle ไม่สำเร็จ จึงเปลี่ยนวิธีเปิด activity ใน instrumentation และทวนด้วย release

ยังไม่ตรวจต่อเนื่อง 24 ชั่วโมง ไม่ได้ตรวจอุณหภูมิ/แบตเตอรี่บนมือถือจริง ยังไม่มีผลความเร็ว AI สองกล้องหรือการติดตามหลายคนเดินตัดกัน ไม่ได้ทดสอบ remote push, RLS สองครอบครัว หรือสแกนระบุตัวบุคคลจริง


## วิธีใช้รุ่นใหม่

ติดตั้ง APK Android 64 บิตรุ่น 1.0.4 นี้ ฟีเจอร์ native ใหม่ไม่ทำงานใน Expo Go โปรเจกต์ Supabase เปิดกลับและตรวจ Auth health แล้ว แต่ยังไม่ได้ทวนเข้าสู่ระบบด้วยบัญชีผู้ใช้จริง

เข้าสู่ระบบและเลือกครอบครัว เปิดสิทธิ์แจ้งเตือน เพิ่มกล้องภายนอก ใส่ลิงก์ HLS (.m3u8) เพียงช่องเดียว แล้วทดสอบให้รับภาพได้จริง

ถ้า HLS มาจากคอม ให้ใช้ IP ที่มือถือเข้าถึงได้แทน localhost ใน Wi-Fi เดียวกัน ถ้ากล้องมีเพียง RTSP/MJPEG ยังต้องมีต้นทางแปลงเป็น HLS

รอให้สถานะ AI บอกว่าได้รับภาพและวิเคราะห์แล้ว ทดสอบในห้องจริงและตรวจความสำเร็จของเหตุ/การแจ้งเตือนก่อนพึ่งการเฝ้าระวัง แอปถูกบังคับหยุดหรือเครื่องรีบูตต้องเปิดแอปอีกครั้ง


## APK และไฟล์หลักฐาน

APK: C:/Users/USER/Desktop/lcc-master/dist-android/LookLanCare-1.0.4-hls-arm64.apk · 72.41 MiB · versionCode 5 · package com.looklancare.app · ARM64 · ลงนามด้วยคีย์โครงการเดิม

SHA256 APK: 8076ffce80b31ac8f7e65f85b5ee20aa41f69eb7bd97423418256d0a51b6b65d

Logs และ JSON: C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability · หลักฐานภาพ: C:/Users/USER/Desktop/lcc-master/test-artifacts/hls-stability/evidence

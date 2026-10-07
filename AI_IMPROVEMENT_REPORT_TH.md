# รายงานแก้ไขและฝึก AI LookLanCare 1.0.6

วันที่ 7 ตุลาคม 2026 · เป้าหมาย: ลดการพลาดเมื่อคนล้มเร็วหรือท่าทางหายชั่วคราว และฝึกโมเดลให้ตรงกับภาพที่ Android ใช้งานจริง ผลนี้ใช้สำหรับประเมินต้นแบบธีสิส ยังไม่ใช่หลักฐานรับรองความแม่นยำทั่วไป 95–100%

## 1. สิ่งที่แก้และฝึกจริง

| ส่วน | การปรับปรุง |
| --- | --- |
| ติดตามคน | จับคู่กรอบด้วยทิศทางการเคลื่อนที่ ขนาดตัว และกรอบซ้อนทับ แก้ ID หลุดเมื่อคนล้มเร็ว เก็บ track ข้ามภาพหายได้ไม่เกิน 1.2 วินาที |
| ยืนยันเหตุ | ใช้ผลบวกจากภาพจริงอย่างน้อย 2 ครั้ง เว้นได้ไม่เกิน 0.9 วินาที ภาพหายอย่างเดียวสร้างเหตุไม่ได้ ยังมี rearm และ cooldown |
| หน้าต่างเวลา | 3 เฟรม มีภาพจริงอย่างน้อย 2 เฟรมก่อนเริ่มให้คะแนน จึงต้องมีอย่างน้อย 3 ภาพจริงเพื่อแจ้งครั้งแรก เก็บตามอายุจริง ไม่ล้างทุกรอบที่ pose หาย |
| ฝึกโมเดล | ฝึก fall classifier 9 ตัวใน 4 โปรไฟล์ เลือกด้วย validation เท่านั้น ผู้ชนะ HistGradientBoosting 250 iterations, threshold 0.45, 1,242 features |
| โมเดลท่าทาง | ใช้ MediaPipe Pose Landmarker Lite task เดิม ไม่ได้ฝึก neural network หาจุดข้อต่อใหม่ |
| สถานะหน้าจอ | ถ้ามีภาพแต่ AI ใช้เกิน 600 ms จะแจ้งว่าประมวลผลช้า และไม่นับกล้องนั้นว่าพร้อมตรวจทันเวลา ยังคงแสดงภาพและกรอบ |
| APK | โมเดลฝังใน release 1.0.6/code 7 ไม่ต้องเปิด Metro เพื่อใช้เส้นทาง HLS บนอุปกรณ์ |

## 2. ข้อมูลและวิธีป้องกันผลคะแนนลวง

ดึงท่าทางตามลำดับเวลาจาก 2,174 คลิป ขนาดไม่เกิน 640 px สุ่มทุก 300 ms ด้วย MediaPipe task ที่ใส่ใน APK แยกผู้เข้าร่วมและ SHA256 ไม่ซ้ำข้าม train/validation/test ผู้ชนะใช้เฉพาะ 1,268 คลิปฝึกจาก Figshare และ GMDCSA24 สร้าง 11,875 windows; validation 407 คลิป; test 499 คลิป ไม่ใช้ test เพื่อ fit หรือเลือก threshold

ป้ายกำกับเป็นระดับวิดีโอ ช่วงตั้งแต่ 60% ของระยะคลิปที่ติดป้าย fall ถูกใช้เป็นตัวอย่างบวกแบบ weak supervision ไม่มีป้ายกำกับเวลาที่เริ่มล้มจริง คลิป normal ใช้หลายช่วงเวลา เสริมการข้ามเฟรมด้วย stride 2 สองตำแหน่ง เมื่อพบหลาย pose จะข้ามเฟรมนั้นเพื่อไม่ยกป้ายกำกับของผู้เข้าร่วมไปให้คนอื่น การฝึกนี้จึงยังไม่พิสูจน์ฉากหลายคนหรือการบังกันในห้องจริง

โปรไฟล์แรกลองเสริม FallVision จาก train cache ที่แปลง keypoints 17 เป็น 33 จุด แต่โปรไฟล์ผู้ชนะไม่ได้ใช้ข้อมูลเสริมนี้ แช่แข็งการเลือกโปรไฟล์ก่อนอ่านคะแนน test ของผู้ชนะ ชุด test นี้กันออกจากการ fit รอบนี้ แต่เคยใช้วิเคราะห์ระบบในงานก่อนหน้า จึงไม่เรียกการรับรองแบบ blind ภาคสนาม

แหล่งข้อมูลและเครดิต: Figshare DOI 10.6084/m9.figshare.28596332.v2 และ GMDCSA24 DOI 10.5281/zenodo.12921216 (CC BY 4.0 ตาม manifests); FallVision DOI 10.7910/DVN/75QPKK เฉพาะการทดลอง/คลิป regression อ้างอิง SHA และผู้เข้าร่วมใน cases.json และ extraction-provenance.json

[การเลือกโมเดลที่แช่แข็งแล้ว](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/model-selection.json>)

## 3. ผล offline บน 499 คลิปที่กันไว้

| รุ่น | คลิป | ล้มพบ | ล้มพลาด | แจ้งผิด | ปกติถูก | Accuracy | Recall ล้ม |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ตัวจำแนกเดิม / หน้าต่าง 4 เฟรม | 499 | 176 | 51 | 21 | 251 | 85.6% | 77.5% |
| ตัวจำแนกใหม่ / หน้าต่าง 3 เฟรม | 499 | 209 | 18 | 19 | 253 | 92.6% | 92.1% |

การเปรียบเทียบ offline ใช้ pose ลำดับเวลาเดียวกันและกฎ gap ของ pipeline ใหม่ ตัวเดิมใช้ตัวจำแนกและความยาวหน้าต่างเดิม ส่วน minTrackFrames เป็น 3 ผลนี้ไม่ใช่การเล่น APK เดิมทั้งระบบ อีก comparator ที่ใช้ minTrackFrames=2 กับโมเดลเดิมให้ 85.97% (พลาด 48/แจ้งผิด 22) ผล APK จริงแสดงแยกในหัวข้อถัดไป

| แหล่งข้อมูล — รุ่นใหม่ | คลิป | Accuracy | Recall ล้ม | Specificity | พลาด | แจ้งผิด |
| --- | --- | --- | --- | --- | --- | --- |
| gmdcsa24 | 37 | 78.4% | 88.2% | 70.0% | 2 | 6 |
| primary | 462 | 93.7% | 92.4% | 94.8% | 16 | 13 |

ยังพลาดการล้ม 18 คลิปและเตือนผิด 19 คลิป โดย GMDCSA24 มี accuracy เพียง 78.4% และเตือนผิด 6 จาก 20 คลิปปกติ ต้องแก้การแยกท่านั่ง/นอน/ก้มและฝึกข้อมูลที่มีเวลาล้มกำกับก่อนอ้างความพร้อมใช้งานทั่วไป ผลรวม 92.6% ไม่ได้หมายถึงทุกห้องหรือทุกมุมกล้องได้เท่านี้

## 4. ผลผ่าน Android decoder และ AI จริง

ใช้ release x86_64 ตรงกับ emulator LookLanCare_Audit_D_20261006/API 36 ที่แยกไว้และซ่อนหน้าต่าง ไม่ควบคุมเมาส์หรือคีย์บอร์ด Windows เล่น HLS จากคลิปที่มีป้ายกำกับ ผ่าน CameraStreamSession และ LocalPoseAnalyzer ตัวจริง APK เดิม 1.0.5 เทียบกับรุ่นใหม่ 1.0.6 ในช่วงที่ไม่มีการฝึก/Gradle แข่งขัน CPU ใช้ข้อมูลทดสอบและไม่มีบัญชีครอบครัวจริง

| ชุด | คลิป | ล้มพบ | ล้มพลาด | แจ้งผิด | Accuracy | Recall ล้ม |
| --- | --- | --- | --- | --- | --- | --- |
| APK เดิม: 32 regression | 32 | 10 | 6 | 0 | 81.2% | 62.5% |
| APK ใหม่: 32 regression รอบแรก | 32 | 15 | 1 | 0 | 96.9% | 93.8% |
| APK เดิม: 20 คลิปสตรีมเพิ่มเติม | 20 | 6 | 4 | 2 | 70.0% | 60.0% |
| APK ใหม่: 20 คลิปสตรีมเพิ่มเติม | 20 | 7 | 3 | 2 | 75.0% | 70.0% |
| APK เดิม: 52 คลิปไม่ซ้ำ | 52 | 16 | 10 | 2 | 76.9% | 61.5% |
| APK ใหม่: 52 คลิปไม่ซ้ำ | 52 | 22 | 4 | 2 | 88.5% | 84.6% |

20 คลิปสตรีมเพิ่มเติมถูกเลือกจากผู้เข้าร่วม test และตัด SHA ของ 32 คลิป regression ออกก่อนทราบคะแนนโมเดล ไม่ใช่ข้อมูลฝึก แต่เป็นส่วนหนึ่งของ 499 คลิป offline จึงไม่ควรนับเป็นตัวอย่างอิสระเพิ่มจากผล offline

| รอบซ้ำ 12 คลิป | ล้มพบ/6 | แจ้งผิด/6 | เฟรม | คลิปพลาด |
| --- | --- | --- | --- | --- |
| quiet-candidate/baseline-01 | 5/6 | 0/6 | 133 | 05-fall |
| quiet-candidate/baseline-02 | 5/6 | 0/6 | 136 | 05-fall |
| quiet-candidate/baseline-03 | 5/6 | 0/6 | 133 | 05-fall |

จำนวนคลิปที่ผลเปลี่ยนใน 3 รอบ: 0/12 (ไม่มี) ผลนี้พิสูจน์ความสม่ำเสมอเฉพาะคลิปและ emulator รอบนี้ ไม่ใช่ความแม่นยำในมือถือทุกเครื่อง

รวมรุ่นใหม่ 76 ครั้งรายคลิป, 739 เฟรม; median ของเวลา inference มัธยฐานแต่ละคลิป 41 ms; เฉพาะคลิปล้มที่ตรวจพบ ให้ผลครั้งแรก median 1822 ms, ช่วง 1435–3597 ms จากเริ่มเปิดคลิป ไม่ใช่ความหน่วงจากเวลาเริ่มล้ม

JUnit ของชุดคลิปตรวจว่าถอดภาพและวิเคราะห์ได้ ส่วนผลถูก/ผิดคำนวณกับป้ายกำกับแยกต่างหาก ไม่ใช้คำว่า test ผ่านเพื่ออ้างว่าจับทุกเหตุได้

## 5. ผลดับจอและความตรงกันของโมเดล

| รายการ | ผลจริง |
| --- | --- |
| ดับจอ release 2 นาที | state=ready, screenInteractive=False, จุดตรวจ 60, อายุผลล่าสุด 281 ms, เหตุผิดระหว่างคลิปปกติ 0 |
| เปลี่ยนเป็นคลิปล้มหลังดับจอ | เหตุบันทึกจริงและ OS notification=True, เวลา 2048 ms จากเปิดคลิป |
| Parity | [{"test": "classifier-parity", "cases": 64, "maxError": 0}, {"test": "runtime-feature-parity", "cases": 64, "maxFeatureError": 0, "maxProbabilityError": 2.220446049250313e-16}] |
| Unit / TypeScript | {"nativeUnitTests": 13, "nativeUnitFailures": 0, "cameraJavaScriptTests": 17, "cameraJavaScriptFailures": 0, "runtimeWindowTests": 4, "runtimeWindowFailures": 0, "typescriptExitCode": 0} |

การดับจอใช้ emulator ที่เสียบไฟ มี foreground service และตรวจ timestamp ของผล/คิวเหตุ/OS notification จริง ไม่ใช่ดูข้อความ service อย่างเดียว ไม่รับรอง deep doze การฆ่าแอปของผู้ผลิต หรือการรับ push บนมือถืออีกเครื่อง รอบ 10 นาทีที่เคยผ่านเป็นโมเดล 1.0.5 และไม่ถือว่าเป็นผลของโมเดลใหม่

[เวลาและสถานะทุกจุดขณะดับจอ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/screen-off/pipeline-screen-off-120000.json>)

![ภาพจากเฟรมที่สร้างเหตุหลังดับจอ (ข้อมูลทดสอบ)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/screen-off/event-evidence.jpg>)

## 6. ปัญหาที่ยังต้องแก้ — ทำซ้ำได้

| ระดับ | รอบ | กรณี | คาดหวัง | ผลจริง | เฟรม | Trace |
| --- | --- | --- | --- | --- | --- | --- |
| สูง | quiet-candidate/baseline-01 | 05-fall | ควรตรวจพบการล้ม | พลาด | 12 | quiet-candidate/baseline-01/pipeline-05-fall-trace.json |
| สูง | quiet-candidate/baseline-02 | 05-fall | ควรตรวจพบการล้ม | พลาด | 12 | quiet-candidate/baseline-02/pipeline-05-fall-trace.json |
| สูง | quiet-candidate/baseline-03 | 05-fall | ควรตรวจพบการล้ม | พลาด | 12 | quiet-candidate/baseline-03/pipeline-05-fall-trace.json |
| สูง | holdout-candidate/additional-01 | holdout-01-fall | ควรตรวจพบการล้ม | พลาด | 6 | holdout-candidate/additional-01/pipeline-holdout-01-fall-trace.json |
| สูง | holdout-candidate/additional-01 | holdout-02-fall | ควรตรวจพบการล้ม | พลาด | 6 | holdout-candidate/additional-01/pipeline-holdout-02-fall-trace.json |
| สูง | holdout-candidate/additional-01 | holdout-05-fall | ควรตรวจพบการล้ม | พลาด | 6 | holdout-candidate/additional-01/pipeline-holdout-05-fall-trace.json |
| กลาง | holdout-candidate/additional-01 | holdout-17-normal | ไม่ควรแจ้งล้ม | แจ้งผิด | 22 | holdout-candidate/additional-01/pipeline-holdout-17-normal-trace.json |
| กลาง | holdout-candidate/additional-01 | holdout-18-normal | ไม่ควรแจ้งล้ม | แจ้งผิด | 14 | holdout-candidate/additional-01/pipeline-holdout-18-normal-trace.json |

กรณี 05-fall (FallVision S_D_0002) พลาดซ้ำทั้ง 3 รอบ ใน trace รอบแรกพบ pose หาย 3 ภาพต่อเนื่องและสร้าง track ใหม่หลังกลับมา คะแนนก่อน/หลังช่วงหายยังต่ำกว่า threshold (สูงสุดประมาณ 0.189) จึงมีทั้งข้อจำกัดการหาท่าทางและตัวจำแนก ไม่แก้ด้วยการลด threshold จากคลิป test นี้ เพราะจะเสี่ยงเพิ่มการแจ้งผิดและทำให้ผล test ใช้เป็นข้อมูลปรับโมเดล

ชุดสตรีมเพิ่มเติมรุ่นใหม่ยังพลาด holdout-01/02/05-fall: 01 มีคะแนนสูงสองภาพแต่ track ต่างกัน (0 → 1) หลังพบหลาย pose; 02 มีคะแนนสูงเพียงภาพเดียวแล้วไม่พบ pose ต่อ; 05 ได้คะแนนสูงเพียงภาพเดียวตอนท้าย กฎยืนยันจึงไม่แจ้ง ทั้งสามมีปัญหาการรับ pose ต่อเนื่อง ส่วน holdout-17/18-normal ได้คะแนนสูงต่อเนื่องแม้ label เป็น normal จึงเป็นข้อจำกัดการจำแนก ไม่ควรเพิ่มความไวด้วยการยกเลิกการยืนยันซ้ำ

ขั้นตอนทำซ้ำ: เปิด gateway ด้วย configuration ที่ตรงชุด → ติดตั้ง candidate-x86_64.apk และ candidate-test.apk ใน emulator แยก → เรียก run_android_ai_audit.py ด้วย regression-plan.json หรือ run-plan.json และ output ใหม่ → เทียบ predictedFall กับ label จาก cases.json ภาพแรกและ trace ของทุกกรณีอยู่หัวข้อหลักฐาน ลำดับเฟรม/จังหวะ decoder อาจทำให้ผลเปลี่ยน ต้องเก็บผลใหม่ทุกครั้ง

พบผลเสียภายใต้โหลดสูงจริง: รอบ tracking ที่ใช้โมเดลเดิมระหว่างดึง pose มีเพียง 54 เฟรมจาก 12 คลิป จับล้มได้ 0/6 แม้ decoder ยังส่งภาพ การ infer หลายคลิปเกิน 600 ms จึงเพิ่มคำเตือนประมวลผลช้าใน UI และทดสอบใหม่ขณะเครื่องว่าง ห้ามรวมรอบ stress นี้เข้ากับ accuracy ของโมเดลใหม่

## 7. APK ที่ส่งมอบและข้อจำกัด

[ดาวน์โหลด APK 1.0.6 สำหรับมือถือ ARM64](<C:/Users/USER/Desktop/lcc-master/dist-android/LookLanCare-1.0.6-ai-improved-arm64.apk>)

com.looklancare.app · version 1.0.6 / code 7 · 72.1 MiB · SHA256 c7427f88e2c47e5bb4a9dcbf0eb54493c9a4390c4d27fa89bcd804b8bed6c8fc

ตรวจลายเซ็นและ ZIP alignment 16 KB ผ่าน assets 5 ไฟล์ตรงกับต้นฉบับ native ELF 28 ไฟล์รองรับ 16 KB cert ตรงกับ APK เดิม ติดตั้งทับได้เมื่อเครื่องอนุญาต APK จากแหล่งนี้ ยังไม่ได้ติดตั้งรุ่นนี้บนมือถือ ARM64 จริง

การแก้รอบนี้อยู่เส้นทาง HLS AI ใน Android APK เส้นทางกล้องมือถือ type=device และโหมดคอมบ้านยังใช้ provider เดิม การติดตามกรอบเป็นความต่อเนื่องทางเรขาคณิต ยังไม่ใช่การยืนยันใบหน้าหรือชื่อบุคคล ตรวจสูงสุด 6 pose และ 2 กล้องตาม config เมื่อเริ่มหรืออัปเดต APK ต้องเปิดแอปและตรวจสถานะกล้องอีกครั้ง

ข้อมูลเพศและอายุของผู้เข้าร่วมไม่ได้มีครบใน manifests ที่ใช้ จึงยังไม่รับรองผลแยกสำหรับเด็ก ผู้สูงอายุ หรือทุกวัย คะแนนที่แสดงจากตัวจำแนกเป็น model score ไม่ใช่การรับรองโอกาสถูกจริงเท่ากับเปอร์เซ็นต์นั้น

ขั้นถัดไปที่มีประโยชน์: เพิ่มคลิป normal ที่นอน/นั่ง/ก้มและคลิปล้มที่มีเวลาเริ่มล้มกำกับ ฝึกเฉพาะ train แล้วทดสอบแหล่งใหม่จากห้องจริงที่ไม่เคยใช้ปรับโมเดล ตรวจแสงน้อย หลายคน การบังกัน และทดสอบแบตเตอรี่/ดับจอกับมือถือจริง รายงาน recall และ false alerts ต่อชั่วโมง ไม่ใช้ accuracy รวมอย่างเดียว

ไม่มีการเรียกผู้ให้บริการ AI ภายนอกเพื่อเทรนหรือทดสอบ HLS รอบนี้ จึงไม่ได้ใช้โควต้า API ไม่ส่งเหตุไปบัญชีครอบครัวจริง ไม่ได้ตรวจ Supabase/Auth/การแจ้งข้ามเครื่องใหม่ในงานนี้

ปิดบริการที่เริ่มเฉพาะรอบทดสอบแล้ว ผลตรวจ cleanup: {"ownedEmulatorRunning": false, "gatewayStopped": true, "testProcessesStopped": true, "ownedAuditProcessCount": 0, "globalAdbDaemonKept": true, "userAppsUntouched": true}

## 8. รายการพลาดและแจ้งผิด offline ทั้งหมด

| แหล่ง | ผู้เข้าร่วม | กิจกรรม | มุม | label | ผล | windows | SHA256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary | 1 | 11 | R | fall | missed_fall | 6 | b1ff217948074aed5ed280dc13793e508b65c7f9a42f46bd4d35ac9e0e8e2710 |
| primary | 1 | 2 | L | fall | missed_fall | 6 | 7f2fe9886f5e02237df8c70f90a2ae7b58383706e115781fda32f194996dd3aa |
| primary | 1 | 4 | L | fall | missed_fall | 6 | 1c70464765b326421cb927410595f4deee934b27bc14f45b0c5fbd4a56592e41 |
| primary | 1 | 19 | B | normal | false_alert | 6 | 743ecd9b0a012d962a0e98622a05bfc9e4e1239ee56d52dc6dc906b51eeafcda |
| primary | 1 | 19 | F | normal | false_alert | 6 | 6a5eb2840caa38cbbab441c43f543328db2a3582cc4e99233e1e89dd5f620007 |
| primary | 1 | 19 | R | normal | false_alert | 5 | f42f432b5fc7f7d314739598643f046082a5d9cbd6c4d3d5bd1d4ad30720f79a |
| primary | 1 | 24 | L | normal | false_alert | 6 | b2dc65bb52c4ac83828f845822375f273eab0b8e71bcb927451ff8f17de7b849 |
| primary | 1 | 24 | R | normal | false_alert | 6 | 46e40744d7bd793fbe16844624babe9968a8f09b2cea8041d74dd1f1bad40bb8 |
| primary | 1 | 25 | L | normal | false_alert | 6 | 30492808dcd0c052e081da5723667564e0b0d78b0c5fde8288e3acf3ee618bfa |
| primary | 1 | 25 | L | normal | false_alert | 6 | 94f325369a84feca6926b54e76f192f315acf8170a2cec9c9ce11e17a19300dd |
| primary | 1 | 25 | R | normal | false_alert | 6 | 7e6f026e68c280234ac34764a26b7f073e6f1367a259ed756a30a663542d3c92 |
| primary | 2 | 11 | B | fall | missed_fall | 5 | 7d9dc935cbacb28e1f6eb74b5f2865eb02a85c052a3923ffaee4f6aeb3cf2d9f |
| primary | 2 | 1 | B | fall | missed_fall | 3 | 36bbe3b7176e28f9c8422e1b8f74263d3c00e3886ab2ed344b0e3553804e7c88 |
| primary | 2 | 1 | L | fall | missed_fall | 3 | dd25557649524498a975e62383096b827521fc4c22c55c74a8a76f3636d93a41 |
| primary | 2 | 1 | L | fall | missed_fall | 3 | dd25557649524498a975e62383096b827521fc4c22c55c74a8a76f3636d93a41 |
| primary | 2 | 2 | F | fall | missed_fall | 6 | 17ad473a946dad64b1326f83ba11d56daf0155c59305d67da7489585ff2ef25d |
| primary | 2 | 2 | L | fall | missed_fall | 4 | d008b4024c81ee10c6c50c5e779c45aacdd120b183ff51092f858486e9c6da51 |
| primary | 2 | 3 | L | fall | missed_fall | 2 | 1a98b1e0b00e7d1fd332a21d7df1e465a8ab265c2f827f4dad50ea282b0178c1 |
| primary | 2 | 4 | F | fall | missed_fall | 1 | 0531c7625a89150d65e71c12cdba2f582dc6ff8d981d0e62a30559c1d7bb0f31 |
| primary | 2 | 5 | B | fall | missed_fall | 3 | 5e12c785d0558fe9636b94e7107d37d265395d34f8e86b8b8ac8d929410e83ca |
| primary | 2 | 7 | F | fall | missed_fall | 2 | b2d784139a0b80e88da9c3dcd84fca00c4ae63987f567f54c1710eef6a693707 |
| primary | 2 | 7 | L | fall | missed_fall | 6 | 67f36e69a9608e05624049289689e180fab374b3bdb683f98f0ffe2192be87fb |
| primary | 2 | 19 | R | normal | false_alert | 5 | 62e3e9bc4c0683d369807cd1c6dd0158e9841d6b2279ccb19bb58aed59d77e22 |
| primary | 2 | 20 | B | normal | false_alert | 6 | 67d5ea9846aef8e11530891150df07561920d61fe4e30801aef3e459324c039e |
| primary | 2 | 20 | F | normal | false_alert | 5 | 7dbc28004f240453e8ac0a1275c01129de37b8eeff7ddfe8930088beae9dba3c |
| primary | 3 | 3 | B | fall | missed_fall | 3 | 57e7554c705fdbc87cdebef60ccb1725a060853f24d32a4d35aecbae7ce5d068 |
| primary | 3 | 4 | B | fall | missed_fall | 5 | b2baf3644175d7f8693d2884ba1e86b0333ca3b44248e75915fcde37d13762d4 |
| primary | 3 | 19 | R | normal | false_alert | 4 | fd36ab9a94039e5b7f25ba1ca490ae22574f53568bb8089e00fb6860888cbcd1 |
| primary | 19 | 19 | L | normal | false_alert | 6 | 18232da85fe3c854311b84286c722868cb0c8dc9a165482b3af632a26e7bc553 |
| gmdcsa24 | 4 |  |  | normal | false_alert | 22 | d7bd6f68df5f0c526ab2a1ada10eac780fd429e7cfb58cc14b673eaf1d682d69 |
| gmdcsa24 | 4 |  |  | normal | false_alert | 20 | 3b8635e008c5ba27337ddf7cb3b1ad5da9b2758a196f1cbed2576cc776c8887d |
| gmdcsa24 | 4 |  |  | normal | false_alert | 16 | 6e410abbc6d4ef7bf52ac835b952a74a94311d0977fdfddb21885477602b7b69 |
| gmdcsa24 | 4 |  |  | normal | false_alert | 29 | 9547a6408eeeca6da339b111cf6d3112129ef02105941d7f1c1051c12bb9f849 |
| gmdcsa24 | 4 |  |  | normal | false_alert | 15 | a42a66af9fc8e8e9df46518f6960efb1899fbc368950c5517c1ab9d4f4704918 |
| gmdcsa24 | 4 |  |  | normal | false_alert | 23 | 20895c4a7ce5ff072158cc9c16675e2cbd39dc7c472ad2e511f097123918a4db |
| gmdcsa24 | 4 |  |  | fall | missed_fall | 10 | 7931179693dd93e45cf0510d6e1d8caa3313fbdf2c46a53bcf7646992b11a4ec |
| gmdcsa24 | 4 |  |  | fall | missed_fall | 11 | 0c0e626c816214436dcedd154fff142a42cc04445a665351fdf8a2b6809dd5d4 |

[ผลรายคลิป offline ทั้ง 499 กรณี](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/held-test-diagnosis.json>)

## 9. ภาพและผลทุกครั้งรายคลิป

ภาพต่อไปนี้เป็นเฟรมแรกที่ AI รับจากคลิป ผลที่ระบุคำนวณจากทั้งคลิป ภาพแรกอาจยังไม่เกิดการล้ม จึงไม่ใส่กรอบผลจากเฟรมภายหลังลงภาพแรก trace เก็บทุกผลที่วิเคราะห์จริง ทั้งผ่าน พลาด และแจ้งผิด HTML ฝังภาพครบ เปิดได้โดยไม่ต้องใช้อินเทอร์เน็ต

### quiet-baseline/additional-01

ล้มพบ 7/10 · แจ้งผิด 0/10 · เฟรม 116

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/results.json>)

extra-01-fall · label fall · ถูก · 6 เฟรม · inference median 45 ms · พบครั้งแรก 2283 ms จากเปิดคลิป · SHA d1051c390eadb134ab46fd24b2982db8457da9c03cd4f3d4980443e8d02c3e1b

![quiet-baseline/additional-01 / extra-01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-01-fall-trace.json>)

extra-02-fall · label fall · พลาดล้ม · 5 เฟรม · inference median 34 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 7d9dc935cbacb28e1f6eb74b5f2865eb02a85c052a3923ffaee4f6aeb3cf2d9f

![quiet-baseline/additional-01 / extra-02-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-02-fall-trace.json>)

extra-03-normal · label normal · ถูก · 6 เฟรม · inference median 45 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 80df805fe52d0f5d078fa9a502c9042e3d517a6331baf3cd37a3c78fe8ee6fc2

![quiet-baseline/additional-01 / extra-03-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-03-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-03-normal-trace.json>)

extra-04-normal · label normal · ถูก · 6 เฟรม · inference median 47 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 141b25edb5898d238b0b20cef48b786c7b6aaeccf606dc5c4df1312ecaf14b48

![quiet-baseline/additional-01 / extra-04-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-04-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-04-normal-trace.json>)

extra-05-fall · label fall · พลาดล้ม · 5 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 8badba1f68272b4cfceb7d947e072d40979fd9b4f7317291ba67726889a06487

![quiet-baseline/additional-01 / extra-05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-05-fall-trace.json>)

extra-06-fall · label fall · ถูก · 6 เฟรม · inference median 72 ms · พบครั้งแรก 1654 ms จากเปิดคลิป · SHA 9c3d120ffcd565786bc9dc93eca8141826745135374c84b5a856085e913432c6

![quiet-baseline/additional-01 / extra-06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-06-fall-trace.json>)

extra-07-normal · label normal · ถูก · 6 เฟรม · inference median 64 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c156ae88d8d9f4040dc840cfc65dec0587ada91a1f3e9fd967f68b7ececae310

![quiet-baseline/additional-01 / extra-07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-07-normal-trace.json>)

extra-08-normal · label normal · ถูก · 6 เฟรม · inference median 69 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6843c42ce8e108e9295c9a48ea5399c5daec51aa26c2e3beef7ac2bff53498d6

![quiet-baseline/additional-01 / extra-08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-08-normal-trace.json>)

extra-09-fall · label fall · ถูก · 6 เฟรม · inference median 36 ms · พบครั้งแรก 2724 ms จากเปิดคลิป · SHA 9c948d6cee80cd70b56b38775e5ad5b4b01e6d57bdc21795fbdaf361a7f48ff0

![quiet-baseline/additional-01 / extra-09-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-09-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-09-fall-trace.json>)

extra-10-fall · label fall · ถูก · 6 เฟรม · inference median 40 ms · พบครั้งแรก 1997 ms จากเปิดคลิป · SHA eca177421c00ce545ac3beca14bddd4f4d5be29f35210cd7f71628f11efcbcf5

![quiet-baseline/additional-01 / extra-10-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-10-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-10-fall-trace.json>)

extra-11-normal · label normal · ถูก · 6 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dc34539ea38a58f6abc24373c20c1561f50a56288d766735127a6ebd8f2929e6

![quiet-baseline/additional-01 / extra-11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-11-normal-trace.json>)

extra-12-normal · label normal · ถูก · 6 เฟรม · inference median 52 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6848e08c57a46861b65d3d5f061414c0a68eb547511775d6ba3386133d215b66

![quiet-baseline/additional-01 / extra-12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-12-normal-trace.json>)

extra-13-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 42 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 0a918927af5e3c428db7d24fb168809138449b0270a4bad3824df553154fd1f4

![quiet-baseline/additional-01 / extra-13-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-13-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-13-fall-trace.json>)

extra-14-fall · label fall · ถูก · 6 เฟรม · inference median 37 ms · พบครั้งแรก 1746 ms จากเปิดคลิป · SHA d8b2dc74fbb6ce444a636ab8f929b5bbdeaf621417f7feb0ac3d8037924bd560

![quiet-baseline/additional-01 / extra-14-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-14-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-14-fall-trace.json>)

extra-15-fall · label fall · ถูก · 5 เฟรม · inference median 37 ms · พบครั้งแรก 1969 ms จากเปิดคลิป · SHA 3b00a93a3c255ded53ca0c3d12dfde24861c36efd856bb29744731500bb3366e

![quiet-baseline/additional-01 / extra-15-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-15-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-15-fall-trace.json>)

extra-16-fall · label fall · ถูก · 6 เฟรม · inference median 54 ms · พบครั้งแรก 2512 ms จากเปิดคลิป · SHA a28a070665e89d5278ccc89d5000724d5dde1eb4070d8416ac28586300bfb5ab

![quiet-baseline/additional-01 / extra-16-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-16-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-16-fall-trace.json>)

extra-17-normal · label normal · ถูก · 6 เฟรม · inference median 73 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA ed13cc5403bf29d8f647274468ba0fa44ec256dc1364f5360f7b0b5a1f08bbf5

![quiet-baseline/additional-01 / extra-17-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-17-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-17-normal-trace.json>)

extra-18-normal · label normal · ถูก · 5 เฟรม · inference median 45 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 90045e30f44cdd59ffa5aff183b2b1092b930d501232a6671004e1e8ecb1bfe9

![quiet-baseline/additional-01 / extra-18-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-18-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-18-normal-trace.json>)

extra-19-normal · label normal · ถูก · 6 เฟรม · inference median 49 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dec79386d6b5d0b639822f11cdf73a61b62b0cd0b224813592a326a1c4010923

![quiet-baseline/additional-01 / extra-19-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-19-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-19-normal-trace.json>)

extra-20-normal · label normal · ถูก · 6 เฟรม · inference median 60 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 1124a6cac80f6d3c1e18004c242c419de16f0d692d1fdbba1ec6b3a3eb6ac3ff

![quiet-baseline/additional-01 / extra-20-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-20-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/additional-01/pipeline-extra-20-normal-trace.json>)

### quiet-baseline/baseline-01

ล้มพบ 3/6 · แจ้งผิด 0/6 · เฟรม 133

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/results.json>)

01-fall · label fall · ถูก · 6 เฟรม · inference median 72 ms · พบครั้งแรก 2375 ms จากเปิดคลิป · SHA f98a1fd8cb6e5ce4245f5f0215d2e09383d5cd38a1d2792519ead0a0df421ec9

![quiet-baseline/baseline-01 / 01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-01-fall-trace.json>)

02-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 66 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 4f497b8b44fe0b8d5044ec09b7fc745d3d1af57ebe93631a575f30321ac54637

![quiet-baseline/baseline-01 / 02-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-02-fall-trace.json>)

03-fall · label fall · พลาดล้ม · 5 เฟรม · inference median 38 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 36071281102477d90aa33c0cc0f087ce39c3071b0ec0b1b7400281a8993c5b68

![quiet-baseline/baseline-01 / 03-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-03-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-03-fall-trace.json>)

04-fall · label fall · ถูก · 5 เฟรม · inference median 36 ms · พบครั้งแรก 1892 ms จากเปิดคลิป · SHA 7e47a12bdfbd5fe2cafc742ec13b86d2339c5d83c0c5d41a51c39307191d1724

![quiet-baseline/baseline-01 / 04-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-04-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-04-fall-trace.json>)

05-fall · label fall · พลาดล้ม · 11 เฟรม · inference median 101 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dd8a669d18d80621c82e1911edfc8407acba1d4bbab4d57bc8822dc566195da8

![quiet-baseline/baseline-01 / 05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-05-fall-trace.json>)

06-fall · label fall · ถูก · 9 เฟรม · inference median 97 ms · พบครั้งแรก 3061 ms จากเปิดคลิป · SHA 97bab741121a558201cdc7a9790e4556551946de871be33b1a45782138988ed4

![quiet-baseline/baseline-01 / 06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-06-fall-trace.json>)

07-normal · label normal · ถูก · 6 เฟรม · inference median 43 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c20945a9290ad2e1de5f0e844bb0d5e2f131a2d162050e41118419cbd04abb26

![quiet-baseline/baseline-01 / 07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-07-normal-trace.json>)

08-normal · label normal · ถูก · 6 เฟรม · inference median 51 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6210f9f1ea8d2d8fbe30c55e7d40a0d65649b6f036e6043994b3665877776300

![quiet-baseline/baseline-01 / 08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-08-normal-trace.json>)

09-normal · label normal · ถูก · 5 เฟรม · inference median 38 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a765230cc0bc9d736a352e7c8ca2f8503c8b9f772d8d541fecbbfcacbb6defa1

![quiet-baseline/baseline-01 / 09-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-09-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-09-normal-trace.json>)

10-normal · label normal · ถูก · 6 เฟรม · inference median 60 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 706a7f3f5b33931f59e864acbf774aac35fefc1fea4e2bf199f2a20684f568a1

![quiet-baseline/baseline-01 / 10-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-10-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-10-normal-trace.json>)

11-normal · label normal · ถูก · 36 เฟรม · inference median 44 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 820bbbb1189ee2fe176b453e3dc26b730cd9a22fe6b0a18b42410732513b8e43

![quiet-baseline/baseline-01 / 11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-11-normal-trace.json>)

12-normal · label normal · ถูก · 32 เฟรม · inference median 40 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a68ce68aa309267d6395cdcd716e13a797994fa838361e03bd337133d9952c7f

![quiet-baseline/baseline-01 / 12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline/baseline-01/pipeline-12-normal-trace.json>)

### quiet-baseline-holdout/additional-01

ล้มพบ 6/10 · แจ้งผิด 2/10 · เฟรม 225

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/results.json>)

holdout-01-fall · label fall · พลาดล้ม · 5 เฟรม · inference median 47 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 95dcfd1bdfabff1952688c849e275491dc3e3e00f7e6f44c38a8cf35e7b7190f

![quiet-baseline-holdout/additional-01 / holdout-01-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-01-fall-trace.json>)

holdout-02-fall · label fall · พลาดล้ม · 5 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA edff13246a6f6466683305eb02a923ffae45fcb127eaa7ae66819c6133b3433f

![quiet-baseline-holdout/additional-01 / holdout-02-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-02-fall-trace.json>)

holdout-03-normal · label normal · ถูก · 5 เฟรม · inference median 44 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 90989faa3cec42dbc71a870be70b170948ae6929d6e246f910d5ce0d494c30a5

![quiet-baseline-holdout/additional-01 / holdout-03-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-03-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-03-normal-trace.json>)

holdout-04-normal · label normal · ถูก · 6 เฟรม · inference median 39 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 2ba4505cf5e03b10cc0256878573194f7586222833cb8ace24ed8424cf6b7dc1

![quiet-baseline-holdout/additional-01 / holdout-04-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-04-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-04-normal-trace.json>)

holdout-05-fall · label fall · ถูก · 6 เฟรม · inference median 41 ms · พบครั้งแรก 2350 ms จากเปิดคลิป · SHA 49cd3fd9265a8a3b8f2b84b0aee285901f40c32a5117cc28d8a28c7f5c255fad

![quiet-baseline-holdout/additional-01 / holdout-05-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-05-fall-trace.json>)

holdout-06-fall · label fall · ถูก · 7 เฟรม · inference median 45 ms · พบครั้งแรก 2790 ms จากเปิดคลิป · SHA 7ec922e29661029c75a82963932f41b7155a0dc1c2e1a57641a7538b9e702597

![quiet-baseline-holdout/additional-01 / holdout-06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-06-fall-trace.json>)

holdout-07-normal · label normal · ถูก · 6 เฟรม · inference median 51 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA fd36ab9a94039e5b7f25ba1ca490ae22574f53568bb8089e00fb6860888cbcd1

![quiet-baseline-holdout/additional-01 / holdout-07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-07-normal-trace.json>)

holdout-08-normal · label normal · ถูก · 6 เฟรม · inference median 40 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 918c38a2cf2820f4770699f9373d4a86db64ff83acc2b3cdc239406af129dea2

![quiet-baseline-holdout/additional-01 / holdout-08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-08-normal-trace.json>)

holdout-09-fall · label fall · พลาดล้ม · 7 เฟรม · inference median 51 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 8df43053c098b09a09a389d41366c6530de6b3f80667c0969ac4994d2251a903

![quiet-baseline-holdout/additional-01 / holdout-09-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-09-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-09-fall-trace.json>)

holdout-10-fall · label fall · ถูก · 6 เฟรม · inference median 51 ms · พบครั้งแรก 2711 ms จากเปิดคลิป · SHA 9ea737d2863325f103eb5bfc598202db9bfef1686319c1637de635bb191de95f

![quiet-baseline-holdout/additional-01 / holdout-10-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-10-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-10-fall-trace.json>)

holdout-11-normal · label normal · ถูก · 5 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 2206b3b1185c837564c9d8e4557b8e728f6f40a67fb1f2349df52278161876d9

![quiet-baseline-holdout/additional-01 / holdout-11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-11-normal-trace.json>)

holdout-12-normal · label normal · ถูก · 5 เฟรม · inference median 34 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 21e9b302043a7bc2336bff398c38a138b64c3d7ac3752924bf43cfd94cc5fc43

![quiet-baseline-holdout/additional-01 / holdout-12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-12-normal-trace.json>)

holdout-13-fall · label fall · ถูก · 15 เฟรม · inference median 37 ms · พบครั้งแรก 1764 ms จากเปิดคลิป · SHA 8a0be863f3d25149bf9fd795f603baaeb5e0c580180b7653e31b5cb4a25671cc

![quiet-baseline-holdout/additional-01 / holdout-13-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-13-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-13-fall-trace.json>)

holdout-14-fall · label fall · ถูก · 14 เฟรม · inference median 45 ms · พบครั้งแรก 4166 ms จากเปิดคลิป · SHA be235fef9bda633f5f63ccbc28c1dbb6c0138728c5b1696d86f7a6e0c66f4516

![quiet-baseline-holdout/additional-01 / holdout-14-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-14-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-14-fall-trace.json>)

holdout-15-fall · label fall · ถูก · 9 เฟรม · inference median 36 ms · พบครั้งแรก 1817 ms จากเปิดคลิป · SHA 7c57683db153b4a05b362763e69f9ebc86c3cc9833c88d789a33bccc3b5cb2bf

![quiet-baseline-holdout/additional-01 / holdout-15-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-15-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-15-fall-trace.json>)

holdout-16-fall · label fall · พลาดล้ม · 13 เฟรม · inference median 41 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dbea18d773a46e9af2911787bc909d9eca24cebc9a45329563ed884ff68222b4

![quiet-baseline-holdout/additional-01 / holdout-16-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-16-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-16-fall-trace.json>)

holdout-17-normal · label normal · แจ้งผิด · 22 เฟรม · inference median 39 ms · พบครั้งแรก 4473 ms จากเปิดคลิป · SHA d7bd6f68df5f0c526ab2a1ada10eac780fd429e7cfb58cc14b673eaf1d682d69

![quiet-baseline-holdout/additional-01 / holdout-17-normal / แจ้งผิด](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-17-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-17-normal-trace.json>)

holdout-18-normal · label normal · แจ้งผิด · 15 เฟรม · inference median 36 ms · พบครั้งแรก 1834 ms จากเปิดคลิป · SHA 6e410abbc6d4ef7bf52ac835b952a74a94311d0977fdfddb21885477602b7b69

![quiet-baseline-holdout/additional-01 / holdout-18-normal / แจ้งผิด](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-18-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-18-normal-trace.json>)

holdout-19-normal · label normal · ถูก · 23 เฟรม · inference median 56 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA e337e1248f012e5db82c5e92879add0fc5bb747b65ae31762b38cca6909f90d4

![quiet-baseline-holdout/additional-01 / holdout-19-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-19-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-19-normal-trace.json>)

holdout-20-normal · label normal · ถูก · 45 เฟรม · inference median 84 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 0ebf059c3c4f408b7d0552fee4ad47774eecd700fec53e55c96a70f1d5ce773a

![quiet-baseline-holdout/additional-01 / holdout-20-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-20-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-baseline-holdout/additional-01/pipeline-holdout-20-normal-trace.json>)

### quiet-candidate/additional-01

ล้มพบ 10/10 · แจ้งผิด 0/10 · เฟรม 107

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/results.json>)

extra-01-fall · label fall · ถูก · 5 เฟรม · inference median 34 ms · พบครั้งแรก 2437 ms จากเปิดคลิป · SHA d1051c390eadb134ab46fd24b2982db8457da9c03cd4f3d4980443e8d02c3e1b

![quiet-candidate/additional-01 / extra-01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-01-fall-trace.json>)

extra-02-fall · label fall · ถูก · 5 เฟรม · inference median 36 ms · พบครั้งแรก 2316 ms จากเปิดคลิป · SHA 7d9dc935cbacb28e1f6eb74b5f2865eb02a85c052a3923ffaee4f6aeb3cf2d9f

![quiet-candidate/additional-01 / extra-02-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-02-fall-trace.json>)

extra-03-normal · label normal · ถูก · 6 เฟรม · inference median 40 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 80df805fe52d0f5d078fa9a502c9042e3d517a6331baf3cd37a3c78fe8ee6fc2

![quiet-candidate/additional-01 / extra-03-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-03-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-03-normal-trace.json>)

extra-04-normal · label normal · ถูก · 5 เฟรม · inference median 43 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 141b25edb5898d238b0b20cef48b786c7b6aaeccf606dc5c4df1312ecaf14b48

![quiet-candidate/additional-01 / extra-04-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-04-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-04-normal-trace.json>)

extra-05-fall · label fall · ถูก · 5 เฟรม · inference median 40 ms · พบครั้งแรก 1917 ms จากเปิดคลิป · SHA 8badba1f68272b4cfceb7d947e072d40979fd9b4f7317291ba67726889a06487

![quiet-candidate/additional-01 / extra-05-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-05-fall-trace.json>)

extra-06-fall · label fall · ถูก · 5 เฟรม · inference median 46 ms · พบครั้งแรก 1724 ms จากเปิดคลิป · SHA 9c3d120ffcd565786bc9dc93eca8141826745135374c84b5a856085e913432c6

![quiet-candidate/additional-01 / extra-06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-06-fall-trace.json>)

extra-07-normal · label normal · ถูก · 6 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c156ae88d8d9f4040dc840cfc65dec0587ada91a1f3e9fd967f68b7ececae310

![quiet-candidate/additional-01 / extra-07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-07-normal-trace.json>)

extra-08-normal · label normal · ถูก · 5 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6843c42ce8e108e9295c9a48ea5399c5daec51aa26c2e3beef7ac2bff53498d6

![quiet-candidate/additional-01 / extra-08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-08-normal-trace.json>)

extra-09-fall · label fall · ถูก · 6 เฟรม · inference median 69 ms · พบครั้งแรก 2030 ms จากเปิดคลิป · SHA 9c948d6cee80cd70b56b38775e5ad5b4b01e6d57bdc21795fbdaf361a7f48ff0

![quiet-candidate/additional-01 / extra-09-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-09-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-09-fall-trace.json>)

extra-10-fall · label fall · ถูก · 6 เฟรม · inference median 53 ms · พบครั้งแรก 1435 ms จากเปิดคลิป · SHA eca177421c00ce545ac3beca14bddd4f4d5be29f35210cd7f71628f11efcbcf5

![quiet-candidate/additional-01 / extra-10-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-10-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-10-fall-trace.json>)

extra-11-normal · label normal · ถูก · 5 เฟรม · inference median 72 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dc34539ea38a58f6abc24373c20c1561f50a56288d766735127a6ebd8f2929e6

![quiet-candidate/additional-01 / extra-11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-11-normal-trace.json>)

extra-12-normal · label normal · ถูก · 6 เฟรม · inference median 50 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6848e08c57a46861b65d3d5f061414c0a68eb547511775d6ba3386133d215b66

![quiet-candidate/additional-01 / extra-12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-12-normal-trace.json>)

extra-13-fall · label fall · ถูก · 6 เฟรม · inference median 50 ms · พบครั้งแรก 2198 ms จากเปิดคลิป · SHA 0a918927af5e3c428db7d24fb168809138449b0270a4bad3824df553154fd1f4

![quiet-candidate/additional-01 / extra-13-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-13-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-13-fall-trace.json>)

extra-14-fall · label fall · ถูก · 5 เฟรม · inference median 34 ms · พบครั้งแรก 1688 ms จากเปิดคลิป · SHA d8b2dc74fbb6ce444a636ab8f929b5bbdeaf621417f7feb0ac3d8037924bd560

![quiet-candidate/additional-01 / extra-14-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-14-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-14-fall-trace.json>)

extra-15-fall · label fall · ถูก · 5 เฟรม · inference median 37 ms · พบครั้งแรก 1578 ms จากเปิดคลิป · SHA 3b00a93a3c255ded53ca0c3d12dfde24861c36efd856bb29744731500bb3366e

![quiet-candidate/additional-01 / extra-15-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-15-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-15-fall-trace.json>)

extra-16-fall · label fall · ถูก · 5 เฟรม · inference median 33 ms · พบครั้งแรก 1738 ms จากเปิดคลิป · SHA a28a070665e89d5278ccc89d5000724d5dde1eb4070d8416ac28586300bfb5ab

![quiet-candidate/additional-01 / extra-16-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-16-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-16-fall-trace.json>)

extra-17-normal · label normal · ถูก · 6 เฟรม · inference median 57 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA ed13cc5403bf29d8f647274468ba0fa44ec256dc1364f5360f7b0b5a1f08bbf5

![quiet-candidate/additional-01 / extra-17-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-17-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-17-normal-trace.json>)

extra-18-normal · label normal · ถูก · 4 เฟรม · inference median 430 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 90045e30f44cdd59ffa5aff183b2b1092b930d501232a6671004e1e8ecb1bfe9

![quiet-candidate/additional-01 / extra-18-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-18-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-18-normal-trace.json>)

extra-19-normal · label normal · ถูก · 5 เฟรม · inference median 89 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dec79386d6b5d0b639822f11cdf73a61b62b0cd0b224813592a326a1c4010923

![quiet-candidate/additional-01 / extra-19-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-19-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-19-normal-trace.json>)

extra-20-normal · label normal · ถูก · 6 เฟรม · inference median 44 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 1124a6cac80f6d3c1e18004c242c419de16f0d692d1fdbba1ec6b3a3eb6ac3ff

![quiet-candidate/additional-01 / extra-20-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-20-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/additional-01/pipeline-extra-20-normal-trace.json>)

### quiet-candidate/baseline-01

ล้มพบ 5/6 · แจ้งผิด 0/6 · เฟรม 133

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/results.json>)

01-fall · label fall · ถูก · 5 เฟรม · inference median 70 ms · พบครั้งแรก 1725 ms จากเปิดคลิป · SHA f98a1fd8cb6e5ce4245f5f0215d2e09383d5cd38a1d2792519ead0a0df421ec9

![quiet-candidate/baseline-01 / 01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-01-fall-trace.json>)

02-fall · label fall · ถูก · 6 เฟรม · inference median 57 ms · พบครั้งแรก 1779 ms จากเปิดคลิป · SHA 4f497b8b44fe0b8d5044ec09b7fc745d3d1af57ebe93631a575f30321ac54637

![quiet-candidate/baseline-01 / 02-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-02-fall-trace.json>)

03-fall · label fall · ถูก · 5 เฟรม · inference median 36 ms · พบครั้งแรก 1587 ms จากเปิดคลิป · SHA 36071281102477d90aa33c0cc0f087ce39c3071b0ec0b1b7400281a8993c5b68

![quiet-candidate/baseline-01 / 03-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-03-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-03-fall-trace.json>)

04-fall · label fall · ถูก · 6 เฟรม · inference median 45 ms · พบครั้งแรก 1757 ms จากเปิดคลิป · SHA 7e47a12bdfbd5fe2cafc742ec13b86d2339c5d83c0c5d41a51c39307191d1724

![quiet-candidate/baseline-01 / 04-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-04-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-04-fall-trace.json>)

05-fall · label fall · พลาดล้ม · 12 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dd8a669d18d80621c82e1911edfc8407acba1d4bbab4d57bc8822dc566195da8

![quiet-candidate/baseline-01 / 05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-05-fall-trace.json>)

06-fall · label fall · ถูก · 9 เฟรม · inference median 43 ms · พบครั้งแรก 1926 ms จากเปิดคลิป · SHA 97bab741121a558201cdc7a9790e4556551946de871be33b1a45782138988ed4

![quiet-candidate/baseline-01 / 06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-06-fall-trace.json>)

07-normal · label normal · ถูก · 6 เฟรม · inference median 148 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c20945a9290ad2e1de5f0e844bb0d5e2f131a2d162050e41118419cbd04abb26

![quiet-candidate/baseline-01 / 07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-07-normal-trace.json>)

08-normal · label normal · ถูก · 5 เฟรม · inference median 47 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6210f9f1ea8d2d8fbe30c55e7d40a0d65649b6f036e6043994b3665877776300

![quiet-candidate/baseline-01 / 08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-08-normal-trace.json>)

09-normal · label normal · ถูก · 6 เฟรม · inference median 71 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a765230cc0bc9d736a352e7c8ca2f8503c8b9f772d8d541fecbbfcacbb6defa1

![quiet-candidate/baseline-01 / 09-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-09-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-09-normal-trace.json>)

10-normal · label normal · ถูก · 5 เฟรม · inference median 44 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 706a7f3f5b33931f59e864acbf774aac35fefc1fea4e2bf199f2a20684f568a1

![quiet-candidate/baseline-01 / 10-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-10-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-10-normal-trace.json>)

11-normal · label normal · ถูก · 37 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 820bbbb1189ee2fe176b453e3dc26b730cd9a22fe6b0a18b42410732513b8e43

![quiet-candidate/baseline-01 / 11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-11-normal-trace.json>)

12-normal · label normal · ถูก · 31 เฟรม · inference median 41 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a68ce68aa309267d6395cdcd716e13a797994fa838361e03bd337133d9952c7f

![quiet-candidate/baseline-01 / 12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-01/pipeline-12-normal-trace.json>)

### quiet-candidate/baseline-02

ล้มพบ 5/6 · แจ้งผิด 0/6 · เฟรม 136

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/results.json>)

01-fall · label fall · ถูก · 6 เฟรม · inference median 41 ms · พบครั้งแรก 1706 ms จากเปิดคลิป · SHA f98a1fd8cb6e5ce4245f5f0215d2e09383d5cd38a1d2792519ead0a0df421ec9

![quiet-candidate/baseline-02 / 01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-01-fall-trace.json>)

02-fall · label fall · ถูก · 5 เฟรม · inference median 35 ms · พบครั้งแรก 1747 ms จากเปิดคลิป · SHA 4f497b8b44fe0b8d5044ec09b7fc745d3d1af57ebe93631a575f30321ac54637

![quiet-candidate/baseline-02 / 02-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-02-fall-trace.json>)

03-fall · label fall · ถูก · 6 เฟรม · inference median 41 ms · พบครั้งแรก 1725 ms จากเปิดคลิป · SHA 36071281102477d90aa33c0cc0f087ce39c3071b0ec0b1b7400281a8993c5b68

![quiet-candidate/baseline-02 / 03-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-03-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-03-fall-trace.json>)

04-fall · label fall · ถูก · 6 เฟรม · inference median 39 ms · พบครั้งแรก 1757 ms จากเปิดคลิป · SHA 7e47a12bdfbd5fe2cafc742ec13b86d2339c5d83c0c5d41a51c39307191d1724

![quiet-candidate/baseline-02 / 04-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-04-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-04-fall-trace.json>)

05-fall · label fall · พลาดล้ม · 12 เฟรม · inference median 41 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dd8a669d18d80621c82e1911edfc8407acba1d4bbab4d57bc8822dc566195da8

![quiet-candidate/baseline-02 / 05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-05-fall-trace.json>)

06-fall · label fall · ถูก · 9 เฟรม · inference median 51 ms · พบครั้งแรก 2161 ms จากเปิดคลิป · SHA 97bab741121a558201cdc7a9790e4556551946de871be33b1a45782138988ed4

![quiet-candidate/baseline-02 / 06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-06-fall-trace.json>)

07-normal · label normal · ถูก · 6 เฟรม · inference median 56 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c20945a9290ad2e1de5f0e844bb0d5e2f131a2d162050e41118419cbd04abb26

![quiet-candidate/baseline-02 / 07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-07-normal-trace.json>)

08-normal · label normal · ถูก · 6 เฟรม · inference median 41 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6210f9f1ea8d2d8fbe30c55e7d40a0d65649b6f036e6043994b3665877776300

![quiet-candidate/baseline-02 / 08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-08-normal-trace.json>)

09-normal · label normal · ถูก · 5 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a765230cc0bc9d736a352e7c8ca2f8503c8b9f772d8d541fecbbfcacbb6defa1

![quiet-candidate/baseline-02 / 09-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-09-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-09-normal-trace.json>)

10-normal · label normal · ถูก · 6 เฟรม · inference median 48 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 706a7f3f5b33931f59e864acbf774aac35fefc1fea4e2bf199f2a20684f568a1

![quiet-candidate/baseline-02 / 10-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-10-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-10-normal-trace.json>)

11-normal · label normal · ถูก · 37 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 820bbbb1189ee2fe176b453e3dc26b730cd9a22fe6b0a18b42410732513b8e43

![quiet-candidate/baseline-02 / 11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-11-normal-trace.json>)

12-normal · label normal · ถูก · 32 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a68ce68aa309267d6395cdcd716e13a797994fa838361e03bd337133d9952c7f

![quiet-candidate/baseline-02 / 12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-02/pipeline-12-normal-trace.json>)

### quiet-candidate/baseline-03

ล้มพบ 5/6 · แจ้งผิด 0/6 · เฟรม 133

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/results.json>)

01-fall · label fall · ถูก · 5 เฟรม · inference median 33 ms · พบครั้งแรก 1625 ms จากเปิดคลิป · SHA f98a1fd8cb6e5ce4245f5f0215d2e09383d5cd38a1d2792519ead0a0df421ec9

![quiet-candidate/baseline-03 / 01-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-01-fall-trace.json>)

02-fall · label fall · ถูก · 6 เฟรม · inference median 64 ms · พบครั้งแรก 1635 ms จากเปิดคลิป · SHA 4f497b8b44fe0b8d5044ec09b7fc745d3d1af57ebe93631a575f30321ac54637

![quiet-candidate/baseline-03 / 02-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-02-fall-trace.json>)

03-fall · label fall · ถูก · 5 เฟรม · inference median 37 ms · พบครั้งแรก 1800 ms จากเปิดคลิป · SHA 36071281102477d90aa33c0cc0f087ce39c3071b0ec0b1b7400281a8993c5b68

![quiet-candidate/baseline-03 / 03-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-03-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-03-fall-trace.json>)

04-fall · label fall · ถูก · 6 เฟรม · inference median 59 ms · พบครั้งแรก 1889 ms จากเปิดคลิป · SHA 7e47a12bdfbd5fe2cafc742ec13b86d2339c5d83c0c5d41a51c39307191d1724

![quiet-candidate/baseline-03 / 04-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-04-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-04-fall-trace.json>)

05-fall · label fall · พลาดล้ม · 12 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dd8a669d18d80621c82e1911edfc8407acba1d4bbab4d57bc8822dc566195da8

![quiet-candidate/baseline-03 / 05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-05-fall-trace.json>)

06-fall · label fall · ถูก · 9 เฟรม · inference median 40 ms · พบครั้งแรก 1843 ms จากเปิดคลิป · SHA 97bab741121a558201cdc7a9790e4556551946de871be33b1a45782138988ed4

![quiet-candidate/baseline-03 / 06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-06-fall-trace.json>)

07-normal · label normal · ถูก · 5 เฟรม · inference median 44 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c20945a9290ad2e1de5f0e844bb0d5e2f131a2d162050e41118419cbd04abb26

![quiet-candidate/baseline-03 / 07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-07-normal-trace.json>)

08-normal · label normal · ถูก · 5 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6210f9f1ea8d2d8fbe30c55e7d40a0d65649b6f036e6043994b3665877776300

![quiet-candidate/baseline-03 / 08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-08-normal-trace.json>)

09-normal · label normal · ถูก · 5 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a765230cc0bc9d736a352e7c8ca2f8503c8b9f772d8d541fecbbfcacbb6defa1

![quiet-candidate/baseline-03 / 09-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-09-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-09-normal-trace.json>)

10-normal · label normal · ถูก · 5 เฟรม · inference median 35 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 706a7f3f5b33931f59e864acbf774aac35fefc1fea4e2bf199f2a20684f568a1

![quiet-candidate/baseline-03 / 10-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-10-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-10-normal-trace.json>)

11-normal · label normal · ถูก · 38 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 820bbbb1189ee2fe176b453e3dc26b730cd9a22fe6b0a18b42410732513b8e43

![quiet-candidate/baseline-03 / 11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-11-normal-trace.json>)

12-normal · label normal · ถูก · 32 เฟรม · inference median 36 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a68ce68aa309267d6395cdcd716e13a797994fa838361e03bd337133d9952c7f

![quiet-candidate/baseline-03 / 12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/quiet-candidate/baseline-03/pipeline-12-normal-trace.json>)

### holdout-candidate/additional-01

ล้มพบ 7/10 · แจ้งผิด 2/10 · เฟรม 230

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/results.json>)

holdout-01-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 43 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 95dcfd1bdfabff1952688c849e275491dc3e3e00f7e6f44c38a8cf35e7b7190f

![holdout-candidate/additional-01 / holdout-01-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-01-fall-trace.json>)

holdout-02-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 58 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA edff13246a6f6466683305eb02a923ffae45fcb127eaa7ae66819c6133b3433f

![holdout-candidate/additional-01 / holdout-02-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-02-fall-trace.json>)

holdout-03-normal · label normal · ถูก · 7 เฟรม · inference median 34 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 90989faa3cec42dbc71a870be70b170948ae6929d6e246f910d5ce0d494c30a5

![holdout-candidate/additional-01 / holdout-03-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-03-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-03-normal-trace.json>)

holdout-04-normal · label normal · ถูก · 7 เฟรม · inference median 46 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 2ba4505cf5e03b10cc0256878573194f7586222833cb8ace24ed8424cf6b7dc1

![holdout-candidate/additional-01 / holdout-04-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-04-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-04-normal-trace.json>)

holdout-05-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 68 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 49cd3fd9265a8a3b8f2b84b0aee285901f40c32a5117cc28d8a28c7f5c255fad

![holdout-candidate/additional-01 / holdout-05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-05-fall-trace.json>)

holdout-06-fall · label fall · ถูก · 7 เฟรม · inference median 81 ms · พบครั้งแรก 2579 ms จากเปิดคลิป · SHA 7ec922e29661029c75a82963932f41b7155a0dc1c2e1a57641a7538b9e702597

![holdout-candidate/additional-01 / holdout-06-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-06-fall-trace.json>)

holdout-07-normal · label normal · ถูก · 6 เฟรม · inference median 62 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA fd36ab9a94039e5b7f25ba1ca490ae22574f53568bb8089e00fb6860888cbcd1

![holdout-candidate/additional-01 / holdout-07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-07-normal-trace.json>)

holdout-08-normal · label normal · ถูก · 6 เฟรม · inference median 43 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 918c38a2cf2820f4770699f9373d4a86db64ff83acc2b3cdc239406af129dea2

![holdout-candidate/additional-01 / holdout-08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-08-normal-trace.json>)

holdout-09-fall · label fall · ถูก · 6 เฟรม · inference median 48 ms · พบครั้งแรก 2052 ms จากเปิดคลิป · SHA 8df43053c098b09a09a389d41366c6530de6b3f80667c0969ac4994d2251a903

![holdout-candidate/additional-01 / holdout-09-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-09-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-09-fall-trace.json>)

holdout-10-fall · label fall · ถูก · 6 เฟรม · inference median 46 ms · พบครั้งแรก 2314 ms จากเปิดคลิป · SHA 9ea737d2863325f103eb5bfc598202db9bfef1686319c1637de635bb191de95f

![holdout-candidate/additional-01 / holdout-10-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-10-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-10-fall-trace.json>)

holdout-11-normal · label normal · ถูก · 5 เฟรม · inference median 47 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 2206b3b1185c837564c9d8e4557b8e728f6f40a67fb1f2349df52278161876d9

![holdout-candidate/additional-01 / holdout-11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-11-normal-trace.json>)

holdout-12-normal · label normal · ถูก · 5 เฟรม · inference median 41 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 21e9b302043a7bc2336bff398c38a138b64c3d7ac3752924bf43cfd94cc5fc43

![holdout-candidate/additional-01 / holdout-12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-12-normal-trace.json>)

holdout-13-fall · label fall · ถูก · 15 เฟรม · inference median 35 ms · พบครั้งแรก 1844 ms จากเปิดคลิป · SHA 8a0be863f3d25149bf9fd795f603baaeb5e0c580180b7653e31b5cb4a25671cc

![holdout-candidate/additional-01 / holdout-13-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-13-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-13-fall-trace.json>)

holdout-14-fall · label fall · ถูก · 13 เฟรม · inference median 37 ms · พบครั้งแรก 3268 ms จากเปิดคลิป · SHA be235fef9bda633f5f63ccbc28c1dbb6c0138728c5b1696d86f7a6e0c66f4516

![holdout-candidate/additional-01 / holdout-14-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-14-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-14-fall-trace.json>)

holdout-15-fall · label fall · ถูก · 7 เฟรม · inference median 37 ms · พบครั้งแรก 2190 ms จากเปิดคลิป · SHA 7c57683db153b4a05b362763e69f9ebc86c3cc9833c88d789a33bccc3b5cb2bf

![holdout-candidate/additional-01 / holdout-15-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-15-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-15-fall-trace.json>)

holdout-16-fall · label fall · ถูก · 14 เฟรม · inference median 57 ms · พบครั้งแรก 3597 ms จากเปิดคลิป · SHA dbea18d773a46e9af2911787bc909d9eca24cebc9a45329563ed884ff68222b4

![holdout-candidate/additional-01 / holdout-16-fall / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-16-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-16-fall-trace.json>)

holdout-17-normal · label normal · แจ้งผิด · 22 เฟรม · inference median 43 ms · พบครั้งแรก 5499 ms จากเปิดคลิป · SHA d7bd6f68df5f0c526ab2a1ada10eac780fd429e7cfb58cc14b673eaf1d682d69

![holdout-candidate/additional-01 / holdout-17-normal / แจ้งผิด](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-17-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-17-normal-trace.json>)

holdout-18-normal · label normal · แจ้งผิด · 14 เฟรม · inference median 34 ms · พบครั้งแรก 1898 ms จากเปิดคลิป · SHA 6e410abbc6d4ef7bf52ac835b952a74a94311d0977fdfddb21885477602b7b69

![holdout-candidate/additional-01 / holdout-18-normal / แจ้งผิด](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-18-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-18-normal-trace.json>)

holdout-19-normal · label normal · ถูก · 24 เฟรม · inference median 37 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA e337e1248f012e5db82c5e92879add0fc5bb747b65ae31762b38cca6909f90d4

![holdout-candidate/additional-01 / holdout-19-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-19-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-19-normal-trace.json>)

holdout-20-normal · label normal · ถูก · 48 เฟรม · inference median 39 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 0ebf059c3c4f408b7d0552fee4ad47774eecd700fec53e55c96a70f1d5ce773a

![holdout-candidate/additional-01 / holdout-20-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-20-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/holdout-candidate/additional-01/pipeline-holdout-20-normal-trace.json>)

### tracking/baseline-01

ล้มพบ 0/6 · แจ้งผิด 0/6 · เฟรม 54

[ผลดิบของรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/results.json>)

01-fall · label fall · พลาดล้ม · 1 เฟรม · inference median 1664 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA f98a1fd8cb6e5ce4245f5f0215d2e09383d5cd38a1d2792519ead0a0df421ec9

![tracking/baseline-01 / 01-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-01-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-01-fall-trace.json>)

02-fall · label fall · พลาดล้ม · 2 เฟรม · inference median 1127 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 4f497b8b44fe0b8d5044ec09b7fc745d3d1af57ebe93631a575f30321ac54637

![tracking/baseline-01 / 02-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-02-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-02-fall-trace.json>)

03-fall · label fall · พลาดล้ม · 4 เฟรม · inference median 1103 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 36071281102477d90aa33c0cc0f087ce39c3071b0ec0b1b7400281a8993c5b68

![tracking/baseline-01 / 03-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-03-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-03-fall-trace.json>)

04-fall · label fall · พลาดล้ม · 3 เฟรม · inference median 257 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 7e47a12bdfbd5fe2cafc742ec13b86d2339c5d83c0c5d41a51c39307191d1724

![tracking/baseline-01 / 04-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-04-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-04-fall-trace.json>)

05-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 376 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA dd8a669d18d80621c82e1911edfc8407acba1d4bbab4d57bc8822dc566195da8

![tracking/baseline-01 / 05-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-05-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-05-fall-trace.json>)

06-fall · label fall · พลาดล้ม · 6 เฟรม · inference median 342 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 97bab741121a558201cdc7a9790e4556551946de871be33b1a45782138988ed4

![tracking/baseline-01 / 06-fall / พลาดล้ม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-06-fall.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-06-fall-trace.json>)

07-normal · label normal · ถูก · 1 เฟรม · inference median 1276 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA c20945a9290ad2e1de5f0e844bb0d5e2f131a2d162050e41118419cbd04abb26

![tracking/baseline-01 / 07-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-07-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-07-normal-trace.json>)

08-normal · label normal · ถูก · 4 เฟรม · inference median 821 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 6210f9f1ea8d2d8fbe30c55e7d40a0d65649b6f036e6043994b3665877776300

![tracking/baseline-01 / 08-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-08-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-08-normal-trace.json>)

09-normal · label normal · ถูก · 1 เฟรม · inference median 858 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a765230cc0bc9d736a352e7c8ca2f8503c8b9f772d8d541fecbbfcacbb6defa1

![tracking/baseline-01 / 09-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-09-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-09-normal-trace.json>)

10-normal · label normal · ถูก · 1 เฟรม · inference median 2256 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 706a7f3f5b33931f59e864acbf774aac35fefc1fea4e2bf199f2a20684f568a1

![tracking/baseline-01 / 10-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-10-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-10-normal-trace.json>)

11-normal · label normal · ถูก · 12 เฟรม · inference median 449 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA 820bbbb1189ee2fe176b453e3dc26b730cd9a22fe6b0a18b42410732513b8e43

![tracking/baseline-01 / 11-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-11-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-11-normal-trace.json>)

12-normal · label normal · ถูก · 13 เฟรม · inference median 761 ms · พบครั้งแรก None ms จากเปิดคลิป · SHA a68ce68aa309267d6395cdcd716e13a797994fa838361e03bd337133d9952c7f

![tracking/baseline-01 / 12-normal / ถูก](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-12-normal.jpg>)

[ผลตามเวลา (trace)](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-improvement-2026-10-07/tracking/baseline-01/pipeline-12-normal-trace.json>)

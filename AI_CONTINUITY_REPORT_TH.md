# รายงานปรับการหาท่าทางและติดตามคน — LookLanCare

วันที่ 7 ตุลาคม 2026 · ทดสอบ Android release บน emulator x86_64 แยกและซ่อนหน้าต่าง ใช้ HLS ที่สร้างจากคลิปติดป้ายกำกับ ผ่าน CameraStreamSession และ LocalPoseAnalyzer จริง ใช้ข้อมูลทดสอบ ไม่มีบัญชีครอบครัวจริงและไม่มีการเรียกผู้ให้บริการ AI ภายนอก

## 1. ผลการตัดสินใจ

ส่งมอบ APK ทดลอง 1.0.7 ที่ลด skeleton ซ้ำและช่วยติดตามด้วยสีเสื้อ โดยปิด ROI/ภาพหมุนหลังตรวจพบการแจ้งคนที่ยังนั่งและคนอื่นในภาพ ผล 52 คลิปพบล้ม 23/26 แจ้งผิด 2/26 เท่า APK เดิม (accuracy 90.4%) จึงยังไม่มีหลักฐานว่าความแม่นยำเพิ่มขึ้น

รุ่นส่งมอบวิเคราะห์ 2,324 เฟรมใน 80 คลิป ไม่มี inference exception หรือเฟรมเกิน 600 ms; แต่ยังพลาด 3/26 ล้มใน regression ผลคลิปสั้นเปลี่ยนข้ามรอบ และ classifier เดิมยังแจ้งในภาพคนนั่งของชุดผู้สูงอายุ ไม่รับรอง >=95% ทั่วไป การปรับการติดตามผ่าน unit test และลด pose ซ้ำใน 30 เฟรม ไม่ยืนยันว่า track ตรงกับชื่อจริง

## 2. สิ่งที่ปรับและขอบเขต

| ส่วน | รายละเอียด |
| --- | --- |
| ท่าทางซ้ำ | ลด skeleton ซ้ำเมื่อทั้งกรอบซ้อนและข้อต่อที่มองเห็นตรงกัน ไม่ลบคนเพียงเพราะกรอบซ้อนกัน |
| ติดตาม | เสริมเรขาคณิตและการเคลื่อนที่ด้วย histogram สีเสื้อ เก็บในหน่วยความจำเฉพาะ track ไม่บันทึกเป็นข้อมูลยืนยันตัวบุคคล |
| ค้นหาเมื่อ pose หาย | ทดลอง ROI/ภาพหมุนแล้วพบการแจ้งคนที่ยังนั่งและคนอื่นในภาพ จึงปิด poseRecoveryEnabled ใน APK ที่ส่งมอบ เก็บโค้ดและผลที่ล้มเหลวสำหรับศึกษาต่อ |
| การยืนยัน | ยังใช้ภาพใหม่จริงอย่างน้อย 2 ผลบวกต่อเนื่อง ภาพหายหรือการคาดตำแหน่งอย่างเดียวสร้างเหตุไม่ได้ |
| โมเดล | คง fall classifier และ MediaPipe Lite ของ 1.0.6 ไม่ได้ fit classifier หรือฝึก neural network เพิ่มในรอบนี้ ไม่ลด threshold จากคลิปทดสอบ |
| การส่งมอบ | APK 1.0.7/code 8 สำหรับทดลองและนำเสนอธีสิส เส้นทาง HLS บน Android ARM64 ใช้ classifier 1.0.6 เดิม มี bundle/model ใน APK; ทดสอบ native code/config เดียวกันใน x86_64 audit code 7 ก่อนสร้าง ARM64 ยังไม่มีผลทดสอบมือถือ ARM64 จริง |

การติดตาม track ไม่ได้ยืนยันชื่อหรือใบหน้า สีเสื้อคล้ายกัน แสงเปลี่ยน การบังเต็มตัว และคนตัดผ่านกันยังทำให้สับสนได้ ผลรอบนี้ครอบคลุมเส้นทาง HLS บน Android ไม่ได้ทดสอบทุกชนิดกล้องหรือ provider ของเส้นทางอื่น

[แผนและเกณฑ์ที่บันทึกก่อนอ่านผลรุ่นทดลอง](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/protocol.json>)

## การทดลองที่ไม่เลือกใช้: ค้นหาจากภาพหมุน/ROI

รอบแรกให้ผลล้ม 24/26 regression และ 20/28 คลิปผู้สูงอายุ แต่เมื่อตรวจภาพแรกที่แจ้งพบคนยังนั่งอยู่ใน elderly-06/16 และกรอบไปอยู่คนอื่นใน elderly-28 จึงไม่ถือว่า 20/28 เป็นการตรวจล้มผู้สูงอายุได้ถูกต้อง และไม่เปิดฟีเจอร์นี้ใน APK ส่งมอบ

ผ่านเกณฑ์จำนวนคลิปไม่ใช่หลักฐานว่าแจ้งถูก actor หรือถูกเวลา ตัวจำแนกที่ฝึกด้วยภาพเต็มไม่ได้มี validation ของ pose จากภาพหมุน/ROI ในคนที่นั่งหรือถูกบัง จึงต้องมีข้อมูลกำกับและ normal ของบริบทนี้ก่อนเปิดใช้งาน ข้อความเรื่องการกระจายข้อมูลนี้เป็นข้อสันนิษฐานจากผลที่พบ ยังไม่ได้พิสูจน์สาเหตุด้วยการฝึกทดลองใหม่

[ผลการทดลองที่ปฏิเสธ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/comparison.json>)

[ผลตรวจภาพและกรอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/recovery-image-review.json>)

[ภาพแจ้งผิด/actor ที่ต้องตรวจสอบ — elderly-06](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/candidate/additional-01/pipeline-elderly-06-fall.jpg>)

[ภาพแจ้งผิด/actor ที่ต้องตรวจสอบ — elderly-16](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/candidate/additional-01/pipeline-elderly-16-fall.jpg>)

[ภาพแจ้งผิด/actor ที่ต้องตรวจสอบ — elderly-28](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/candidate/additional-01/pipeline-elderly-28-fall.jpg>)

[แผนรุ่นที่ปิด recovery](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-protocol.json>)

## 3. ผลเทียบ 52 คลิปเดิมแบบจับคู่

| รุ่น | พบล้ม / 26 | พลาดล้ม | แจ้งผิด / 26 | ปกติถูก | Accuracy | Recall ล้ม |
| --- | --- | --- | --- | --- | --- | --- |
| APK 1.0.6 ทดสอบใหม่ | 23/26 | 3 | 2/26 | 24 | 90.4% | 88.5% |
| tracking-only | 23/26 | 3 | 2/26 | 24 | 90.4% | 88.5% |

กรณีเปลี่ยนจากผิดเป็นถูก: extra-13-fall, holdout-01-fall; จากถูกเป็นผิด: 04-fall, holdout-02-fall

ชุดนี้เป็น regression ที่เคยใช้วิเคราะห์ระบบ ไม่ใช่ชุดใหม่ที่ปิดบังผลเพื่อรับรองความแม่นยำภาคสนาม การรับภาพจริงสุ่มตามเวลาและอาจเปลี่ยนเฟรมที่ได้ ตัวอย่าง baseline 1.0.6 ในงานก่อนหน้าเคยพบ 22/26 แต่การทดสอบใหม่รอบนี้พบ 23/26 จึงใช้ baseline รอบนี้ในการเปรียบเทียบ

## 4. คลิปบ้านพักผู้สูงอายุ 28 คลิป

| รุ่น | คลิปที่ให้ผลว่าล้ม | คลิปไม่ให้ผลว่าล้ม | เฟรมที่วิเคราะห์ | เฟรมไม่พบ pose |
| --- | --- | --- | --- | --- |
| APK 1.0.6 | 13/28 | 15 | 1743 | 961 |
| tracking-only | 13/28 | 15 | 1846 | 999 |

คลิปที่เพิ่มผลล้ม: ไม่มี; คลิปที่เสียผลเดิม: ไม่มี

ตัวเลขในส่วนนี้เป็นความครอบคลุมเหตุระดับคลิปเท่านั้น ชุดนี้ติดป้าย fall ทั้งหมด ไม่มีคลิป normal ผู้สูงอายุ ไม่มีเวลาเริ่มล้มและไม่มีคำตอบกำกับว่าคนใดล้ม บางคลิปมีผู้ดูแลเดินผ่านหรือก้มอยู่ด้วย การได้ผลล้มจากคนผิดหรือก่อนเหตุยังอาจถูกนับเป็นคลิปที่พบ จึงไม่ใช้ตัวเลขนี้เป็น accuracy/recall การล้มของผู้สูงอายุ ไม่สรุปว่าแจ้งผิดเป็นศูนย์ และไม่รวมกับ 52 คลิปเพื่อทำคะแนนให้สูงขึ้น

ตรวจภาพเหตุของรุ่นที่ปิด recovery ยังพบ elderly-05 และ elderly-24 เป็นภาพคนที่ยังนั่งอยู่ โดยไม่มีคนล้มให้เห็นในกรอบที่แจ้ง เป็นข้อผิดพลาดของตัวจำแนกเดิมที่ยังต้องแก้ ไม่ถือว่า 13 คลิปนี้คือการล้ม 13 เหตุที่ยืนยันแล้ว elderly-14 เป็นช่วงเปลี่ยนท่าที่ต้องมี onset annotation ก่อนตัดสิน

[ผลตรวจภาพของรุ่นปิด recovery](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-image-review.json>)

[ตัวอย่างภาพที่ต้องตรวจเหตุ — elderly-05](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-05-fall.jpg>)

[ตัวอย่างภาพที่ต้องตรวจเหตุ — elderly-24](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-24-fall.jpg>)

แหล่งคลิป: Databrary long-term-care falls DOI 10.17910/B7.739; regression ใช้ Figshare DOI 10.6084/m9.figshare.28596332.v2, GMDCSA24 DOI 10.5281/zenodo.12921216 และ FallVision DOI 10.7910/DVN/75QPKK ตาม manifests ที่เก็บไว้ Source SHA256 อยู่ใน cases.json ไม่ฝึกหรือเลือก threshold ด้วยคลิปชุดนี้

## 5. เวลาและความต่อเนื่องที่วัดจริง

| ชุด / รุ่น | เฟรม | median ของ clip medians (ms) | frame p95 (ms) | frame max (ms) | เฟรมเกินงบ | งาน recovery | เฟรมได้ pose จาก recovery เท่านั้น |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 52 regression / 1.0.6 | 476 | 49.5 | ไม่ได้เก็บ | ไม่ได้เก็บ | ไม่ได้เก็บ | ไม่มี | ไม่มี |
| 52 regression / tracking-only | 478 | 44.5 | 221 | 547 | 0 | 0 | 0 |
| 28 ผู้สูงอายุ / 1.0.6 | 1743 | 40.5 | ไม่ได้เก็บ | ไม่ได้เก็บ | ไม่ได้เก็บ | ไม่มี | ไม่มี |
| 28 ผู้สูงอายุ / tracking-only | 1846 | 26.5 | 50 | 309 | 0 | 0 | 0 |

52 regression เฉพาะคลิปล้มที่พบ: median เวลาเริ่มเล่นคลิปถึงผลแรก 2098 ms ช่วง 1470–3540 ms เวลาเหล่านี้รวมการเริ่มรับภาพและไม่ใช่ latency จากเวลาเริ่มล้ม เพราะไม่มี onset annotation

งบ inference ตาม runtime = 600 ms ภาพที่ใช้ค้นหาซ้ำเป็นงานจริงและอาจทำให้บางเฟรมช้าขึ้น ระบบตรวจอายุผลและเตือนเมื่อช้า ไม่มีการจำลองภาพหายให้เป็นหลักฐานล้ม ทั้งสองรุ่นถูกเล่นบนเครื่องเดียวกันช่วงที่ไม่มีการฝึกหรือสร้าง APK แข่งขัน CPU

## 6. เกณฑ์และความเสถียร

| เกณฑ์ | ผล |
| --- | --- |
| regressionFallsDoNotDecrease | ผ่าน |
| regressionFalseAlertsDoNotIncrease | ผ่าน |
| olderAdultClipEventsDoNotDecrease | ผ่าน |
| eventDetectionImproves | ไม่ผ่าน |
| clipMediansBelowBudget | ผ่าน |
| noInferenceErrors | ผ่าน |

เกณฑ์เวลาตรวจ median ของแต่ละคลิป ไม่เลือกเฉพาะเฟรมเร็ว ในการทดลอง recovery ที่ไม่เลือกใช้ extra-06-fall มี median 767 ms แม้ไม่ได้ใช้ recovery ในเฟรมที่ช้า ผลซ้ำที่กลับมาเร็วไม่ลบผลช้ารอบแรก สาเหตุของเวลาที่พุ่งยังระบุไม่ได้แน่นอน; median รวมต่ำกว่า 600 ms ไม่ถือว่าไม่มีเฟรมล่าช้า

| รอบ / จำนวนคลิป | พบล้ม | แจ้งผิด | เฟรม | พลาด |
| --- | --- | --- | --- | --- |
| 1 / 14 | 7/8 | 2/6 | 192 | 05-fall |
| 2 / 14 | 5/8 | 2/6 | 193 | 05-fall, extra-13-fall, holdout-02-fall |

คลิปที่ผลเปลี่ยนข้ามรอบซ้ำ: extra-13-fall, holdout-02-fall การทดสอบซ้ำชุดเล็กตรวจจังหวะ decoder เท่านั้น ไม่ใช่หลักฐานการติดตามคนถูกทุกฉาก

[เหตุผลเลือกชุดทดสอบซ้ำและกรณีเพิ่มหลังพบปัญหา](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/repeat-protocol.json>)

| ดับจอ release 2 นาที | ผล |
| --- | --- |
| screenInteractive | False |
| checkpoints | 60 |
| analysisAgeMs | 239 |
| unexpectedNormalEvents | 0 |
| fallAlertAfterScreenOff | True |
| clipStartToAlertMs | 1819 |

ตรวจ timestamp การวิเคราะห์ คิวเหตุ และ OS notification หลังดับจอจริง ไม่ใช้ข้อความ foreground service เป็นหลักฐานเพียงอย่างเดียว เป็น emulator ที่เสียบไฟ ไม่รับรอง deep doze การฆ่าแอปของผู้ผลิต หรือ push ไปมือถือเพื่อน

![เฟรมที่บันทึกเป็นเหตุหลังดับจอ — config ของ APK ส่งมอบ](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-screen-off/event-evidence.jpg>)

| การตรวจประกอบ | ผล |
| --- | --- |
| unit | 20 ผ่าน / 0 ล้มเหลว |
| native | 80 คลิปไม่ซ้ำ baseline/recovery/tracking รวม 240 ครั้ง; candidate ทั้งสองไม่มี inference exception |
| repeat | tracking 14 คลิป x 2 รอบ พบล้ม 7/8 และ 5/8; แจ้งผิด 2/6 ทุกครั้ง; รวมการทดลอง recovery อีก 42 ครั้ง เป็น 310 clip attempts ไม่ใช่ 310 คลิปอิสระ |
| screenOff | config ส่งมอบ: release 2 นาที; 60 checkpoints; ผลล่าสุดอายุ 239 ms; normal ผิด 0; event + OS notification 1819 ms จากเปิดคลิป |
| disabledRecovery | ยืนยัน recoveryInferences=0 ทุก 2,324 เฟรมของรุ่นส่งมอบ |
| apk | assets 5 ตรง source, ELF 28 ไฟล์ 16 KB, ZIP align 16 KB, cert เดิม, ARM64, code8/version1.0.7 |
| quota | AI บนอุปกรณ์ ไม่มี provider AI ภายนอก |

## 7. ปัญหาที่ยังพบและทำซ้ำได้

| ระดับ | กรณี | คำตอบระดับคลิป | ผลจริง | เฟรม |
| --- | --- | --- | --- | --- |
| สูง | 04-fall | fall | พลาดล้ม | 4 |
| สูง | 05-fall | fall | พลาดล้ม | 12 |
| สูง | holdout-02-fall | fall | พลาดล้ม | 5 |
| กลาง | holdout-17-normal | normal | แจ้งผิด | 23 |
| กลาง | holdout-18-normal | normal | แจ้งผิด | 16 |

ทำซ้ำ: ใช้ gateway.json กับ cases ของชุดที่ต้องการ ติดตั้ง APK ทดสอบและ test APK บน emulator แยก เรียก run_android_ai_audit.py ด้วย run-plan.json และ output ใหม่ เทียบ predictedFall กับ label ดู trace และภาพเหตุประกอบ ทุกรอบต้องเก็บผลใหม่เพราะจังหวะภาพมีผล

งานที่ยังต้องทำก่อนอ้างผลทั่วไป ≥95%: กำกับ actor และเวลาเริ่มล้ม เพิ่ม normal ผู้สูงอายุที่นั่ง/นอน/ก้ม ทดสอบแสงน้อยและหลายคนจากแหล่งที่ไม่เคยใช้ปรับระบบ วัดการแจ้งผิดต่อชั่วโมง ระบุผู้ล้มให้ถูก ทดสอบแบตเตอรี่และดับจอบนมือถือจริง ไม่ใช้คะแนน model confidence แทนความแม่นยำ

ข้อผิดพลาดท่านั่งในภาพผู้สูงอายุจัดเป็นความรุนแรงสูงสำหรับการอ้างความพร้อมเฝ้าระวังจริง การปรับการติดตามและลด skeleton ซ้ำไม่ได้แก้การแยกท่านั่งออกจากการล้ม รุ่นนี้จึงเป็นต้นแบบสำหรับศึกษาและนำเสนอ ต้องมีการฝึกจากข้อมูลที่มีคำตอบระดับคน/เวลาและทดสอบใหม่ก่อนยืนยันคุณภาพ AI

ในการทดลอง recovery ที่ปฏิเสธ 05-fall มีคนเสื้อแดงนอนบนพื้นขณะมีคนอื่นยืนอยู่ บางเฟรมให้กรอบท่าทางซ้อนของคนนอนมากกว่าหนึ่งกรอบ การลด skeleton ซ้ำยังไม่ครอบคลุม pose ที่เห็นเพียงบางส่วน ผลว่าล้มเกิดในรอบหลักแต่ไม่เกิดในทั้งสามรอบซ้ำ จึงไม่ใช้ผลสำเร็จรอบเดียวรับรองการติดตามบุคคล

## 8. ไฟล์และหลักฐาน

[ผลเทียบพร้อมเวลารายเฟรม](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-comparison.json>)

[ผลจับคู่ CSV](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-comparison.csv>)

[คลิป regression และ SHA](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/regression-cases.json>)

[คลิปผู้สูงอายุและ SHA](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/elderly-cases.json>)

[APK สำหรับมือถือ ARM64](<C:/Users/USER/Desktop/lcc-master/dist-android/LookLanCare-1.0.7-ai-continuity-preview-arm64.apk>)

APK: SHA256 562d8769feeefc5532d2826b36b1426af663f44ceea891e0af8cd5871b570afe · 72.1 MiB · assets 5 ไฟล์ตรงกับ candidate · ELF 28 ไฟล์รองรับ 16 KB ตรวจลายเซ็นและ ZIP alignment แยกในหลักฐานส่งมอบ

[ผลตรวจ APK](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/arm64-verification.json>)

[การปิดบริการทดสอบของรอบนี้](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/cleanup.json>)

HTML รวมภาพแรกและภาพแรกที่ระบบให้ผลล้มของทุกกรณีที่เกี่ยวข้องไว้ครบ ภาพเหล่านี้เป็นเฟรมจาก decoder ที่ AI ใช้ ไม่ใช่ภาพหน้าจอการใช้งาน UI รายงานนี้ไม่กำกับชื่อหรือเดาอายุ/เพศของคนในภาพ เครดิตและต้นทางอยู่ใน manifests และ DOI ข้างต้น

## 52 regression: ภาพและผลรายกรณี

### 01-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-01-fall-trace.json>)

![baseline · pipeline-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-01-fall.jpg>)

![baseline · pipeline-01-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-01-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-01-fall-trace.json>)

![tracking-only · pipeline-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-01-fall.jpg>)

![tracking-only · pipeline-01-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-01-fall-fall.jpg>)

### 02-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-02-fall-trace.json>)

![baseline · pipeline-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-02-fall.jpg>)

![baseline · pipeline-02-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-02-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-02-fall-trace.json>)

![tracking-only · pipeline-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-02-fall.jpg>)

![tracking-only · pipeline-02-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-02-fall-fall.jpg>)

### 03-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-03-fall-trace.json>)

![baseline · pipeline-03-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-03-fall.jpg>)

![baseline · pipeline-03-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-03-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-03-fall-trace.json>)

![tracking-only · pipeline-03-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-03-fall.jpg>)

![tracking-only · pipeline-03-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-03-fall-fall.jpg>)

### 04-fall · label=fall · เดิม=True · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-04-fall-trace.json>)

![baseline · pipeline-04-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-04-fall.jpg>)

![baseline · pipeline-04-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-04-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-04-fall-trace.json>)

![tracking-only · pipeline-04-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-04-fall.jpg>)

### 05-fall · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-05-fall-trace.json>)

![baseline · pipeline-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-05-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-05-fall-trace.json>)

![tracking-only · pipeline-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-05-fall.jpg>)

### 06-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-06-fall-trace.json>)

![baseline · pipeline-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-06-fall.jpg>)

![baseline · pipeline-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-06-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-06-fall-trace.json>)

![tracking-only · pipeline-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-06-fall.jpg>)

![tracking-only · pipeline-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-06-fall-fall.jpg>)

### 07-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-07-normal-trace.json>)

![baseline · pipeline-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-07-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-07-normal-trace.json>)

![tracking-only · pipeline-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-07-normal.jpg>)

### 08-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-08-normal-trace.json>)

![baseline · pipeline-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-08-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-08-normal-trace.json>)

![tracking-only · pipeline-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-08-normal.jpg>)

### 09-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-09-normal-trace.json>)

![baseline · pipeline-09-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-09-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-09-normal-trace.json>)

![tracking-only · pipeline-09-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-09-normal.jpg>)

### 10-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-10-normal-trace.json>)

![baseline · pipeline-10-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-10-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-10-normal-trace.json>)

![tracking-only · pipeline-10-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-10-normal.jpg>)

### 11-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-11-normal-trace.json>)

![baseline · pipeline-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-11-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-11-normal-trace.json>)

![tracking-only · pipeline-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-11-normal.jpg>)

### 12-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-12-normal-trace.json>)

![baseline · pipeline-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-12-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-12-normal-trace.json>)

![tracking-only · pipeline-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-12-normal.jpg>)

### extra-01-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-01-fall-trace.json>)

![baseline · pipeline-extra-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-01-fall.jpg>)

![baseline · pipeline-extra-01-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-01-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-01-fall-trace.json>)

![tracking-only · pipeline-extra-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-01-fall.jpg>)

![tracking-only · pipeline-extra-01-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-01-fall-fall.jpg>)

### extra-02-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-02-fall-trace.json>)

![baseline · pipeline-extra-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-02-fall.jpg>)

![baseline · pipeline-extra-02-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-02-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-02-fall-trace.json>)

![tracking-only · pipeline-extra-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-02-fall.jpg>)

![tracking-only · pipeline-extra-02-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-02-fall-fall.jpg>)

### extra-03-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-03-normal-trace.json>)

![baseline · pipeline-extra-03-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-03-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-03-normal-trace.json>)

![tracking-only · pipeline-extra-03-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-03-normal.jpg>)

### extra-04-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-04-normal-trace.json>)

![baseline · pipeline-extra-04-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-04-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-04-normal-trace.json>)

![tracking-only · pipeline-extra-04-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-04-normal.jpg>)

### extra-05-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-05-fall-trace.json>)

![baseline · pipeline-extra-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-05-fall.jpg>)

![baseline · pipeline-extra-05-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-05-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-05-fall-trace.json>)

![tracking-only · pipeline-extra-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-05-fall.jpg>)

![tracking-only · pipeline-extra-05-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-05-fall-fall.jpg>)

### extra-06-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-06-fall-trace.json>)

![baseline · pipeline-extra-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-06-fall.jpg>)

![baseline · pipeline-extra-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-06-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-06-fall-trace.json>)

![tracking-only · pipeline-extra-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-06-fall.jpg>)

![tracking-only · pipeline-extra-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-06-fall-fall.jpg>)

### extra-07-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-07-normal-trace.json>)

![baseline · pipeline-extra-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-07-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-07-normal-trace.json>)

![tracking-only · pipeline-extra-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-07-normal.jpg>)

### extra-08-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-08-normal-trace.json>)

![baseline · pipeline-extra-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-08-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-08-normal-trace.json>)

![tracking-only · pipeline-extra-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-08-normal.jpg>)

### extra-09-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-09-fall-trace.json>)

![baseline · pipeline-extra-09-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-09-fall.jpg>)

![baseline · pipeline-extra-09-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-09-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-09-fall-trace.json>)

![tracking-only · pipeline-extra-09-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-09-fall.jpg>)

![tracking-only · pipeline-extra-09-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-09-fall-fall.jpg>)

### extra-10-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-10-fall-trace.json>)

![baseline · pipeline-extra-10-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-10-fall.jpg>)

![baseline · pipeline-extra-10-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-10-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-10-fall-trace.json>)

![tracking-only · pipeline-extra-10-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-10-fall.jpg>)

![tracking-only · pipeline-extra-10-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-10-fall-fall.jpg>)

### extra-11-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-11-normal-trace.json>)

![baseline · pipeline-extra-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-11-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-11-normal-trace.json>)

![tracking-only · pipeline-extra-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-11-normal.jpg>)

### extra-12-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-12-normal-trace.json>)

![baseline · pipeline-extra-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-12-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-12-normal-trace.json>)

![tracking-only · pipeline-extra-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-12-normal.jpg>)

### extra-13-fall · label=fall · เดิม=False · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-13-fall-trace.json>)

![baseline · pipeline-extra-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-13-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-13-fall-trace.json>)

![tracking-only · pipeline-extra-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-13-fall.jpg>)

![tracking-only · pipeline-extra-13-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-13-fall-fall.jpg>)

### extra-14-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-14-fall-trace.json>)

![baseline · pipeline-extra-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-14-fall.jpg>)

![baseline · pipeline-extra-14-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-14-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-14-fall-trace.json>)

![tracking-only · pipeline-extra-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-14-fall.jpg>)

![tracking-only · pipeline-extra-14-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-14-fall-fall.jpg>)

### extra-15-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-15-fall-trace.json>)

![baseline · pipeline-extra-15-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-15-fall.jpg>)

![baseline · pipeline-extra-15-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-15-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-15-fall-trace.json>)

![tracking-only · pipeline-extra-15-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-15-fall.jpg>)

![tracking-only · pipeline-extra-15-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-15-fall-fall.jpg>)

### extra-16-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-16-fall-trace.json>)

![baseline · pipeline-extra-16-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-16-fall.jpg>)

![baseline · pipeline-extra-16-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-16-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-16-fall-trace.json>)

![tracking-only · pipeline-extra-16-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-16-fall.jpg>)

![tracking-only · pipeline-extra-16-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-16-fall-fall.jpg>)

### extra-17-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-17-normal-trace.json>)

![baseline · pipeline-extra-17-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-17-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-17-normal-trace.json>)

![tracking-only · pipeline-extra-17-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-17-normal.jpg>)

### extra-18-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-18-normal-trace.json>)

![baseline · pipeline-extra-18-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-18-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-18-normal-trace.json>)

![tracking-only · pipeline-extra-18-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-18-normal.jpg>)

### extra-19-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-19-normal-trace.json>)

![baseline · pipeline-extra-19-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-19-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-19-normal-trace.json>)

![tracking-only · pipeline-extra-19-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-19-normal.jpg>)

### extra-20-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-20-normal-trace.json>)

![baseline · pipeline-extra-20-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-extra-20-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-20-normal-trace.json>)

![tracking-only · pipeline-extra-20-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-extra-20-normal.jpg>)

### holdout-01-fall · label=fall · เดิม=False · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-01-fall-trace.json>)

![baseline · pipeline-holdout-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-01-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-01-fall-trace.json>)

![tracking-only · pipeline-holdout-01-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-01-fall.jpg>)

![tracking-only · pipeline-holdout-01-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-01-fall-fall.jpg>)

### holdout-02-fall · label=fall · เดิม=True · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-02-fall-trace.json>)

![baseline · pipeline-holdout-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-02-fall.jpg>)

![baseline · pipeline-holdout-02-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-02-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-02-fall-trace.json>)

![tracking-only · pipeline-holdout-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-02-fall.jpg>)

### holdout-03-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-03-normal-trace.json>)

![baseline · pipeline-holdout-03-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-03-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-03-normal-trace.json>)

![tracking-only · pipeline-holdout-03-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-03-normal.jpg>)

### holdout-04-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-04-normal-trace.json>)

![baseline · pipeline-holdout-04-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-04-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-04-normal-trace.json>)

![tracking-only · pipeline-holdout-04-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-04-normal.jpg>)

### holdout-05-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-05-fall-trace.json>)

![baseline · pipeline-holdout-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-05-fall.jpg>)

![baseline · pipeline-holdout-05-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-05-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-05-fall-trace.json>)

![tracking-only · pipeline-holdout-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-05-fall.jpg>)

![tracking-only · pipeline-holdout-05-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-05-fall-fall.jpg>)

### holdout-06-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-06-fall-trace.json>)

![baseline · pipeline-holdout-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-06-fall.jpg>)

![baseline · pipeline-holdout-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-06-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-06-fall-trace.json>)

![tracking-only · pipeline-holdout-06-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-06-fall.jpg>)

![tracking-only · pipeline-holdout-06-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-06-fall-fall.jpg>)

### holdout-07-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-07-normal-trace.json>)

![baseline · pipeline-holdout-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-07-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-07-normal-trace.json>)

![tracking-only · pipeline-holdout-07-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-07-normal.jpg>)

### holdout-08-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-08-normal-trace.json>)

![baseline · pipeline-holdout-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-08-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-08-normal-trace.json>)

![tracking-only · pipeline-holdout-08-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-08-normal.jpg>)

### holdout-09-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-09-fall-trace.json>)

![baseline · pipeline-holdout-09-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-09-fall.jpg>)

![baseline · pipeline-holdout-09-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-09-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-09-fall-trace.json>)

![tracking-only · pipeline-holdout-09-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-09-fall.jpg>)

![tracking-only · pipeline-holdout-09-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-09-fall-fall.jpg>)

### holdout-10-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-10-fall-trace.json>)

![baseline · pipeline-holdout-10-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-10-fall.jpg>)

![baseline · pipeline-holdout-10-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-10-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-10-fall-trace.json>)

![tracking-only · pipeline-holdout-10-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-10-fall.jpg>)

![tracking-only · pipeline-holdout-10-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-10-fall-fall.jpg>)

### holdout-11-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-11-normal-trace.json>)

![baseline · pipeline-holdout-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-11-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-11-normal-trace.json>)

![tracking-only · pipeline-holdout-11-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-11-normal.jpg>)

### holdout-12-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-12-normal-trace.json>)

![baseline · pipeline-holdout-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-12-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-12-normal-trace.json>)

![tracking-only · pipeline-holdout-12-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-12-normal.jpg>)

### holdout-13-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-13-fall-trace.json>)

![baseline · pipeline-holdout-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-13-fall.jpg>)

![baseline · pipeline-holdout-13-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-13-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-13-fall-trace.json>)

![tracking-only · pipeline-holdout-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-13-fall.jpg>)

![tracking-only · pipeline-holdout-13-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-13-fall-fall.jpg>)

### holdout-14-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-14-fall-trace.json>)

![baseline · pipeline-holdout-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-14-fall.jpg>)

![baseline · pipeline-holdout-14-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-14-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-14-fall-trace.json>)

![tracking-only · pipeline-holdout-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-14-fall.jpg>)

![tracking-only · pipeline-holdout-14-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-14-fall-fall.jpg>)

### holdout-15-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-15-fall-trace.json>)

![baseline · pipeline-holdout-15-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-15-fall.jpg>)

![baseline · pipeline-holdout-15-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-15-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-15-fall-trace.json>)

![tracking-only · pipeline-holdout-15-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-15-fall.jpg>)

![tracking-only · pipeline-holdout-15-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-15-fall-fall.jpg>)

### holdout-16-fall · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-16-fall-trace.json>)

![baseline · pipeline-holdout-16-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-16-fall.jpg>)

![baseline · pipeline-holdout-16-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-16-fall-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-16-fall-trace.json>)

![tracking-only · pipeline-holdout-16-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-16-fall.jpg>)

![tracking-only · pipeline-holdout-16-fall-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-16-fall-fall.jpg>)

### holdout-17-normal · label=normal · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-17-normal-trace.json>)

![baseline · pipeline-holdout-17-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-17-normal.jpg>)

![baseline · pipeline-holdout-17-normal-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-17-normal-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-17-normal-trace.json>)

![tracking-only · pipeline-holdout-17-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-17-normal.jpg>)

![tracking-only · pipeline-holdout-17-normal-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-17-normal-fall.jpg>)

### holdout-18-normal · label=normal · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-18-normal-trace.json>)

![baseline · pipeline-holdout-18-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-18-normal.jpg>)

![baseline · pipeline-holdout-18-normal-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-18-normal-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-18-normal-trace.json>)

![tracking-only · pipeline-holdout-18-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-18-normal.jpg>)

![tracking-only · pipeline-holdout-18-normal-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-18-normal-fall.jpg>)

### holdout-19-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-19-normal-trace.json>)

![baseline · pipeline-holdout-19-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-19-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-19-normal-trace.json>)

![tracking-only · pipeline-holdout-19-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-19-normal.jpg>)

### holdout-20-normal · label=normal · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-20-normal-trace.json>)

![baseline · pipeline-holdout-20-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/baseline-01/pipeline-holdout-20-normal.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-20-normal-trace.json>)

![tracking-only · pipeline-holdout-20-normal](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/baseline-01/pipeline-holdout-20-normal.jpg>)

## 28 คลิปผู้สูงอายุ: ผลและภาพหลักฐาน

### elderly-01 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-01-trace.json>)

![baseline · pipeline-elderly-01](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-01.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-01-trace.json>)

![tracking-only · pipeline-elderly-01](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-01.jpg>)

### elderly-02 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-02-trace.json>)

![baseline · pipeline-elderly-02](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-02.jpg>)

![baseline · pipeline-elderly-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-02-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-02-trace.json>)

![tracking-only · pipeline-elderly-02](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-02.jpg>)

![tracking-only · pipeline-elderly-02-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-02-fall.jpg>)

### elderly-03 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-03-trace.json>)

![baseline · pipeline-elderly-03](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-03.jpg>)

![baseline · pipeline-elderly-03-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-03-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-03-trace.json>)

![tracking-only · pipeline-elderly-03](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-03.jpg>)

![tracking-only · pipeline-elderly-03-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-03-fall.jpg>)

### elderly-04 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-04-trace.json>)

![baseline · pipeline-elderly-04](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-04.jpg>)

![baseline · pipeline-elderly-04-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-04-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-04-trace.json>)

![tracking-only · pipeline-elderly-04](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-04.jpg>)

![tracking-only · pipeline-elderly-04-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-04-fall.jpg>)

### elderly-05 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-05-trace.json>)

![baseline · pipeline-elderly-05](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-05.jpg>)

![baseline · pipeline-elderly-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-05-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-05-trace.json>)

![tracking-only · pipeline-elderly-05](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-05.jpg>)

![tracking-only · pipeline-elderly-05-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-05-fall.jpg>)

### elderly-06 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-06-trace.json>)

![baseline · pipeline-elderly-06](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-06.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-06-trace.json>)

![tracking-only · pipeline-elderly-06](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-06.jpg>)

### elderly-07 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-07-trace.json>)

![baseline · pipeline-elderly-07](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-07.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-07-trace.json>)

![tracking-only · pipeline-elderly-07](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-07.jpg>)

### elderly-08 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-08-trace.json>)

![baseline · pipeline-elderly-08](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-08.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-08-trace.json>)

![tracking-only · pipeline-elderly-08](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-08.jpg>)

### elderly-09 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-09-trace.json>)

![baseline · pipeline-elderly-09](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-09.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-09-trace.json>)

![tracking-only · pipeline-elderly-09](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-09.jpg>)

### elderly-10 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-10-trace.json>)

![baseline · pipeline-elderly-10](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-10.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-10-trace.json>)

![tracking-only · pipeline-elderly-10](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-10.jpg>)

### elderly-11 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-11-trace.json>)

![baseline · pipeline-elderly-11](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-11.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-11-trace.json>)

![tracking-only · pipeline-elderly-11](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-11.jpg>)

### elderly-12 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-12-trace.json>)

![baseline · pipeline-elderly-12](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-12.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-12-trace.json>)

![tracking-only · pipeline-elderly-12](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-12.jpg>)

### elderly-13 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-13-trace.json>)

![baseline · pipeline-elderly-13](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-13.jpg>)

![baseline · pipeline-elderly-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-13-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-13-trace.json>)

![tracking-only · pipeline-elderly-13](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-13.jpg>)

![tracking-only · pipeline-elderly-13-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-13-fall.jpg>)

### elderly-14 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-14-trace.json>)

![baseline · pipeline-elderly-14](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-14.jpg>)

![baseline · pipeline-elderly-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-14-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-14-trace.json>)

![tracking-only · pipeline-elderly-14](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-14.jpg>)

![tracking-only · pipeline-elderly-14-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-14-fall.jpg>)

### elderly-15 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-15-trace.json>)

![baseline · pipeline-elderly-15](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-15.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-15-trace.json>)

![tracking-only · pipeline-elderly-15](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-15.jpg>)

### elderly-16 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-16-trace.json>)

![baseline · pipeline-elderly-16](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-16.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-16-trace.json>)

![tracking-only · pipeline-elderly-16](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-16.jpg>)

### elderly-17 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-17-trace.json>)

![baseline · pipeline-elderly-17](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-17.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-17-trace.json>)

![tracking-only · pipeline-elderly-17](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-17.jpg>)

### elderly-18 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-18-trace.json>)

![baseline · pipeline-elderly-18](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-18.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-18-trace.json>)

![tracking-only · pipeline-elderly-18](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-18.jpg>)

### elderly-19 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-19-trace.json>)

![baseline · pipeline-elderly-19](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-19.jpg>)

![baseline · pipeline-elderly-19-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-19-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-19-trace.json>)

![tracking-only · pipeline-elderly-19](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-19.jpg>)

![tracking-only · pipeline-elderly-19-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-19-fall.jpg>)

### elderly-20 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-20-trace.json>)

![baseline · pipeline-elderly-20](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-20.jpg>)

![baseline · pipeline-elderly-20-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-20-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-20-trace.json>)

![tracking-only · pipeline-elderly-20](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-20.jpg>)

![tracking-only · pipeline-elderly-20-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-20-fall.jpg>)

### elderly-21 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-21-trace.json>)

![baseline · pipeline-elderly-21](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-21.jpg>)

![baseline · pipeline-elderly-21-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-21-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-21-trace.json>)

![tracking-only · pipeline-elderly-21](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-21.jpg>)

![tracking-only · pipeline-elderly-21-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-21-fall.jpg>)

### elderly-22 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-22-trace.json>)

![baseline · pipeline-elderly-22](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-22.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-22-trace.json>)

![tracking-only · pipeline-elderly-22](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-22.jpg>)

### elderly-23 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-23-trace.json>)

![baseline · pipeline-elderly-23](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-23.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-23-trace.json>)

![tracking-only · pipeline-elderly-23](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-23.jpg>)

### elderly-24 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-24-trace.json>)

![baseline · pipeline-elderly-24](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-24.jpg>)

![baseline · pipeline-elderly-24-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-24-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-24-trace.json>)

![tracking-only · pipeline-elderly-24](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-24.jpg>)

![tracking-only · pipeline-elderly-24-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-24-fall.jpg>)

### elderly-25 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-25-trace.json>)

![baseline · pipeline-elderly-25](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-25.jpg>)

![baseline · pipeline-elderly-25-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-25-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-25-trace.json>)

![tracking-only · pipeline-elderly-25](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-25.jpg>)

![tracking-only · pipeline-elderly-25-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-25-fall.jpg>)

### elderly-26 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-26-trace.json>)

![baseline · pipeline-elderly-26](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-26.jpg>)

![baseline · pipeline-elderly-26-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-26-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-26-trace.json>)

![tracking-only · pipeline-elderly-26](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-26.jpg>)

![tracking-only · pipeline-elderly-26-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-26-fall.jpg>)

### elderly-27 · label=fall · เดิม=True · ทดลอง=True

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-27-trace.json>)

![baseline · pipeline-elderly-27](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-27.jpg>)

![baseline · pipeline-elderly-27-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-27-fall.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-27-trace.json>)

![tracking-only · pipeline-elderly-27](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-27.jpg>)

![tracking-only · pipeline-elderly-27-fall](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-27-fall.jpg>)

### elderly-28 · label=fall · เดิม=False · ทดลอง=False

[baseline trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-28-trace.json>)

![baseline · pipeline-elderly-28](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/baseline/additional-01/pipeline-elderly-28.jpg>)

[tracking-only trace](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-28-trace.json>)

![tracking-only · pipeline-elderly-28](<C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-continuity-2026-10-07/tracking-only/additional-01/pipeline-elderly-28.jpg>)

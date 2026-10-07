# ผลทดสอบ AI LookLanCare รอบใหม่

วันที่ 2026-10-07T11:31:49.200668+07:00 · เวอร์ชัน 1.0.5 · Android API 36 x86_64 Release

## ขอบเขตและผลที่อ่านได้

เสร็จ 4 ชุดการรัน รวมการทดสอบรายคลิป 56 ครั้ง จากคลิปไม่ซ้ำ 32 คลิป

วัด AI บนอุปกรณ์ Android สำหรับกล้อง HLS ผ่าน Media3 → MediaPipe Pose → ตัวจำแนกล้มและการยืนยันต่อเนื่อง ใช้โค้ด native และ asset เดียวกับ APK ARM64 รุ่น 1.0.5 แต่รันใน emulator x86_64

การทดสอบซ้ำสามรอบใช้คลิปเดิม จึงนับเป็น 12 คลิปไม่ซ้ำ ชุดเพิ่มเติมมี 20 คลิปจากผู้เข้าร่วมคนอื่น 5 คน เลือกก่อนดูผล ไม่มีการฝึกโมเดลหรือปรับ threshold ระหว่างทดสอบ

ผลนี้ไม่ใช่การรับรองความแม่นยำทั่วไป 95% และไม่ครอบคลุมมือถือจริง กล้องมือถือ ระบบคอมบ้าน การระบุชื่อบุคคล หรือการรับ push ข้ามเครื่อง

ผลไม่แจ้งล้มรวมกรณีที่ AI ยัง uncertain ด้วย ตารางนี้วัดว่ามี trigger ล้มหรือไม่ จำนวนเฟรมที่พบ pose และสถานะก่อนยืนยันอ่านได้จาก trace จึงไม่ใช้จำนวนไม่แจ้งผิดอ้างว่ารู้จำท่าปกติสำเร็จทุกเฟรม

| รอบ | คลิป | ตรวจล้มได้ | พลาด | แจ้งผิด | Recall | Specificity |
| --- | --- | --- | --- | --- | --- | --- |
| baseline-01 | 12 | 4/6 | 2 | 1/6 | 66.7% | 83.3% |
| baseline-02 | 12 | 3/6 | 3 | 0/6 | 50.0% | 100.0% |
| baseline-03 | 12 | 2/6 | 4 | 1/6 | 33.3% | 83.3% |
| additional-01 | 20 | 8/10 | 2 | 0/10 | 80.0% | 100.0% |

## ผลซ้ำและความสม่ำเสมอ

คลิปที่ผลล้ม/ไม่แจ้งล้มเปลี่ยนระหว่างรอบ: 01-fall, 02-fall, 03-fall, 04-fall, 05-fall, 09-normal

จำนวนเฟรมที่วิเคราะห์ขึ้นกับเวลาเริ่มสตรีมและการข้ามเฟรมเมื่อเครื่องไม่ทัน การทดสอบนี้เก็บ trace ของทุกเฟรมที่ AI ได้รับ เพื่อแสดงหลักฐานผล uncertain จำนวนคน และการยืนยันล้ม ความสัมพันธ์ดังกล่าวยังไม่ใช่ข้อพิสูจน์สาเหตุของทุกกรณี

| คลิป | ป้ายกำกับ | baseline-01 | baseline-02 | baseline-03 | เฟรมแต่ละรอบ |
| --- | --- | --- | --- | --- | --- |
| 01-fall | fall | ล้ม | ไม่แจ้งล้ม | ล้ม | 5, 4, 6 |
| 02-fall | fall | ล้ม | ล้ม | ไม่แจ้งล้ม | 6, 5, 4 |
| 03-fall | fall | ล้ม | ล้ม | ไม่แจ้งล้ม | 6, 6, 5 |
| 04-fall | fall | ไม่แจ้งล้ม | ล้ม | ไม่แจ้งล้ม | 3, 6, 5 |
| 05-fall | fall | ล้ม | ไม่แจ้งล้ม | ล้ม | 12, 13, 12 |
| 06-fall | fall | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 9, 8, 9 |
| 07-normal | normal | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 5, 5, 6 |
| 08-normal | normal | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 7, 5, 6 |
| 09-normal | normal | ล้ม | ไม่แจ้งล้ม | ล้ม | 5, 4, 5 |
| 10-normal | normal | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 5, 5, 6 |
| 11-normal | normal | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 35, 37, 36 |
| 12-normal | normal | ไม่แจ้งล้ม | ไม่แจ้งล้ม | ไม่แจ้งล้ม | 30, 31, 31 |

## ข้อสรุปความสม่ำเสมอ

ในชุดเดิม ตรวจล้มได้ต่ำสุด 2 และสูงสุด 4 จาก 6 คลิปต่อรอบ มี 6/12 คลิปที่คำตอบเปลี่ยน จึงยังไม่รับรองผลตรวจที่สม่ำเสมอจากรอบนี้

การที่ instrumentation ขึ้น OK หมายถึงอ่านและวิเคราะห์คลิปครบตามเงื่อนไขของตัวทดสอบ จำนวนเหตุล้มที่พลาดและแจ้งผิดต้องอ่านจากผล AI แยกต่างหาก


## ชุดเพิ่มเติม

เลือกจาก manifest split=test ของชุด Figshare ตาม seed และป้ายกำกับ ล้ม 10 คลิปและไม่ล้ม 10 คลิป ผู้เข้าร่วม 2, 3, 8, 17, 19 มี ID ต่างจากชุด Figshare เดิมที่ใช้ผู้เข้าร่วม 1 แต่ split นี้เคยใช้ในการประเมิน offline ก่อนหน้านี้ จึงไม่ใช่ชุดทดสอบ blind ใหม่ทั้งหมด การเทียบ ID ของคนทำได้ภายใน dataset เดียวกัน

metadata ระบุทิศทางกิจกรรม F/B/L/R; อายุ เพศ และเวลาเริ่มล้มไม่ได้ระบุสำหรับชุดนี้ ผู้เข้าร่วม 17 มีเฉพาะคลิปล้มและ 19 มีเฉพาะคลิปปกติ จึงไม่ใช้สรุปความแม่นยำแยกประชากร

| คลิป | ผู้เข้าร่วม | ทิศทาง | กิจกรรม | ป้ายกำกับ | ผล | เฟรม | เริ่มคลิปถึงผลล้ม (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| extra-01-fall | 2 | F | 1 | fall | ล้ม | 5 | 1927 |
| extra-02-fall | 2 | B | 11 | fall | ล้ม | 5 | 2594 |
| extra-03-normal | 2 | F | 16 | normal | ไม่แจ้งล้ม | 6 | — |
| extra-04-normal | 2 | B | 22 | normal | ไม่แจ้งล้ม | 5 | — |
| extra-05-fall | 3 | F | 5 | fall | ล้ม | 6 | 2826 |
| extra-06-fall | 3 | B | 2 | fall | ไม่แจ้งล้ม | 6 | — |
| extra-07-normal | 3 | F | 13 | normal | ไม่แจ้งล้ม | 5 | — |
| extra-08-normal | 3 | B | 20 | normal | ไม่แจ้งล้ม | 2 | — |
| extra-09-fall | 8 | F | 2 | fall | ล้ม | 6 | 2829 |
| extra-10-fall | 8 | B | 1 | fall | ล้ม | 6 | 1991 |
| extra-11-normal | 8 | F | 16 | normal | ไม่แจ้งล้ม | 5 | — |
| extra-12-normal | 8 | B | 21 | normal | ไม่แจ้งล้ม | 5 | — |
| extra-13-fall | 17 | F | 1 | fall | ไม่แจ้งล้ม | 7 | — |
| extra-14-fall | 17 | B | 7 | fall | ล้ม | 5 | 1954 |
| extra-15-fall | 17 | L | 10 | fall | ล้ม | 6 | 2001 |
| extra-16-fall | 17 | R | 9 | fall | ล้ม | 7 | 2663 |
| extra-17-normal | 19 | F | 14 | normal | ไม่แจ้งล้ม | 6 | — |
| extra-18-normal | 19 | B | 19 | normal | ไม่แจ้งล้ม | 6 | — |
| extra-19-normal | 19 | L | 22 | normal | ไม่แจ้งล้ม | 6 | — |
| extra-20-normal | 19 | R | 17 | normal | ไม่แจ้งล้ม | 5 | — |

## การดับจอและความตรงของโมเดล

firstFallMs วัดจากเริ่มเล่นคลิป ไม่มี label เวลาที่ร่างกายเริ่มล้ม จึงยังใช้เป็นเวลาตอบสนองจากเริ่มล้มจริงไม่ได้ การทดสอบ clip pipeline วัดผล AI ส่วนการทดสอบ screen-off ตรวจคิวเหตุและ OS notification จริง


## parity.log

ผ่าน: {"test": "classifier-parity", "cases": 64, "maxError": 0}


## screen-off.log

ผ่าน: ดับจอ 2 นาที กล้องยัง ready และผลวิเคราะห์ล่าสุดมีอายุ 7 ms ตรวจ 60 จุด

เหตุล้มผิดระหว่างคลิปปกติ 0 เหตุ หลังเปลี่ยนเป็นคลิปล้ม สร้างเหตุและตรวจ OS notification ภายใน 2.649 วินาทีจากเริ่มคลิป


## ปัญหาที่พบและขั้นตอนทำซ้ำ

ใช้ run-plan.json กับ gateway ของชุดที่ต้องการ แล้วรัน run_android_ai_audit.py จะอ่าน HLS และบันทึกผลจากตัวตรวจใน release build ข้อผิดพลาดล้มที่พลาดมีความรุนแรงสูง และการแจ้งผิดมีความรุนแรงปานกลางสำหรับการประเมินนี้


## baseline-01 / 04-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 3 เฟรม ไม่พบ pose 0 เฟรม uncertain 3 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1146 | uncertain | 0.0000 | 1 | 0 | False |
| 1972 | uncertain | 0.0000 | 1 | 1 | False |
| 2643 | uncertain | 0.0000 | 1 | 1 | False |

## baseline-01 / 06-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 9 เฟรม ไม่พบ pose 4 เฟรม uncertain 7 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9977170768655711 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1101 | uncertain | 0.0000 | 0 |  | False |
| 1596 | uncertain | 0.0000 | 1 | 0 | False |
| 1981 | uncertain | 0.0000 | 1 | 0 | False |
| 2316 | possible_fall | 0.9940 | 2 | 0, 1 | False |
| 2521 | uncertain | 0.0000 | 1 | 1 | False |
| 2907 | possible_fall | 0.9977 | 2 | 2, 0 | False |
| 3151 | uncertain | 0.0000 | 0 |  | False |
| 3410 | uncertain | 0.0000 | 0 |  | False |
| 3854 | uncertain | 0.0000 | 0 |  | False |

## baseline-01 / 09-normal

คาดหวัง: normal ตามป้ายกำกับต้นทาง ผลจริง: fall รับภาพวิเคราะห์ 5 เฟรม ไม่พบ pose 0 เฟรม uncertain 2 เฟรม จำนวน trigger ที่ยืนยัน 1

คะแนนล้มสูงสุด 0.9993837518642111 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1242 | uncertain | 0.0000 | 1 | 0 | False |
| 1795 | uncertain | 0.0000 | 1 | 0 | False |
| 1966 | normal | 0.0163 | 1 | 0 | False |
| 2326 | possible_fall | 0.9988 | 1 | 0 | False |
| 2811 | fall | 0.9994 | 1 | 0 | True |

## baseline-02 / 01-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 4 เฟรม ไม่พบ pose 0 เฟรม uncertain 2 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9498323785483409 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1652 | uncertain | 0.0000 | 1 | 0 | False |
| 2109 | uncertain | 0.0000 | 1 | 0 | False |
| 2454 | possible_fall | 0.9498 | 1 | 0 | False |
| 2781 | normal | 0.4792 | 1 | 0 | False |

## baseline-02 / 05-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 13 เฟรม ไม่พบ pose 2 เฟรม uncertain 6 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9679987425243901 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1035 | uncertain | 0.0000 | 1 | 0 | False |
| 1109 | uncertain | 0.0000 | 1 | 0 | False |
| 1450 | normal | 0.0002 | 1 | 0 | False |
| 1764 | normal | 0.0036 | 1 | 0 | False |
| 2103 | normal | 0.0039 | 1 | 0 | False |
| 2485 | normal | 0.0766 | 1 | 0 | False |
| 2770 | normal | 0.5113 | 1 | 0 | False |
| 3104 | possible_fall | 0.9680 | 1 | 0 | False |
| 3455 | uncertain | 0.0000 | 0 |  | False |
| 3770 | uncertain | 0.0000 | 0 |  | False |
| 4101 | uncertain | 0.0000 | 1 | 0 | False |
| 4475 | uncertain | 0.0000 | 1 | 0 | False |
| 4812 | normal | 0.0086 | 1 | 0 | False |

## baseline-02 / 06-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 8 เฟรม ไม่พบ pose 4 เฟรม uncertain 8 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 872 | uncertain | 0.0000 | 0 |  | False |
| 1326 | uncertain | 0.0000 | 1 | 0 | False |
| 1708 | uncertain | 0.0000 | 2 | 1, 2 | False |
| 2075 | uncertain | 0.0000 | 1 | 2 | False |
| 2391 | uncertain | 0.0000 | 2 | 3, 1 | False |
| 2674 | uncertain | 0.0000 | 0 |  | False |
| 2983 | uncertain | 0.0000 | 0 |  | False |
| 3502 | uncertain | 0.0000 | 0 |  | False |

## baseline-03 / 02-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 4 เฟรม ไม่พบ pose 0 เฟรม uncertain 3 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9478930240178531 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1307 | uncertain | 0.0000 | 1 | 0 | False |
| 1859 | uncertain | 0.0000 | 3 | 1, 0, 2 | False |
| 2231 | uncertain | 0.0000 | 1 | 2 | False |
| 2857 | possible_fall | 0.9479 | 1 | 2 | False |

## baseline-03 / 03-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 5 เฟรม ไม่พบ pose 0 เฟรม uncertain 3 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.7543621669014088 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1242 | uncertain | 0.0000 | 1 | 0 | False |
| 1509 | uncertain | 0.0000 | 1 | 1 | False |
| 1894 | uncertain | 0.0000 | 1 | 1 | False |
| 2155 | possible_fall | 0.7544 | 1 | 1 | False |
| 2488 | normal | 0.5329 | 1 | 1 | False |

## baseline-03 / 04-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 5 เฟรม ไม่พบ pose 1 เฟรม uncertain 4 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9994917196939737 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1118 | uncertain | 0.0000 | 1 | 0 | False |
| 1466 | uncertain | 0.0000 | 1 | 0 | False |
| 1731 | possible_fall | 0.9995 | 2 | 0, 1 | False |
| 2067 | uncertain | 0.0000 | 0 |  | False |
| 2531 | uncertain | 0.0000 | 1 | 1 | False |

## baseline-03 / 06-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 9 เฟรม ไม่พบ pose 4 เฟรม uncertain 7 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9977170768655711 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 735 | uncertain | 0.0000 | 0 |  | False |
| 1110 | uncertain | 0.0000 | 1 | 0 | False |
| 1415 | uncertain | 0.0000 | 1 | 0 | False |
| 1810 | possible_fall | 0.9934 | 2 | 0, 1 | False |
| 2082 | uncertain | 0.0000 | 1 | 1 | False |
| 2431 | possible_fall | 0.9977 | 2 | 2, 0 | False |
| 2777 | uncertain | 0.0000 | 0 |  | False |
| 3065 | uncertain | 0.0000 | 0 |  | False |
| 3431 | uncertain | 0.0000 | 0 |  | False |

## baseline-03 / 09-normal

คาดหวัง: normal ตามป้ายกำกับต้นทาง ผลจริง: fall รับภาพวิเคราะห์ 5 เฟรม ไม่พบ pose 0 เฟรม uncertain 2 เฟรม จำนวน trigger ที่ยืนยัน 1

คะแนนล้มสูงสุด 0.9996796897522174 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1020 | uncertain | 0.0000 | 1 | 0 | False |
| 1488 | uncertain | 0.0000 | 1 | 0 | False |
| 1833 | normal | 0.0164 | 1 | 0 | False |
| 2191 | possible_fall | 0.9991 | 1 | 0 | False |
| 2531 | fall | 0.9997 | 1 | 0 | True |

## additional-01 / extra-06-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 6 เฟรม ไม่พบ pose 2 เฟรม uncertain 5 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.9753484184391724 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1060 | uncertain | 0.0000 | 1 | 0 | False |
| 1175 | uncertain | 0.0000 | 1 | 0 | False |
| 1564 | possible_fall | 0.9753 | 1 | 0 | False |
| 1820 | uncertain | 0.0000 | 0 |  | False |
| 2162 | uncertain | 0.0000 | 0 |  | False |
| 2496 | uncertain | 0.0000 | 1 | 0 | False |

## additional-01 / extra-13-fall

คาดหวัง: fall ตามป้ายกำกับต้นทาง ผลจริง: no_fall_alert รับภาพวิเคราะห์ 7 เฟรม ไม่พบ pose 1 เฟรม uncertain 3 เฟรม จำนวน trigger ที่ยืนยัน 0

คะแนนล้มสูงสุด 0.7368955095722286 เป็นคะแนนของโมเดล ไม่ใช่ความแม่นยำของแอป ดู trace และภาพในส่วนหลักฐาน สาเหตุที่ต้องตรวจต่อคือความต่อเนื่องของ pose/track และคะแนนในแต่ละเฟรมก่อนยืนยัน ไม่ปรับเกณฑ์เพื่อให้คลิปทดสอบผ่านในรอบนี้

| เวลาเริ่มคลิป (ms) | ผล AI | คะแนนล้ม | พบคน | ID track ที่มองเห็น | trigger |
| --- | --- | --- | --- | --- | --- |
| 1146 | uncertain | 0.0000 | 1 | 0 | False |
| 1323 | uncertain | 0.0000 | 1 | 0 | False |
| 1661 | normal | 0.0001 | 1 | 0 | False |
| 1989 | normal | 0.0001 | 1 | 0 | False |
| 2326 | normal | 0.0006 | 1 | 0 | False |
| 2654 | possible_fall | 0.7369 | 1 | 0 | False |
| 2980 | uncertain | 0.0000 | 0 |  | False |

## จุดที่ควรแก้ก่อนกล่าวอ้างความแม่นยำสูง

รักษาความต่อเนื่องของ track ขณะคนล้มเร็วหรือ pose หาย ตัวอย่าง 04-fall ในรอบแรกได้รับเพียง 3 เฟรม และ ID เปลี่ยนจาก 0 เป็น 1 ทำให้แต่ละ track มีประวัติไม่พอ; 06-fall และ extra-06-fall มีคะแนนสูงบางช่วง แต่ pose ขาดก่อนยืนยันต่อเนื่อง

ตรวจข้อมูลฝึกและการเทียบเกณฑ์กับภาพตามเวลาในสตรีมจริง คลิป 09-normal แจ้งผิดในสองรอบและมีคะแนนประมาณ 0.999 จึงใช้คะแนน confidence สูงเป็นหลักฐานความถูกต้องไม่ได้ ต้องประเมินกิจกรรมปกติที่คล้ายล้มด้วยชุดข้อมูลที่แยกไว้

วัดอัตราเฟรมที่ส่งถึง AI และเวลาเหตุบนมือถือจริง พร้อม label จุดเริ่มล้ม ภายใต้หลายห้องและการบังตัว ผลของ emulator นี้ยังไม่ชี้ว่าปัญหาแต่ละส่วนเกิดบนมือถือจริงเท่าใด


## หลักฐานรายคลิป

ภาพด้านล่างเป็นเฟรมแรกที่ถอดและวิเคราะห์จริงจาก HLS ไม่ใช่ภาพ UI หรือภาพ ณ เวลาแจ้งเหตุ แต่ละคลิปมี trace JSON และ log ของรอบนั้นอยู่ในโฟลเดอร์รายงาน


### baseline-01 / 01-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "10", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 01-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-01-fall.jpg)

### baseline-01 / 02-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "11", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 02-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-02-fall.jpg)

### baseline-01 / 03-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "1", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 03-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-03-fall.jpg)

### baseline-01 / 04-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "1", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 04-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-04-fall.jpg)

### baseline-01 / 05-fall · label=fall · ผล=ล้ม

{}

![baseline-01 / 05-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-05-fall.jpg)

### baseline-01 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม

{}

![baseline-01 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-06-fall.jpg)

### baseline-01 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "13", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-07-normal.jpg)

### baseline-01 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "14", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-08-normal.jpg)

### baseline-01 / 09-normal · label=normal · ผล=ล้ม

{"subject_id": "1", "location_id": "3", "action_id": "15", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 09-normal · label=normal · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-09-normal.jpg)

### baseline-01 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "16", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-01 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-10-normal.jpg)

### baseline-01 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-01 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-11-normal.jpg)

### baseline-01 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-01 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-01/pipeline-12-normal.jpg)

### baseline-02 / 01-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "1", "action_id": "10", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 01-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-01-fall.jpg)

### baseline-02 / 02-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "11", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 02-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-02-fall.jpg)

### baseline-02 / 03-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "1", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 03-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-03-fall.jpg)

### baseline-02 / 04-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 04-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-04-fall.jpg)

### baseline-02 / 05-fall · label=fall · ผล=ไม่แจ้งล้ม

{}

![baseline-02 / 05-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-05-fall.jpg)

### baseline-02 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม

{}

![baseline-02 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-06-fall.jpg)

### baseline-02 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "13", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-07-normal.jpg)

### baseline-02 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "14", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-08-normal.jpg)

### baseline-02 / 09-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "15", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 09-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-09-normal.jpg)

### baseline-02 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "16", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-02 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-10-normal.jpg)

### baseline-02 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-02 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-11-normal.jpg)

### baseline-02 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-02 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-02/pipeline-12-normal.jpg)

### baseline-03 / 01-fall · label=fall · ผล=ล้ม

{"subject_id": "1", "location_id": "1", "action_id": "10", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 01-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-01-fall.jpg)

### baseline-03 / 02-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "1", "action_id": "11", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 02-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-02-fall.jpg)

### baseline-03 / 03-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "1", "action_id": "1", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 03-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-03-fall.jpg)

### baseline-03 / 04-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "1", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 04-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-04-fall.jpg)

### baseline-03 / 05-fall · label=fall · ผล=ล้ม

{}

![baseline-03 / 05-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-05-fall.jpg)

### baseline-03 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม

{}

![baseline-03 / 06-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-06-fall.jpg)

### baseline-03 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "13", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 07-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-07-normal.jpg)

### baseline-03 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "14", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 08-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-08-normal.jpg)

### baseline-03 / 09-normal · label=normal · ผล=ล้ม

{"subject_id": "1", "location_id": "3", "action_id": "15", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 09-normal · label=normal · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-09-normal.jpg)

### baseline-03 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "1", "location_id": "3", "action_id": "16", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![baseline-03 / 10-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-10-normal.jpg)

### baseline-03 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-03 / 11-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-11-normal.jpg)

### baseline-03 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "4", "source": "GMDCSA24", "license": "CC BY 4.0", "doi": "10.5281/zenodo.12921216"}

![baseline-03 / 12-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/baseline-03/pipeline-12-normal.jpg)

### additional-01 / extra-01-fall · label=fall · ผล=ล้ม

{"subject_id": "2", "location_id": "2", "action_id": "1", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-01-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-01-fall.jpg)

### additional-01 / extra-02-fall · label=fall · ผล=ล้ม

{"subject_id": "2", "location_id": "2", "action_id": "11", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-02-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-02-fall.jpg)

### additional-01 / extra-03-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "2", "location_id": "5", "action_id": "16", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-03-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-03-normal.jpg)

### additional-01 / extra-04-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "2", "location_id": "5", "action_id": "22", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-04-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-04-normal.jpg)

### additional-01 / extra-05-fall · label=fall · ผล=ล้ม

{"subject_id": "3", "location_id": "2", "action_id": "5", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-05-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-05-fall.jpg)

### additional-01 / extra-06-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "3", "location_id": "2", "action_id": "2", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-06-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-06-fall.jpg)

### additional-01 / extra-07-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "3", "location_id": "4", "action_id": "13", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-07-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-07-normal.jpg)

### additional-01 / extra-08-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "3", "location_id": "4", "action_id": "20", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-08-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-08-normal.jpg)

### additional-01 / extra-09-fall · label=fall · ผล=ล้ม

{"subject_id": "8", "location_id": "3", "action_id": "2", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-09-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-09-fall.jpg)

### additional-01 / extra-10-fall · label=fall · ผล=ล้ม

{"subject_id": "8", "location_id": "3", "action_id": "1", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-10-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-10-fall.jpg)

### additional-01 / extra-11-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "8", "location_id": "3", "action_id": "16", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-11-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-11-normal.jpg)

### additional-01 / extra-12-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "8", "location_id": "3", "action_id": "21", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-12-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-12-normal.jpg)

### additional-01 / extra-13-fall · label=fall · ผล=ไม่แจ้งล้ม

{"subject_id": "17", "location_id": "1", "action_id": "1", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-13-fall · label=fall · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-13-fall.jpg)

### additional-01 / extra-14-fall · label=fall · ผล=ล้ม

{"subject_id": "17", "location_id": "1", "action_id": "7", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-14-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-14-fall.jpg)

### additional-01 / extra-15-fall · label=fall · ผล=ล้ม

{"subject_id": "17", "location_id": "1", "action_id": "10", "side": "L", "attempt": "2", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-15-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-15-fall.jpg)

### additional-01 / extra-16-fall · label=fall · ผล=ล้ม

{"subject_id": "17", "location_id": "1", "action_id": "9", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-16-fall · label=fall · ผล=ล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-16-fall.jpg)

### additional-01 / extra-17-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "19", "location_id": "1", "action_id": "14", "side": "F", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-17-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-17-normal.jpg)

### additional-01 / extra-18-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "19", "location_id": "1", "action_id": "19", "side": "B", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-18-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-18-normal.jpg)

### additional-01 / extra-19-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "19", "location_id": "1", "action_id": "22", "side": "L", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-19-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-19-normal.jpg)

### additional-01 / extra-20-normal · label=normal · ผล=ไม่แจ้งล้ม

{"subject_id": "19", "location_id": "1", "action_id": "17", "side": "R", "attempt": "1", "source": "Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects", "license": "CC BY 4.0", "doi": "10.6084/m9.figshare.28596332.v2"}

![additional-01 / extra-20-normal · label=normal · ผล=ไม่แจ้งล้ม](C:/Users/USER/Desktop/lcc-master/test-artifacts/ai-retest-2026-10-07/additional-01/pipeline-extra-20-normal.jpg)

## ค่าที่ใช้และข้อจำกัด

IMAGE mode · Pose Lite · อ่านภาพ 300 ms · threshold 0.56 · ยืนยัน 2 ครั้ง · ภาพ 640 px · runtime.json และ model.json ตรวจตรงกับ APK ARM64 ที่ส่งให้ผู้ใช้

โมเดลทำงานบนอุปกรณ์ ไม่มีการเรียก AI provider ภายนอกระหว่างรอบนี้ การวิเคราะห์ไม่ใช้โควต้า AI cloud

emulator เสียบไฟและใช้สตรีมในเครือข่ายจำลอง ผลนี้ไม่ครอบคลุม Deep Doze โทรศัพท์จริง ภาพจากห้องจริง หรือการระบุเฉพาะคนในห้องหลายคน ต้องตรวจข้อพลาดกับข้อมูลที่ระบุเวลาเหตุและใช้ชุดประเมินแยกก่อนรับรองความแม่นยำ

log ของ emulator มี ANR ของ Google Play Services ระหว่างเริ่มเครื่อง ดู emulator-anr-events.log ข้อจำกัดของสภาพแวดล้อมอาจมีผลต่อเวลาอ่าน/วิเคราะห์ภาพ และยังไม่ได้แยกวัดผลกระทบดังกล่าว

OS notification ในผลดับจอตรวจจากรายการแจ้งเตือนของ Android ไม่ได้ยืนยันเสียงหรือการเห็นแจ้งเตือนบนมือถือจริง และไม่ได้ทดสอบส่งไปมือถือผู้ดูแลอีกเครื่อง


## หลังจบการทดสอบ

{"realAccountsUsed": false, "monitoringModelChanged": false, "emulatorStopped": true, "replayEncoderStopped": true, "checkedAt": "2026-10-07T04:30:41.5985134Z", "externalAiProviderCalls": 0, "replayGatewayStopped": true}

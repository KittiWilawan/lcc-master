# ชุดข้อมูลสำหรับระบบตรวจจับการล้มของ LookLanCare รุ่น 1.0.34

## ข้อมูลและวิธีการสำหรับบทที่ 3

โครงงาน LookLanCare ใช้ตัวประมาณท่าทาง MediaPipe Pose Landmarker ที่ผ่านการฝึกมาแล้ว เพื่อสกัดตำแหน่งข้อต่อจากวิดีโอ แล้วฝึกตัวจำแนกการล้มจากการเปลี่ยนแปลงท่าทางตามเวลา ข้อมูลหลักมาจากชุด Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects ของ Ursul (2025) และ GMDCSA24 รุ่น 2.0 ของ Alam (2024) รวม 2,174 รายการ โครงงานแบ่งตามผู้เข้าร่วมภายในแต่ละชุดข้อมูลเป็นชุดฝึก 1,268 รายการ ชุดตรวจสอบสำหรับเลือกโมเดล 407 รายการ และชุดทดสอบ 499 รายการ ชุดฝึกให้ตัวอย่างท่าทางต่อเนื่อง 11,875 ช่วง การฝึกโมเดลเสริมใช้คลิปกิจวัตรในบ้านจาก Charades และบางช่วงจากวิดีโอของ Simon Fraser University ที่ตรวจยืนยันว่าบุคคลใกล้เหตุไม่ได้ล้ม เพื่อช่วยแยกผู้ล้มออกจากบุคคลหรือกิจกรรมอื่นในภาพ [1–4]

## จำนวนรายการของตัวจำแนกหลัก

| ชุดข้อมูล | ฝึก | ตรวจสอบเพื่อเลือกโมเดล | ทดสอบ | รวมที่โครงการใช้ |
|---|---:|---:|---:|---:|
| Ursul บน Figshare รุ่น 2 [1] | 1,188 | 364 | 462 | 2,014 |
| GMDCSA24 รุ่น 2.0 [2] | 80 | 43 | 37 | 160 |
| รวม | **1,268** | **407** | **499** | **2,174** |

ตัวเลขในตารางนับรายการตามบัญชีข้อมูลของโครงงาน ผู้เผยแพร่ Figshare ระบุขนาดชุดเต็ม 2,017 วิดีโอจาก 29 คน ส่วนโครงงานมี 2,014 รายการในการแบ่งชุดครั้งนี้ การตรวจไฟล์ภายหลังพบสำเนาคลิปซ้ำหนึ่งรายการภายในชุดทดสอบ 499 รายการ จึงมีวิดีโอทดสอบที่เนื้อหาไฟล์ไม่ซ้ำกัน 498 รายการ ชุดนี้เคยใช้วิเคราะห์ข้อผิดพลาดแล้ว [ผลฝึกตัวจำแนกหลัก](test-artifacts/ai-improvement-2026-10-07/fast-three-frame-training/training-results.json) · [บัญชีรายคลิป](test-artifacts/weight-retraining-2026-11-17/manifest.json) · [รายงานตรวจไฟล์ซ้ำ](AI_RETRAINING_ROUND2_REPORT_TH.md)

## ข้อมูลที่ใช้ฝึกโมเดลเสริมในแอป

| ส่วนของระบบ | ข้อมูลที่นำเข้าฝึกได้จริง | จำนวนช่วงท่าทาง |
|---|---|---:|
| ตัวจำแนกการเคลื่อนไหว | 1,269 คลิปหรือช่วงคลิป ได้แก่ Figshare 1,174, GMDCSA24 79, Charades 14 และช่วงบุคคลใกล้เหตุที่ไม่ได้ล้มจากคลิป Databrary 2 ช่วง | 8,877 |
| ตัวยืนยันเหตุล้ม | 1,291 คลิปหรือช่วงคลิป ได้แก่ Figshare 1,174, GMDCSA24 79 และกิจกรรมปกติในบ้านจาก Charades 38 | 11,465 |

แต่ละแถวเป็นการฝึกคนละส่วนของระบบและใช้วิดีโอต้นทางซ้ำกันได้ หน่วย “ช่วงท่าทาง” หมายถึงลำดับภาพที่สกัดจากคลิปหนึ่ง ๆ คลิปเดียวสร้างตัวอย่างได้หลายช่วง ตัวอย่างกิจกรรมปกติรวมถึงการเอนบนโซฟาและการนอนบนเตียง รุ่น 1.0.34 ปรับเกณฑ์การยืนยันการล้มจากภาพต่อเนื่องโดยใช้น้ำหนักโมเดลเดิม [ผลฝึกตัวจำแนกการเคลื่อนไหว](test-artifacts/temporal-fit-2026-11-22/frozen.json) · [ผลฝึกตัวยืนยัน](test-artifacts/fall-verification-2026-11-23/fit.json) · [รายงานรุ่น 1.0.34](test-artifacts/fall-confirmation-2026-11-24/REPORT_TH.md)

## ชุดข้อมูลสำหรับการทดลองและประเมินผล

- **UR Fall Detection Dataset** [5] มีการล้ม 30 เหตุและกิจวัตร 40 เหตุ โครงงานใช้ตรวจเวลาเริ่มพบการล้มและเปรียบเทียบมุมกล้องแนวราบกับมุมเพดาน ภาพเหตุเดียวกันจากสองกล้องนับเป็นหนึ่งเหตุเมื่อนับจำนวนเหตุการณ์
- **FallVision** [6] มีวิดีโอล้มและไม่ล้มจากเตียง เก้าอี้ และท่ายืน โครงงานใช้ประเมินข้ามชุดข้อมูล และเคยใช้ฝึกโมเดลทดลองก่อนหน้า น้ำหนักตัวจำแนกหลักที่ส่งออกลงแอปใช้ Figshare กับ GMDCSA24 [รายงานการทดลองหลายชุดข้อมูล](AI_LTC_REPORT_TH.md)
- **Videos of Falls in Long-Term Care** [4] ใช้ประเมินการล้มจริงในสถานดูแลผู้สูงอายุด้วย ชุดเต็มของผู้เผยแพร่มี 300 วิดีโอจาก 118 คน ส่วนการตรวจรุ่น 1.0.34 รายงานผลจาก 6 คลิป การใช้สองช่วงเป็นตัวอย่างคนที่ไม่ได้ล้มในการฝึกตัวจำแนกการเคลื่อนไหวเป็นคนละวัตถุประสงค์กับการประเมินเหตุล้มจริง
- รอบเปรียบเทียบ 1.0.34 กันคลิปใหม่ 60 คลิปไว้ประเมินหลังเลือกเกณฑ์ ตรวจพบไฟล์ไม่ซ้ำกับรายการฝึกที่ตรวจสอบ แต่ผู้แสดง Charades 1 จาก 12 คนในชุดนี้เคยปรากฏในชุดฝึกตัวยืนยัน [ผลตรวจการแยกข้อมูล](test-artifacts/fall-confirmation-2026-11-24/blind-integrity.json)

## เอกสารอ้างอิงและแหล่งข้อมูลต้นฉบับ

1. Ursul, I. (2025). *Video-Based Fall Detection Dataset with 2017 Activities from 29 Subjects* (Version 2) [Data set]. Figshare. [DOI 10.6084/m9.figshare.28596332.v2](https://doi.org/10.6084/m9.figshare.28596332.v2)
2. Alam, E. (2024). *GMDCSA24: A Dataset for Human Fall Detection in Videos* (Version 2.0) [Data set]. Zenodo. [DOI 10.5281/zenodo.12921216](https://zenodo.org/records/12921216)
3. Sigurdsson, G. A., Varol, G., Wang, X., Farhadi, A., Laptev, I., & Gupta, A. (2016). *Hollywood in Homes: Crowdsourcing Data Collection for Activity Understanding*. European Conference on Computer Vision. [บทความต้นฉบับของ Charades](https://arxiv.org/abs/1604.01753)
4. Injury Prevention and Mobility Laboratory, Simon Fraser University. *Videos of Falls in Long Term Care* [Data set]. Databrary. [DOI 10.17910/B7.739](https://doi.org/10.17910/B7.739) · [รายละเอียดและวิธีขอเข้าถึงจากห้องปฏิบัติการ](https://www.sfu.ca/ipml/research/data-sharing.html)
5. Kwolek, B., & Kępski, M. (2014). Human fall detection on embedded platform using depth maps and wireless accelerometer. *Computer Methods and Programs in Biomedicine, 117*(3), 489–501. [หน้าชุดข้อมูลและรายการอ้างอิงที่ผู้จัดทำขอให้ใช้](https://fenix.ur.edu.pl/~mkepski/ds/uf.html)
6. Rahman, N. N., Mahi, A. B. S., Mistry, D., Al Masud, S. M. R., Saha, A. K., Rahman, R., & Islam, M. R. (2025). FallVision: A benchmark video dataset for fall detection. *Data in Brief, 59*, 111440. [DOI บทความ 10.1016/j.dib.2025.111440](https://doi.org/10.1016/j.dib.2025.111440) · [DOI ชุดข้อมูล 10.7910/DVN/75QPKK](https://doi.org/10.7910/DVN/75QPKK)

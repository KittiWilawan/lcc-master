@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้ง Node.js ก่อนเปิด LookLanCare Hub
  pause
  exit /b 1
)

if not exist "home-monitor\.env" (
  echo ไม่พบไฟล์ตั้งค่า home-monitor\.env
  echo กรุณาตั้งค่าคอมเครื่องนี้ก่อนเปิดระบบ
  pause
  exit /b 1
)

node --env-file=home-monitor/.env home-monitor/hub.mjs
if errorlevel 1 pause

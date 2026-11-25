@echo off
echo ============================================
echo   LookLanCare - Expo SDK 58 Upgrade Script
echo ============================================
echo.

cd /d D:\lcc-master
if errorlevel 1 (
    echo ERROR: Cannot find D:\lcc-master
    pause
    exit /b 1
)

echo [1/4] Deleting node_modules and package-lock.json...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
echo Done.
echo.

echo [2/4] Installing packages (SDK 58)...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)
echo Done.
echo.

echo [3/4] Running npx expo install --fix to align versions...
call npx expo install --fix
echo Done.
echo.

echo [4/4] Running expo-doctor to verify...
call npx expo-doctor
echo.

echo ============================================
echo   Upgrade Complete! 
echo   Now run: cd /d D:\lcc-master ^&^& npx expo start
echo ============================================
pause

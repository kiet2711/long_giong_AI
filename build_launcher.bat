@echo off
title Build Launcher EXE
cd /d "%~dp0"

echo ========================================================
echo   Compiling AI Dubbing Studio Launcher EXE...
echo ========================================================

set CSC="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist %CSC% (
    set CSC="C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

if not exist %CSC% (
    echo [Loi] Khong tim thay trinh bien dich csc.exe tren he thong.
    pause
    exit /b 1
)

%CSC% /nologo /target:exe /optimize+ /win32icon:app.ico /out:AI_Dubbing_Studio.exe Launcher.cs

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo [THANH CONG] Da tao file: AI_Dubbing_Studio.exe
    echo Ban co the nhap dup chuot vao AI_Dubbing_Studio.exe de chay!
    echo ========================================================
) else (
    echo.
    echo [THAT BAI] Co loi trong qua trinh bien dich.
)

pause

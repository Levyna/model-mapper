@echo off
chcp 65001 >nul
::
:: model-mapper 编译脚本 (Windows)
::
:: 用法: 双击 build.bat
::

echo ╔═══════════════════════════════════════════════════════╗
echo ║       model-mapper 编译 (Windows)                      ║
echo ╚═══════════════════════════════════════════════════════╝
echo.

:: 检查 Go
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未安装 Go，请先下载: https://go.dev/dl/
    pause
    exit /b 1
)

echo ✅ Go 版本:
go version
echo.

:: 清理旧文件
if exist "model-mapper-windows.exe" del "model-mapper-windows.exe"
if exist "dist\model-mapper-windows.zip" del "dist\model-mapper-windows.zip"

:: 编译 Windows
echo 📦 编译 Windows...
go build -ldflags "-s -w" -o model-mapper-windows.exe .
if %errorlevel% equ 0 (
    echo    ✅ 编译成功
) else (
    echo    ❌ 编译失败
    pause
    exit /b 1
)

:: 打包
echo.
echo 📦 打包...
if not exist "dist" mkdir dist

powershell -Command "Compress-Archive -Path 'model-mapper-windows.exe' -DestinationPath 'dist\model-mapper-windows.zip' -Force"

if exist "dist\model-mapper-windows.zip" (
    echo    ✅ dist\model-mapper-windows.zip
)

echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║  编译完成！输出文件在 dist\ 目录                  ║
echo ╠═══════════════════════════════════════════════════════╣
echo ║  • dist\model-mapper-windows.zip  (Windows)          ║
echo ╚═══════════════════════════════════════════════════════╝
echo.
pause
@echo off
chcp 65001 >nul
::
:: model-mapper 安装脚本 (Windows)
::
:: 用法: 双击 install-windows.bat
::

echo ╔═══════════════════════════════════════════════════════╗
echo ║       model-mapper 安装 (Windows)                      ║
echo ╚═══════════════════════════════════════════════════════╝
echo.

set SCRIPT_DIR=%~dp0
set SERVICE_NAME=model-mapper
set EXE_NAME=model-mapper-windows.exe

:: ========== 检查文件 ==========
if not exist "%SCRIPT_DIR%%EXE_NAME%" (
    echo ❌ 未找到 %EXE_NAME%
    echo    请先运行 build.bat 编译
    pause
    exit /b 1
)

:: ========== 注册 Windows 服务（使用 NSSM 或简单启动）==========
echo 📝 启动服务...

:: 使用 sc 命令创建服务（需要管理员权限）
sc query %SERVICE_NAME% >nul 2>&1
if %errorlevel% equ 0 (
    echo    服务已存在，先停止...
    sc stop %SERVICE_NAME% >nul 2>&1
    timeout /t 2 >nul
    sc delete %SERVICE_NAME% >nul 2>&1
)

:: 创建服务
echo    创建 Windows 服务...
sc create %SERVICE_NAME% binPath= "%SCRIPT_DIR%%EXE_NAME%" start= auto DisplayName= "model-mapper" >nul 2>&1

:: 启动服务
echo    启动服务...
sc start %SERVICE_NAME% >nul 2>&1

timeout /t 3 >nul

:: ========== 验证 ==========
echo.
echo 🔍 验证...

netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% equ 0 (
    echo    ✅ HTTP  localhost:3000 ^(Claude Desktop^)
) else (
    echo    ❌ HTTP 未启动
)

netstat -ano | findstr ":3001" >nul 2>&1
if %errorlevel% equ 0 (
    echo    ✅ HTTPS localhost:3001 ^(Office 插件^)
) else (
    echo    ❌ HTTPS 未启动
)

echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║  管理命令:                                           ║
echo ║    状态: sc query %SERVICE_NAME%                     ║
echo ║    停止: sc stop %SERVICE_NAME%                       ║
echo ║    启动: sc start %SERVICE_NAME%                      ║
echo ║    删除: sc delete %SERVICE_NAME%                    ║
echo ╚═══════════════════════════════════════════════════════╝
echo.
echo 配置地址:
echo   Claude Desktop: http://localhost:3000  (API Key: dummy)
echo   Office 插件:    https://localhost:3001  (API Key: dummy)
echo.
pause
#!/usr/bin/env node
/**
 * 一键安装脚本
 *
 * 用法: npx git+https://github.com/Levyna/model-mapper.git
 *
 * 自动完成:
 *   1. 创建配置目录
 *   2. 复制示例配置
 *   3. 启动服务
 *   4. 安装后台服务（开机自启）
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const isWindows = os.platform() === "win32";
const isMac = os.platform() === "darwin";

// 颜色输出
const log = {
  info: msg => console.log(`\x1b[36m➜\x1b[0m ${msg}`),
  success: msg => console.log(`\x1b[32m✓\x1b[0m ${msg}`),
  warn: msg => console.log(`\x1b[33m⚠\x1b[0m ${msg}`),
  error: msg => console.log(`\x1b[31m✗\x1b[0m ${msg}`),
};

// 获取脚本所在目录（npm 全局安装位置）
function getInstallDir() {
  try {
    const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return path.join(npmRoot, "model-mapper");
  } catch {
    return __dirname;
  }
}

// 创建配置目录并复制示例
function setupConfig() {
  const installDir = getInstallDir();
  const configPath = path.join(installDir, "model-mapper-config.json");
  const examplePath = path.join(installDir, "model-mapper-config.example.json");

  if (fs.existsSync(configPath)) {
    log.info("配置文件已存在，跳过创建");
    return;
  }

  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    log.success("已创建配置文件");
    log.info(`请编辑: ${configPath}`);
    log.info("填入你的 API Key 后，服务将自动启动");
  }
}

// 安装后台服务 (macOS)
function installMacService() {
  const installDir = getInstallDir();
  const serviceName = "model-mapper";
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${serviceName}.plist`);
  const exePath = process.execPath;
  const scriptPath = path.join(installDir, "model-mapper.js");

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${serviceName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${exePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${installDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/model-mapper.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/model-mapper-error.log</string>
</dict>
</plist>`;

  try {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plistContent);
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
    execSync(`launchctl load "${plistPath}"`);
    log.success("后台服务已安装（开机自启）");
  } catch (err) {
    log.warn("后台服务安装失败，请手动运行: launchctl load ~/Library/LaunchAgents/model-mapper.plist");
  }
}

// 安装后台服务 (Windows)
function installWindowsService() {
  const installDir = getInstallDir();
  const serviceName = "model-mapper";
  const scriptPath = path.join(installDir, "model-mapper.js");

  try {
    // 使用 PowerShell 创建服务
    const psScript = `
      $svc = Get-Service -Name "${serviceName}" -ErrorAction SilentlyContinue
      if ($svc) {
        Stop-Service -Name "${serviceName}" -Force
        sc.exe delete "${serviceName}"
      }
      sc.exe create "${serviceName}" binPath= "${process.execPath} \\"${scriptPath}\\"" start= auto DisplayName= "model-mapper"
      Start-Service -Name "${serviceName}"
    `;

    execSync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, { stdio: "inherit" });
    log.success("后台服务已安装（开机自启）");
  } catch (err) {
    log.warn("后台服务安装失败，请以管理员身份运行");
  }
}

// 启动服务
function startService() {
  const installDir = getInstallDir();
  const scriptPath = path.join(installDir, "model-mapper.js");

  try {
    log.info("启动服务...");
    execSync(`"${process.execPath}" "${scriptPath}"`, {
      cwd: installDir,
      stdio: "inherit",
      detached: true,
      unref: true,
    });
    log.success("服务已启动");
  } catch (err) {
    log.error("服务启动失败");
    process.exit(1);
  }
}

// 主程序
function main() {
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║       model-mapper 一键安装                        ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  log.info("安装目录: " + getInstallDir());

  // 1. 设置配置
  setupConfig();

  // 2. 启动服务
  startService();

  // 3. 安装后台服务
  if (isMac) {
    installMacService();
  } else if (isWindows) {
    installWindowsService();
  }

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║  ✅ 安装完成！                                   ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log("║                                                      ║");
  console.log("║  下一步:                                           ║");
  console.log("║    1. 编辑配置文件，填入 API Key                   ║");
  console.log("║    2. 在 Claude Desktop / Office 插件配置          ║");
  console.log("║                                                      ║");
  console.log("║  配置界面: http://localhost:3000/                  ║");
  console.log("║                                                      ║");
  console.log("║  Claude Desktop:                                   ║");
  console.log("║    URL: http://localhost:3000                      ║");
  console.log("║    Key: dummy                                     ║");
  console.log("║                                                      ║");
  console.log("║  Office 插件:                                     ║");
  console.log("║    URL: https://localhost:3001                     ║");
  console.log("║    Key: dummy                                     ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
}

main();
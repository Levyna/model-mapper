#!/usr/bin/env node
/**
 * 后台服务安装脚本 (跨平台)
 *
 * 用法:
 *   node bin/install-service.js           # 安装服务
 *   node bin/install-service.js uninstall # 卸载服务
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const isWindows = os.platform() === "win32";
const SERVICE_NAME = "model-mapper";
const PLIST_PATH = isWindows
  ? null
  : path.join(os.homedir(), "Library/LaunchAgents", `${SERVICE_NAME}.plist`);

function log(msg) {
  console.log(msg);
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch (err) {
    return false;
  }
}

// ========== macOS ==========
function installMac() {
  log("📝 创建 macOS LaunchAgent...");

  const exePath = process.execPath;
  const scriptDir = process.cwd();
  const scriptPath = path.join(scriptDir, "model-mapper.js");

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${exePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${scriptDir}</string>
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

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plistContent);

  // 停止旧服务
  run(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`);

  // 加载服务
  if (run(`launchctl load "${PLIST_PATH}"`)) {
    log(`✅ 服务已安装: ${PLIST_PATH}`);
    log("   启动: launchctl load ${SERVICE_NAME}");
    log("   停止: launchctl unload ${SERVICE_NAME}");
    log("   日志: cat /tmp/model-mapper.log");
  } else {
    log("❌ 服务安装失败");
  }
}

function uninstallMac() {
  log("⏹️  卸载 macOS 服务...");
  run(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`);
  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH);
    log("✅ 已卸载");
  }
}

// ========== Windows ==========
function installWindows() {
  log("📝 创建 Windows 服务...");

  // 使用 nssm 或 sc.exe
  const exePath = path.join(process.cwd(), "node.exe");
  const scriptPath = path.join(process.cwd(), "model-mapper.js");

  // 检查是否已有服务
  try {
    execSync(`sc query ${SERVICE_NAME}`, { stdio: "ignore" });
    log("   服务已存在，先停止并删除...");
    execSync(`sc stop ${SERVICE_NAME}`, { stdio: "ignore" });
    execSync(`sc delete ${SERVICE_NAME}`, { stdio: "ignore" });
  } catch {}

  // 创建服务
  try {
    execSync(`sc create ${SERVICE_NAME} binPath= "${process.execPath} \\"${scriptPath}\\"" start= auto DisplayName= "model-mapper"`, { stdio: "inherit" });
    log("✅ 服务已安装");
    log("   启动: sc start model-mapper");
    log("   停止: sc stop model-mapper");
  } catch (err) {
    log("⚠️  sc 命令失败，请以管理员身份运行");
  }
}

function uninstallWindows() {
  log("⏹️  卸载 Windows 服务...");
  try {
    execSync(`sc stop ${SERVICE_NAME}`, { stdio: "ignore" });
    execSync(`sc delete ${SERVICE_NAME}`, { stdio: "ignore" });
    log("✅ 已卸载");
  } catch {
    log("⚠️  请以管理员身份运行");
  }
}

// ========== 主程序 ==========
const cmd = process.argv[2];

if (cmd === "uninstall") {
  if (isWindows) {
    uninstallWindows();
  } else {
    uninstallMac();
  }
} else {
  if (isWindows) {
    installWindows();
  } else {
    installMac();
  }
}
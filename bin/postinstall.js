#!/usr/bin/env node
/**
 * 安装后配置脚本
 *
 * 运行在 npm install 之后
 * 只负责创建配置文件，不启动服务
 */

const fs = require("fs");
const path = require("path");

// 获取脚本所在目录（npm 全局安装位置）
function getInstallDir() {
  try {
    const { execSync } = require("child_process");
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
    console.log("➜ 配置文件已存在");
    return;
  }

  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    console.log("✓ 已创建配置文件: model-mapper-config.json");
    console.log("✓ 请编辑此文件，填入你的 API Key");
    console.log("✓ 然后运行 'model-mapper' 启动服务");
  }
}

// 主程序
function main() {
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║       model-mapper 安装完成                          ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  setupConfig();

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║  ✅ 安装成功！                                   ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log("║                                                      ║");
  console.log("║  下一步:                                           ║");
  console.log("║    1. 打开 http://localhost:3000/ 配置 API Key     ║");
  console.log("║    2. 或编辑配置文件手动配置                        ║");
  console.log("║    3. 运行 model-mapper 启动服务                   ║");
  console.log("║                                                      ║");
  console.log("║  Claude Desktop:                                   ║");
  console.log("║    URL: http://localhost:3000  Key: dummy         ║");
  console.log("║                                                      ║");
  console.log("║  Office 插件:                                     ║");
  console.log("║    URL: https://localhost:3001  Key: dummy         ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
}

main();
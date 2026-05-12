#!/usr/bin/env node
/**
 * CLI 入口
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const mainScript = path.join(__dirname, "..", "model-mapper.js");

// 检查配置文件
const configPath = path.join(process.cwd(), "model-mapper-config.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ 配置文件不存在: model-mapper-config.json");
  console.error("   请复制 model-mapper-config.example.json 并填入 API Key");
  process.exit(1);
}

// 启动服务
const child = spawn("node", [mainScript], {
  cwd: process.cwd(),
  stdio: "inherit",
});

child.on("error", err => {
  console.error("❌ 启动失败:", err.message);
  process.exit(1);
});

child.on("exit", code => {
  process.exit(code || 0);
});

// 捕获 Ctrl+C
process.on("SIGINT", () => {
  child.kill("SIGINT");
  process.exit(0);
});
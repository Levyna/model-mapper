#!/usr/bin/env node
/**
 * model-mapper.js — Claude 多模型代理 (跨平台)
 *
 * 同时服务 Claude Desktop 和 Office 插件：
 *   - localhost:3000 (HTTP)  → Claude Desktop
 *   - localhost:3001 (HTTPS) → Office 插件 (Word/Excel/PowerPoint)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ========== 配置加载 ==========
const CONFIG_PATH = path.join(process.cwd(), "model-mapper-config.json");
const CERT_PATH = path.join(process.cwd(), "localhost-cert.pem");
const KEY_PATH = path.join(process.cwd(), "localhost-key.pem");

let config;
try {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  config = JSON.parse(raw);
} catch (err) {
  console.error(`❌ 无法读取配置文件: ${CONFIG_PATH}`);
  console.error(`   ${err.message}`);
  console.error(`\n   请复制 model-mapper-config.example.json 为 model-mapper-config.json 并填入 API Key`);
  process.exit(1);
}

const PORT = config.port || 3000;
const ROUTES = config.routes || [];

// ========== 工具函数 ==========

function matchRoute(modelStr) {
  if (!modelStr) return null;
  const modelRouteMap = new Map();
  ROUTES.forEach(route => {
    (route.mapped_models || []).forEach(m => {
      modelRouteMap.set(m.toLowerCase(), route);
    });
  });
  return modelRouteMap.get(modelStr.toLowerCase()) || null;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendUpstream(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout: 10000,
    };
    const req = transport.request(options, res => resolve(res));
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("请求超时 (10秒)")); });
    if (body) req.write(body);
    req.end();
  });
}

function buildUpstreamHeaders(req, route) {
  const headers = {};
  const forwardHeaders = ["content-type", "anthropic-version", "anthropic-beta", "accept"];
  for (const [key, value] of Object.entries(req.headers)) {
    if (forwardHeaders.includes(key.toLowerCase())) headers[key] = value;
  }
  if (route.protocol === "anthropic") {
    headers["x-api-key"] = route.upstream_token;
    headers["anthropic-version"] = headers["anthropic-version"] || "2023-06-01";
    headers["content-type"] = headers["content-type"] || "application/json";
  } else {
    headers["authorization"] = `Bearer ${route.upstream_token}`;
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  return headers;
}

// ========== 生成自签名证书 ==========
function generateSelfSignedCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return;
  }

  console.log("📝 生成 HTTPS 证书...");

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const cert = crypto.createSign("SHA256");
  cert.update(
    "MIIBdjCCAR2gAwIBAgIBATANBgkqhkiG9w0BAQsFADAYMRYwFAYDVQQDDA1sb" +
    "jAxMi4wLmNvbTAeFw0yNzA1MTExMDAwMDBaFw0zNzA1MDkxMDAwMDBaMBgxFj" +
    "AUBgNVBAMMDWxvY2FsaG9zdDBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7qda" +
    "L5tTZXZVKb1KzXvn7sWnL6pZfZ5q5X5zX5yZ5x5z5z5z5z5z5z5z5z5z5z5z" +
    "5z5z5z5z5z5z5z5z5z5z5z5zAgMBAAGjUzBRMB0GA1UdDgQWBBQIDu3b5X5z" +
    "5z5z5z5z5z5z5z5z5z5zAfBgNVHSMEGDAWgBQIDu3b5X5z5z5z5z5z5z5z5z" +
    "5z5zAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA0EAexample"
  );
  const signKey = crypto.createPrivateKey({ key: privateKey, format: "pem" });

  const certPem = `-----BEGIN CERTIFICATE-----
MIICjDCCAXSgAwIBAgIBATANBgkqhkiG9w0BAQsFADAYMRYwFAYDVQQDDA1sb2Nh
bGhvc3QwHhcNMjYwNTEyMTAwMDAwWhcNMzIwNTA5MTAwMDAwWjAYMRYwFAYDVQQD
DA1sb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDH5pVb
J2vZL9qZ3K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5x
Lm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5
xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K
5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7
K5xLm9Y9qK5L7K5xLm9Y9qK5L7K5xLm9Y9qK5L7AgMBAAGjUzBRMB0GA1UdDgQW
BBQ2P3P9Y5x5z5z5z5z5z5z5z5z5z5zAfBgNVHSMEGDAWgBQ2P3P9Y5x5z5z5z5z
5z5z5z5z5z5zAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBj
-----END CERTIFICATE-----`;

  fs.writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(CERT_PATH, certPem);

  console.log("✅ 证书已生成");
}

// ========== 请求处理 ==========

function handlePreflight(req, res) {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
}

function handleModels(req, res) {
  setCorsHeaders(res);
  const models = [];
  ROUTES.forEach(route => {
    (route.mapped_models || []).forEach(m => {
      let hostname = "unknown";
      try {
        hostname = new URL(route.upstream_url).hostname;
      } catch {}
      models.push({
        id: m,
        type: "model",
        display_name: `${route.target_model} (via ${hostname})`,
        created_at: "2026-01-01T00:00:00Z",
      });
    });
  });
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  res.end(JSON.stringify({
    data: models,
    first_id: models[0]?.id,
    has_more: false,
    last_id: models[models.length - 1]?.id,
  }));
}

async function handlePost(req, res) {
  setCorsHeaders(res);
  try {
    const rawBody = await collectBody(req);
    let bodyObj;
    try {
      bodyObj = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    const modelStr = bodyObj.model;
    const route = matchRoute(modelStr);
    if (!route) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "unknown_model",
        message: `没有为模型 "${modelStr}" 配置路由。可用: ${ROUTES.flatMap(r => r.mapped_models || []).join(", ")}`,
      }));
      return;
    }

    bodyObj.model = route.target_model;
    const base = route.upstream_url.replace(/\/+$/, "");
    const upstreamUrl = route.protocol === "anthropic"
      ? `${base}/v1/messages`
      : `${base}/chat/completions`;

    const upstreamHeaders = buildUpstreamHeaders(req, route);
    const upstreamRes = await sendUpstream(upstreamUrl, "POST", upstreamHeaders, JSON.stringify(bodyObj));

    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (!key.toLowerCase().startsWith("access-control-")) {
        res.setHeader(key, value);
      }
    }
    res.writeHead(upstreamRes.statusCode);
    upstreamRes.pipe(res);
    upstreamRes.on("error", () => { if (!res.writableEnded) res.end(); });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_error", message: err.message }));
    }
  }
}

function handleRequest(req, res) {
  const method = req.method.toUpperCase();
  const urlPath = req.url.split("?")[0];
  const time = new Date().toLocaleTimeString();

  if (method === "OPTIONS") return handlePreflight(req, res);
  if (method === "GET" && urlPath === "/v1/models") {
    console.log(`[${time}] GET /v1/models`);
    return handleModels(req, res);
  }
  if (method === "POST") {
    console.log(`[${time}] POST ${req.url}`);
    return handlePost(req, res);
  }
  setCorsHeaders(res);
  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "method_not_allowed" }));
}

// ========== 启动服务 ==========
function startServer() {
  // 打印路由表
  console.log("📋 路由表:");
  ROUTES.forEach((route, i) => {
    console.log(`   [${i + 1}] ${(route.mapped_models || []).join(", ")}  →  ${route.target_model} (${route.upstream_url})`);
  });

  // HTTP — Claude Desktop
  const httpServer = http.createServer(handleRequest);
  httpServer.listen(PORT, () => {
    console.log(`✅ HTTP:  http://localhost:${PORT} (Claude Desktop)`);
  });

  // HTTPS — Office 插件
  try {
    generateSelfSignedCert();
    const cert = fs.readFileSync(CERT_PATH);
    const key = fs.readFileSync(KEY_PATH);
    const httpsServer = https.createServer({ cert, key }, handleRequest);
    httpsServer.listen(PORT + 1, () => {
      console.log(`✅ HTTPS: https://localhost:${PORT + 1} (Office 插件)`);
    });
  } catch (err) {
    console.log(`⚠️  HTTPS 未启用: ${err.message}`);
  }

  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║       model-mapper · Claude 多模型代理             ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log(`║  配置: ${CONFIG_PATH}`);
  console.log("║");
  console.log("║  Claude Desktop:");
  console.log(`║    http://localhost:${PORT}`);
  console.log("║");
  console.log("║  Office 插件:");
  console.log(`║    https://localhost:${PORT + 1}`);
  console.log("║");
  console.log("║  API Key: dummy");
  console.log("║");
  console.log("║  等待请求中... (Ctrl+C 停止)");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
}

startServer();
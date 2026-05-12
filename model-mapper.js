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

// ========== 配置路径 ==========
const CONFIG_PATH = path.join(process.cwd(), "model-mapper-config.json");
const CERT_PATH = path.join(process.cwd(), "localhost-cert.pem");
const KEY_PATH = path.join(process.cwd(), "localhost-key.pem");

// ========== 配置加载 ==========
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return { port: 3000, routes: [] };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

let config = loadConfig();
const PORT = config.port || 3000;

// ========== Web 界面 HTML ==========
const WEB_UI = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>model-mapper 配置</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; color: #111; min-height: 100vh; padding: 24px 16px 80px; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: #666; margin-bottom: 24px; }
  .routes { display: flex; flex-direction: column; gap: 16px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #eee; }
  .card-title { font-size: 16px; font-weight: 700; }
  .delete-btn { background: #fee; color: #c00; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .delete-btn:hover { background: #fdd; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 13px; font-weight: 600; color: #444; margin-bottom: 6px; }
  input, select { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
  input:focus, select:focus { outline: none; border-color: #0066cc; }
  .row { display: flex; gap: 12px; }
  .row .field { flex: 1; margin-bottom: 0; }
  textarea { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; min-height: 60px; resize: vertical; }
  textarea:focus { outline: none; border-color: #0066cc; }
  .add-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px; background: #f0f0f0; color: #333; border: 2px dashed #ccc; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  .add-btn:hover { background: #e8e8e8; border-color: #999; }
  .bottom { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,.95); backdrop-filter: blur(8px); padding: 16px 24px; display: flex; align-items: center; justify-content: center; gap: 16px; border-top: 1px solid #ddd; }
  .btn { padding: 12px 36px; background: #111; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn:hover { background: #333; }
  .btn:disabled { background: #999; cursor: not-allowed; }
  .status { font-size: 14px; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
  .model-tag { display: inline-block; background: #e8f4ff; color: #0066cc; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin: 2px; }
  .info { background: #fffbe6; border: 1px solid #ffe58f; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #8a6d3b; }
</style>
</head>
<body>
<div class="container">
  <h1>model-mapper</h1>
  <p class="subtitle">Claude 多模型代理配置</p>

  <div class="info">
    配置完成后，在 Claude Desktop 或 Office 插件中使用：
    <br>• Claude Desktop: <strong>http://localhost:3000</strong>，API Key: <strong>dummy</strong>
    <br>• Office 插件: <strong>https://localhost:3001</strong>，API Key: <strong>dummy</strong>
  </div>

  <div class="routes" id="routes"></div>
  <button class="add-btn" onclick="addRoute()">+ 添加路由</button>
</div>

<div class="bottom">
  <button class="btn" id="saveBtn" onclick="save()">保存配置</button>
  <span class="status" id="status"></span>
</div>

<script>
let routeId = 0;

function createRouteCard(route) {
  const id = routeId++;
  const models = (route.mapped_models || []).join('\\n');
  return '<div class="card" id="card-' + id + '">' +
    '<div class="card-header">' +
      '<span class="card-title">路由 #' + (id + 1) + '</span>' +
      '<button class="delete-btn" onclick="removeRoute(' + id + ')">删除</button>' +
    '</div>' +
    '<div class="field">' +
      '<label>上游 URL</label>' +
      '<input type="url" id="upstream_url-' + id + '" value="' + (route.upstream_url || '') + '" placeholder="https://api.minimaxi.com/anthropic">' +
    '</div>' +
    '<div class="row">' +
      '<div class="field">' +
        '<label>协议</label>' +
        '<select id="protocol-' + id + '">' +
          '<option value="anthropic" ' + (route.protocol !== 'openai' ? 'selected' : '') + '>Anthropic</option>' +
          '<option value="openai" ' + (route.protocol === 'openai' ? 'selected' : '') + '>OpenAI</option>' +
        '</select>' +
      '</div>' +
      '<div class="field">' +
        '<label>目标模型</label>' +
        '<input type="text" id="target_model-' + id + '" value="' + (route.target_model || '') + '" placeholder="MiniMax-M2.7">' +
      '</div>' +
    '</div>' +
    '<div class="field">' +
      '<label>API Key</label>' +
      '<input type="password" id="upstream_token-' + id + '" value="' + (route.upstream_token || '') + '" placeholder="sk-...">' +
    '</div>' +
    '<div class="field" style="margin-bottom:0">' +
      '<label>映射模型（每行一个，将映射到此路由）</label>' +
      '<textarea id="mapped_models-' + id + '" placeholder="claude-sonnet-4-5">' + models + '</textarea>' +
    '</div>' +
  '</div>';
}

function addRoute(existing) {
  const container = document.getElementById('routes');
  const div = document.createElement('div');
  div.innerHTML = createRouteCard(existing || {});
  container.appendChild(div.firstElementChild);
}

function removeRoute(id) {
  const el = document.getElementById('card-' + id);
  if (el) el.remove();
}

async function load() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const container = document.getElementById('routes');
    container.innerHTML = '';
    routeId = 0;
    (cfg.routes || []).forEach(r => addRoute(r));
    if (routeId === 0) addRoute();
  } catch (err) {
    console.error(err);
    addRoute();
  }
}

async function save() {
  const btn = document.getElementById('saveBtn');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '';

  const cards = document.querySelectorAll('.card');
  const routes = [];

  cards.forEach(card => {
    const id = card.id.replace('card-', '');
    const upstream_url = document.getElementById('upstream_url-' + id).value.trim();
    const upstream_token = document.getElementById('upstream_token-' + id).value.trim();
    const protocol = document.getElementById('protocol-' + id).value;
    const target_model = document.getElementById('target_model-' + id).value.trim();
    const mapped_models = document.getElementById('mapped_models-' + id).value
      .split('\\n').map(s => s.trim()).filter(Boolean);

    if (upstream_url && target_model) {
      routes.push({ upstream_url, upstream_token, protocol, target_model, mapped_models });
    }
  });

  if (routes.length === 0) {
    status.textContent = '请至少配置一个路由';
    status.className = 'status err';
    btn.disabled = false;
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 3000, routes })
    });
    if (res.ok) {
      status.textContent = '✅ 已保存！重启服务后生效';
      status.className = 'status ok';
    } else {
      status.textContent = '保存失败: ' + res.status;
      status.className = 'status err';
    }
  } catch (err) {
    status.textContent = '网络错误';
    status.className = 'status err';
  }

  btn.disabled = false;
  setTimeout(() => { status.textContent = ''; }, 5000);
}

load();
</script>
</body>
</html>`;

// ========== 工具函数 ==========

function matchRoute(modelStr) {
  if (!modelStr) return null;
  const modelRouteMap = new Map();
  config.routes.forEach(route => {
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
K5xLm9Y9qK5L7K5xLm9Y9qK5L7AgMBAAGjUzBRMB0GA1UdDgQWBBQ2P3P9Y5x5z
5z5z5z5z5z5z5z5z5zAfBgNVHSMEGDAWgBQ2P3P9Y5x5z5z5z5z5z5z5z5z5z5z
APBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBj
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
  config.routes.forEach(route => {
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

function handleGetConfig(req, res) {
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  res.end(JSON.stringify(config));
}

function handlePostConfig(req, res) {
  setCorsHeaders(res);
  collectBody(req).then(body => {
    try {
      const newConfig = JSON.parse(body);
      saveConfig(newConfig);
      config = newConfig;
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end('{"error":"invalid json"}');
    }
  }).catch(() => {
    res.writeHead(400);
    res.end();
  });
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
        message: `没有为模型 "${modelStr}" 配置路由。可用: ${config.routes.flatMap(r => r.mapped_models || []).join(", ")}`,
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

  // Web 界面
  if (method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(WEB_UI);
    return;
  }

  // API
  if (method === "GET" && urlPath === "/api/config") return handleGetConfig(req, res);
  if (method === "POST" && urlPath === "/api/config") return handlePostConfig(req, res);
  if (method === "GET" && urlPath === "/v1/models") {
    console.log(`[${time}] GET /v1/models`);
    return handleModels(req, res);
  }

  // 代理
  if (method === "POST") {
    console.log(`[${time}] POST ${req.url}`);
    return handlePost(req, res);
  }

  setCorsHeaders(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

// ========== 启动服务 ==========
function startServer() {
  // 打印路由表
  console.log("📋 路由表:");
  config.routes.forEach((route, i) => {
    console.log(`   [${i + 1}] ${(route.mapped_models || []).join(", ")}  →  ${route.target_model} (${route.upstream_url})`);
  });

  // HTTP — Claude Desktop + Web 界面
  const httpServer = http.createServer(handleRequest);
  httpServer.listen(PORT, () => {
    console.log(`✅ HTTP:  http://localhost:${PORT}`);
    console.log(`   • Claude Desktop + Office 插件`);
    console.log(`   • Web 配置界面: http://localhost:${PORT}/`);
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
  console.log(`║  Web 配置: http://localhost:${PORT}/                ║`);
  console.log(`║  配置保存: ${CONFIG_PATH}`);
  console.log("║");
  console.log("║  Claude Desktop:                                     ║");
  console.log(`║    http://localhost:${PORT}  API Key: dummy         ║`);
  console.log("║                                                      ║");
  console.log("║  Office 插件:                                       ║");
  console.log(`║    https://localhost:${PORT + 1}  API Key: dummy     ║`);
  console.log("║");
  console.log("║  等待请求中... (Ctrl+C 停止)");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
}

startServer();
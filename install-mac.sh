#!/bin/bash
#
# model-mapper 安装脚本 (macOS)
#
# 用法: bash install.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.claude.model-mapper"
PLIST_FILE="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "╔═══════════════════════════════════════════════════════╗"
echo "║       model-mapper 安装 (macOS)                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ========== 检查文件 ==========
if [ ! -f "$SCRIPT_DIR/model-mapper" ]; then
  echo "❌ 未找到 model-mapper 可执行文件"
  echo "   请先运行 build.sh 编译"
  exit 1
fi

chmod +x "$SCRIPT_DIR/model-mapper"

# ========== 信任证书 ==========
CERT_FILE="$SCRIPT_DIR/localhost-cert.pem"
if [ -f "$CERT_FILE" ]; then
  echo "🔐 信任 HTTPS 证书..."
  echo "   （需要输入 Mac 密码）"
  sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain \
    "$CERT_FILE" 2>/dev/null || true
  echo "   ✅ 证书已信任"
fi

# ========== 停止旧服务 ==========
echo ""
echo "⏹️  停止旧服务..."
launchctl unload "$PLIST_FILE" 2>/dev/null || true

# ========== 创建 plist ==========
echo ""
echo "📝 创建后台服务..."

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SCRIPT_DIR/model-mapper</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/model-mapper.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/model-mapper-error.log</string>
</dict>
</plist>
EOF

echo "   ✅ $PLIST_FILE"

# ========== 启动服务 ==========
echo ""
echo "🚀 启动服务..."
launchctl load "$PLIST_FILE"

sleep 2

# ========== 验证 ==========
echo ""
echo "🔍 验证..."

HTTP_OK=false
HTTPS_OK=false

if lsof -i :3000 2>/dev/null | grep -q LISTEN; then
  echo "   ✅ HTTP  localhost:3000 (Claude Desktop)"
  HTTP_OK=true
else
  echo "   ❌ HTTP 未启动，查看: cat /tmp/model-mapper-error.log"
fi

if lsof -i :3001 2>/dev/null | grep -q LISTEN; then
  echo "   ✅ HTTPS localhost:3001 (Office 插件)"
  HTTPS_OK=true
else
  echo "   ❌ HTTPS 未启动，查看: cat /tmp/model-mapper-error.log"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
if [ "$HTTP_OK" = true ] && [ "$HTTPS_OK" = true ]; then
  echo "║  ✅ 安装成功！                                   ║"
else
  echo "║  ⚠️  部分服务未启动                             ║"
fi
echo "╠═══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  Claude Desktop:                                     ║"
echo "║    Gateway URL: http://localhost:3000                ║"
echo "║    API Key:     dummy                               ║"
echo "║                                                      ║"
echo "║  Office 插件:                                       ║"
echo "║    Gateway URL: https://localhost:3001                ║"
echo "║    API Key:     dummy                               ║"
echo "║                                                      ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  管理命令:                                         ║"
echo "║    状态: launchctl list | grep model-mapper        ║"
echo "║    停止: launchctl unload $PLIST_NAME               ║"
echo "║    启动: launchctl load $PLIST_NAME                 ║"
echo "║    日志: cat /tmp/model-mapper.log                  ║"
echo "╚═══════════════════════════════════════════════════════╝"
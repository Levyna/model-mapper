#!/bin/bash
#
# model-mapper 交叉编译脚本
#
# 用法: bash build.sh
#
# 需要先安装 Go: https://go.dev/dl/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔═══════════════════════════════════════════════════════╗"
echo "║       model-mapper 交叉编译                         ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# 检查 Go
if ! command -v go &> /dev/null; then
  echo "❌ 未安装 Go，请先下载: https://go.dev/dl/"
  exit 1
fi
echo "✅ Go 版本: $(go version)"
echo ""

# 清理旧文件
rm -f model-mapper model-mapper-windows.exe model-mapper-test

# ========== 编译 Mac (amd64 + arm64) ==========
echo "📦 编译 macOS..."

# macOS amd64
echo "   • macOS amd64..."
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o model-mapper-mac-amd64 .
mv model-mapper-mac-amd64 model-mapper

# macOS arm64
echo "   • macOS arm64..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o model-mapper-mac-arm64 .
mv model-mapper-mac-arm64 model-mapper

echo "   ✅ macOS 双架构完成"
echo ""

# ========== 编译 Windows ==========
echo "📦 编译 Windows..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o model-mapper-windows.exe .
echo "   ✅ Windows 完成"
echo ""

# ========== 打包 ==========
echo "📦 打包..."

mkdir -p dist

# Mac
tar -czf dist/model-mapper-mac.tar.gz model-mapper
echo "   ✅ model-mapper-mac.tar.gz"

# Windows
zip -j dist/model-mapper-windows.zip model-mapper-windows.exe
rm model-mapper-windows.exe
echo "   ✅ model-mapper-windows.zip"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  编译完成！输出文件在 dist/ 目录                    ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  • model-mapper-mac.tar.gz      (Mac 通用)           ║"
echo "║  • model-mapper-windows.zip     (Windows)           ║"
echo "╚═══════════════════════════════════════════════════════╝"
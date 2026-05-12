# model-mapper

Claude 多模型代理 - 一句命令安装，同时支持 Claude Desktop 和 Office 插件

## 一行安装

```bash
npm install -g model-mapper
```

## 快速配置

1. 复制配置文件：
```bash
cp model-mapper-config.example.json model-mapper-config.json
```

2. 编辑 `model-mapper-config.json`，填入你的 API Key

3. 启动服务：
```bash
model-mapper
```

## 效果

| 应用 | 地址 | 模型 |
|------|------|------|
| Claude Desktop | `http://localhost:3000` | MiniMax、智谱、DeepSeek、GPT 自由切换 |
| Word / Excel / PowerPoint | `https://localhost:3001` | 同上，Office 插件内选择 |

## 安装后台服务

**macOS:**
```bash
node node_modules/model-mapper/bin/install-service.js
```

**Windows (管理员):**
```bash
node node_modules/model-mapper/bin/install-service.js
```

## 完整使用指南

请查看 [完整配置指南](./docs/guide.md)
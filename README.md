# model-mapper

Claude 多模型代理 - 一键安装，同时支持 Claude Desktop 和 Office 插件

## 一行安装

```bash
npm install -g git+https://github.com/Levyna/model-mapper.git
```

安装完成后，**直接在浏览器打开 http://localhost:3000/** 配置你的 API Key！

## 效果

| 应用 | 地址 | API Key |
|------|------|---------|
| Claude Desktop | `http://localhost:3000` | `dummy` |
| Word / Excel / PowerPoint | `https://localhost:3001` | `dummy` |

## Web 配置界面

打开 http://localhost:3000/ 即可在界面上：
- 添加/删除/修改路由
- 填入 API Key
- 选择协议（Anthropic / OpenAI）
- 设置模型映射

## 安装步骤

```bash
# 1. 一键安装（自动创建配置、启动服务、安装后台服务）
npm install -g git+https://github.com/Levyna/model-mapper.git

# 2. 打开浏览器配置 API Key
open http://localhost:3000/

# 3. 在 Claude Desktop / Office 插件配置
#    URL: http://localhost:3000
#    Key: dummy
```

## 支持的模型

| 显示的模型 ID | 实际调用的上游 |
|--------------|--------------|
| claude-sonnet-4-5 | MiniMax-M2.7 |
| claude-opus-4-6 | 智谱 GLM-5.1 |
| claude-sonnet-4-6 | DeepSeek |
| claude-opus-4-7 | GPT (中转) |

## 管理命令

### macOS
```bash
# 查看状态
launchctl list | grep model-mapper

# 停止服务
launchctl unload ~/Library/LaunchAgents/model-mapper.plist

# 启动服务
launchctl load ~/Library/LaunchAgents/model-mapper.plist

# 查看日志
cat /tmp/model-mapper.log
```

### Windows
```cmd
sc query model-mapper
sc stop model-mapper
sc start model-mapper
sc delete model-mapper
```
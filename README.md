# omp-switch

> 面向 [pi](https://pi.dev) 与 [omp（Oh My Pi）](https://omp.sh) 两个 CLI 编码 Agent 的可视化配置管理器。

`omp-switch` 是一个跨平台桌面应用，把 pi / omp 散落在 `~/.pi/agent` 与 `~/.omp/agent` 下的
供应商、模型角色、Skills、MCP、会话等配置集中到一个界面里管理，免去手动编辑 JSON / YAML 的麻烦。
所有写回都会**原样保留未知字段**，不会破坏 CLI 自己维护的其它设置。

## ✨ 功能特性

- **双 Agent 管理** — 在同一界面切换管理 pi 和 omp，各自的配置文件路径自动探测。
- **供应商（Providers）** — 增删改各供应商及模型；支持 omp 全部 7 种 API 类型
  （`openai-responses` / `openai-completions` / `openai-codex-responses` /
  `azure-openai-responses` / `anthropic-messages` / `google-generative-ai` / `google-vertex`），
  可选拉取供应商的远程模型列表。
- **模型切换（Switch）**
  - pi：设置 `defaultProvider` / `defaultModel` / `defaultThinkingLevel`（单角色）。
  - omp：管理 `modelRoles` 多角色（default / plan / vision / commit …）。
  - 思考等级支持 `off / minimal / low / medium / high / xhigh / max`。
- **Skills** — 从 GitHub 仓库或 [skills.sh](https://skills.sh) 浏览、安装、卸载技能；
  中央仓库统一存放，按需以**软链接**（省空间、实时生效）或**文件复制**分发到各 Agent。
- **Pi 插件（Packages）** — 管理 Pi 全局 npm / Git / 本地 Package；支持启停、更新、卸载，并检查自动发现的本地扩展。
- **MCP** — 可视化管理 `mcp.json` 中的 MCP Server。
- **会话（Sessions）** — 浏览、搜索、删除会话；自动汇总多个会话根目录
  （CLI 默认目录、`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 环境变量、
  配置文件里的 `sessionDir`、以及手动添加的目录），内置 Monaco 只读查看原始 JSONL。
- **原始配置编辑** — 内嵌 Monaco 编辑器直接编辑配置文件，保存前做语法校验并自动生成 `.bak` 备份。
- **系统托盘** — 托盘菜单快速查看/切换当前模型。
- **主题与体验** — 浅色 / 深色 / 跟随系统；可配置关闭窗口行为（询问 / 最小化到托盘 / 直接退出）。

## 🖥️ 环境要求

- **Node.js** ≥ 22.13，pnpm 11
- **操作系统**：Windows / macOS / Linux
- 需要另行安装你要管理的 CLI：[pi](https://pi.dev/docs) 和/或 [omp](https://omp.sh)。
  本应用只读写它们的配置文件，不会替你安装 CLI。

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/ddz12123/omp-switch.git
cd omp-switch

# 安装依赖
pnpm install --frozen-lockfile

# 启动开发环境
pnpm run dev
```

## 📦 构建打包

```bash
# Windows
pnpm run build:win

# macOS
pnpm run build:mac

# Linux
pnpm run build:linux
```

产物输出到 `dist/`。打包相关配置见 [`electron-builder.yml`](./electron-builder.yml)。

## 🛠️ 开发脚本

| 命令                 | 说明                                  |
| -------------------- | ------------------------------------- |
| `pnpm run dev`       | 启动 electron-vite 开发模式（热重载） |
| `pnpm run lint`      | ESLint 检查                           |
| `pnpm run typecheck` | 类型检查（主进程 + 渲染进程）         |
| `pnpm run format`    | Prettier 格式化                       |
| `pnpm run build`     | 类型检查 + 构建                       |

## 🧩 技术栈

- **框架**：Electron + [electron-vite](https://electron-vite.org)
- **UI**：React 19 + TypeScript + [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS 4
- **状态**：Zustand
- **编辑器**：Monaco Editor
- **提示**：Sonner
- **配置解析**：`yaml`（omp 的 YAML 配置写回保真）

## 📁 项目结构

```
src/
├── main/            # 主进程：配置读写、IPC、托盘
│   ├── agents/      # pi / omp 适配器（路径探测、读写、格式保真）
│   ├── appConfig.ts # 应用自身配置
│   ├── sessions.ts  # 会话根目录探测与会话读写
│   ├── piPlugins.ts   # Pi Packages 与本地扩展管理
│   ├── mcp.ts       # MCP 配置读写
│   └── ipc.ts       # IPC 通道注册
├── preload/         # 预加载：contextBridge 白名单
├── renderer/        # 渲染进程：React 界面
│   └── src/pages/   # Providers / Switch / Skills / MCP / Sessions / Settings
└── shared/          # 主/渲染共享的类型与工具
```

## 🔒 数据与隐私

- 所有配置都读写你**本机**的 pi / omp 目录，不上传任何数据。
- 编辑原始配置前会自动生成 `.bak` 备份；写回时保留 CLI 维护的未知字段。

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。提交前请确保通过：

```bash
pnpm run lint
pnpm run typecheck
```

## 📄 许可证

[MIT](./LICENSE)

# 论文阅读器（DSH 插件）

在 DSH 右侧栏读 PDF 论文：目录跳转、页内搜索、连续滚动、多色高亮与边注；选中的原文可引用到对话、解释、翻译成中文。agent 通过四个只读工具按页读当前论文。也支持 arXiv 链接/ID 与关键词搜索打开论文，扫描版 PDF 可后台 OCR。

> 状态：阶段 1（骨架）已完成。阅读层、标注、agent 工具、arXiv 抓取与 OCR 按阶段推进。

## 安装

本仓库是一个标准 DSH bundle，以**本地目录**方式装进 profile（链接而非拷贝，改完重新构建即可）：

- 在 DSH 的 插件/Plugins 设置里添加本地目录 `D:\CODE\dsh-paper-reader`，或
- 让 agent 执行 `plugin_manager` 的 `install_bundle`，目标填仓库绝对路径。

装好后打开右侧栏，在引导页点「论文阅读器」卡片即可打开「论文」标签页。

## 开发

```powershell
pnpm install
pnpm build        # node build.mjs -> client.js
pnpm typecheck    # tsc -p tsconfig.json
```

- `client.js` 是构建产物（esbuild 打包的 CommonJS，外套 DSH 的 `window.__ModuleLoader__` 包装），不要手改。
- Client 侧只能 `require` 平台已提供的模块（React 等），其余依赖必须打进 bundle。
- Host 侧代码在 `index.js`（`export function apply(ctx)`）。
- 本机注意：DSH 的文件沙箱不允许生命周期脚本所需的管道式 spawn，所以 `pnpm-workspace.yaml` 把 esbuild 的构建脚本设为 `false`，并显式固定 `@esbuild/win32-x64`（仅 Windows devDependency）。
- 客户端类型来自真实 DSH 包（`@deepseek-ai/dsh-client-ui-sidebar-right` 等，devDependencies），契约漂移会变成类型错误。

## 结构

```
index.js               Host 半（agent 工具、抓取、落盘；阶段 1 为空壳）
src/client/index.tsx   Client 半：注册「论文」tab 类型、body、标题、引导页入口
src/client/locale.ts   界面文案（zh/en）
build.mjs              构建脚本（驱动 esbuild CLI 并加平台包装）
cordis.patch.yml       Loader 行
locale/*.json          插件列表里的标题/描述
```

## 设计约束（已与用户确认）

- 只读 agent 工具，默认作用于当前激活的论文标签页。
- 内置 PDF 预览不暴露选区/高亮 API，因此本插件自建 pdf.js 渲染层（打包进 Client bundle）。
- 全程离线（除抓取论文），缓存与笔记落在 DSH 插件数据目录；本地 PDF 只记路径。
- 扫描版只做文本级 OCR（搜索/翻译/agent 可读），扫描页上不划高亮。

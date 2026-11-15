# 安全策略 / Security

## 支持范围

只有**最新发布版本**接受安全修复；旧版本请先升级。

| 版本 | 支持 |
|---|---|
| `0.2.x`（最新发布） | ✅ |
| `0.1.0`（预发布版本） | ❌ |

当前发布版本为 `v0.2.0`（tag 与 GitHub Release）；`v0.1.0` 是历史预发布版本，其 tag/Release 保留、不移动，但不再接受安全修复。

## 报告漏洞

请**不要**公开提 issue。请使用 GitHub 的私密漏洞报告（本仓库只通过这个渠道接收安全报告）：

- 直接打开：**https://github.com/beiwei91/dsh-paper-reader/security/advisories/new**
- 或：仓库 **Security → Advisories → Report a vulnerability**。

报告时请说明：DSH 版本、操作系统、插件版本、复现步骤、影响（读取/写入/网络），以及一个最小复现（**不要附上受版权保护的论文 PDF**；如需样例请用你自己生成或公开许可的文件）。

## 安全模型（便于判断问题是否在范围内）

- 插件包含 **Host 半**（`lib/host.js`），在 DSH 进程内运行、无沙箱隔离，能读取用户通过 DSH 工作区接口打开的本地文件，并在 `$DSH_HOME/paper-reader/` 下写入论文字节、文本缓存与标注。装插件等于信任其 Host 代码。
- 唯一的外部网络请求来自 Host 对 arXiv（`export.arxiv.org`、`arxiv.org`）的抓取；浏览器端只访问同源 `/paper-reader/api/*`。
- 该 API 只接受回环地址，写操作要求同源 `Origin`；不具备跨站写能力。
- 无遥测、无外部上报；论文内容与标注不会离开本机。
- agent 工具是**只读**的，只读取当前会话打开的论文。
- 插件不做任何提权、不修改 DSH 配置、不写工作区文件。

本地文件与论文内容的私密性依赖操作系统账号权限；共享机器上请自行限制 `$DSH_HOME/paper-reader/` 的访问权限。

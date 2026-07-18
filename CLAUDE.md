# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指引。

## 这是什么

一个基于 Web 的文件浏览器/编辑器，用于查看和编辑用户主目录下的配置文件（最初是 `~/.openclaw`）。由单个 Express 后端 + 原生 JS 前端组成，**没有构建步骤、没有测试、没有 linter**。

## 命令

```bash
npm install          # 安装依赖（只有 express）
npm start            # 运行 server.js —— 唯一的 npm 脚本
```

通过环境变量覆盖直接运行：

```bash
PORT=8787 HOME_DIR=/Users/me ROOT_DIR=/Users/me/.openclaw node server.js
```

Docker（与生产配置一致 —— host 网络、端口 8787、以读写方式挂载主目录）：

```bash
docker compose up --build
```

没有 test/lint/typecheck 工具链。要验证改动，请启动服务器并调用 REST API（例如 `curl localhost:3000/api/tree?path=`）或直接使用 UI。

## 环境变量

- `PORT`（默认 `3000`）、`HOST`（默认 `0.0.0.0`）
- `HOME_DIR`（默认 `os.homedir()`）—— **不可变的外层安全边界**；其之外的任何内容都无法被访问。
- `ROOT_DIR`（默认 `HOME_DIR`）—— **初始**浏览根目录。必须位于 `HOME_DIR` 之内，切根功能才能工作；否则会打印一条警告。

## 架构

### 双层路径限制（核心设计）

路径安全在两个不同层级上强制执行 —— 在改动任何 API 之前请先理解这两层：

1. **`HOME_DIR`** —— 启动时固定，永不改变。“切根”端点（`POST /api/root`）会让输入经过 `normalizeHomePath` → `isUnderHome`，因此活动根目录只能在 `HOME_DIR` *内部*移动（支持 `~`、`~/x` 和相对路径，全部重新锚定到 `HOME_DIR`）。
2. **`currentRoot`** —— 可变的模块级变量（初始值为 `ROOT_DIR`）。每个文件/目录树请求都会通过 `safeResolve` 将其 `?path=` 相对于 `currentRoot` 解析，并拒绝任何逃逸出 `currentRoot` 的解析结果（路径穿越防护）。

所以：*切换根目录*受 `HOME_DIR` 约束；*读写文件*受 `currentRoot` 约束。新增端点时，目录/文件访问要走 `safeResolve`，根目录变更要走 `normalizeHomePath` —— 不要对原始用户输入直接调用 `fs`。

### 文本文件门控

`isProbablyTextFile` → `looksLikeTextBuffer` 会采样前 4096 字节：拒绝 NUL 字节，要求是合法的 UTF-8（容忍末尾被截断的 1～3 个字节，以免把采样边界处的多字节字符误判为二进制），并要求控制字符占比 <2%。未通过的文件会以 `canOpen: false` 返回 —— UI **禁止打开/保存，但仍允许删除**。硬性上限：每个文件 2 MB（`MAX_FILE_SIZE`），读和写都适用。符号链接会通过 `stat` 解析以判断真实类型；失效链接会暴露 `linkError`。

### REST API（全部在 `server.js` 中）

- `GET/POST /api/root` —— 读取或切换当前根；两者都会返回作为 UI 预设的子目录列表。
- `GET /api/tree?path=` —— 列出单层目录（前端按需懒加载目录树，每次点击加载一层）。
- `GET/POST/DELETE /api/file` —— 读取 / 覆盖 / 删除单个文件。删除会拒绝目录。

所有端点返回 `{ ok: true, ... }` 或 `{ ok: false, error }`；前端的 `api()` 辅助函数在 `ok === false` 时抛出异常。

### 前端（`public/`，以静态文件方式服务）

`app.js` 中是纯 DOM 操作，没有框架或打包器。状态保存在模块级变量中（`currentFilePath`、`originalContent`、`isReadingMode` 等）。脏标记通过将 `editor.value` 与 `originalContent` 比较来判断，并带有 `beforeunload` 防护。**阅读模式**通过随仓库附带的 `public/vendor/marked.min.js` 渲染 Markdown，且仅对通过文本门控的 `.md/.markdown/.mdown/.mkd` 文件启用。`marked.js` 是从本地 `<script>` 加载，而非 CDN —— 请保持其随仓库附带（vendored）。

## 部署胶水（不属于应用本身）

`scripts/bind_ip_proxy.py` 是一个独立的 asyncio TCP 代理，将某个特定私有 IP 的 `:8787` 端口绑定并转发到 `127.0.0.1:18787`。`.run/` 保存它的 pid/log。这些都与具体环境相关，和 Node 应用自身的逻辑无关。

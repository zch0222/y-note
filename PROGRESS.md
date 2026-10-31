# Y Note 进度与里程碑

最后更新：2026-11-01
当前阶段：**M0、M1 已完成（Windows）；M2 只读 Git Diff 首切片已完成并通过 Windows 原生对照，Worker、性能与三平台未开始**
技术方向：React 19 · Tiptap 3.30.3 · Tauri 2 · Windows / macOS / Linux

本文只记录已经验证的进展，不以代码量或主观百分比代替完成状态。里程碑只有在对应验收条件全部通过后才能标记为完成。

## 1. 当前进度

| 工作项 | 状态 | 验证或交付物 |
|---|---|---|
| Typora 无损编辑机制分析 | 已完成 | 已读取并提炼指定分析报告 |
| 本地 Tiptap 能力评估 | 已完成 | 确认版本为 3.30.3，已检查 React 与 Markdown 包实现 |
| 无损编辑器技术方案 | 已完成 | [design/y-note-design.md](design/y-note-design.md) |
| 高保真桌面 UI | 已完成 | [design/y-note-ui.html](design/y-note-ui.html) |
| 主编辑态与 Diff 态导出 | 已完成 | [主编辑态](design/y-note-editor.png) · [Diff 态](design/y-note-diff.png) |
| UI 浏览器验证 | 已完成 | 1440×900 渲染；大纲/Diff、源码/WYSIWYG、暗色模式切换正常 |
| Git 仓库初始化 | 已完成 | 本地仓库已初始化并提交；M1 实施前基线为 6 个提交（HEAD `8c23dea`）；已加入 `.gitignore` |
| M0 无损内核实现 | 已完成 | `src/source/`：FileEnvelope、SourceMap、SourceBuffer、S0–S5 补丁、投影、保存协议、原子写入 |
| M0 内核级测试 | 已完成 | 6 个内核测试文件 176 个测试 + 1 个编辑桥接测试文件 4 个测试，共 180 个通过；M1 后扩展到 8 个文件 187 个测试；M2 Git Diff 后为 189 个；`tsc --noEmit` 无错误 |
| M0 UI 级无操作验收 | 已完成 | 浏览器预览中打开演示文件 → 聚焦 → 源码/视觉切换 → 保存，SHA-256 前后一致且 `dirty=false` |
| React + Vite + Tauri 应用脚手架 | 已完成 | React 19.2.9、Vite 8.3.5、Tauri 2.12.4；前端生产构建与原生 debug 二进制构建均通过 |
| Tiptap 投影与编辑桥接 | 已完成 | `src/editor/`：sourceId schema、投影接入、增量 patch、选区提示回传；浏览器预览验证 |
| 文件打开与保存 | 已完成（原生窗口验收） | 真实 Tauri 窗口经原生文件选择框和 IPC 打开真实 `.md`，Tiptap 编辑 + Ctrl/Cmd+S 保存，Node 外部读取与 SHA 校验通过 |
| 草稿与最近文件 | 已完成（Windows 实机） | 草稿只写应用数据目录；强制结束进程后重启可恢复并保存；最近文件、工作区树和子目录文件打开已验证 |
| 所见即所得编辑 | 部分完成 | 段落、标题、粗体/斜体/删除线/行内代码、列表、引用、代码块、任务勾选已接入；表格结构编辑与图片插入仍只在源码模式处理 |
| 原生文件监听 | 已完成（Windows 实机） | Rust `notify` watcher 在真实窗口捕获外部写入与删除；保存前 SHA 校验仍为兜底；网络盘待验证 |
| 冲突态处置 | 已完成（Windows 实机） | 重新载入与保留本地在真实窗口通过；冲突保存不覆盖磁盘，删除文件后可重建 |
| 自动化 E2E | 已完成（浏览器 + 原生窗口） | 8 条 Playwright 浏览器 E2E + 64 项 Windows/WebView2 原生验收 + 12 项强制退出草稿恢复验收 |
| M2 只读 Git Diff 首切片 | 已完成（Windows） | Rust `read_git_diff` + 改动面板 Git/未保存双视图；原生窗口上面板状态、numstat、hunk、分支与 HEAD 均与 `git` CLI 一致；未保存编辑不进入 Git 差异 |
| 三平台原生验证 | 未开始 | 尚无 macOS、Linux 安装包或实机结果 |

## 2. 已完成阶段：产品与架构设计

完成时间：2026-10-31

已确定的核心决策：

- Tiptap 负责编辑与排版，不承担整份 Markdown 文件的序列化权威。
- 使用 SourceBuffer 保存原始文本，使用 SourceSpan 映射最小源区间。
- 保存采用局部补丁，禁止全文 `getMarkdown()` 覆盖原文件。
- 未编辑块保持字节不变，保留原始定界符、表格空格、编码、BOM 和 EOL。
- 默认草稿恢复不写仓库，只有显式保存或用户主动开启的自动保存才写原文件。
- 无法可靠映射的内容安全降级为局部源码编辑。
- UI 采用活动栏、文件栏、编辑区、上下文面板的桌面布局，提供明暗主题和只读 Git Diff。

验收证据：

- 技术方案已覆盖数据模型、事务分级、原子保存、性能、安全、测试与发布门槛。
- UI 稿无外部资源依赖，脚本语法检查通过。
- 两张 1440×900 PNG 已导出并重新读取检查。

## 3. 里程碑总览

| 里程碑 | 目标 | 状态 | 完成前提 |
|---|---|---|---|
| M0 无损内核证明 | 证明局部编辑不会产生全文格式差异 | 已完成 | 干净 Diff 合同、自动化测试与 UI 级无操作验收全部通过 |
| M1 可用本地编辑器 | 打开、编辑、保存真实 Markdown 文件 | 已完成（Windows）：全部退出条件与自动化验收通过；macOS/Linux 未验证 | 核心编辑闭环、恢复和冲突保护通过端到端验证 |
| M2 Git 可观察性与性能 | 看清真实修改，满足长文档性能预算 | 进行中：只读 Git Diff 已完成；Worker、虚拟化、性能与三平台未开始 | 只读 Diff、长文档与三平台压力测试通过 |
| M3 视觉完善与发布 | 形成可分发的跨平台桌面产品 | 未开始 | UI、可访问性、安装包和发布检查全部通过 |

目标日期待项目排期后补充，不在没有估算依据时承诺日期。

## 4. M0：无损内核证明

**优先级最高。先证明保存机制，再扩张编辑功能。**

### 范围

- 建立独立的 TypeScript 内核与测试环境，不依赖完整 UI。
- 实现 FileEnvelope，首轮支持 UTF-8、UTF-8 BOM、LF、CRLF 和末尾换行保持。
- 实现 SourceBuffer、SourceSpan、区间完整性校验与原文指纹。
- 建立与 Tiptap 相同 `marked` 配置的源索引，无法映射时明确降级。
- 实现 S0–S5：视图操作不变、文本补丁、最小内联重建、最小块重建，并显式拒绝需要局部源码编辑的结构变化。
- 实现撤销/重做时的 SourceBuffer 同步。
- 建立 golden fixtures 与随机事务属性测试。

### 暂不包含

- 完整 React/Tauri 应用壳。
- 表格列操作、公式、图片和复杂拖放。
- Git 提交、推送、云同步和多人协同。

### 实现状态

完成时间：2026-10-31

运行环境：Windows 10.0.26200 x64，Node v22.23.2，TypeScript 5.9.3，Vitest 4.1.12，fast-check 4.10.2，marked 17.0.6。

| 模块 | 文件 | 已实现能力 |
|---|---|---|
| 文件外壳与编码 | `src/source/encoding.ts`、`Envelope.ts` | 严格 UTF-8、UTF-8 BOM、UTF-16LE/BE、gb18030 往返检测；LF/CRLF/CR/mixed 识别；末尾换行分类；SHA-256；有损解码标记只读 |
| 词法与源索引 | `src/source/lexer.ts`、`SourceMap.ts` | 与 Tiptap 相同 `marked` 默认配置；front matter、块/内联、表格、列表、引用、代码、HTML、引用式链接；绝对 UTF-16 偏移；gap 铺满原文；FNV-1a 指纹；完整性校验；歧义表格整块降级 |
| 可保存缓冲 | `src/source/SourceBuffer.ts` | `original/current`、根区间重排、局部重建、确定性 ID、修订号、脏区间、撤销/重做 |
| S0–S5 补丁 | `src/source/patch.ts` | 文本叶替换、内联粗体/斜体/删除线/行内代码、标题层级、列表标记、任务勾选、局部源码替换；S4/S5 显式拒绝并降级到源码编辑 |
| 投影 | `src/source/projection.ts` | 生成 Tiptap 形状的文档 JSON 与 `sourceId`，供 M1 接入 |
| 保存协议 | `src/source/save.ts`、`AtomicFile.ts`、`node-io.ts` | 未修改不写盘；磁盘 SHA 冲突检测；外部修改/文件缺失/只读分支；临时文件 + fsync + 原子 rename；保留权限；写失败不更新基线 |

可复现命令：

```bash
npm install --legacy-peer-deps --no-fund --no-audit  # npm 10 arborist 对 vitest 可选 peer 的解析问题
npm run check                                        # typecheck + 全部测试
npm test                                             # 仅测试
npm run typecheck                                    # 仅类型检查
npm run test:e2e                                     # Playwright 浏览器 E2E，使用本机 Edge
# 原生验收需先启动带 WebView2 CDP 的应用（另开终端）：
# WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri -- dev --no-watch
npm run test:native                                  # Windows 原生窗口 55 项验收
npm run test:native:draft:prepare                    # 强制退出草稿恢复：准备阶段
# 强制结束应用并重启后：
npm run test:native:draft:verify                     # 强制退出草稿恢复：验证阶段
```

最近一次结果（2026-11-01，M2 Git Diff 切片完成后复测）：`npm run check` 通过，8 个测试文件共 189 个测试通过；`tsc --noEmit` 无错误；`npm run build` 生产构建通过（JS 811.53 kB，gzip 253.12 kB，Vite 提示超过 500 kB 预算）。

### 退出条件

- [x] 打开、聚焦、切换视图、空保存后 SHA-256 不变。
  - 内核级：打开与空保存不改变字节，`tests/save.test.ts` 与各 fixture 的 no-op 测试均校验 SHA。
  - UI 级：浏览器预览中打开演示文件，聚焦编辑器，依次切到源码视图、切回视觉视图，再按 Ctrl/Cmd+S；基线、当前缓冲与磁盘 SHA 均为 `9d3b4a14c62b93e914fd92b9f725b81b0a776815abdd0eac8782d83dec77c634`，`dirty=false`，源映射问题数为 0。
- [x] 修改一个文本叶节点，所有未标记 dirty 的源切片逐字节一致。
  - 由 `tests/property.test.ts` 的随机编辑属性测试与 `tests/patch.test.ts` 的定点测试覆盖。
- [x] `__x__`、`* item`、`1)`、`~~~`、引用式链接和行尾两空格不被自动改写。
- [x] CRLF、UTF-8 BOM、末尾无换行及多空行保持。
- [x] 修改一个表格单元格不会重排整表空格。
- [x] 中文、组合 Unicode、重复 token 和嵌套块测试通过。
- [x] 无法映射的语料会安全降级，不产生猜测性写回。
- [x] 测试结果和可复现命令已记录。

### 已知限制

- 内核已在 M1 应用壳中接入真实 ProseMirror 事务；中文 IME 尚未专项验证。
- Node 参考实现与 Tauri Rust 实现均已存在且各有单元测试；Windows/Unix 的 rename、ACL 与故障注入尚未做原生演练。
- 表格中的代码竖线、转义竖线或缺失单元格会让整表安全降级为 raw 块（`table-degraded`），暂不支持按表格编辑。
- Setext 标题层级变更、列表标记宽度变更按设计返回 S4/S5，需要局部源码编辑，不会猜测性重写。
- 任务项取消再勾选时，原 `[X]` 大写样式不保证保留；当前写回 `[x]`。
- 尚未实现表格列操作、公式、图片资产处理、拖放和跨块合并。

## 5. M1：可用本地编辑器

### 范围

- 创建 React 19 + Tiptap 3.30.3 + Tauri 2 工程；使用 Node 22+（`engines >= 22`），Tiptap 使用 npm 发布包。
- 将设计稿实现为应用壳，接入真实 Tiptap 所见即所得编辑。
- 支持打开/保存单个文件、打开文件夹、文件树和最近文件。
- 支持段落、标题、强调、链接、列表、任务、引用、代码、表格和图片基础编辑。
- 支持局部源码模式、撤销/重做、IME、快捷键和草稿恢复。
- Rust 实现原子保存、文件监听、编码回写和外部修改冲突保护。
- 仓库内不生成会话、缓存、索引或持久备份文件。

### 实现状态

完成时间：2026-11-01（Windows 原生验收、浏览器 E2E、强制退出草稿恢复）；macOS/Linux 与表格结构/图片插入不在本次完成范围。

运行环境：Windows 10.0.26200 x64，Node v22.23.2，npm 10.9.8，TypeScript 5.9.3，Vitest 4.1.12，React 19.2.9，Vite 8.3.5，Tiptap 3.30.3，Tauri CLI/API 2.12.4（crate 2.12.5），Rust 1.98.0。

| 模块 | 文件 | 已实现能力 |
|---|---|---|
| 应用壳 | `src/App.tsx`、`src/ui/` | 活动栏、文件栏与最近文件、编辑区、大纲/源码差异面板、状态栏、明暗主题、全局快捷键、未保存退出提醒 |
| 平台网关 | `src/platform/` | 浏览器预览（内存文件 + localStorage 草稿/最近文件，不支持打开文件夹）；Tauri 网关（打开文件/文件夹、读写、SHA、草稿、文件树） |
| Tiptap 接入 | `src/editor/schema.tsx`、`project.ts` | sourceId 节点属性（`keepOnSplit=false`）、投影 JSON 载入编辑器、表格节点可渲染；图片扩展已注册但未提供插入入口 |
| 增量编辑桥 | `src/editor/bridge.ts` | 扁平块差异分派；S1 文本、S2 代码内容、标题层级、S3 行内标记/任务/列表标记；容器结构变化走 S4 顶层区间重建；无法安全映射时回滚并提示；块索引 + 偏移的选区提示往返 |
| 文件工作流 | `src/state/store.ts` | 打开、保存、最近文件、原生 watcher 外部修改检测、冲突保护与“重新载入/保留本地”、草稿恢复/丢弃、只读降级 |
| Tauri 后端 | `src-tauri/src/` | 临时文件 + fsync + 原子 rename、权限保留、SHA 冲突检测、文件缺失分支、草稿读写删除（应用数据目录）、工作区树、`notify` 文档目录监听与事件 |
| 自动化验证 | `tests/app-store.test.ts`、`e2e/editor.spec.ts`、`playwright.config.ts` | 7 条应用层集成测试；7 条 Playwright 浏览器 E2E |
| 原生验收工具 | `scripts/native-acceptance.mjs`、`scripts/select-open-file.ps1`、`scripts/close-open-dialogs.ps1` | M1 时 55 项 Windows/WebView2 原生验收，M2 扩展到 64 项，含真实文件选择框、Git 工作区/单点 Diff、Git 面板对照、文件树/最近文件、IME、撤销/重做与回滚 |
| 草稿恢复验收 | `scripts/native-draft-recovery.mjs` | prepare/verify 两阶段：编辑不保存 → 强制结束进程 → 重启 → 恢复草稿 → 保存，12 项通过 |

### 验证记录（浏览器预览）

以下结果来自 `npm run dev` 的浏览器预览，磁盘由内存注册表模拟；它们证明 UI 与内核逻辑，不等同于 Tauri 原生应用行为。

| 场景 | 结果 |
|---|---|
| 打开 → 聚焦 → 源码/视觉切换 → 保存 | 基线、当前缓冲与磁盘 SHA 均为 `9d3b4a14c62b…`，`dirty=false`，映射问题 0 |
| 源码编辑回投影 | 修改后视觉视图同步显示，映射问题 0 |
| 任务勾选 | `- [ ]` → `- [x]`，delta 0，映射问题 0 |
| 工具栏标题级别 | `#` → `##`，delta 2，映射问题 0 |
| 粗体开关 | 生成 `**本地优先**`；再次点击精确还原原文；选区 31..35 保持；无误报提示 |
| 列表 / 引用开关 | 写入 `- ` / `> ` 前缀；再次点击精确还原原文 |
| 段落末尾回车 | 源码不变，出现无 sourceId 的空段落；在其中输入后生成真实段落补丁 |
| 段中拆分与 Backspace 合并 | 拆分插入 `\n\n`；合并后恢复 910 字符，`dirty=false`，三处 SHA 相等 |
| 代码块内容编辑 | 仅围栏内文本变化，映射问题 0 |
| Ctrl/Cmd+S 保存 | 基线/当前/磁盘 SHA 一致，`dirty=false`，标题脏标记消失 |
| 外部修改冲突 | 保存被拒，`external='conflict'`，本地内容保留，磁盘 SHA 保持外部值；界面提示“磁盘文件已被外部修改，未写入任何内容。” |
| 浏览器 E2E：打开—编辑—保存 | Playwright 通过；保存后基线、当前缓冲与磁盘 SHA 一致，`dirty=false` |
| 浏览器 E2E：无操作保存 | 源码/视觉切换后按 Ctrl+S，基线、当前与磁盘 SHA 均不变 |
| 浏览器 E2E：冲突—保留本地 | 冲突保存不写盘；确认后本地内容覆盖磁盘，`external='none'` |
| 浏览器 E2E：外部修改—重新载入 | 清空缓冲区时保存不写盘；重新载入后源码等于外部内容，`external='none'` |
| 浏览器 E2E：撤销/重做 | 文本编辑后撤销恢复原文、重做恢复编辑；保存后磁盘与重做内容一致 |
| 浏览器 E2E：结构回滚 | 插入表格被拒绝，表格数量不变、源码不变、提示可见 |
| 浏览器 E2E：跨文档历史 | 打开第二篇文档后撤销不会回到上一篇的内容 |
| 浏览器 E2E：IME composition | CDP composition 提交“中文”无丢字，选区在末尾，映射问题 0 |
| 应用层集成测试 | 7 条通过：保存、外部变更、脏缓冲冲突、保留本地（确认/取消）、删除后重建、草稿恢复不写盘、epoch 单调性 |

### 验证记录（原生窗口，2026-11-01）

在 Windows 上用 Tauri 2.12.5 原生窗口运行，通过 WebView2 CDP 驱动页面并调用真实 Tauri IPC；Git 验收使用临时仓库，结束后删除。`npm run test:native` 55 项全部通过。

| 场景 | 结果 |
|---|---|
| 原生文件选择框 | Win32 自动化设置文件名并确认，真实 `.md` 打开成功 |
| 打开真实 LF 文件 | 路径、源码、UTF-8/LF 识别一致；基线 SHA 等于磁盘 SHA |
| 默认闲置 / 无操作保存 | 等待和源码/视觉切换后保存均不改变磁盘字节，Git 工作区保持干净 |
| 单点修改的 Git Diff | 仅目标文件被修改，Diff 只有一个 hunk、一行删除和一行新增 |
| 草稿与 Git 工作区 | 草稿只写应用数据目录；丢弃草稿后 Git 工作区仍干净 |
| 工作区树与最近文件 | 原生读取文件夹树、展开子目录并打开文件；最近文件记录正确 |
| Tiptap 编辑保存 | 编辑写入磁盘；未编辑前缀与行数不变；无 `.ynote.tmp` 残留；基线/缓冲/磁盘 SHA 一致 |
| 原生 watcher 外部修改 | 真实外部写入后进入 `external-change`，提示可见 |
| 重新载入 | 缓冲区与编辑器均显示外部内容；不写磁盘 |
| 冲突 | 脏缓冲 + 外部写入进入 `conflict`；保存被拒、磁盘不变；保留本地后覆盖磁盘 |
| 文件删除 | 保存不重建文件；保留本地重建并写入本地缓冲内容 |
| BOM + CRLF + 无末尾换行 | 编码/EOL 识别正确；无操作保存字节不变；编辑后 BOM、CRLF 与无末尾换行保持 |
| 中文 IME composition | CDP composition 提交“中文”无丢字，选区在末尾，映射问题 0 |
| 撤销/重做与跨文档历史 | 撤销恢复原文、重做恢复输入；打开新文档后撤销不会回到旧文档 |
| 结构回滚 | 插入表格被拒绝，表格数量与源码不变，提示可见 |
| 只读文件 | 保存失败，原文件 SHA 不变 |
| 缺陷修复 | 修复重新载入 epoch 碰撞、重投影清空重做栈、跨文档历史污染；均加入回归断言 |

验收边界：文件选择框已通过 Win32 自动化；IME 使用 Chromium composition 协议模拟，真实系统输入法候选窗交互未自动化。

### 验证记录（强制退出草稿恢复，2026-11-01）

`prepare` 阶段编辑不保存，确认草稿写入应用数据目录且 Git 工作区干净；随后按 PID 强制结束进程，重启应用执行 `verify`。12 项全部通过：

| 场景 | 结果 |
|---|---|
| 进程退出后草稿仍在 | 应用数据目录中的草稿文件保留 |
| 重启后检测到草稿 | 打开同一文件后出现草稿恢复提示 |
| 恢复前磁盘与 Git | 磁盘仍是原文，Git 工作区干净 |
| 恢复草稿 | 缓冲区恢复未保存内容，磁盘仍未写入，Git 工作区不变 |
| 保存恢复内容 | 磁盘写入恢复内容，草稿文件删除，Git Diff 只有一行增删 |

自动化与构建结果：

- `npm run check`：8 个测试文件、187 个测试通过，`tsc --noEmit` 无错误。
- `npm run test:e2e`：7 条 Playwright 测试通过（本机 Edge 1440×900）。
- `npm run test:native`：Windows/WebView2 原生窗口 55 项通过；需先以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri -- dev --no-watch` 启动应用。
- `npm run test:native:draft:prepare` / `verify`：强制退出草稿恢复 12 项通过（两次运行之间需按 PID 结束并重启应用）。
- `npm run build`：生产构建通过；JS 805.57 kB（gzip 251.53 kB），Vite 提示超过 500 kB 建议拆包。
- `cargo test --manifest-path src-tauri/Cargo.toml`：6 个 Rust 单元测试通过（含监听过滤与真实文件变更通知）。
- `npx tauri build --debug --no-bundle`：原生 debug 二进制构建成功（`src-tauri/target/debug/y-note.exe`）。

### 退出条件

- [x] 用户可以打开真实 `.md`，进行所见即所得编辑并保存，再被其他 Markdown 工具正常读取。
  - 原生文件选择框与 Tauri IPC 均打开真实 `.md`，Tiptap 编辑、Ctrl/Cmd+S 保存，并用 Node 外部读取与 SHA 校验；原生验收 55 项通过。
- [x] 单点修改的 Git Diff 只包含真实变化及必要的结构影响。
  - 在临时 Git 仓库中单点编辑后仅目标文件变更，`git diff --unified=0` 只有一个 hunk、一行删除和一行新增。
- [x] 默认闲置和草稿恢复不会改变 Git 工作区。
  - 原生验收与强制退出恢复验收均确认：闲置、草稿保存、恢复草稿阶段 Git 工作区保持干净；草稿只写应用数据目录。
- [x] 写入失败不会破坏原文件，异常退出后可以恢复草稿。
  - 只读文件保存失败且原字节不变；强制结束进程后重启，12 项草稿恢复验收通过，保存后 Git Diff 只有一行增删。
- [x] 外部修改冲突不会被静默覆盖。
  - 原生窗口已实测 watcher 外部修改、冲突拒绝、重新载入与保留本地；删除文件后保存不重建，保留本地可重建；Rust 冲突拒绝测试与浏览器 E2E 同时通过。
- [x] 中文 IME composition 期间无丢字、跳选区或错误映射。
  - 在真实 WebView2 中通过 CDP composition 提交中文，无丢字、选区在末尾、映射问题为 0；真实系统输入法候选窗交互未自动化。
- [x] 主编辑流程端到端测试通过。
  - 7 条浏览器 E2E、7 条应用层集成测试、Windows 原生窗口 55 项验收与强制退出草稿恢复 12 项验收均通过；覆盖打开、编辑、保存、撤销/重做、回滚、文件树、最近文件、外部修改、冲突与草稿恢复。表格结构编辑与图片插入仍属已知限制。

### 已知限制

- 浏览器预览使用内存磁盘与 localStorage，不能代表真实文件系统、权限和 Tauri 行为；核心流程已在 Windows 原生窗口验收，macOS/Linux 尚未验证。
- 外部修改检测使用原生 `notify` watcher，监听当前文档所在目录并在 150 ms 防抖后校验 SHA；保存前 SHA 校验仍为兜底。Windows 实机已验证原子替换、删除与外部编辑，网络盘、特殊文件系统和其他平台待验证。
- 中文 IME 通过 Chromium composition 协议模拟验证；真实系统输入法（如微软拼音）的候选窗与组词交互尚未专项人工验收。
- 原生文件夹选择对话框未纳入自动化；工作区树读取、展开子目录与打开文件已通过原生 IPC 和 UI 验证。
- 撤销/重做历史在打开新文档、重新载入、恢复草稿或切换源码/视觉视图时重置；不跨文档或跨模式保留。拖放和键盘无障碍尚未专项验证。
- 表格节点可以渲染；表格结构编辑与图片插入仍只在源码模式处理，歧义表格整块降级。
- 跨块重组、列表标记宽度变化、Setext 标题层级变化等结构操作会回滚并提示，需要切到源码视图完成。
- 空段落（回车产生、尚无 sourceId）属于临时编辑态；在其中输入文字后才会写入源码，单独存在的空段落不会保存。
- 源码视图是纯文本 textarea，无语法高亮；无法映射的原始块通过源码模式编辑。
- “源码改动”面板是基线—当前缓冲的本地行级差异预览，不是 M2 的真实 Git Diff；M1 的 Git 契约已在外部临时仓库中验证。
- 设置与快捷键按钮目前只显示提示；暂无自动保存、多标签页和命令面板。
- 长文档性能未测量；生产构建存在 500 kB chunk 警告。
- Tauri CSP 仍为 `null`，capability 仅包含默认核心权限与 dialog；发布前需完成安全收紧。

## 6. M2：Git 可观察性与性能

### 范围

- 实现只读 Git 状态、当前文件 Diff 和块级变更说明。
- 区分内容变化与格式变化，不自动提交或推送。
- 将源索引和 Diff 移入 Web Worker，输入路径不执行全文解析或 IPC。
- 对昂贵 NodeView 做安全视觉虚拟化，保留完整 ProseMirror 文档语义。
- 建立 1 MB / 10,000 顶层块基准文档和三平台压力测试。

### 实现状态（只读 Git Diff 首切片，2026-11-01）

| 模块 | 文件 | 已实现能力 |
|---|---|---|
| Rust Git 只读后端 | `src-tauri/src/git.rs` | `rev-parse` 定位仓库根/分支/HEAD；porcelain 状态分类（clean/modified/staged/untracked/deleted/ignored/unborn/not-repo）；`git diff --numstat HEAD` 计数；unified diff 解析为 hunk、行号与增删行；二进制识别；4 MB / 200 hunk / 4000 行截断保护；Git 未安装与非仓库安全返回 |
| 平台与状态层 | `src/platform/types.ts`、`src/platform/tauri.ts`、`src/platform/web.ts`、`src/state/store.ts` | `readGitDiff` 网关；打开、保存、保留本地、外部变更和切换“改动”页时刷新；过期响应丢弃；浏览器预览返回 not-repo 状态 |
| 改动面板 | `src/ui/Inspector.tsx`、`src/styles/design.css` | “Git 差异 / 未保存改动”双视图；分支、HEAD、文件状态、增删统计与手动刷新；hunk 行号与增删高亮；not-repo/untracked/unborn/binary/error/clean 空态 |

验证记录（Windows 原生窗口，2026-11-01）：

- `npm run test:native` 64 项通过，其中新增 9 项 Git 面板断言。
- 保存后的面板状态为 `modified`，`+1/−1` 与 `git diff --numstat HEAD` 一致；hunk 数、分支与 HEAD 与 CLI 一致；渲染的增删行文本正确。
- 提交检查点后刷新，面板显示“与 HEAD 版本一致”；未保存的缓冲编辑刷新后 Git 状态仍为 clean、面板无差异行，确认只读 Git 视图不混入草稿。
- `cargo test` 13 项通过（新增 7 项：clean、modified、staged、untracked/deleted、not-repo、多 hunk 解析、零长度区间）。
- `npm run check` 189 项通过；`npm run test:e2e` 8 条通过；`npm run build` 通过（JS 811.53 kB，gzip 253.12 kB）。

尚未完成：

- 块级变更说明与“内容变化/格式变化”分类未实现；当前为 Git 行级差异。
- untracked/deleted/staged/binary/rename 和大差异截断的 UI 状态尚未逐一实机验收；Rust 层已有分类与解析测试。
- 非 UTF-8 文件的 diff 以 UTF-8 有损解码显示，尚未按源文件编码解码。
- Worker 源索引、NodeView 虚拟化、1 MB / 10,000 块性能预算与三平台压力测试未开始。
- Git 未安装、网络盘仓库与特殊文件系统的实机行为未验证。

### 退出条件

- [x] Diff 面板与真实 Git 源文件差异一致。
  - Windows 原生窗口已验证 modified/clean 状态与 CLI 的 numstat、hunk、分支和 HEAD 一致，并确认未保存编辑不进入 Git 差异；untracked/deleted/binary/rename 的文件级分类由 Rust 测试覆盖，UI 状态待扩验。
- [ ] 1 MB 文档首次可交互时间达到 `<1.5 s` 的实测预算，或明确记录未达标项。
- [ ] 主线程输入处理 P95 达到 `<16 ms` 的实测预算，或明确记录未达标项。
- [ ] 连续输入时无全文序列化、全文 Diff 和同步 IPC。
- [ ] 虚拟化不破坏选区、查找、撤销和焦点行为。
- [ ] Windows、macOS、Linux 的文件监听与长文档测试均有结果。

性能数字必须附测试环境、样本和可复现命令，不能把设计预算写成实测结果。

## 7. M3：视觉完善与发布

### 范围

- 完成设计稿中的明暗主题、面板折叠、空态、冲突态和命令面板。
- 完善键盘导航、读屏、焦点环、减少动态效果及 200% 缩放。
- 完成 Windows、macOS、Linux 原生标题栏和快捷键适配。
- 实现打印/PDF 导出，导出不得回写源文件。
- 构建三平台安装包，完成签名、更新和发布检查。

### 退出条件

- [ ] UI 关键状态与高保真稿一致，并通过设计走查。
- [ ] 正文与辅助文字满足 WCAG AA，核心流程可纯键盘完成。
- [ ] 三平台安装、启动、打开、编辑、保存和升级路径通过。
- [ ] Tauri capability、CSP、路径 scope 和外链策略完成安全检查。
- [ ] 所有干净 Diff 合同在三平台通过。
- [ ] 发布说明明确已知限制，无未披露的数据安全问题。

## 8. 下一步行动

M0、M1 已完成（Windows），M2 只读 Git Diff 已落地。继续完成 M2 其余范围，同时保留已披露限制的后续验证：

1. M2 剩余：块级变更说明与内容/格式分类、Worker 源索引、NodeView 虚拟化、1 MB / 10,000 块性能预算与三平台压力测试。
2. 扩展 Git 面板实机验收：untracked、deleted、staged、binary、rename、大差异截断与非 UTF-8 编码。
3. 在 macOS/Linux 重跑 64 项原生验收脚本与长文档测试；当前仅覆盖 Windows。
4. 用真实系统输入法（如微软拼音）人工验收候选窗、组词与选区；现有 IME 验收使用 Chromium composition 协议。
5. 按需补齐表格结构编辑与图片插入；当前仅单元格文字与源码模式可用。
6. 验证网络盘、特殊文件系统上的 watcher 事件行为。
7. M2 通过后进入 M3：设置、无障碍、CSP 收紧、三平台安装包与发布检查。

## 9. 当前主要风险

| 风险 | 应对方式 |
|---|---|
| `marked` token 与原文区间不能始终一一对应 | 顺序精确匹配、完整性校验、重复 token fixtures、失败时安全降级 |
| 表格中的竖线、转义或缺失单元格导致整表降级 | 已整块降级并给出 `table-degraded`，不猜测写回；后续增加真实表格语料再决定是否细化 |
| ProseMirror 事务跨块后 dirty 范围扩大 | 使用 StepMap 更新映射，重建最小共同父区间，禁止顺手格式化邻块 |
| 表格和嵌套列表产生隐性重排 | 独立单元格/列表项区间与专项 golden tests 已覆盖；已用真实 Tiptap 事务验证基础块编辑，表格编辑仍未开放 |
| Windows 与 Unix 原子替换语义不同 | Node 与 Rust 实现均有单元测试；发布前仍需三平台故障注入并确认权限保留 |
| 投影 JSON 与真实 Tiptap schema/扩展不一致 | 已接入真实 schema 与桥接回滚；继续补事务级 golden tests，不允许直接信任投影文本 |
| 长文档虚拟化破坏编辑器语义 | 只卸载昂贵视觉效果，保留完整 PM 文档和焦点附近节点 |
| 浏览器预览与 Tauri 原生行为差异 | Windows 原生核心流程与文件选择框已验收；继续覆盖真实系统输入法与 macOS/Linux |
| 原生 watcher 在原子替换、网络盘或特殊文件系统上的事件差异 | Windows 实机已验证原子替换、删除与外部编辑；继续验证网络盘、特殊文件系统与三平台 |
| UI 与 SourceBuffer 世代不同步导致编辑器保留旧内容 | 已改为全局单调 epoch 并加入应用层与浏览器 E2E 回归断言；继续关注重新载入/切换路径 |
| 撤销历史跨文档污染或重投影清空重做栈 | 每次文档加载使用独立 loadId 重建编辑器；内容已一致时跳过 setContent；已加入跨文档与撤销/重做回归测试 |
| 中文 IME 组合输入与增量映射冲突 | Chromium composition 验收通过；继续用真实系统输入法人工验收候选窗交互 |
| 结构编辑回滚造成用户困惑 | 回滚时明确提示并引导源码视图；逐步补齐高频结构操作 |
| Git 未安装、文件不在仓库或非 UTF-8 内容 | 返回 not-repo/git-unavailable 与明确空态，不影响编辑和保存；非 UTF-8 diff 暂按 UTF-8 有损显示，后续按文档编码解码 |
| Git diff 输出过大或仓库过大拖慢面板 | 只读按需刷新，限制 4 MB / 200 hunk / 4000 行并标记截断；Worker 化列入 M2 剩余范围 |
| “Git 差异”与“未保存改动”混淆 | 面板明确双视图：Git 仅比较磁盘与 HEAD，未保存缓冲单独展示；原生验收断言未保存编辑不进入 Git 差异 |

## 10. 更新记录

### 2026-11-01（M2 只读 Git Diff）

- 新增 `src-tauri/src/git.rs` 与 `read_git_diff` 命令：只读获取仓库根、分支、HEAD、porcelain 状态、numstat 计数，并把 unified diff 解析为带行号的 hunk；包含二进制识别与大输出截断保护，Git 缺失/非仓库安全降级。
- `DocumentGateway` 增加 `readGitDiff`；AppStore 在打开、保存、保留本地、外部变更和切换“改动”页时刷新，并丢弃过期响应。
- “改动”面板改为“Git 差异 / 未保存改动”双视图：展示分支、HEAD、文件状态、增删统计、刷新按钮、hunk 行号与空态；M1 的基线—缓冲预览保留。
- 扩展验证：Rust 测试 6 → 13，应用层测试 7 → 9，浏览器 E2E 7 → 8，Windows 原生验收 55 → 64（新增 9 项 Git 面板与 CLI 对照断言）。
- 原生窗口验证：面板 numstat、hunk 数、分支、HEAD 与 `git` CLI 一致；检查点后显示无差异；未保存编辑不进入 Git 差异。
- `npm run check`（189）、`npm run test:e2e`（8）、`npm run test:native`（64）、`cargo test`（13）与 `npm run build` 全部通过。
- 修复属性测试在空白段落上出现 0 个 paragraph 时仍取模索引的测试漏洞，连续 5 次随机运行通过。
- 按退出条件标记“Diff 面板与真实 Git 源文件差异一致”（Windows modified/clean 已对照 CLI）；M2 其余条件保持未完成。

### 2026-11-01

- 完成 M1 剩余验收：原生文件选择框（Win32 自动化）、Git 工作区与单点 Diff、中文 IME composition、撤销/重做、跨文档历史、结构回滚、工作区树与最近文件；Windows 原生验收 55 项通过。
- 强制退出草稿恢复：prepare/verify 两阶段 12 项通过，确认草稿只写应用数据目录；恢复后保存的 Git Diff 只有一行增删。
- 修复重投影清空重做栈：编辑器内容与投影一致时跳过 `setContent`；修复跨文档撤销污染：每次文档加载引入 `loadId` 并重建编辑器。
- 新增 `scripts/select-open-file.ps1`、`scripts/close-open-dialogs.ps1`、`scripts/native-acceptance.mjs`、`scripts/native-draft-recovery.mjs` 及对应 npm 脚本。
- `npm run check`（187）、`npm run test:e2e`（7）、`npm run test:native`（55）、草稿恢复（12）、`cargo test`（6）、`npm run build` 与 `tauri build --debug --no-bundle` 全部通过。
- 按退出条件标记 M1 完成（Windows）。表格结构编辑、图片插入、真实系统输入法候选窗与 macOS/Linux 验收作为已披露限制保留。

### 2026-10-31

- 初始化本地 Git 仓库并完成首批提交（6 个提交，HEAD `8c23dea`）。
- 完成技术方案、可交互 UI 稿和两张高保真导出图。
- 完成 UI 浏览器渲染与基础交互检查。
- 建立 M0–M3 里程碑及退出条件。
- 完成 M0 无损内核：文件外壳/编码、源索引、SourceBuffer、S0–S5 补丁、投影、保存协议与原子写入。
- 建立 6 个内核测试文件共 176 个测试，覆盖 golden fixtures、CRLF/BOM/UTF-16/gb18030、表格、列表、引用、Unicode、安全降级、保存冲突、原子替换和 fast-check 随机编辑/撤销重做。
- 创建 React 19 + Vite 8 + Tauri 2 应用壳，把设计稿落地为活动栏、文件栏、编辑区、大纲/源码差异面板和状态栏。
- 接入 Tiptap 3.30.3：实现 sourceId schema、投影载入、增量编辑桥、选区提示往返和无法映射时的回滚提示。
- 实现打开/保存、最近文件、草稿、只读降级、外部修改轮询与冲突保护；Tauri 侧实现原子写入、SHA 校验、草稿和工作区命令。
- 浏览器预览完成 M0 UI 级无操作验收与主要编辑闭环验证：无操作保存 SHA 不变；文本、标题、粗体、列表、引用、任务、代码块、拆分/合并均产生最小源补丁；冲突保存不覆盖磁盘。
- 新增 `tests/bridge.test.ts`（4 个选区映射测试），测试总数达到 7 个文件 180 个；`npm run check`、`npm run build`、`cargo test`（4 个 Rust 测试）与 `tauri build --debug --no-bundle` 全部通过。
- 限制示例文档只在浏览器预览中提供，避免桌面端保存时写入相对路径文件。
- 核对文档与仓库实际状态：修正 Git 已提交状态、Windows/Rust 版本、Node 版本要求和构建体积数字。
- 新增 Rust `notify` 文件监听（监听文档所在目录、过滤临时文件与访问事件、150 ms 前端防抖），以 Tauri 事件驱动外部修改状态；移除前端 3 秒轮询。
- 冲突提示新增“保留本地”，通过显式确认后用当前缓冲区覆盖磁盘；写入仍使用 SHA 前置校验和原子替换，并新增“重新载入”。
- 新增 `tests/app-store.test.ts`（应用层集成测试）和 Playwright 浏览器 E2E（3 条，使用本机 Edge），测试总数达到 8 个文件。
- 新增 `scripts/native-acceptance.mjs` 与 `npm run test:native`：通过 WebView2 CDP 驱动真实 Tauri 窗口，使用真实临时文件完成初始 27 项验收（后续扩展到 55 项），覆盖打开、无操作保存、编辑保存、BOM/CRLF/无末尾换行、只读失败、watcher、重新载入、冲突、保留本地和删除重建。
- 原生验收发现重新载入时 epoch 碰撞导致编辑器保留旧内容；改为全局单调 epoch，新增应用层回归测试并把浏览器 E2E 断言扩展到编辑器 DOM，测试总数达到 187 个。
- 修复 Rust 测试临时目录仅按纳秒命名的并行碰撞（加入进程内原子计数），`cargo test` 连续两次 6 项通过。
- 明确 M1 剩余门槛：原生文件选择框点选、中文 IME、草稿强制退出恢复演练、撤销/重做与桥接回滚交互，以及 watcher 在三平台/网络盘的行为（已于 2026-11-01 完成 Windows 部分）。

# Y Note 设计方案

> 本地优先的 Markdown 所见即所得编辑器  
> React 19 · Tiptap 3.30.3 · Tauri 2 · Windows / macOS / Linux  
> 状态：产品与架构设计，不代表编辑器本体已经实现

## 1. 产品目标

Y Note 直接打开本地 `.md` 文件。用户看到的是排版后的文档，磁盘上始终是普通 Markdown，不需要专有工程格式，也不在仓库中生成配置、缓存或备份文件。

核心承诺按优先级排列：

1. **数据安全**：任何解析失败、映射不确定或外部修改冲突都不得静默覆盖原文件。
2. **干净 Diff**：打开、移动光标、切换视图、保存未修改文档，输出字节必须完全不变；未触碰的源区间必须逐字节保留。
3. **真正的所见即所得**：标题、列表、引用、表格、图片、代码和公式在编辑位置直接呈现，不以“左侧源码 + 右侧预览”冒充 WYSIWYG。
4. **本地高性能**：输入路径不经过 React 重渲染、Rust IPC 或全文 Markdown 序列化。
5. **克制美观**：文档是视觉中心，工具默认退后；Git 状态清晰可见但不制造焦虑。

非目标：首版不做云同步、多人协同、Git 提交/推送、插件市场和全功能 IDE。

## 2. 最关键的技术决策

**Tiptap 是编辑与排版引擎，不是整份文件的序列化权威。**

本地 Tiptap 3.30.3 已提供 React 绑定和 `@tiptap/markdown`。其 `MarkdownManager` 在 `D:/code/tiptap/packages/markdown/src/MarkdownManager.ts:351` 将 ProseMirror JSON 序列化为 Markdown，在 `:382` 解析 Markdown。这适合导入、粘贴和生成新片段，但 AST 会丢失部分原始写法，不能用“全文 parse → 全文 serialize”保证字节稳定。

因此不复制 Typora 的 `.md-meta` DOM 方案，而采用独立的无损源层：

```text
原始字节（权威基线）
   │ 解码，不统一 EOL
   ▼
SourceBuffer ───────────────┐
原始文本 + 精确区间 + 原文指纹 │ 事务驱动最小补丁
   │                        │
   │ Markdown 投影           │ 仅新内容/必要片段序列化
   ▼                        │
Tiptap / ProseMirror ───────┘
   │
   ▼
React 仅渲染应用壳、面板和 NodeView
   │
   ▼ Ctrl/Cmd + S
Tauri Rust：字节比较 → 原子写盘 → 文件监听
```

### 明确禁止

- 保存时调用全文 `editor.getMarkdown()` 覆盖原文件。
- 打开文件时统一 LF/CRLF、去 BOM、补末尾换行或 trim 空白。
- 自动格式化全文、自动对齐表格、自动替换引号或 emoji 源码。
- 把会话、缓存、`.bak`、索引或应用配置写进用户仓库。
- 为了视觉虚拟化而删除 ProseMirror 文档中未显示的节点。

## 3. 无损文档模型

### 3.1 FileEnvelope：文件外壳

Rust 返回原始文件信息和解码文本；前端收到文本后不规范化换行。

```ts
type FileEnvelope = {
  path: string
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gb18030'
  eol: 'LF' | 'CRLF' | 'CR' | 'mixed'
  trailingBytes: 'none' | 'single-newline' | 'original'
  originalSha256: string
  source: string
  readOnlyReason?: string
}
```

首版必须完整支持 UTF-8 / UTF-8 BOM；其他编码通过 `encoding_rs` 解码与回写。无法无损往返的编码直接以只读源码模式打开。混合 EOL 不按多数派统一，换行保留在各源区间内；只有新插入的行沿用附近行的 EOL。

### 3.2 SourceBuffer：唯一可保存文本

```ts
type SourceBuffer = {
  original: string
  current: string
  roots: SourceSpan[]
  revision: number
}

type SourceSpan = {
  id: string
  kind: 'block' | 'inline' | 'delimiter' | 'raw' | 'gap'
  start: number       // JS UTF-16 offset，不使用 UTF-8 byte offset
  end: number
  contentStart: number
  contentEnd: number
  parentId?: string
  raw: string
  fingerprint: string
}
```

- `original` 是打开时的文本基线，`current` 是应用补丁后的内存文本。
- `gap` 覆盖块之间的空行和无法归属的字符，保证所有区间拼接后仍等于完整原文。
- ProseMirror 节点只保存 `sourceId`，原始字符串放在外部 SourceBuffer，避免复制/撤销时复制大段元数据。
- 粘贴产生的新节点不得复制旧 `sourceId`；事务后检查 ID 唯一性。
- 区间映射使用 ProseMirror `StepMap` 同步更新；撤销/重做同样经过 SourceBuffer，不另造一套内容状态。

### 3.3 源区间索引

以本地 Tiptap 相同的 `marked` 配置做词法分析，保留 `token.raw`，建立块与内联源区间。顶层 token 必须按顺序精确落回原文；空行、front matter、HTML 和不支持的扩展也要进入区间树。

解析器提供的是“定位信息”，原文切片才是事实。若 token 无法无歧义落回原文：

- 将该块降级为 `raw`；
- 使用 `contenteditable=false` 的 NodeView 展示；
- 用户可进入局部源码编辑，不允许猜测性重写。

不引入第二套 Markdown 语法解析器，避免 Tiptap 显示结构和源区间结构发生分歧。

## 4. 编辑与保存算法

### 4.1 打开

1. Rust 读取字节，记录 SHA-256、权限、编码、BOM，不修改文件。
2. 前端创建 SourceBuffer 和 SourceSpan 树，再投影为 Tiptap JSON。
3. 对 `parse → source projection` 做完整性校验：所有区间连续、无越界、拼接等于 `original`。
4. 未通过校验的文件进入安全源码模式，而不是尝试“修复”。

### 4.2 每次事务

事务先由 ProseMirror 正常应用，再由同步适配器计算最小变更范围。React 不参与每次击键的数据流转。

按以下顺序选择更新策略：

| 级别 | 场景 | 写回策略 |
|---|---|---|
| S0 | 选区、焦点、光标、视图切换 | 不改 SourceBuffer |
| S1 | 纯文本替换，节点与 mark 拓扑不变 | 按映射直接替换原始文本区间，保留所有定界符和邻接空白 |
| S2 | 粗体、链接等内联结构变化 | 只重建受影响的最小内联区间；沿用原定界符风格 |
| S3 | 标题层级、列表项、引用等块变化 | 只重建最小块/列表项，结构前缀来自原 `prefixRaw` |
| S4 | 跨块拆分、合并、拖放 | 重建最小共同父区间，并明确显示实际受影响行 |
| S5 | 不支持或映射歧义 | 局部源码编辑；拒绝自动写回富文本投影 |

示例：把 `这是 __重点__ 内容` 中的“内容”改为“正文”，只替换“内容”两个字符，`__重点__` 不参与序列化。把普通文本设为粗体时，仅在该文本两侧新增用户偏好的 `**`，其他文本不动。

### 4.3 特殊内容

- **表格**：记录每个单元格的内容区间。修改单元格只替换该区间，不重算列宽、不补齐分隔线空格；新增行复制最近行的标记风格。新增/删除列本来就影响多行，属于真实结构修改。
- **列表**：以列表项为最小单元，保留 `-`、`+`、`*`、有序列表起始数字、缩进和 checkbox 大小写。只有显式“重新编号”命令才能批量改数字。
- **代码/公式**：NodeView 负责高亮或渲染，保存始终读取其原始源码；渲染 SVG、高亮节点绝不进入 Markdown。
- **图片**：保留原 alt、URL、title 和引用式写法。本地图片只读预览，不在打开时改路径或复制资产。
- **富文本粘贴**：只有新插入片段允许规范化，默认弹层提供“保留 Markdown 源文本”选项。
- **链接与原始 HTML**：无法安全投影时作为原子块或局部源码，不用 HTML 中转后重写。

### 4.4 保存

1. 仅 `Ctrl/Cmd + S`、明确的“全部保存”或用户主动开启的自动保存才写原文件。
2. 默认自动恢复只写应用数据目录中的草稿，不写 `.md`，因此后台运行不会让 `git status` 变脏。
3. 将 `current` 按原编码/BOM 编码；与打开基线字节相同则直接返回“无需写盘”。
4. 写盘前比较磁盘 SHA-256。若外部已修改且当前也有修改，进入冲突界面，禁止覆盖。
5. 在目标文件同目录创建临时文件，写完并 flush 后原子替换；保留原文件权限。临时文件由操作系统清理，不作为持久备份留在仓库。
6. 保存成功后更新基线和 Git Diff；文件 watcher 忽略本次已知写入，不回灌编辑器。

## 5. 干净 Diff 合同

以下是必须自动化验证的产品合同，而不是“尽量做到”：

| 合同 | 验收方式 |
|---|---|
| 空操作稳定 | 打开、聚焦每个块、切换源码/WYSIWYG、保存，SHA-256 不变 |
|  untouched 稳定 | 修改一个文本叶节点，所有未映射为 dirty 的源切片逐字节相同 |
| 原样保留 | `__x__`、`* item`、`1)`、`~~~`、引用式链接、行尾两空格不会被偏好设置重写 |
| 文件外壳稳定 | CRLF、UTF-8 BOM、末尾无换行均保持 |
| 无后台污染 | 闲置 24 小时、自动恢复运行期间，仓库无新增/修改文件 |
| 表格稳定 | 改一个单元格，不触发整表空格重排 |
| 安全降级 | 无法映射的语法不会导致其他块被格式化 |

建议建立跨平台 golden fixtures：CommonMark、GFM、嵌套列表、混合标记、CRLF、BOM、末尾多空行、复杂表格、代码内伪 Markdown、重复 token、中文与组合 Unicode。每个 fixture 都执行 no-op round-trip 和单点编辑测试，再跑属性测试生成随机事务序列及撤销/重做。

注意：“干净 Diff”不等于任何操作都只允许改一行。拆分块、增删表格列等真实结构操作可以影响多行，但不得顺手格式化无关内容。

## 6. 应用架构

### 6.1 前端

```text
src/
├── app/                 # 窗口、路由、快捷键、命令面板
├── components/          # 应用壳与通用 UI
├── editor/
│   ├── Editor.tsx       # Tiptap 生命周期
│   ├── extensions/      # sourceId、原子块、Markdown 输入规则
│   ├── node-views/      # 表格、代码、公式、图片
│   └── transactions/    # 事务分类与 dirty span
├── source/
│   ├── SourceBuffer.ts
│   ├── SourceMap.ts
│   ├── patch.ts
│   └── projection.ts
├── stores/              # 文档壳状态；不保存每次击键的 React state
└── styles/              # design tokens、主题、打印
```

- 固定使用本地 Tiptap 对应版本 3.30.3，不混用不同版本的 `@tiptap/*` 包。
- 消费发布构建或 workspace package，不 fork 编辑器核心；源保真能力放在 Y Note 的适配层。
- 本地 Tiptap 根工程声明 Node `>=24`，参与其源码构建时对齐 Node 24+。
- React 使用 `useSyncExternalStore` 订阅低频壳状态；工具栏按选区事务节流更新，正文输入不触发文件树、Diff 和状态栏重渲染。

### 6.2 Tauri / Rust

```text
src-tauri/src/
├── document.rs          # 打开、编码、哈希、原子保存
├── watcher.rs           # notify 文件监听与写入去抖
├── workspace.rs         # 最近文件、目录权限、路径规范化
├── recovery.rs          # 应用数据目录中的加密可选草稿
└── git.rs               # 只读 status/diff，后续能力

commands: open_document, save_document, read_git_diff,
          watch_document, pick_file, reveal_in_file_manager
```

Tauri 2 capability 按最小权限开放。前端没有任意路径读写能力；所有路径经 Rust 规范化并限制在用户显式打开的文件/目录内。启用严格 CSP，不加载远程脚本；本地图片使用受限 asset scope。外链必须经系统浏览器打开。

### 6.3 数据位置

- 文档：用户原路径。
- 设置、会话、恢复草稿、日志：Tauri `app_config_dir` / `app_data_dir` / `app_log_dir`。
- 仓库内新增文件：**0**。

## 7. 性能设计与验收预算

以下是待实测的设计预算，不是当前产品的性能声明。参考场景为 1 MB / 10,000 个顶层块的 Markdown 文档：

- 主线程输入处理 P95 `<16 ms`，不在击键中做全文 parse、全文 diff 或 IPC。
- 首次可交互 `<1.5 s`，先显示首屏，再分帧建立非首屏装饰与只读 Git 信息。
- 保存主线程序列化成本与修改范围相关，而不是与全文长度相关。
- Markdown 源索引与 Diff 在 Web Worker 中执行；ProseMirror 视图和 DOM 仍在主线程。
- 大文档只虚拟化昂贵 NodeView 的视觉效果，保留完整 PM 文档、选区、查找和撤销语义；焦点、选区、查找命中附近禁止卸载。
- 图片懒解码，代码高亮按可视块调度；React 不为每个字符创建组件。
- 连续输入期间 Diff 延迟 500 ms 合并计算，Git 状态与文件监听事件去抖。
- Windows / macOS / Linux 分别跑长文档输入、IME、撤销、保存和文件竞争测试；中文 IME composition 期间不重映射选区。

## 8. UI 设计

高保真可交互稿见 `design/y-note-ui.html`，导出图见 `design/y-note-editor.png` 与 `design/y-note-diff.png`。

### 8.1 视觉方向

关键词：**纸感、专注、精密、安静**。不是开发者工具式的密集面板，也不是只有一张白纸的玩具编辑器。

- 主色：靛蓝 `#635BFF`，只用于当前项、焦点和关键操作。
- 文本：墨黑 `#202124`；次级信息 `#737781`。
- 背景：浅灰工作台 `#F4F5F7`，编辑器纸张 `#FFFFFF`。
- 成功：低饱和绿 `#23856D`；修改：琥珀 `#B7791F`；危险：红 `#C44545`。
- UI 字体：Inter（可离线打包）+ 系统中文无衬线；正文使用系统字体，代码使用 JetBrains Mono。
- 圆角：面板 10 px、按钮 7 px；阴影只用于浮层，不以重边框分割所有区域。
- 动效：120–180 ms，仅透明度和位移；遵循系统减少动态效果设置。

### 8.2 主窗口

1440 × 900 设计基准，最小窗口 960 × 640。

```text
┌ 标题栏：工作区 / 文件名       已保存 · Clean Diff        窗口控制 ┐
├ 56px 活动栏 ─ 244px 文件栏 ─ 弹性编辑区 ─ 280px 上下文面板 ┤
│ 文件       搜索/树            breadcrumb                    │
│ 大纲       最近/目录           轻量格式工具栏     大纲/改动   │
│ Git        工作区文件          750px 正文          块级状态    │
│ 设置                          任务/代码/表格      干净 Diff    │
├ 状态栏：Markdown · 行/列 · UTF-8 · LF · 仅本地 · 字数 ┤
```

- 活动栏提供文件、搜索、Git、设置，不使用多层彩色图标。
- 文件栏显示修改圆点和当前文件，不在树中塞满 Git 标签。
- 编辑区正文最大宽度 760 px，左右留白随窗口变化；焦点块左侧出现低对比块句柄。
- 工具栏只保留常用排版；其余通过 `/`、选区浮窗和命令面板完成。
- 右栏默认大纲，“改动”页显示基线、变更统计和逐块 Diff，提供“查看源 Diff”。
- 状态栏明确显示 `UTF-8`、`LF/CRLF` 和保存状态，让文件保真行为可见。

### 8.3 关键界面状态

1. **编辑态**：所见即所得正文，当前块有极浅背景，不显示 Markdown 定界符。
2. **改动态**：右栏展示“2 处内容修改 · 0 处格式改写”，Diff 只出现真实变化。
3. **源码态**：同一文档切换为等宽源码，不是另一个互相同步的编辑器；切回仍走无损投影。
4. **冲突态**：顶部出现非模态警告，提供“比较”“使用磁盘版本”“保留我的草稿”，没有直接覆盖按钮。
5. **空态/欢迎页**：打开文件、打开文件夹、恢复草稿；不强制创建账号。
6. **暗色模式**：同一层级语义，纸张为 `#18191C`，避免纯黑和高亮白字反差。

### 8.4 跨平台与可访问性

- 标题栏在 Windows 使用右侧窗口控制，在 macOS 保留左侧 traffic-light 安全区，Linux 跟随系统装饰能力。
- `Ctrl` / `Cmd` 由快捷键层映射；保存、粗体、斜体、搜索、源码、命令面板行为一致。
- 所有图标按钮有 tooltip 与可访问名称；正文和辅助文字达到 WCAG AA。
- 面板可折叠，窄窗口按“右栏 → 文件栏”的顺序收起；编辑器最小宽度优先保留。
- 完整键盘导航，焦点环不被视觉简化掉；触控板滚动不绑定自定义动画。

## 9. 实施顺序

### M0：先证明无损，不做漂亮外壳

- SourceBuffer、源区间、S0–S3 补丁和原子保存。
- no-op / CRLF / BOM / 标记风格 / 表格 golden tests。
- 任何一个核心合同失败都不进入功能扩张。

### M1：可用编辑器

- React + Tauri 应用壳、文件/文件夹、WYSIWYG、局部源码、撤销重做、草稿恢复。
- 常用块、图片、代码、表格、快捷键和外部修改冲突。

### M2：Git 可观察性与性能

- 只读 Git 状态、块 Diff、源码 Diff、长文档 Worker 与 NodeView 虚拟化。
- 三平台文件系统、编码、 watcher、IME 和压力测试。

### M3：视觉完善与发布

- 明暗主题、命令面板、打印/PDF 导出、安装包与自动更新签名。
- 导出永远是单独命令，不回写源文件。

## 10. 发布门槛

- 上述干净 Diff 合同在三平台全部通过。
- 断电/写入失败不会损坏原文件，恢复草稿可用。
- 外部修改冲突不会丢用户内容。
- 1 MB 文档达到第 7 节实测预算，或有明确、可接受的降级策略。
- 所有 UI 状态完成键盘、读屏、暗色和 200% 缩放检查。

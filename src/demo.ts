export const DEMO_SOURCE = `---
title: Clean by design
tags: [ymd, local-first]
---

# 让每一次修改，都只留下真实的差异。

Y Note 是一个本地优先的 Markdown 编辑器。它把优雅的所见即所得体验，和字节级可靠的 Git 友好保存结合在一起。原始源码是唯一事实，未触碰的内容不会因为光标经过而被重新格式化。

## 01 原始源码是唯一事实

编辑器不应该在保存时“重新理解”整篇文档。**Tiptap 负责编辑体验，SourceBuffer 负责文件真相。** 保存是源区间补丁，不是全文导出。

当用户修改一个段落，我们只更新这个段落对应的 \`SourceSpan\`。其他块没有进入保存管线，因此也不会产生意外的 Git 差异。

> __强调__、CRLF、BOM 和末尾空白均保持原样。
> 复杂结构无法安全映射时，会退回局部源码编辑。

- [x] 原始编码、BOM 与换行风格保持
- [x] 未编辑块永不重新序列化
- [ ] 复杂结构使用局部源码安全降级

## 02 最小编辑补丁

\`\`\`ts
export function saveDocument(document: Document) {
  if (document.isPristine) return NO_OP
  const patches = document.dirtySpans
  return applySourcePatches(patches)
}
\`\`\`

| 层级 | 策略 | 适用场景 |
| --- | --- | --- |
| S1 | 行内文本替换 | 普通输入 |
| S2 | 块内容替换 | 代码块 |
| S4 | 局部区域重建 | 新增段落、列表 |

## 03 原子保存与恢复

保存前会校验磁盘摘要，只有磁盘仍等于基线时才写入。冲突不会被静默覆盖，草稿保存在应用数据目录，不写入你的仓库。

---

本地优先 · Clean by design。按 Ctrl/Cmd + S 保存，按 Ctrl/Cmd + Shift + E 切换源码视图。
`

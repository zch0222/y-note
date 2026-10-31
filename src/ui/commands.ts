import { DEMO_SOURCE } from '../demo.js'
import type { AppStore } from '../state/store.js'

export interface CommandItem {
  id: string
  title: string
  detail?: string
  keywords: string
  shortcut?: string
  disabled?: boolean
  run: (store: AppStore) => void | Promise<void>
}

export function buildCommands(store: AppStore): CommandItem[] {
  const doc = store.doc
  const readOnly = Boolean(doc?.readOnly)
  const tauri = store.gateway.kind === 'tauri'
  const commands: CommandItem[] = [
    {
      id: 'open-file',
      title: '打开 Markdown 文件',
      detail: '选择本机文件并以无损方式打开',
      keywords: 'open file 打开 文件 markdown',
      shortcut: 'Mod+O',
      run: current => current.openFile(),
    },
    {
      id: 'focus-search',
      title: '搜索工作区文件',
      detail: '聚焦文件栏的搜索框',
      keywords: 'search find 搜索 查找 文件',
      shortcut: 'Mod+P',
      run: () => document.getElementById('file-search')?.focus(),
    },
    {
      id: 'save',
      title: '保存文档',
      detail: readOnly ? '当前文档为只读' : '按磁盘基线校验后原子写入',
      keywords: 'save 保存 写盘',
      shortcut: 'Mod+S',
      disabled: !doc || readOnly,
      run: current => current.save(),
    },
    {
      id: 'reload',
      title: '重新载入磁盘内容',
      detail: '放弃缓冲区内容并读取磁盘版本',
      keywords: 'reload 重新载入 刷新 磁盘',
      disabled: !doc,
      run: current => current.reloadFromDisk(),
    },
    {
      id: 'toggle-mode',
      title: store.mode === 'source' ? '切换到所见即所得' : '切换到源码视图',
      detail: '同一文档的另一种编辑视图',
      keywords: 'source visual 源码 所见即所得 切换',
      shortcut: 'Mod+Shift+E',
      disabled: !doc || (readOnly && store.mode === 'source'),
      run: current => current.setMode(current.mode === 'visual' ? 'source' : 'visual'),
    },
    {
      id: 'toggle-panel',
      title: store.panelOpen ? '隐藏上下文面板' : '显示上下文面板',
      detail: '大纲与改动',
      keywords: 'panel inspector outline diff 面板 大纲 改动',
      shortcut: 'Mod+Shift+D',
      run: current => current.togglePanel(),
    },
    {
      id: 'toggle-sidebar',
      title: store.sidebarOpen ? '隐藏文件栏' : '显示文件栏',
      detail: '工作区树与最近文件',
      keywords: 'sidebar files 文件栏 侧栏 工作区',
      shortcut: 'Mod+Shift+B',
      run: current => current.toggleSidebar(),
    },
    {
      id: 'outline',
      title: '显示文档大纲',
      keywords: 'outline 大纲 标题',
      disabled: !doc,
      run: current => current.setInspectorTab('outline'),
    },
    {
      id: 'diff',
      title: '显示源码改动',
      keywords: 'diff git 改动 差异 未保存',
      disabled: !doc,
      run: current => current.setInspectorTab('diff'),
    },
    {
      id: 'print',
      title: '打印 / 导出 PDF',
      detail: '通过系统打印对话框输出，不写回源文件',
      keywords: 'print pdf export 打印 导出 输出',
      shortcut: 'Mod+Shift+P',
      disabled: !doc,
      run: current => current.printDocument(),
    },
    {
      id: 'toggle-theme',
      title: store.theme === 'light' ? '切换到深色主题' : '切换到浅色主题',
      keywords: 'theme dark light 主题 深色 浅色 外观',
      run: current => current.toggleTheme(),
    },
    {
      id: 'settings',
      title: '打开设置',
      detail: '主题、动效与安全状态',
      keywords: 'settings preferences 设置 偏好',
      shortcut: 'Mod+,',
      run: current => current.openOverlay('settings'),
    },
    {
      id: 'shortcuts',
      title: '查看键盘快捷键',
      keywords: 'shortcuts keys keyboard 快捷键 键盘',
      shortcut: 'Mod+/',
      run: current => current.openOverlay('shortcuts'),
    },
  ]

  if (tauri) {
    commands.splice(1, 0, {
      id: 'open-workspace',
      title: '打开文件夹',
      detail: '浏览工作区中的 Markdown 文件',
      keywords: 'folder workspace 打开 文件夹 工作区',
      shortcut: 'Mod+Shift+O',
      run: current => current.openWorkspace(),
    })
  } else {
    commands.push({
      id: 'open-demo',
      title: '打开示例文档',
      detail: '仅浏览器预览可用',
      keywords: 'demo example 示例 演示',
      run: current => current.openDemo(DEMO_SOURCE),
    })
  }

  return commands
}

<p align="center"><img src="src/icons/better-tags.png" width="80" height="80" alt="Better Tags 图标"></p>

# Better Tags for Zotero

[English](README.md) · [下载安装包](https://github.com/Pigggggggggg/Better-tags-for-Zotero/releases) · [反馈问题](https://github.com/Pigggggggggg/Better-tags-for-Zotero/issues)

Better Tags 将 Zotero 左下方的标签栏替换为紧凑的标签导航面板。使用多层分组整理标签，直接筛选 Zotero 原有的文献列表，共用主界面的搜索框和 PDF 阅读器。

**版本 1.0.1 · 适用于 Zotero 10.0.x · 中文界面 · MIT 许可证**

## 安装

1. 在 [Releases](https://github.com/Pigggggggggg/Better-tags-for-Zotero/releases) 下载 `better-tags-1.0.1.xpi`。GitHub 自动提供的 Source code 压缩包不是安装包。
2. 打开 Zotero 的「工具 → 插件」，在齿轮菜单中选择「从文件安装插件…」。
3. 选择 XPI，完成安装。
4. 使用文献工具栏中的 Better Tags 图标或「工具 → Better Tags…」打开面板。

本版声明兼容 Zotero **10.0.x**，运行验证环境为 Windows。尚未独立验证 macOS、Linux；不声明兼容 Zotero 7/8/9。后续更新需要从 Releases 下载 XPI 手动安装，本版尚未配置自动更新发布。

## 使用

| 操作 | 效果 |
| --- | --- |
| 单击标签 | 切换到该标签，替换之前的标签及分组条件 |
| Ctrl 或 Alt＋单击 | 添加/取消单个标签；两次点击之间可以松开按键 |
| All / ANY | 所选标签全部满足 / 任一满足 |
| 整个文库 / 当前分类 | 切换标签筛选范围；默认整个当前文库 |
| Zotero 原生搜索框 | 在标签筛选基础上继续搜索文献 |
| 清空标签 | 移除标签条件，保留 Zotero 原生搜索内容 |
| 标签搜索框旁的 New | 新建标签分组 |
| 点击分组名 | 展开/收起；点击「筛选」查看该组及子组的标签并集 |
| 拖动分组名 | 调整同层分组顺序；子组和标签归属随之保留 |
| 分组旁的 ＋ / ⋯ | 新建子组 / 编辑名称、父分组和成员标签 |
| 右键标签 | 重命名标签或选择预设底色 |
| 整理所选 | 为 Zotero 列表中选中的条目批量添加/移除标签 |
| 常用组合 | 保存及恢复筛选组合 |

同一标签可加入多个分组。分组结构独立于标签名称，不需要给标签添加路径前缀。删除分组不会删除条目或原生标签。重命名标签会修改当前文库内的原生标签，并更新相应的分组及常用组合；合并到已有同名标签需确认。

标签按字母顺序排列，以浅色小标签展示；灰色数字为当前文库中带该标签的条目数量，不随其他标签交集缩减。右键可从预设色板选择底色，也可恢复自动配色。

批量操作支持撤销最近一次修改；检测到外部修改冲突时不会强行覆盖。只读文库不能修改原生标签，但可以设置本机分组和显示颜色。

## 按标题自动添加已有标签

在 Zotero 主列表选中条目，右键选择「按标题自动添加已有标签」。

- 只检查标题，只使用当前文库已有标签，不读取摘要、正文，也不创建新标签。
- 忽略大小写，识别常见英文单复数，并要求多词标签连续完整匹配。
- 标题含 `battery`：可添加 `battery`，不会因此添加 `Flow battery`。
- 标题含 `XXX Flow batteries`：可以同时添加 `battery` 和 `Flow battery`。
- 这是文字匹配，不是语义分析；不保证覆盖所有专业词汇、缩写或不规则词形。

## 显示和数据保存

面板嵌入 Zotero 左侧栏；调整分隔线后，缩放主窗口会保留面板占比。标签筛选不会默认展开每篇文献的附件和笔记，手动展开及 Zotero 原生文本搜索仍保留原有行为。图标在启动时预先固定尺寸，避免先显示大图再缩小。

插件复用 Zotero 原生标签，标签同步遵循 Zotero 自身设置。分组、颜色、常用组合和布局保存在本机 Zotero 配置中，不跨设备同步。不需要 API 密钥或开启本地 API。

插件 ID 保持 `tag-workspace@local.tools`。公开版 **1.0.1** 从内部最终版 **2.2.2** 重新编号，包含其最终功能，并非旧版浮窗界面。已安装内部 2.x 版本时，请直接从文件手动安装此版，不必先卸载；原有配置仍使用相同的存储位置。

## 开发与反馈

测试需要 Node.js 22 或更新版本；打包使用 Windows PowerShell 5.1 或 PowerShell 7，无需安装 npm 依赖。

```powershell
npm test
npm run build
npm run package:source
```

输出位于 `dist/`。完整开发说明见 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。提交问题时请附上 Zotero 版本、操作系统、Better Tags 版本和复现步骤；避免上传私人文库或未经检查的日志。

参见 [更新记录](CHANGELOG.md) 和 [MIT 许可证](LICENSE)。

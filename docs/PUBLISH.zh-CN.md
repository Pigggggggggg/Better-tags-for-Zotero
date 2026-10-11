# 上传 GitHub 与发布 1.0.1

目标仓库：https://github.com/Pigggggggggg/Better-tags-for-Zotero

本目录只准备本地文件，不会自动提交或发布到 GitHub。

## 1. 上传源码

把当前发布文件夹**里面的文件和目录**上传到仓库根目录，不要把 `Better-Tags-1.0.1-GitHub` 这一层也上传。可以更新现有 `README.md`；`LICENSE` 已沿用仓库现有的 MIT 原文，版权人为 Shuaifei。

需要上传：

- `src/`、`scripts/`、`tests/`、`docs/`。
- `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE`、`package.json`、`AGENTS.md`。
- `.gitignore`、`.gitattributes`；这些是点号开头的文件，注意一并上传。

不要上传 `dist/`、`test-runs/`、`node_modules/` 或日志。通过 Git 提交时 `.gitignore` 会排除它们；通过网页拖拽上传时，需要自己排除。

也可以解压 `dist/better-tags-1.0.1-source.zip`，上传其中 `Better-tags-for-Zotero` 目录内的全部内容。该 ZIP 已排除安装包、测试文库和日志。

## 2. 创建 Release

源码提交后，在仓库 Releases 中创建发布：

- Tag：`v1.0.1`，指向刚刚上传完整源码的提交。
- Title：`Better Tags 1.0.1`。
- 正文：复制下方的发布说明。
- 附件：上传 `dist/better-tags-1.0.1.xpi` 和 `dist/SHA256.txt`。

可选附件为准备好的 `dist/better-tags-1.0.1-source.zip`。GitHub 也会为版本标签生成源码归档；用户安装时应下载 XPI。

## 可复制的发布说明

Better Tags 1.0.1，将分组标签导航嵌入 Zotero 左侧栏，共用原生文献列表、搜索框和 PDF 阅读器。

- 支持 All/ANY 筛选、Ctrl/Alt 多选、嵌套标签分组和分组排序。
- 支持标签改名、预设配色、数量显示、常用组合及批量整理。
- 可根据条目标题自动添加当前文库已有标签，支持忽略大小写和常见英文单复数。
- 保留侧栏高度占比；修正筛选结果混入、附件默认展开及启动图标先大后小的问题。

适用于 Zotero 10.0.x，中文界面。运行验证环境为 Windows。

下载 `better-tags-1.0.1.xpi`，在 Zotero「工具 → 插件 → 齿轮 → 从文件安装插件…」中安装。本版采用手动更新。

本次公开版从内部 2.2.2 重新编号为 1.0.1。已安装内部 2.x 的用户请手动安装，不必先卸载；插件 ID 和原有配置存储位置保持不变。

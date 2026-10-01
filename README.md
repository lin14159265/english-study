# English Study · 语境阅读

基于 GitHub Pages 的 CET-4 词汇语境阅读器，保留原始 25 篇文章和 1000 个目标词，并支持 JSON 资料包导入与发布。

阅读时按需查用义、核对译文；学习工具提供历史语境检索、本机文章纠错、可选理解小测、阅读任务队列和学习备份。义项卡、错句和作答保存原文快照，正文更新后不删除旧记录。辅助功能按需打开，无阅读滚动进度条。

使用和格式约定见 [IMPORT.md](IMPORT.md)，生成新资料使用 [配套提示词](downloads/article-generation-prompt.md) 和 [完整示例](downloads/pack-template.json)。个人数据保存在当前浏览器；改文保存本机修订，导出后上传 GitHub 才公开更新。换设备用学习备份迁移。

静态 HTML / CSS / JavaScript，无依赖安装。运行检查：

```sh
node --test tests/*.test.cjs
```

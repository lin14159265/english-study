# 完整同步开发验收（2026-10-09）

本分支包括 PR #1 审核提交 `de67b75` 的全部修复。main 未修改，未部署正式站点，未创建生产 Firebase 资源或上传个人数据。源码与测试一同提交；配置默认为关闭云端。

| 验收 | 结果 | 实际范围 |
| --- | --- | --- |
| `node --test tests/*.test.cjs` | 215/215 | 包含原测试；存储、迁移、队列、三方合并、控制器、适配器和阅读锚点 |
| `tests/browser-acceptance.cjs` | 6/6 | 真实 Chromium：双标签页、缺失/延迟包、旧备份、消费者恢复、SW 更新和离线；原生 IndexedDB v2→v3 |
| `tests/reader-position-browser.cjs` | 5/5 | 真实 DOM 字符定位、重开、固定链接、续读、不同宽度/字号；390px 仍是桌面模拟视口 |
| `tests/cloud-browser.cjs` | 8/8 | 真实页面/控制器/原生 IndexedDB：完整恢复、自动双向、断网重连、两标签页、刷新失败锁定与重试、持久冲突、旧回执重开；认证/服务器为合成后台 |
| `tests/firebase-loader-browser.cjs` | 4/4 | 真浏览器首次失败重试、缓存后离线、损坏缓存恢复、官方 SDK 模块图共享 app |
| `tests/firebase-rules-emulator.cjs` | 5/5 | 实际 Firebase SDK 和 Firestore 模拟器：本人权限、不可变内容、原子 head/回执、1.43 MiB 私包及全状态、迁移/丢确认/新设备/双端合并 |

Chromium 为 153.0.8010.0；Firestore 模拟器用 Java 17、firebase-tools 13.35.1，应用 SDK 固定 13.0.0。模拟器控制器测试的本机存储为内存桩，原生存储由上述浏览器测试覆盖。所有测试数据合成且隔离，不替代真实 Google OAuth、生产 Firestore、安全规则发布或 Android/iPhone/平板验收。

## 大资料包成本

`tests/sync-benchmark.cjs` 在 Chromium 原生 IndexedDB 中使用 12 个合成私包，总计 21,023,450 UTF-8 字节（约 20.05 MiB），预热一次、各测五次。同一实现对比完整云端应用与仅上传回执确认：

| 本机阶段 | 中位耗时 | packs 全读 / 写入 | UI 重载 |
| --- | --- | --- | --- |
| 完整 `applySync` | 314.1 ms（304.3–334.0） | 1 / 12 | 1 |
| 仅回执 `confirmSync` | 146.1 ms（134.3–176.3） | 0 / 0 | 0 |
| 普通本机保存（单次） | 2.1 ms | 0 / 0 | 0 |

仅回执仍需原子写入完整已确认基线，因此不是零成本；普通本机保存不读取或重写大同步快照。计时包括事务及必要页面确认，不含 `readSync`、flight 构造、网络和 Firestore 成本；这不是历史版本对比，也不是手机性能结果。真正云端业务变化继续完整应用，避免为优化牺牲一致性。

## 上线前剩余事项

1. 本人从正式网站导出完整 version 1 JSON，并在隔离 origin / 浏览器个人资料恢复验证；确认后才合并发布。
2. 本人创建 Spark 项目、配置 Web 应用/Google/Firestore，并将本人 UID 同时配置到网页与安全规则。见 [firebase-setup.md](firebase-setup.md)。
3. 在独立 HTTPS 测试 origin 和独立测试项目完成实际 Google 登录、手机网络、后台保存与全部记录双向验收。见 [cloud-sync.md](cloud-sync.md) 的操作顺序。

main 的 Pages 发布历史表明合并可能直接触发上线，不能把合并当作单纯审查操作。生产未启用前，不宣称正式网站已完成可用云同步。

回退先关闭 Firebase 配置并更新 SW 资源版本，保留 v3 存储层；旧 v2 存储层不能直接打开已升级数据库。保留 JSON 备份、不可变云端历史、回执和待同步队列，绝不删除数据库降级。

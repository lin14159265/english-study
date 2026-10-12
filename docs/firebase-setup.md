# Firebase 启用步骤

本网站保留 GitHub Pages 和本地 IndexedDB。代码完成不代表生产云端已经启用；需要你创建项目、授权 Google 登录、发布本人 UID 安全规则，并完成真机账号验收。不开通计费，不上传学习资料到公开 GitHub。

1. 打开 https://console.firebase.google.com/ ，创建项目，保持 **Spark 免费计划**；Analytics 可关闭。添加 Web 应用，复制 Firebase 的网页配置（apiKey、authDomain、projectId、appId；这不是服务账号密钥）。
2. **Authentication → Sign-in method → Google** 启用，选择项目支持邮箱。**Settings → Authorized domains** 添加 `lin14159265.github.io`（仅域名，无路径）；本地测试另加 `localhost`。不打开其他登录提供商。
3. **Firestore Database → Create database**，选择 Standard edition、生产模式和合适地区。不要采用临时公开测试规则，不创建 Storage bucket，不启用 Blaze。
4. 将网页配置填入 `firebase-config.js` 的 `window.ENGLISH_STUDY_FIREBASE`；`allowedUid` 初次留空。登录按钮预加载 SDK 后才启用。使用本人 Google 账号登录，这时只允许认证、显示 UID，**不读写 Firestore**。在 **Authentication → Users** 复制该用户 UID。
5. 将同一个 UID 填入网页配置 `allowedUid` 和 `firestore.rules` 的 `REPLACE_WITH_YOUR_UID`。在 Firestore **Rules** 粘贴规则并点击发布。规则只允许该 UID 的 Google 登录用户访问本人路径。Firestore **Indexes → Single field** 对 collection group `chunks` 的 `text`、`manifests` 的 `chunks` 禁用索引；或使用 CLI 一次发布规则和索引：`firebase deploy --only firestore --project 项目ID`。该命令不部署 GitHub Pages。
6. 在每个已有数据的设备先导出并验证完整 JSON 备份。启用配置后，先在隔离网站登录、观察首次合并；全新浏览器登录后核对私人包、修订、学习历史、回退快照，再验证双向同步和离线恢复。正式发布前必须确认备份已完成。

网页配置示例（使用控制台实际值；不复制服务账号 JSON）：

```js
window.ENGLISH_STUDY_FIREBASE = {
  apiKey: '来自 Web 应用配置',
  authDomain: '项目ID.firebaseapp.com',
  projectId: '项目ID',
  appId: '来自 Web 应用配置',
  allowedUid: 'Authentication 用户 UID'
};
```

## 手机登录与网络

GitHub Pages 使用 Google 弹窗登录，手机必须从 Safari/Chrome 正常浏览器打开并允许弹窗，不能依赖微信内嵌浏览器。首次 SDK 下载需要网络；SDK 不能加载或 Google/Firebase 在当前网络不可达时，本地阅读继续可用，云同步保持待重试。手机网络环境需要实际验收。

SDK 加载先用可重试的 fetch 下载固定官方模块，再构造本次唯一的 Blob 模块图，避免 Chromium 永久缓存失败的 import URL，导致恢复网络后仍无法登录。Auth 和 Firestore 共享同一个 app 模块注册表。下载成功的公开 SDK 源码可放入独立 CacheStorage，支持下次离线打开；该缓存不含账号凭据或学习数据，缓存损坏会删除后重新下载，不影响 IndexedDB。

不要把 `authDomain` 擅自改成 `lin14159265.github.io`。Firebase 官方说明 Safari 等浏览器的跨站存储限制会使普通跨域 redirect 失败。当前默认 popup；只有实现官方同域 auth helper / 反向代理并验证后，才设置 `redirectReady: true` 启用 popup-blocked 的 redirect 回退。GitHub Pages 本身不能提供反向代理。

## 存储、配额与恢复

所有私人成分在 Firestore 内按不超过 180 KiB 的 UTF-8 JSON 内容分块，SHA-256 校验；每个状态顶层字段和资料包独立成分，清单也分块。阅读变化复用资料包块。每次拉取仍从服务器检查 head；同一版本只读 head，版本变化后复用同账号会话中已校验的不可变成分，避免重复下载私人包。缓存有内存上限，退出、换账号、关闭适配器即释放；从未知缓存或新设备读取必须重新校验。head 和不可变 operation receipt 同事务提交，断网重试通过持久 receipt 幂等确认；后续设备更新 head 不会使旧操作重新提交。

Firestore 当前免费额度：1 GiB 存储、每日 50,000 读 / 20,000 写、每月 10 GiB 出站。此方案无需 Storage / Blaze，但免费额度并非无限；历史内容与 receipt 保留会累积，达到限制会停止云端提交并保留本地待同步记录，不自动扣费。暂不自动清理云端历史，未来清理必须保护所有现有引用与回退记录。需要真实数据量和频率验收后才能估算长期额度。

退出账号保留本地学习数据。回退客户端版本保留 IndexedDB、JSON 备份与云端不可变资料；不得用删除数据库或清空 Firestore 作为回退步骤。安全规则故障可关闭网页配置，继续本地学习，修正规则后重试。

## 可复现的本地安全规则验收

默认自动化测试包含 `tests/firebase-adapter.test.cjs`。额外的 `tests/firebase-rules-emulator.cjs` 使用真实 Firestore 模拟器和 Firebase modular SDK 测试规则；不接入生产项目。工具可装在仓库外，避免给静态网站引入 npm 构建：

```sh
npm install --prefix /tmp/english-study-firebase-qa firebase-tools@13.35.1 firebase@13.0.0 @firebase/rules-unit-testing@6.0.0
ENGLISH_STUDY_FIREBASE_MODULES=/tmp/english-study-firebase-qa/node_modules \
  /tmp/english-study-firebase-qa/node_modules/.bin/firebase emulators:exec \
  --only firestore --project demo-english-study \
  'node --test tests/firebase-rules-emulator.cjs'
```

该工具版本兼容本次环境的 Java 17，实际应用 SDK 固定 13.0.0。本次通过 5 组模拟器验收：非本人/匿名/非 Google 登录拒绝、超大块与不可变数据修改拒绝、head 和永久 receipt 原子版本提交、实际 SDK 大私人包与全部状态及回退快照恢复，以及实际控制器的首次迁移、提交后确认丢失、重开幂等确认、新设备完整恢复和双设备不同学习记录合并。控制器集成测试使用内存存储桩；真实 IndexedDB 和页面刷新由浏览器验收覆盖。以上没有替代实际 Google OAuth 和手机网络验收。

`tests/firebase-loader-browser.cjs` 是额外的真实 Chromium SDK 加载验收，覆盖首次 503 后同页面成功重试、模块注册表共享、缓存公开 SDK 后离线重开、损坏缓存自动恢复。设置 `ENGLISH_STUDY_CHROMIUM` 可指定已有 Chromium 路径；`ENGLISH_STUDY_QA_FIREBASE_SOURCES` 可指向本地下载的官方固定版本 `firebase-app-cdn.js`、`firebase-auth-cdn.js`、`firebase-firestore-cdn.js`，额外验证真实 SDK 图的 Auth/Firestore 共享 app。本次四组均通过。

官方参考（核查 2026-10-09）：

- https://firebase.google.com/docs/web/setup （当前 CDN SDK 固定 13.0.0）
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/security/rules-conditions

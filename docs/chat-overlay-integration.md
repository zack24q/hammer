# 最新版弹幕悬浮窗接入

2026-10-09 接入 upstream master `f94091413d50b0d53f666b6aa9d94b83b886b0c2`（上游 1.1.1；master 与 1.1.1 的差异仅 CI）。保留锤子主进程，编译上游最新 renderer/preload，采用新版 UI、事件组件、设置结构与默认值。

## 行为

- 控制台原有“打开弹幕悬浮框”入口启动新版窗口，通过锤子的事件桥接收弹幕。
- 新设置键 `overlay-settings`，认证字段 `serverBridgeAuthToken`；不迁移旧配置。
- 默认不置顶、不穿透；字体 20、背景透明度 80、最多保留 100 条消息。用户可在标题栏开启置顶和穿透。
- 采用最新富文本、表情、礼物、SC、舰长、抽奖/红包等事件渲染和自定义 CSS。
- 设置菜单、设置和关于弹窗打开时暂停穿透，关闭后恢复。Linux 配套标题栏感应窗口及 Escape 退出穿透。
- 保留窗口位置记忆与“防 OBS 捕获”开关，感应窗口同样使用内容保护。

## 主项目适配

`chat-overlay` 子模块保持上游原样，没有在子模块内修改代码。主项目只负责 Electron 窗口生命周期、原生 IPC、Linux 标题栏感应窗口、内容保护、外链协议校验和构建配置；这些适配位于根项目 `src/main/chatOverlay.ts`。

根构建补齐 Tailwind V4 插件、`@` 别名及新版依赖；TypeScript 更新到 6，满足上游事件类型包的 peer 依赖。整体发行许可证、上游归属、源代码交付规则与源码归档脚本已准备，尚未发布。

## 检查

运行 `npm test`、`npm run lint`、`npm run typecheck:overlay`、`npm run package`。详见 [测试说明](testing.md)。源码归档已解压到独立目录，`npm ci` 干净安装、96 项自动化测试和专门类型检查均通过。根项目 96 项自动化测试通过，ESLint 和专门类型检查通过，macOS ARM64 打包通过。`npm run test:overlay:desktop` 用实际锤子主进程、最新 preload/renderer、真实本地事件桥验证消息、设置及窗口生命周期，macOS 已通过。Linux 状态机由模拟 Electron 单元测试覆盖，Windows/Linux 的系统鼠标穿透及内容保护仍须实机验收。

之前升级过程中产生的子模块本地改动已丢弃；子模块工作树保持干净，仅记录上游提交。

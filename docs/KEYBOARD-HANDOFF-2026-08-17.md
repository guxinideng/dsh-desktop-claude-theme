# 键盘问题交接报告：发送/停止按钮后 iOS 键盘自动弹出

> 写给接手解决的 Claude Code / 其他 agent。本报告自包含，不依赖之前的对话上下文。
> 日期：2026-08-17。作者：DSH mobile 主题维护会话。

## 1. 问题现象（用户原话）

- 最初：「每次按发送的时候他会自动打开那个键盘很奇怪」
- 第一次修复后：「弹出来自己自动收回去了，体验感也不是很好。最好让它不要随便跳那个输入框，就是我只要不单点这个输入框，它就不要跳。」
- 第二次修复后：「你这次更严重了。原本它还会自动收回，现在它连收回都不收回了，只要我按那个发送按钮**或者停止按钮**，它就会跳出来键盘。」
- 第三次修复（readonly 锁）后：「行吧，但是这个问题咱还没有解决。」

**现状：用户手机上，点击「发送」或「停止」按钮后，iOS 键盘会弹出来（且不收回）。期望：只有用户主动点击输入框（或语音条的轻点打字）时键盘才出现。**

## 2. 环境

| 项 | 值 |
|---|---|
| 项目 | `dsh-desktop-claude-theme`（github.com/guxinideng，本地 `/Users/secondcomputer/Documents/Claude/Projects/dsh-desktop-claude-theme`） |
| 工作分支 | `claude/dsh-mobile-remote-control-a8o0af`（**最新代码在此分支的 `ce5b8fc`**；本地 `main` 停在 `b73f813`，勿在 main 上改） |
| dsh 服务 | `http://127.0.0.1:3080`（本机，DeepSeek Harness） |
| 网关 | `remote-gateway.js`，`127.0.0.1:3090`（launchd 服务，token：`6f205d80c63052f95e7271029427130b`，可 `?token=` 访问） |
| 手机访问 | iOS 26 独立模式（添加到主屏幕）：`https://deepseek.jiecaisongai.shop` → Cloudflare → VPS → autossh 回 Mac 网关 |
| 注入机制 | 网关把 `mobile.css` / `mobile.js` 注入 dsh 的 index HTML，URL 带 `?v=<mtime>` 缓存戳（改文件后手机刷新即生效） |
| 移动判定 | `window.innerWidth <= 640`（`mobile.js` 的 `isMobile()`） |

## 3. 相关代码（`mobile.js`，行号以 `ce5b8fc` 为准）

**键盘锁与 focus 处理区（约 1240–1320 行）：**

- `KEYBOARD_LOCK_MS = 1500`（1247）：**导航后键盘锁**——会话导航后 1.5s 内 composer 保持 `readonly`，readonly 的 textarea 在 iOS 上聚焦也不弹键盘。**这套机制被证明有效**（用户没抱怨导航后弹键盘）。
  - `touchstart` capture（1248–1258）：用户真实点击 `.uV2eYG_input` → 解除导航锁 + `readOnly = false`。
  - `focus` capture（1259–1271）：导航锁内 → `el.readOnly = true; el.blur()`。
  - `setInterval` 150ms（1272–1286）：锁内持续断言 `readOnly`（防 dsh 重渲染重置），锁外解除。
- `SEND_FOCUS_BLOCK_MS = 1500`（1300）、`let lastSendAt = 0`（1301）：**发送后键盘锁**（当前方案）。
  - `focus` capture（1303–1316）：`Date.now() - lastSendAt < 1500` → `el.readOnly = true; el.blur()`。
  - poll（1276–1284）已并入 `inNavLock || inSendLock`。

**语音相关：**
- `focusRealInputForTyping(overlay)`（1432–1441）：轻点语音条想打字 → `lastSendAt = 0; readOnly = false; input.focus()`。
- `bindSendButtonForVoiceRecall()`（2007–2024）：**事件委托**（document capture click，匹配 `.uV2eYG_primary`）→ `lastSendAt = Date.now()` + 400ms 后恢复语音 overlay。注意：dsh 的发送按钮和停止按钮共用同一个 `.uV2eYG_primary` 插槽（`aria-label` 在「发送消息」/「停止」间切换）。

**其他相关：** `.uV2eYG_input` 是 composer textarea（dsh CSS module 类名，hash 前缀可能随 dsh 版本漂移，本项目用完整类名硬编码）。

## 4. 三次修复迭代与结果（都未真正解决）

| 提交 | 方案 | 用户反馈 |
|---|---|---|
| `9199dac` | 发送按钮 click 后 400ms `blur()` | 键盘「弹出来又自动收回」（闪一下）——blur 太晚，键盘先弹了 |
| `b73f813` | focus guard：发送窗口 1.5s 内，非 trusted focus 事件 `preventDefault + blur`（依赖按钮实例绑定的 listener 记录 `lastSendAt`） | 「更严重了，连收回都不收回，发送/停止都弹」——两个可疑点：① 按钮绑定 listener 可能被 dsh 重渲染替换 DOM 而失效（`lastSendAt` 从未设置 → guard 从不触发）；② iOS 上 focus 事件的 `preventDefault` 拦截不可靠 |
| `ce5b8fc` | readonly 锁：委托监听发送/停止按钮 → 1.5s 内 input `readOnly + blur`，150ms poll 断言 | 「还是没解决」 |

**Electron 中 `ce5b8fc` 验证全部通过**：点击发送后 `input.readOnly === true`、activeElement 离开 textarea、1.5s 后解锁、再次发送重新上锁、点击输入框立即解锁。但真实 iOS 上键盘仍弹出。

## 5. 关键调查发现（Electron 中验证）

1. **dsh 发送后确实会程序化聚焦 composer**：填文字 → 点击发送按钮 → 发送后 `document.activeElement` 是 `TEXTAREA.uV2eYG_input`（输入框已清空）。
2. **Electron 环境限制**：`input.focus()` 在 Electron 中**不派发 focus 事件**（activeElement 变了但 capture listener 收不到任何 focus/blur 事件）——因此 Electron 无法完整模拟 iOS 的 focus 事件时序；只能验证 readonly 属性与 blur 的 DOM 效果，不能验证「dsh 的 focus 事件到达时 readonly 是否已就位」。
3. 键盘锁（导航后 readonly）机制在真实设备上有效——说明 **readonly 本身能压住 iOS 键盘**。

## 6. 未解疑问（readonly 锁为什么在真机没生效）

请接手者在真实设备上优先排查以下假设（按可能性排序）：

1. **时序：dsh 的 focus 发生在我们的锁设置之前**。若 dsh 的发送/停止处理绑定在 `pointerdown`/`mousedown`（而非 `click`），发送和聚焦会在我们 document-capture `click` 委托（`lastSendAt = now`）**之前**完成 → 锁根本没来得及上，键盘已弹出。**验证方法**：真机 Safari 远程调试（Mac Safari → 开发 → iOS 设备），在 `focus`、`pointerdown`、`click`、`readOnly` 变化上加日志，确认「键盘弹出时刻」与「readonly 就位时刻」的先后。
2. **锁被 dsh 重渲染清掉**：dsh 发送后清空 textarea/重渲染，可能重置 `readOnly`；poll 150ms 有窗口，若 dsh 在窗口内聚焦，键盘可能在这 150ms 内弹出一次（readonly 补上后键盘已出现，且 iOS 可能不会因 readonly 自动收起）。
3. **键盘弹起的触发源不是 `.uV2eYG_input`**：请确认真机上弹键盘时 `document.activeElement` 到底是谁（也许 dsh 聚焦的是别的输入元素，比如搜索框/设置项）。当前代码只锁了 `.uV2eYG_input`。
4. **缓存**：用户手机是否加载了最新 `mobile.js`（`?v=` 随 mtime 更新，若用户未刷新页面则还是旧版）。让用户删除主屏图标重加，或清 Safari 缓存后重试，先排除。

## 7. 建议的下一步（供接手者参考，非定论）

1. **真机取证优先**：iOS 设备连接 Mac，Safari Web Inspector 挂到 `deepseek.jiecaisongai.shop`，完整记录一次「点发送 → 键盘弹出」过程中：`activeElement` 变化、focus/pointerdown/click 事件顺序与 `isTrusted`、`.uV2eYG_input.readOnly` 的每一帧值。这能直接定位是「锁没上」还是「锁上了但键盘照弹」。
2. 若假设 1 成立（focus 早于 click）：把锁的触发点从 `click` 提前到 `pointerdown`/`touchstart` capture（在 dsh 任何处理之前），或改为 **focus 事件本身驱动**：记录「最后一次非用户手势 focus 的时间」，若 focus 发生前 300ms 内用户按过 `.uV2eYG_primary` 就置 readonly + blur。
3. 若假设 3 成立：把锁/拦截扩展到触发键盘的实际元素。
4. 备选思路：发送后 `input.blur()` 的同时把 `readonly` 保持 1.5s，并**监听键盘可见性**（`visualViewport` 高度变化）兜底：检测到非预期键盘弹出时强制 blur。

## 8. 验证环境速查

- Electron 测试（能验证 readonly/blur 的 DOM 效果，不能验证 focus 事件时序）：
  `env -u ELECTRON_RUN_AS_NODE PATH="/opt/homebrew/bin:$PATH" node_modules/.bin/electron <script>.js`，窗口 420×860，页面 `http://127.0.0.1:3090/?token=6f205d80c63052f95e7271029427130b`（gateway 注入最新 mobile.js；改文件后无需重启 gateway，`?v=` 自动变）。
- `mobile.js` 末尾有 `window.__dsVoiceDebug` 调试钩子（语音动画用）。
- 改完文件 → 手机刷新页面（或删主屏图标重加）验证。网关无重启需求（每次请求读文件）。
- 提交到 `claude/dsh-mobile-remote-control-a8o0af` 分支并 push。

## 9. 约束与铁律（项目既有）

- 只注入 CSS/JS 覆盖，不 fork dsh；不修改 dsh 源码。
- `mobile.js` 中 CSS module 类名（`.uV2eYG_input` 等）是 dsh 打包产物，hash 前缀可能随版本漂移。
- 页面移动端强制浅色主题；所有改动须保持该约束。
- 一次只改一个变量，每步在 Electron 验证，真机问题以真机取证为准（Electron 有 focus 事件盲区）。

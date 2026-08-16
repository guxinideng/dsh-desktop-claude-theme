# 工作单 · Opus 5 · 前端逻辑(2 项)

**先读 `00-共同须知.md`。**

**你独占的文件:`mobile.js`。** 不要改 remote-gateway.js(Sonnet 在用)、不要改 mobile.css(DeepSeek 在用)。

这两项是这批任务里**风险最高的**:都是拆掉现有机制换成另一套,不是加功能。改坏了会影响每一次输入和整个页面的响应性。

---

## 任务 1:键盘处理换成 visualViewport(方向性重构)

### 现状:一套"对抗式"机制

dsh 是桌面应用,会在会话切换、发送消息之后**自动 focus 输入框**——桌面上这很合理(接着打字),手机上却会把软键盘顶出来。

当前的应对方式是**想办法不让键盘出来**:

```js
const KEYBOARD_LOCK_MS = 1500;
const SEND_FOCUS_BLOCK_MS = ...;

// 每 150ms 一轮,反复把输入框设成 readonly 并强制 blur
setInterval(() => {
  const inNavLock = Date.now() - lastSessionNavAt < KEYBOARD_LOCK_MS;
  const inSendLock = Date.now() - lastSendAt < SEND_FOCUS_BLOCK_MS;
  if (inNavLock || inSendLock) {
    if (!input.readOnly) input.readOnly = true;      // 每 tick 重设
    if (document.activeElement === input) input.blur();
  } else if (input.readOnly) {
    input.readOnly = false;
  }
}, 150);
```

注释里写了为什么要每 tick 重设:"dsh may replace the textarea or reset its properties on re-render, and the readonly is what actually keeps the keyboard off — blur alone lost this race before."

也就是说:这是一场持续的竞速,靠高频轮询压制对方。

### 问题

```
visualViewport 使用次数: 0
```

`visualViewport` 是浏览器给移动端提供的**感知软键盘的标准接口**——键盘弹出时它的 `height` 会缩小,并触发 `resize` 事件。这套代码完全没用它。

方向是拧的:**手机思维应该是"监听键盘弹出,让布局让位",而不是"阻止键盘出现"。** 前者顺着系统走,后者一直在较劲,所以才需要锁定时长、readonly、150ms 重设这一堆补丁。

### 要做什么

用 `visualViewport` 重建这块:

1. 监听 `visualViewport.resize` / `scroll`,得到键盘实际占据的高度
2. 键盘弹出时让 composer 跟着上移、消息区相应压缩(而不是被键盘盖住)
3. **重新评估"阻止自动 focus"这件事还要不要做**——如果布局能正确让位,dsh 自动 focus 输入框在手机上其实是合理行为(用户切到一个会话,准备打字);现在之所以要压制它,是因为键盘一弹布局就乱

如果第 3 点成立,`KEYBOARD_LOCK_MS`、`SEND_FOCUS_BLOCK_MS`、readonly 重设、以及那个 150ms 轮询应该能**整体删掉**——这是这项任务真正的收益。

### 陷阱

- 布局让位不要靠改 `body` 高度(body 已经是 `position:fixed; height:100dvh`,是 mobile.css 定的,你不能改那个文件)。用 transform 或者给 composer 容器加 padding-bottom 这类不碰全局布局的方式
- iOS 上 `visualViewport.height` 变化和键盘动画不完全同步,可能需要配合过渡
- 语音输入的覆盖层就盖在输入框上(`.ds-mobile-voice-overlay`),它有自己的 tap/hold 手势判定。改动别破坏它——**tap 会调用 `input.focus()` 来唤起键盘**,这条路径必须继续работа
- 用户当前是"轻点打字、按住说话"的交互,tap 之后键盘必须能正常弹出

### 验收

- 真机上:点输入框 → 键盘弹出 → 输入框跟着上移可见,不被键盘盖住
- 切换会话 → 键盘不应该自己弹出来(如果保留这个行为的话)
- 发送消息 → 键盘行为符合预期
- 语音 tap → 键盘正常弹出

Browser pane 里模拟不了真实软键盘,所以这项**必须留一部分给真机验证**。你能在工具里验证的:`visualViewport` 监听器是否正确注册、resize 时计算逻辑是否正确(可以手动派发 resize 事件模拟)。诚实标注哪些验证过、哪些需要真机。

---

## 任务 2:轮询瘦身

### 现状:三个常驻定时器

页面静置、用户什么都不做时,仍有三个定时器持续跑:

```
150ms   键盘锁定检查        ← 每秒 6.7 次
1000ms  语音覆盖层绑定
2000ms  14 个 DOM 修正函数   ← 每个都做全文档 querySelector
```

2 秒那个每轮要跑这 14 个函数(括号里是定义位置):

| 函数 | 行 | 干什么 |
|---|---|---|
| `ensureDshExpanded` | 65 | 阻止 dsh 折叠侧边栏 |
| `observeDshCollapseState` | 93 | 监听折叠状态 |
| `hideDisabledSettingsNavTabs` | 113 | 隐藏设置里的模型/Agent预设标签 |
| `hideSettingsAgentPresetRow` | 136 | 隐藏 Agent 预设行 |
| `hideAddWorkspaceMenuItem` | 153 | 隐藏"添加工作区" |
| `stripDeepSeekPrefix` | 182 | 去掉模型名的 DeepSeek 前缀 |
| `observeModelLabel` | 199 | 监听模型名变化 |
| `syncThemeColor` | 235 | 同步 theme-color |
| `pinMobileToLight` | 254 | 锁定浅色主题 |
| `autoDismissWelcomeNotice` | 268 | 自动关欢迎提示 |
| `trimTurnStatusStats` | 309 | 精简轮次统计 |
| `syncTrajectoryTabStrip` | 336 | 同步轨迹标签条 |
| `relocateContextRing` | 355 | 移动上下文进度环 |
| `syncSettingsPanelHeight` | 543 | 同步设置面板高度 |

### 为什么是手机问题

桌面插着电、CPU 富余,这点开销无感。手机上持续的 JS 执行直接影响续航,而且和滚动、动画**共用主线程**,是卡顿的隐性来源。

### 要做什么

逐个判断,分三类处理:

1. **能改成 MutationObserver 的** — 大部分"隐藏某个元素""改某段文字"类的,本质是"DOM 出现时处理一次"。已经有几个函数名里带 `observe` 了,说明这个模式在这个文件里是成立的
2. **能改成事件驱动的** — 比如只在某个按钮点击后才需要检查的(文件里已有这种模式:点击 `.VOzbGW_trigger` 后 50ms 检查设置面板)
3. **确实只能轮询的** — 合并、降频

150ms 那个:如果任务 1 做成了,**大概率可以直接删掉**。

### 陷阱

- 这 14 个函数是一年多逐个加上去的,每个都对应一个真实的用户报告(注释里通常写了)。**改成事件驱动前要理解它当初为什么需要反复执行**——有些是因为 dsh 会 re-render 覆盖掉修改,这种改成"只执行一次"会退化
- dsh 的设置面板是 portal,每次打开都是全新挂载的 DOM,MutationObserver 要挂在足够高的层级才能捕获
- 别为了减少轮询把逻辑搞得比现在更难懂——如果某个函数改成事件驱动需要一堆额外状态管理,保留轮询更合理,在报告里说明

### 验收

- 静置状态下用 Performance 面板或 `console.count` 确认轮询频率真的降下来了
- 逐个确认原来那 14 个功能仍然生效(设置面板的隐藏项、模型名前缀、主题锁定等)——这个必须一项项过,不能只看"没报错"

---

## 建议顺序

先做任务 1(键盘),因为它可能直接消掉 150ms 那个轮询,做完之后任务 2 的范围会变小、也更清楚。

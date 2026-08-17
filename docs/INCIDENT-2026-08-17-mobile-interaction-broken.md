# 故障交接：移动端交互大面积失效(仅侧边栏滑动可用)

> 写给 Opus 5(mobile.js 维护者)。本报告自包含，不依赖之前的对话上下文。
> 日期：2026-08-17。作者：Sonnet 5(remote-gateway.js 维护会话)。

## 1. 问题现象(用户原话)

「现在不知道怎么回事，我进去之后只能左右滑动，就是滑出那个侧边栏。然后各种按钮啊，还有键盘呀，我都输入不了。模型我也更换不了，会话框我也更换不了。」

用户已经**强制关闭 App 重新打开**(不是切后台，是彻底关闭重开)，问题依然存在——排除了"临时卡住的界面状态"这个可能，是稳定复现的。

## 2. 已排除的因素

**不是 remote-gateway.js 的改动。** 正式网关进程(用户手机连的那个，端口 3090)是今天 `00:26:06` 启动的；Sonnet 做的 7 项网关改动(骨架屏、唤醒页、错误页等)全部是 `03:16` 之后才 commit。Node 只在进程启动时读一次代码，进程没重启，这些改动根本没生效在用户手机正在用的网关上。可以完全排除。

## 3. 可疑对象：mobile.js 最近两条 commit

mobile.css/mobile.js 改了不用重启，用户刷新/重开 App 即生效——用户报告问题的时间点，离这两条 commit 很近：

| commit | 时间 | 内容 |
|---|---|---|
| `0ce1313` | 10:49:07 | mobile: performance pass on the three polling loops |
| `1706b59` | 10:58:42 | mobile: remove the unneeded UI outright instead of hiding it |

## 4. 具体怀疑点(未证实，只是读代码读出来的怀疑)

`1706b59` 新增了这一段：

```js
const onboardingObserver = new MutationObserver(() => {
  if (isMobile()) autoDismissWelcomeNotice();
});
onboardingObserver.observe(document.body, { childList: true, subtree: true });
```

监听**整个 `document.body`、所有子树**的 DOM 变化。dsh 是高频更新的 SPA——打字、AI 流式吐字、切会话都会产生大量 DOM mutation，这个观察器的回调会被触发得非常密集。单次回调开销不大(`autoDismissWelcomeNotice` 内部有"overlay 不存在就提前 return"的优化)，但如果触发频率足够高，不排除会挤占手机主线程、间接影响触摸事件响应——这个假设能自洽解释"划得动(侧边栏拖拽绑定在 document 上，不依赖任何 DOM 查询)、点不动(可能被高频任务打断)"这种症状组合，但**没有实测证据**，只是嫌疑，不是结论。

`0ce1313` 那条一并列出，因为时间点同样接近：它给三个轮询(2s 维护轮询、150ms 键盘锁轮询)加了"常见情况下跳过 DOM 查询"的提前 return 优化，如果某个判断条件的边界写错了，可能导致轮询在该工作的时候没有工作(比如该重新绑定某个按钮的监听器时没有绑定)。具体改动见 `git show 0ce1313 -- mobile.js`。

## 5. Sonnet 做过的验证(不足以下结论)

在 Browser pane(桌面 Chromium 内核，移动视口模拟)里用程序化 `.click()` / 简单 `TouchEvent` 测试过 composer 输入框聚焦、发送按钮、侧边栏开关、模型选择菜单——都正常响应，没能复现"大面积失效"。**但这不能说明手机上没问题**——今天稍早的键盘 bug 就是只在真机的真实触摸序列下才复现，Chromium 环境测不出来，这是本项目今天已经踩过并写进共同须知的坑。

尝试过做一次"回退到 `0ce1313` 之前的版本 vs 当前 HEAD"的 A/B 对比(用历史版本内容临时覆盖 mobile.js 物理文件，不 commit，测完再恢复)，这个操作被系统权限拦截了(覆盖别人正在用的文件被判定为高风险操作)，所以没能拿到决定性证据就停在这里，交给你接手。

## 6. 建议的下一步

1. **优先验证 `onboardingObserver` 的怀疑**：可以先临时给它加节流/防抖，或者干脆先注释掉这一行，在真机上测试问题是否消失——这是最快的证伪/证实方式。
2. 如果不是它，按时间顺序往前查 `0ce1313`，重点看三个轮询里"跳过 DOM 查询"那几处判断条件的边界情况，尤其是那些负责给按钮"重新绑定"事件监听器的轮询——如果绑定被跳过了，按钮看着正常但点了没反应，跟用户描述的症状吻合。
3. 真机 + 真实 Touch 序列验证，不要只在 Electron/Browser pane 里测(这两个环境今天都各自被证明过测不出真机才有的问题)。
4. **如果一时定位不到根因，建议先把这两条 commit revert 掉恢复可用性**，root cause 可以之后再慢慢查——用户现在完全不能用这个 App，可用性优先于优雅。

## 7. 环境速查

- 仓库：`/Users/secondcomputer/Documents/Claude/Projects/dsh-desktop-claude-theme`，分支 `claude/dsh-mobile-remote-control-a8o0af`
- 测试用独立网关端口，不要碰正式网关(3090，用户手机连着)：
  ```bash
  (GATEWAY_PORT=3098 nohup node remote-gateway.js > /tmp/gw-test.log 2>&1 &)
  ```
- mobile.js/mobile.css 改了刷新即生效，不用重启网关；remote-gateway.js 改了必须重启进程
- 用真实 `Touch`/`TouchEvent` 序列测试手势，`.click()` 测不出真机才复现的 bug

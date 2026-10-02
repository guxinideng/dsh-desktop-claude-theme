[English](README.md)

# DSH Desktop

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的社区桌面外壳 + 暖色主题。

**非 DeepSeek 官方产品。** 这是一个个人重新皮肤项目:围绕 dsh 自身网页界面的 Electron 封装,配上暖色调米白/赤陶色主题、字体选择器、加宽的布局,以及一些交互细节调整(工具调用轨迹行降低视觉权重、轨迹视图标签翻译成中文)。全部通过 CSS 变量覆盖和 DOM 调整实现,建立在 dsh 现有网页界面之上——不 fork、不修改 dsh 本身。

## 下载

预编译好的安装包在 [Releases 页面](https://github.com/guxinideng/dsh-desktop-claude-theme/releases)——macOS 个人版、macOS 公开版、Windows 版都有。选之前先看下面的注意事项。

## 三种构建方式

**个人版**——你已经装了 `@deepseek-ai/dsh` 并且 `dsh web` 正在运行:

```bash
npm install
npm run build:personal
```

产出 `dist/personal/*.dmg`。体积小,因为不内置 dsh。

**公开版**——给什么都没装的人用。内置固定版本的 dsh,自动启动:

```bash
npm install
npm run build:public
```

产出 `dist/public/*.dmg`。体积较大(~350MB),因为内置了 dsh 本身。首次启动时,如果 `127.0.0.1:3080` 没有任何东西在监听,应用会自己启动内置的 dsh 实例(用 Electron 自带的 Node 运行时,所以接收方也不需要装 Node.js)。不内置任何 API key 或凭证——首次启动会提示填入接收方自己的 DeepSeek API key,跟直接装 dsh 一样。

**Windows 版**——同样的外壳和主题,移植到 Windows 上运行。不像 mac 公开版那样内置固定版本的 dsh,而是内置了 `npm`,首次启动时真的联网去装最新版 `@deepseek-ai/dsh`:

```bash
npm install
npm run build:windows
```

产出 `dist/windows/*.exe`(免安装单文件,直接运行)。首次启动需要联网去装 dsh;装好之后就直接复用,不会重复下载。这是拿 mac 公开版"离线可用、针对固定版本测试过"的优点,换成"始终最新版,但需要联网一次"——具体为什么这是个真实的取舍而非纯粹的升级,见下面"固定版本"那条注意事项。

不管哪种方式,应用本身是同一个;区别只在于 dsh 是否随包附带,以及附带的是不是这个主题实际验证过的版本。

## 不打包直接运行

```bash
npm install
npm start
```

需要 `dsh web` 已经在 `127.0.0.1:3080` 跑着。

## 现状 / 注意事项

- **macOS:仅 Apple Silicon。** Windows:仅 x64。没有 Intel Mac 或 ARM Windows 版本。
- **未签名。** 三个安装包都没有做代码签名或公证(这个项目背后没有 Apple 开发者账号,也没有 Windows 代码签名证书),所以 macOS Gatekeeper 首次打开会提示"身份不明的开发者"——右键→打开一次就能绕过。Windows SmartScreen 大概率也会有类似的"未知发布者"提示。
- **mac 公开版固定在 dsh `0.1.0-rc.6`;Windows 版永远装最新版。** 这个主题的实现方式是精确匹配 dsh 自己的 CSS 类名,而这些类名是构建时生成的哈希,dsh 每次发版都可能变。固定版本(mac)意味着测试过、稳定,但不会跟着 dsh 自动更新;始终最新版(Windows)意味着版本新,但如果 dsh 哪次更新了前端,主题可能会在毫无预警的情况下局部失效。如果想自己把 mac 版固定的版本号往上调,看 `scripts/vendor-dsh.sh`,调完记得重新检查一遍主题效果。
- **Windows 版还没有在真实 Windows 机器上跑过。** 这个项目是在 macOS 上交叉构建 Windows 版的,只做了静态验证(包内容、PE 资源、图标嵌入),没有做过真实启动测试。如果你发现问题,欢迎开 issue。
- 这里的视觉选择(配色、字体、布局宽度)是一个人的个人品味,写死在代码里。想要不一样的效果,从 `theme.css` 和 `font-picker.js` 改起。

## 安全须知(手机远程访问 / `remote-gateway.js`)

dsh 能在你的电脑上执行命令,所以**拿到网关 token 就等于拿到你这台机器的命令执行权**。

- `GATEWAY_TOKEN` 只放在 launchd plist 或进程环境变量里。**不要写进文档、README、聊天记录、截图,也不要写进任何 URL 示例**(文档里用 `<GATEWAY_TOKEN>` 占位)。URL 里的 `?token=` 会进浏览器历史、分享面板和各种代理日志。
- 用强随机值,例如 `openssl rand -hex 32`(纯十六进制:URL 里不会被转义,也和 `deploy/vps/` 里 nginx 按 `[a-f0-9]+` 取 cookie 缓存键的写法兼容)。不要用 base64(含 `+ / =`,放进 `?token=` 会被解析坏)。
- 首次用 `https://你的域名/?token=<GATEWAY_TOKEN>` 打开后,网关会换成 HttpOnly cookie 并立刻跳转到不带 token 的地址;老书签/主屏图标继续可用。换 token 后,旧书签和旧 cookie 立即失效,需用新 token 的链接打开一次。
- 没设置 `GATEWAY_TOKEN` 时,网关只接受来自本机的请求,经隧道/反代转进来的请求一律拒绝。
- 同一地址连续鉴权失败 20 次(5 分钟内)会被封 15 分钟。验证脚本:`node scripts/test-gateway-auth.mjs`。
- 一旦 token 出现在任何公开或共享的地方(包括 git 历史),视为已泄露:**轮换它**,而不是只删文件。部署快照 `deploy/` 里的 token、IP、SSH 端口一律是占位符,真实值只存在于本机。

## 许可证

本仓库中的代码采用 MIT 许可证——见 `LICENSE`。公开版中还内置了 DeepSeek Harness(MIT)和两款开源字体(SIL OFL 1.1);完整版权信息见 `NOTICE.md`。

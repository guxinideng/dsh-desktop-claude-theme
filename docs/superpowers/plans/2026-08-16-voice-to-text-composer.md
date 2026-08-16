# 输入框语音转文字 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** composer 输入框旁新增一个按住说话的麦克风按钮,录音通过 remote-gateway.js 转给本机 whisper.cpp 做转写,文字填入输入框待用户确认后手动发送。

**Architecture:** mobile.js 新增 MediaRecorder 驱动的录音状态机 → fetch POST 到 remote-gateway.js 新路由 `/__ds_theme/stt` → 网关用 ffmpeg 转码 + spawn whisper-cli 本地推理(Mac 本机,M5 芯片 + Metal GPU 加速) → 返回文字 → 前端用原生 setter 写入 React 受控的 textarea。全程不接触 dsh 源码,不接触 VPS。

**Tech Stack:** Node.js(remote-gateway.js 已用的 http/fs/child_process)、ffmpeg(已装)、whisper.cpp 的 `whisper-cli`(已装,Homebrew)、浏览器原生 MediaRecorder API。

**对应设计文档:** [docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md](../specs/2026-08-16-voice-to-text-composer-design.md)

---

## 关于验证方式的说明

这个仓库没有任何自动化测试框架(`package.json` 里只有 `electron`/`electron-builder`,没有 test script),历史上所有验证都是手动完成的:后端用 curl/命令行工具直接打,前端靠 Browser pane 模拟触摸序列 + 真机实测。这份计划延续这个模式,不引入新的测试框架——但每一步依然要有明确、可重复执行的验证动作和预期结果,不是"看着差不多就行"。

有一个技巧贯穿多个任务:用 macOS 自带的 `say` 命令做文字转语音,生成内容已知的测试音频,这样可以确定性地验证"转写出来的文字对不对",不用每次都靠人真的开口说话。

## 关于并发编辑风险的说明

`mobile.js`/`mobile.css` 当前正被另一个会话(dsh 内建的 DeepSeek 会话)实时编辑,做的是设置面板相关的改动。这份计划里对这两个文件的每一处改动都设计成**追加到文件末尾/独立代码块**,尽量不去改动文件中间已有的行——降低两边冲突的概率。但即便如此,**执行以下任何一个 Task 里涉及 mobile.js/mobile.css 的步骤之前,必须先重新 Read 一遍文件确认当前实际内容**,计划里给出的行号/上下文只是撰写计划时的快照,不能假设它还准确。改动一律用 Edit(局部替换),不用 Write(整篇重写)。

## File Structure

- **Modify:** `remote-gateway.js` — 新增 `/__ds_theme/stt` 路由 + 三个辅助函数(`readRequestBody`/`runCommand`/`handleStt`)
- **Modify:** `mobile.css` — 文件末尾追加麦克风按钮的三种状态样式
- **Modify:** `mobile.js` — 文件末尾(`})();` 之前)追加一段自包含的语音输入模块
- **Modify:** `.gitignore` — 排除本地模型文件目录
- **Create(非代码,下载产物):** `whisper-models/ggml-large-v3-turbo-q5_0.bin`

---

### Task 1: 准备 whisper 模型并验证基础调用链路

**Files:**
- Create: `whisper-models/` 目录(项目根目录下)
- Modify: `.gitignore`

- [ ] **Step 1: 排除模型目录,不进 git**

模型文件几百 MB,超过 GitHub 单文件 100MB 限制,而且没必要进版本控制。

Read `.gitignore` 当前内容,然后追加一行:

```
whisper-models/
```

- [ ] **Step 2: 创建模型目录并下载模型**

```bash
cd /Users/secondcomputer/Documents/Claude/Projects/dsh-desktop-claude-theme
mkdir -p whisper-models
curl -L -o whisper-models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Expected: 下载完成,文件几百 MB。验证:

```bash
ls -la whisper-models/ggml-large-v3-turbo-q5_0.bin
```

Expected: 文件存在且大小 > 100MB(不是 404 页面那种几 KB 的文件)。

- [ ] **Step 3: 用自带测试样本验证 whisper-cli + 模型能跑通(英文,只验证 pipeline)**

```bash
whisper-cli -m whisper-models/ggml-large-v3-turbo-q5_0.bin \
  -f /opt/homebrew/share/whisper-cpp/jfk.wav \
  -nt -np
```

Expected: 输出包含类似 "And so my fellow Americans, ask not what your country can do for you" 的文字(这是经典肯尼迪演讲片段,whisper.cpp 官方自带的标准测试样本)。如果这一步报错或输出乱码,先停下来排查(常见原因:模型文件下载不完整、GPU 初始化失败),不要往下走。

- [ ] **Step 4: 用 macOS 自带 TTS 生成中文测试音频,验证中文识别效果**

```bash
cd /Users/secondcomputer/Documents/Claude/Projects/dsh-desktop-claude-theme
say -v Tingting -o /tmp/ds-stt-test.aiff "今天天气不错,我们去公园散步吧"
ffmpeg -y -i /tmp/ds-stt-test.aiff -ar 16000 -ac 1 /tmp/ds-stt-test.wav
whisper-cli -m whisper-models/ggml-large-v3-turbo-q5_0.bin \
  -f /tmp/ds-stt-test.wav -l zh -nt -np
```

Expected: 输出文字与"今天天气不错,我们去公园散步吧"一致或高度接近(TTS 生成的语音很清晰,识别应该接近 100% 准确;如果识别结果明显不对,说明模型或语言参数有问题,需要先解决再继续)。

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "Ignore local whisper model directory"
```

---

### Task 2: remote-gateway.js — 新增 STT 路由

**Files:**
- Modify: `remote-gateway.js`

- [ ] **Step 1: 重新读取 remote-gateway.js 确认当前内容**

这个文件没有被并发编辑(只有 DeepSeek 那边在动 mobile.js/mobile.css),但仍按纪律先 Read 一遍确认行号没变。

- [ ] **Step 2: 顶部新增依赖引入**

找到文件顶部的:

```js
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
```

替换为:

```js
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
```

- [ ] **Step 3: 在配置区新增 STT 相关环境变量**

找到:

```js
const TLS_OPTS =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? { cert: fs.readFileSync(process.env.TLS_CERT_FILE), key: fs.readFileSync(process.env.TLS_KEY_FILE) }
    : null;
```

在它之后插入:

```js

// STT_MODEL_FILE  path to a ggml whisper.cpp model (default: bundled
//                 whisper-models/ggml-large-v3-turbo-q5_0.bin next to this
//                 file — see docs/superpowers/plans/2026-08-16-voice-to-text-composer.md)
// STT_WHISPER_BIN whisper.cpp CLI binary                       (default "whisper-cli")
// STT_TIMEOUT_MS  max time allowed for ffmpeg + whisper-cli     (default 30000)
const STT_MODEL_FILE =
  process.env.STT_MODEL_FILE || path.join(__dirname, 'whisper-models', 'ggml-large-v3-turbo-q5_0.bin');
const STT_WHISPER_BIN = process.env.STT_WHISPER_BIN || 'whisper-cli';
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS) || 30000;
```

- [ ] **Step 4: 新增 STT 处理函数**

找到 `function getCookie(req, name) {` 这一整段函数定义的**结束位置**(它后面紧跟着 `authMethod` 函数的注释),在 `getCookie` 函数和 `authMethod` 之间插入:

```js

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function runCommand(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Local speech-to-text: audio in, transcribed text out — see
// docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md for
// why this runs on the Mac (whisper.cpp + Metal) instead of a cloud API
// or the VPS (1 core / 1GB RAM, can't run a real STT model).
async function handleStt(req, res) {
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `dsh-stt-${id}.input`);
  const wavPath = path.join(os.tmpdir(), `dsh-stt-${id}.wav`);
  const outBase = path.join(os.tmpdir(), `dsh-stt-${id}`);
  const txtPath = `${outBase}.txt`;

  try {
    const audio = await readRequestBody(req);
    if (audio.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'empty audio' }));
      return;
    }
    fs.writeFileSync(inputPath, audio);

    await runCommand('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath], STT_TIMEOUT_MS);
    await runCommand(
      STT_WHISPER_BIN,
      ['-m', STT_MODEL_FILE, '-f', wavPath, '-l', 'zh', '-nt', '-np', '-otxt', '-of', outBase],
      STT_TIMEOUT_MS
    );

    const text = fs.readFileSync(txtPath, 'utf8').trim();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    console.error('[gateway] stt error:', err.message);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'stt failed' }));
  } finally {
    for (const p of [inputPath, wavPath, txtPath]) {
      fs.unlink(p, () => {});
    }
  }
}
```

- [ ] **Step 5: 接入路由**

找到 `requestHandler` 里这一段:

```js
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname in THEME_ASSETS) {
    serveThemeAsset(pathname, res);
    return;
  }

  touch();
```

替换为:

```js
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname in THEME_ASSETS) {
    serveThemeAsset(pathname, res);
    return;
  }

  if (pathname === '/__ds_theme/stt' && req.method === 'POST') {
    touch();
    await handleStt(req, res);
    return;
  }

  touch();
```

(STT 请求不依赖 dsh 进程,所以插在 `ensureDshReady()`/`proxy.web()` 之前直接 return,跟 dsh 是否已启动无关;`touch()` 顺手调用一下,语音输入也算用户活跃,不该被空闲计时器误判。)

- [ ] **Step 6: 语法检查**

```bash
node --check remote-gateway.js
```

Expected: 无输出(无语法错误)。

- [ ] **Step 7: 手动验证 —— 用真实网关进程 + curl + TTS 生成的音频**

先在一个终端里启动网关(不需要 dsh 在跑,STT 路由不依赖它;如果 3080 端口已经有 dsh 在跑也没关系,不冲突):

```bash
cd /Users/secondcomputer/Documents/Claude/Projects/dsh-desktop-claude-theme
GATEWAY_PORT=3099 node remote-gateway.js
```

另开一个终端:

```bash
say -v Tingting -o /tmp/ds-stt-test2.aiff "帮我写一封请假邮件"
curl -s -X POST --data-binary @/tmp/ds-stt-test2.aiff http://127.0.0.1:3099/__ds_theme/stt
```

Expected: 返回 JSON,形如 `{"text":"帮我写一封请假邮件"}`,文字与说的内容一致或高度接近。

再测一个异常路径 —— 空 body:

```bash
curl -s -X POST --data-binary "" http://127.0.0.1:3099/__ds_theme/stt
```

Expected: `{"error":"empty audio"}`,HTTP 状态码 400。

验证完毕后停掉这个临时网关进程(Ctrl+C 或 `kill` 对应 PID)。

- [ ] **Step 8: Commit**

```bash
git add remote-gateway.js
git commit -m "Add local whisper.cpp STT endpoint to remote-gateway.js"
```

---

### Task 3: mobile.css — 语音输入覆盖层样式

**改版说明(共三版,以第三版为最终实现):**
1. 最初是一个 34×34 小圆形按钮插进 `.uV2eYG_trailing` 工具栏。
2. 用户看过 mockup 后要求改成一个盖在输入框上方的整块区域——平时显示居中的静态声波图形(不写"按住说话"这类文字提示,图形本身就是入口),按住后波形跳动,松开后过渡到识别中,再到文字带动画浮现。参考了讯飞输入法"说话时呈现声音频谱动画"的做法,以及用户提供的真实 DeepSeek App 截图里输入框的配色感觉。这版做成了覆盖层整体不可点(`pointer-events:none`)、只有中间一小块"hit"区域可交互,外面的空白区域点击穿透到真实输入框。
3. 独立 spec reviewer 发现第 2 版有严重 bug——覆盖层大部分时间都盖在输入框上,用户完全没法手动打字。修复过程中用户又反馈:不想要"必须精确点在波形小图标上才能录音、点旁边才能打字"这种按位置区分的方式,而是想要"单击(点一下就松开)=呼出键盘打字,长按=录音"这种按压住时长区分的方式,跟很多聊天 App 的语音消息手势一致。第 3 版(当前实际生效的版本)据此重做:覆盖层重新变回整体可交互,不再有内外分离的 `.ds-mobile-voice-hit` 区域;交互判定逻辑挪到 mobile.js 里,靠 touchstart→200ms 计时器→touchend 谁先谁后来判断是 tap 还是 hold。

**下面的代码块保留的是第 2 版的样子(历史记录,不是最终态)** ——第 3 版的实际改动直接看仓库当前的 `mobile.css`/`mobile.js`,以及 commit `7901d48`("Rework voice overlay gesture: tap-anywhere-to-type, hold-anywhere-to-talk")的 diff,不在这里逐字重新贴一遍,避免文档和代码出现两份不一致的"权威版本"。核心差异:`.ds-mobile-voice-hit` 类被删除,相关样式规则(边框/背景/pointer-events)合并回 `.ds-mobile-voice-overlay` 本身,新增 `-webkit-touch-callout: none` 防止 iOS 长按菜单干扰长按手势。

**Files:**
- Modify: `mobile.css`

已确认的真实 DOM 事实(用 Browser pane 在真实 dsh 页面上实测):
- `.uV2eYG_input`(输入框本身)的直接父容器 `.uV2eYG_grow` 已经是 `position: relative`,这是覆盖层的天然挂载点,不需要额外处理定位基准
- composer 卡片布局很紧凑:输入框区域默认只有约 28px 高,工具栏行紧跟在下面(两者间距只有约 10px)。撑高整个 composer 有跟 dsh 自身 textarea 自动增高逻辑打架的风险,所以这版覆盖层做成贴合现有空间的紧凑样式,不强行撑高——效果不如早期 mockup 里那种更开阔的独立卡片,如果真机测试觉得局促,留到 Task 6 再看要不要做撑高方案
- 强调色(波形激活色、边框强调色)不写死具体色值,而是运行时从发送按钮 `.uV2eYG_primary` 的背景色读取,赋给一个 CSS 自定义属性——这样跟着当前实际生效的主题走,不会因为主题调整(这个仓库的暖色主题、或者以后可能的其它主题)而显得不搭

- [ ] **Step 1: 重新读取 mobile.css 确认当前内容和文件末尾**

按前面说的纪律,先 Read 一遍(它可能已经被 DeepSeek 那边改过),找到文件最后一行的实际内容,确认追加位置。

- [ ] **Step 2: 追加语音输入覆盖层样式到文件末尾**

在文件末尾追加(用 Edit,`old_string` 用文件当前最后几行的实际内容作为锚点,`new_string` 是那几行 + 以下新增内容):

```css

/* ── Voice-to-text input overlay ─────────────────────────────────────
   Sits on top of .uV2eYG_input (a real <textarea>) inside .uV2eYG_grow,
   which is already position:relative — so a plain absolute inset pins
   this layer exactly over the input, no extra positioning math needed.
   Stays inside the composer's existing ~28px-tall footprint rather than
   forcing it taller (that risks fighting dsh's own textarea auto-resize).
   --ds-voice-accent is set at runtime by mobile.js from the send
   button's own background color, so this tracks whatever theme is
   active instead of a color hardcoded here. See
   docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md */
.ds-mobile-voice-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: 10px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
}
body[data-ds-dark-theme] .ds-mobile-voice-overlay {
  background: rgba(0, 0, 0, 0.25);
}
.ds-mobile-voice-overlay.ds-mobile-voice-hidden {
  display: none;
}
.ds-mobile-voice-overlay.ds-mobile-voice-recording {
  border-color: var(--ds-voice-accent, #d85a30);
}
.ds-mobile-voice-wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 16px;
  transition: opacity 0.15s;
}
.ds-mobile-voice-wave span {
  display: block;
  width: 2.5px;
  border-radius: 2px;
  background: rgba(127, 127, 127, 0.55);
  transition: background 0.15s;
}
.ds-mobile-voice-overlay.ds-mobile-voice-recording .ds-mobile-voice-wave span {
  background: var(--ds-voice-accent, #d85a30);
  animation: ds-voice-wave 0.9s ease-in-out infinite;
}
@keyframes ds-voice-wave {
  0%, 100% { transform: scaleY(0.45); }
  50% { transform: scaleY(1); }
}
.ds-mobile-voice-busy-dots {
  display: none;
  font-size: 13px;
  color: rgba(127, 127, 127, 0.7);
  letter-spacing: 2px;
}
.ds-mobile-voice-overlay.ds-mobile-voice-busy .ds-mobile-voice-wave {
  display: none;
}
.ds-mobile-voice-overlay.ds-mobile-voice-busy .ds-mobile-voice-busy-dots {
  display: block;
  animation: ds-voice-busy-pulse 1s ease-in-out infinite;
}
@keyframes ds-voice-busy-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.9; }
}
.ds-mobile-voice-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 14px;
  color: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.ds-mobile-voice-overlay.ds-mobile-voice-done .ds-mobile-voice-text,
.ds-mobile-voice-overlay.ds-mobile-voice-error .ds-mobile-voice-text {
  opacity: 1;
  transform: translateY(0);
}
.ds-mobile-voice-overlay.ds-mobile-voice-error .ds-mobile-voice-text {
  color: rgba(200, 60, 60, 0.85);
}
.ds-mobile-voice-overlay.ds-mobile-voice-done .ds-mobile-voice-wave,
.ds-mobile-voice-overlay.ds-mobile-voice-done .ds-mobile-voice-busy-dots,
.ds-mobile-voice-overlay.ds-mobile-voice-error .ds-mobile-voice-wave,
.ds-mobile-voice-overlay.ds-mobile-voice-error .ds-mobile-voice-busy-dots {
  opacity: 0;
}
```

**关于错误状态(`ds-mobile-voice-error`):** 权限被拒绝、识别结果为空、网络/whisper 调用失败这三种情况,design 文档要求都要有明确提示,不能静默退回待机——复用 `.ds-mobile-voice-text` 这个文字层显示错误信息(比如"没有麦克风权限"/"没听清,再试一次"),颜色区别于正常转写文字,短暂停留后自动回到待机态。Task 4 的代码里会用这个状态。

- [ ] **Step 3: 语法/结构检查**

mobile.css 没有构建步骤,直接用浏览器加载验证就行,放到 Task 5 一起做真机/模拟验证。这一步先确认文件本身没有明显的括号不匹配:

```bash
node -e "
const css = require('fs').readFileSync('mobile.css', 'utf8');
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
if (open !== close) { console.error('brace mismatch:', open, 'vs', close); process.exit(1); }
console.log('braces balanced:', open);
"
```

Expected: `braces balanced: <某个数字>`,不报 mismatch。

- [ ] **Step 4: Commit**

```bash
git add mobile.css
git commit -m "Add voice-to-text overlay styles for the mobile composer"
```

---

### Task 4: mobile.js — 录音交互逻辑

**改版说明:** 原计划是往 `.uV2eYG_trailing` 里插一个独立小按钮。现在改成一个盖在输入框(`.uV2eYG_input`)正上方的覆盖层:平时显示静态声波图形,按住跳动录音,松开后过渡到"识别中",再到文字带动画浮现在覆盖层里——与此同时把文字真实写入底层 textarea;浮现动画播完后覆盖层整体隐藏,把控制权交还给原生 textarea,用户可以正常编辑/查看。发送按钮点下去之后(dsh 自己会清空输入框),延迟一点再让覆盖层重新出现,回到"可以说话"的待机态。

下面的代码块和 Task 5/6/7 里引用的类名(`.ds-mobile-voice-hit`)是**这个覆盖层方案的第一版实现**,已经被两轮后续修复取代:第一轮(spec reviewer 发现的 bug)让覆盖层本身 `pointer-events:none`、只留一个内部小 `hit` 区域可点,解决了"覆盖层挡住打字"的问题,但需要精确点在波形图标上才能触发录音;第二轮(用户要求"单击=打字,长按=录音",不分点击位置)把方案改成整体可交互 + touchstart 200ms 计时器判断 tap/hold,`.ds-mobile-voice-hit` 这个类被删掉了。**最终以 commit `7901d48` 为准**,不在这里重新贴一遍完整代码——道理同 Task 3。

**Files:**
- Modify: `mobile.js`

已确认的真实 DOM 事实(用 Browser pane 在真实 dsh 页面上实测):
- `.uV2eYG_input` 是 `<textarea>`,不是 contenteditable
- `.uV2eYG_input` 的直接父容器是 `.uV2eYG_grow`,已经是 `position: relative` ——覆盖层就插进这个容器里,用 `position:absolute; inset:0` 精确盖住输入框,不需要额外的定位计算
- `.uV2eYG_primary` 是发送按钮(在 `.uV2eYG_trailing` 里),用它的背景色作为覆盖层的强调色来源

- [ ] **Step 1: 重新读取 mobile.js 确认当前内容和文件末尾**

同样的纪律:先 Read 整个文件,确认最后的 `})();` 收尾还在,以它作为追加锚点。

- [ ] **Step 2: 追加语音输入模块到 `})();` 之前**

用 Edit,`old_string` 是文件当前的最后一行 `})();`,`new_string` 是新代码块 + `})();`:

```js

  // ---------------------------------------------------------------------
  // Voice-to-text composer input — an overlay pinned over the composer's
  // real <textarea> (.uV2eYG_input, inside the already-relative
  // .uV2eYG_grow). Press-and-hold the overlay to record, release to
  // upload to the gateway's local whisper.cpp endpoint; the transcribed
  // text fades into view on the overlay itself (while also being written
  // into the real textarea underneath), then the overlay hides and hands
  // control back to that textarea for the user to edit/send — never
  // auto-sends. Re-appears once the send button is used (dsh clears the
  // textarea on send), or on first load if the textarea starts empty.
  // See docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md
  // ---------------------------------------------------------------------

  const VOICE_OVERLAY_CLASS = 'ds-mobile-voice-overlay';
  const VOICE_STATE_CLASSES = [
    'ds-mobile-voice-recording',
    'ds-mobile-voice-busy',
    'ds-mobile-voice-done',
    'ds-mobile-voice-error',
  ];
  const VOICE_MIN_RECORDING_MS = 300;
  const VOICE_WAVE_BAR_HEIGHTS = [7, 12, 16, 10, 14, 8, 15, 11];
  const VOICE_DONE_DISPLAY_MS = 900;
  const VOICE_ERROR_DISPLAY_MS = 1500;
  const VOICE_UPLOAD_TIMEOUT_MS = 20000;

  let voiceStream = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceRecordingStartedAt = 0;
  let voiceReleaseRequested = false;

  function getComposerGrow() {
    return document.querySelector('.uV2eYG_grow');
  }

  function getVoiceComposerInput() {
    return document.querySelector('.uV2eYG_input');
  }

  function getSendButton() {
    return document.querySelector('.uV2eYG_primary');
  }

  function setVoiceState(overlay, state) {
    overlay.classList.remove(...VOICE_STATE_CLASSES);
    if (state) overlay.classList.add(state);
  }

  function isVoiceMidFlow(overlay) {
    return VOICE_STATE_CLASSES.some((cls) => overlay.classList.contains(cls));
  }

  function showVoiceError(overlay, message) {
    const textLayer = overlay.querySelector('.ds-mobile-voice-text');
    textLayer.textContent = message;
    setVoiceState(overlay, 'ds-mobile-voice-error');
    setTimeout(() => {
      setVoiceState(overlay, null);
    }, VOICE_ERROR_DISPLAY_MS);
  }

  function applyVoiceAccentColor(overlay) {
    const sendBtn = getSendButton();
    if (!sendBtn) return;
    const accent = getComputedStyle(sendBtn).backgroundColor;
    if (accent) overlay.style.setProperty('--ds-voice-accent', accent);
  }

  function ensureVoiceOverlay() {
    if (!isMobile()) return null;
    const grow = getComposerGrow();
    if (!grow) return null;
    let overlay = grow.querySelector('.' + VOICE_OVERLAY_CLASS);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = VOICE_OVERLAY_CLASS;
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('aria-label', '按住说话');

    const wave = document.createElement('div');
    wave.className = 'ds-mobile-voice-wave';
    for (const h of VOICE_WAVE_BAR_HEIGHTS) {
      const bar = document.createElement('span');
      bar.style.height = h + 'px';
      wave.appendChild(bar);
    }
    overlay.appendChild(wave);

    const busyDots = document.createElement('div');
    busyDots.className = 'ds-mobile-voice-busy-dots';
    busyDots.textContent = '···';
    overlay.appendChild(busyDots);

    const textLayer = document.createElement('div');
    textLayer.className = 'ds-mobile-voice-text';
    overlay.appendChild(textLayer);

    const input = getVoiceComposerInput();
    if (input && input.value) overlay.classList.add('ds-mobile-voice-hidden');

    grow.appendChild(overlay);
    return overlay;
  }

  function fillComposerText(text) {
    const input = getVoiceComposerInput();
    if (!input || !text) return;
    const existing = input.value || '';
    const combined = existing ? existing + text : text;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    nativeSetter.call(input, combined);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function startVoiceRecording(overlay) {
    if (voiceRecorder || isVoiceMidFlow(overlay)) return;
    voiceReleaseRequested = false;
    applyVoiceAccentColor(overlay);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showVoiceError(overlay, '没有麦克风权限,请去设置里开启');
      return;
    }
    if (voiceReleaseRequested) {
      // 用户在系统权限弹窗还没处理完时就已经松手了(首次使用几乎必然
      // 触发这个弹窗)——不进入录音状态,否则会卡在 recording 视觉态
      // 却再也等不到对应的 touchend。
      stream.getTracks().forEach((track) => track.stop());
      voiceReleaseRequested = false;
      setVoiceState(overlay, null);
      return;
    }
    voiceStream = stream;
    voiceChunks = [];
    voiceRecordingStartedAt = Date.now();
    voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) voiceChunks.push(event.data);
    };
    voiceRecorder.start();
    setVoiceState(overlay, 'ds-mobile-voice-recording');
  }

  function stopVoiceRecording(overlay) {
    if (!voiceRecorder) {
      voiceReleaseRequested = true;
      return;
    }
    const recordedMs = Date.now() - voiceRecordingStartedAt;
    const recorder = voiceRecorder;
    voiceRecorder = null;

    recorder.addEventListener('stop', () => {
      if (voiceStream) {
        voiceStream.getTracks().forEach((track) => track.stop());
        voiceStream = null;
      }
      if (recordedMs < VOICE_MIN_RECORDING_MS) {
        setVoiceState(overlay, null);
        return;
      }
      const blob = new Blob(voiceChunks, { type: recorder.mimeType });
      uploadVoiceRecording(blob, overlay);
    });
    recorder.stop();
  }

  async function uploadVoiceRecording(blob, overlay) {
    setVoiceState(overlay, 'ds-mobile-voice-busy');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VOICE_UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch('/__ds_theme/stt', { method: 'POST', body: blob, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.text) {
        const textLayer = overlay.querySelector('.ds-mobile-voice-text');
        textLayer.textContent = data.text;
        setVoiceState(overlay, 'ds-mobile-voice-done');
        fillComposerText(data.text);
        setTimeout(() => {
          overlay.classList.add('ds-mobile-voice-hidden');
          setVoiceState(overlay, null);
        }, VOICE_DONE_DISPLAY_MS);
      } else {
        showVoiceError(overlay, '没听清,再试一次');
      }
    } catch {
      clearTimeout(timeoutId);
      showVoiceError(overlay, '识别失败,请重试');
    }
  }

  function recallVoiceOverlayAfterSend() {
    const overlay = ensureVoiceOverlay();
    if (!overlay || isVoiceMidFlow(overlay)) return;
    overlay.classList.remove('ds-mobile-voice-hidden');
    setVoiceState(overlay, null);
  }

  function bindVoiceOverlay() {
    const overlay = ensureVoiceOverlay();
    if (!overlay || overlay.dataset.dsBound) return;
    overlay.dataset.dsBound = '1';
    overlay.addEventListener(
      'touchstart',
      (event) => {
        event.preventDefault();
        startVoiceRecording(overlay);
      },
      { passive: false }
    );
    overlay.addEventListener(
      'touchend',
      (event) => {
        event.preventDefault();
        stopVoiceRecording(overlay);
      },
      { passive: false }
    );
  }

  function bindSendButtonForVoiceRecall() {
    const sendBtn = getSendButton();
    if (!sendBtn || sendBtn.dataset.dsVoiceRecallBound) return;
    sendBtn.dataset.dsVoiceRecallBound = '1';
    sendBtn.addEventListener('click', () => {
      setTimeout(recallVoiceOverlayAfterSend, 400);
    });
  }

  setInterval(() => {
    if (!isMobile()) return;
    bindVoiceOverlay();
    bindSendButtonForVoiceRecall();
  }, 1000);
})();
```

- [ ] **Step 3: 语法检查**

```bash
node --check mobile.js
```

Expected: 无输出。

- [ ] **Step 4: 确认这个覆盖层会被现有拖拽排除逻辑覆盖**

搜索文件里侧边栏拖拽 touchstart 监听器的排除判断:

```bash
grep -n "closest('button" mobile.js
```

Expected: 能看到类似 `event.target.closest('button, a, [role="button"], [role="menuitem"]')` 这一行。新创建的覆盖层设置了 `role="button"`,会自动落入这个排除范围(`[role="button"]` 那部分),不需要为它单独加代码。如果这行代码因为并发编辑被改动或删除了,先停下来——说明侧边栏拖拽排除机制本身发生了变化,需要重新确认覆盖层是否还会被正确排除,而不是想当然往下走。

- [ ] **Step 5: Commit**

```bash
git add mobile.js
git commit -m "Add voice-to-text overlay interaction to the mobile composer"
```

---

### Task 5: 端到端验证

**Files:** 无新文件,纯验证

- [ ] **Step 1: Browser pane 模拟验证覆盖层存在、位置正确、状态切换正常**

用一个独立的 Browser pane 标签页(不要用被 DeepSeek 会话占着的那个标签),打开本地 dsh 的裸端口 3080,手动注入当前的 mobile.css/mobile.js(延续这个项目一直以来的模拟测试方式),用 `javascript_tool` 检查:

```js
(() => {
  const overlay = document.querySelector('.ds-mobile-voice-overlay');
  const input = document.querySelector('.uV2eYG_input');
  if (!overlay || !input) return { found: false };
  const overlayRect = overlay.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  return {
    found: true,
    hidden: overlay.classList.contains('ds-mobile-voice-hidden'),
    role: overlay.getAttribute('role'),
    overlayRect: { x: overlayRect.x, y: overlayRect.y, w: overlayRect.width, h: overlayRect.height },
    inputRect: { x: inputRect.x, y: inputRect.y, w: inputRect.width, h: inputRect.height },
    waveBarCount: overlay.querySelectorAll('.ds-mobile-voice-wave span').length,
  };
})()
```

Expected: `found: true`,`hidden: false`(输入框为空,覆盖层应可见),`role: "button"`,`overlayRect` 与 `inputRect` 的 x/y/宽高基本一致(覆盖层精确盖住了输入框),`waveBarCount: 8`。

再验证状态类切换本身没写错(不需要真的录音,直接手动切 class 看 CSS 生效):

```js
(() => {
  const overlay = document.querySelector('.ds-mobile-voice-overlay');
  overlay.classList.add('ds-mobile-voice-recording');
  const wave = overlay.querySelector('.ds-mobile-voice-wave');
  const bar = wave.querySelector('span');
  const barColor = getComputedStyle(bar).backgroundColor;
  const borderColor = getComputedStyle(overlay).borderColor;
  overlay.classList.remove('ds-mobile-voice-recording');
  return { barColor, borderColor };
})()
```

Expected: `barColor` 和 `borderColor` 不是默认的灰色(`rgba(127, 127, 127, ...)`),说明 `--ds-voice-accent` 被正确应用了(前提是 Task 4 的 `applyVoiceAccentColor` 在这之前跑过一次,如果没跑过会退回 CSS 里写的默认色 `#d85a30`,这也算正常,只是没读到发送按钮的实际颜色)。

- [ ] **Step 2: Browser pane 验证 fillComposerText 能正确写入 React 受控的 textarea**

```js
(() => {
  const input = document.querySelector('.uV2eYG_input');
  const before = input.value;
  // 直接调用页面里暴露的内部函数不可行(IIFE 闭包,外部拿不到) —
  // 改为验证原生 setter trick 本身在这个 textarea 上确实有效:
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, before + '测试文字');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { before, after: input.value };
})()
```

Expected: `after` 比 `before` 多了"测试文字",且刷新页面观察 React 渲染的字数统计/发送按钮的启用状态也跟着变化(证明 React 确实收到了这次变化,不是只改了 DOM 表面值)。测试完手动清空输入框,不要留着测试文字。

- [ ] **Step 3: 真机测试 —— 完整链路**

这一步需要在真实 iPhone 上操作,无法用工具代为验证,请手动完成:

1. 确认 Mac 上 remote-gateway.js 用最新代码重启(带上 `STT_MODEL_FILE`/`STT_WHISPER_BIN` 如果没用默认值)
2. 手机打开隧道地址,进任意会话
3. 确认输入框位置默认显示的是居中的静态波形图形,不是"给智能体发消息"这类打字占位提示
4. 按住这块区域说一句话,松开
5. 确认:按下时波形跳动、边框微微变强调色;松开后波形消失、短暂显示识别中的"···";几秒内文字带过渡动画浮现在原来的位置,和说的内容基本一致;文字没有自动发送,需要手动点发送按钮
6. 文字浮现大约一秒后,覆盖层应该整体消失,底下露出的是可以正常编辑的原生输入框(点一下能唤出键盘手动改字)
7. 点发送按钮,确认发送完成后覆盖层重新出现,回到"可以说话"的待机态
8. 再测一次异常路径:按一下立刻松开(不到 0.3 秒),确认没有触发上传,覆盖层直接回到待机波形
9. 再测一次:说话时把手机静音或者背景很吵,确认识别失败(或者返回空文本)时覆盖层能回到待机态,而不是卡在"识别中"不动
10. 手动在输入框里打几个字(不用语音),确认覆盖层不会自己跳出来打断打字

把这一步的真机结果反馈给我,如果哪一条不符合预期,回来改对应的 Task 再重新走一遍验证。

---

### Task 6: UI 细节优化

这一步的具体内容取决于 Task 5 真机验证的实际观感,不是能预先写死代码的。做的时候按这个清单过一遍,只调细节,不加新功能、不改交互逻辑:

- [ ] 波形跳动的强调色、识别中的呼吸动画,在真实光线下(尤其室外强光)是否够清晰
- [ ] 覆盖层紧贴在现有 ~28px 高的输入框空间里,真机上会不会显得局促——如果局促,评估要不要做"进入录音/识别中状态时临时撑高 composer"的方案,这个当时因为怕跟 dsh 自身 textarea 自动增高逻辑打架而没做
- [ ] 波形/识别中点点/错误文字/转写文字这几个状态之间切换,有没有布局跳动或者闪烁
- [ ] 覆盖层退场、露出底层原生输入框的这个时机是否顺滑,有没有一瞬间"看到两层重叠"的违和感
- [ ] 如果这轮真机反馈里用户提了具体的观感问题,直接对照着改,不用等一个"完整清单走完"才动手

每处调整都是对 mobile.css/mobile.js 的小范围 Edit,改完照 Task 5 的方式重新验证一遍,单独 commit,commit message 具体描述改了什么(不要用"UI优化"这种笼统的话)。

---

### Task 7: 对照设计文档验收(找 bug)

打开 [docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md](../specs/2026-08-16-voice-to-text-composer-design.md),逐条对照真机实测结果:

- [ ] 触发手势是按住说话/松开结束,不是点击切换
- [ ] 转写文字直接填入输入框,不弹独立确认框
- [ ] 不自动发送,发送键始终由用户手动点
- [ ] 权限被拒绝时有提示,不是静默失败
- [ ] 按太短(<0.3s)被忽略,不触发上传
- [ ] 识别结果为空时提示"没听清"类反馈,不把空文本填进去
- [ ] 网络/whisper 调用失败时有短暂错误提示,且手动打字这条路径全程不受影响(试着在识别失败后立刻手动打字,确认输入框没有被卡住或锁定)
- [ ] 没有做实时流式字幕(确认是松手才出字,不是边说边出)
- [ ] 没有引入语言/模型切换 UI
- [ ] 语音输入覆盖层所在的改动,没有影响到 DeepSeek 那边同期在做的设置面板/侧边栏改动(两边各自开关一遍,确认互不影响)

有任何一条对不上,回到对应 Task 定位问题、修、重新走一遍 Task 5 的验证,再回来重新过这个清单——不要跳过没验证过的条目就当作通过。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-16-voice-to-text-composer.md`. Two execution options:

**1. Subagent-Driven(推荐)** - 每个 Task 派一个新的子代理去做,任务之间我来做审查,迭代更快

**2. Inline Execution** - 就在当前这个会话里按顺序做,每个 Task 做完停下来给你看结果

要选哪种?

// 查 Gemini 各模型此刻通不通,决定要不要切过去用。
//
//   node scripts/check-gemini-models.mjs
//
// 起因:gemini-3.7-flash 在 2026-08-19 实测 5 次只成功 1 次,其余是
// 503 "currently experiencing high demand"(它 08-13 才发布,免费层
// 还在挤);而 gemini-3.6-flash 同一把 key、同一条网络 5/5 成功、
// 中位 6.2 秒。所以「Gemini 慢」当时并不是网络或配置问题,是那个模型
// 本身在过载 —— 而这件事只有发几次真请求才看得出来。
//
// key 从 ~/.modlens/config.json 读,不进 argv、不打印。
// 注意每跑一次都会消耗免费额度;测多了会撞 429 限流。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG = path.join(os.homedir(), '.modlens', 'config.json');
const MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash'];
const N = Number(process.argv[2] || 3);

let key;
try {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  key = cfg?.providers?.['gemini-api']?.apiKey || cfg?.providers?.gemini?.apiKey;
} catch {
  /* 落到下面的报错 */
}
if (!key) {
  console.error(`没在 ${CONFIG} 里找到 gemini key。`);
  console.error('先配:node ~/.dsh/profiles/web/node_modules/@liustack/modlens/dist/main.js config set gemini-api.apiKey');
  process.exit(1);
}

async function once(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        // 最短的问题:测的是能不能通、要等多久,不是回答质量
        body: JSON.stringify({ contents: [{ parts: [{ text: '回答"好"一个字' }] }] }),
      }
    );
    const j = await res.json();
    return { ms: Date.now() - t0, status: res.status, msg: (j?.error?.message || '').slice(0, 60) };
  } catch (e) {
    return { ms: Date.now() - t0, status: 0, msg: e.message.slice(0, 60) };
  }
}

console.log(`每个模型测 ${N} 次\n`);
for (const model of MODELS) {
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(await once(model));
  const ok = runs.filter((r) => r.status === 200);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const mid = times.length ? times[Math.floor(times.length / 2)] : null;

  console.log(`【${model}】`);
  console.log(`  ${runs.map((r) => `${(r.ms / 1000).toFixed(1)}s(${r.status || 'ERR'})`).join('  ')}`);

  // 成功率和快慢是两件事,分开说。一个 5/5 成功但每次 20 秒的模型,
  // 和一个 2/5 成功但成功时 5 秒的模型,难受的方式完全不同。
  const s503 = runs.filter((r) => r.status === 503).length;
  const s429 = runs.filter((r) => r.status === 429).length;

  if (ok.length === 0) {
    if (s503) console.log('  → 全部过载(503)。是 Google 那边挤,不是你的网络,换节点没用,等等再试。');
    else if (s429) console.log('  → 撞到额度限流(429)。歇十几分钟,或换池子里另一把 key。');
    else console.log(`  → 全部失败:${runs[0].msg}`);
  } else if (ok.length < N) {
    console.log(`  → 时好时坏(${ok.length}/${N} 通)${s503 ? ',失败的是 503 过载' : ''}。当主力会难受。`);
  } else if (mid <= 10000) {
    console.log(`  → 好用,中位 ${(mid / 1000).toFixed(1)}s。可以切到这个。`);
  } else {
    console.log(`  → 全通但慢,中位 ${(mid / 1000).toFixed(1)}s。能用,只是每句话都要等这么久。`);
  }
  console.log();
}

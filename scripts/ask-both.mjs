// 同一张图、同一个问题,同时问 DeepSeek 和 Gemini,并排给答案。
//
//   node scripts/ask-both.mjs <图片> "问题"
//   node scripts/ask-both.mjs a.png b.png "这两个人分别是谁?"
//
// 为什么是"要的时候才跑"而不是常驻双跑:实测两个模型对同一张密集
// 截图的答案一致率 3/3,而并行的墙钟时间等于慢的那个 —— 12.6 秒
// 对 3.7 秒。天天双跑是花双倍的钱买一个"它俩都这么说"。
//
// 真正值得问第二遍的是它已知的弱项:复杂计数、隐藏形状、倒置碎片图、
// 需要逐个数清楚的场景。那些场景下两边给出不同答案才有信息量。
//
// key 分别从 ~/.dsh/.credentials.yaml 和 ~/.modlens/config.json 读,
// 不进 argv 也不打印。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node ask-both.mjs <图片...> "问题"');
  console.error('例:  node ask-both.mjs shot.png "图里有几双筷子?"');
  process.exit(1);
}
const question = args[args.length - 1];
const images = args.slice(0, -1);

for (const p of images) {
  if (!fs.existsSync(p)) { console.error(`找不到图片: ${p}`); process.exit(1); }
}

function readKeys() {
  let dsKey, gKey;
  try {
    const cred = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    dsKey = cred.match(/^DEEPSEEK_API_KEY:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  } catch { /* 下面统一报错 */ }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.modlens', 'config.json'), 'utf8'));
    gKey = cfg?.providers?.['gemini-api']?.apiKey || cfg?.providers?.gemini?.apiKey;
  } catch { /* 同上 */ }
  return { dsKey, gKey };
}

const { dsKey, gKey } = readKeys();
const b64s = images.map((p) => ({ name: path.basename(p), b64: fs.readFileSync(p).toString('base64') }));

async function deepseek() {
  const t0 = Date.now();
  if (!dsKey) return { who: 'DeepSeek', ms: 0, err: '没读到 DEEPSEEK_API_KEY' };
  const content = [{ type: 'text', text: question }];
  for (const { b64 } of b64s) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dsKey}` },
      // 上限给足:它会先思考再作答,思考也算输出 token。设小了会出现
      // finish_reason=length 而正文一个字都没有的空返回。
      body: JSON.stringify({ model: 'deepseek-v4-flash-vision-exp', max_tokens: 4000,
        messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    return { who: 'DeepSeek 视觉', ms: Date.now() - t0,
             txt: (j?.choices?.[0]?.message?.content || '').trim(),
             err: j?.error?.message,
             note: j?.choices?.[0]?.finish_reason === 'length' ? '(被输出上限截断)' : '' };
  } catch (e) {
    return { who: 'DeepSeek 视觉', ms: Date.now() - t0, err: e.message };
  }
}

async function gemini() {
  const t0 = Date.now();
  if (!gKey) return { who: 'Gemini', ms: 0, err: '没读到 gemini key' };
  const parts = [{ text: question }];
  for (const { b64 } of b64s) parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gKey },
        body: JSON.stringify({ contents: [{ parts }] }) });
    const j = await r.json();
    return { who: 'Gemini 3.6', ms: Date.now() - t0,
             txt: (j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim(),
             err: j?.error?.message };
  } catch (e) {
    return { who: 'Gemini 3.6', ms: Date.now() - t0, err: e.message };
  }
}

console.log(`图片: ${b64s.map((x) => x.name).join(', ')}`);
console.log(`问题: ${question}\n`);

const results = await Promise.all([deepseek(), gemini()]);
for (const r of results) {
  console.log(`${'─'.repeat(58)}`);
  console.log(`【${r.who}】 ${(r.ms / 1000).toFixed(1)}s ${r.note || ''}`);
  console.log(r.err ? `  ✗ ${r.err}` : `  ${r.txt.replace(/\n/g, '\n  ')}`);
}
console.log('─'.repeat(58));

// 只比数字:两边说法不同但数字一致,通常是同一个意思换了措辞。
// 数字不一致才是真分歧 —— 而计数正是这个模型已知的弱项。
const nums = results.map((r) => (r.txt || '').match(/\d+/g)?.join('|') || '');
if (results.every((r) => !r.err)) {
  console.log(nums[0] && nums[0] === nums[1]
    ? '\n两边数字一致。'
    : '\n⚠ 两边数字不一致 —— 至少有一个是错的,建议自己核一遍。');
}

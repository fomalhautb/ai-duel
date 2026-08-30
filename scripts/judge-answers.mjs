#!/usr/bin/env node
// 自动判卷脚本：读 pregen-answers.mjs 生成的答案文件，逐条问一个判卷模型「这个回答和标准答案一致吗」，
// 把结论写成 scripts/out/verdicts-run4.json。
//
// 之所以要模型来判而不是字符串比对：标准答案是「无法判断」「都不是」这种结论，模型会用一整句话说出来
//（「没有足够信息判断」），关键词匹配既漏又误。判卷模型只需要读懂结论，不需要自己会做题。
//
// 用法：
//   node scripts/judge-answers.mjs                        判 generation-run4.json（+ -fix.json 若存在）
//   node scripts/judge-answers.mjs --in a.json --fix b.json --out verdicts.json
//   node scripts/judge-answers.mjs --retry-null          只补判 --out 里结论为 null（含缺格）的那些格子
//
// 输入文件名都只接受 scripts/out/ 下的文件名，不接受路径。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUESTIONS } from './pregen-answers.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');
const OUT_DIR = join(SCRIPT_DIR, 'out');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const JUDGE_MODEL = 'google/gemini-3.7-flash';
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 60_000;
const CONCURRENCY = 8;

// OpenRouter 对这个账号的 gemini-3.7-flash 限速 20 请求/分钟，超了整片返回 429。
// 并发数拦不住这个：8 个 worker 各自跑得飞快，一分钟照样发出上百个请求。
// 所以在并发之上再压一道「两次请求至少隔 MIN_REQUEST_INTERVAL_MS」的闸，把速率压到限额以内。
const RATE_LIMIT_RPM = 18; // 比 20 留一点余量，免得卡在边界上
const MIN_REQUEST_INTERVAL_MS = Math.ceil(60_000 / RATE_LIMIT_RPM);

// 判卷本身只要一个 {"correct": ...}，十几个 token 就够，但 gemini 会先想一会儿，
// 思维链和正文共享这份配额：给 64 时实测正文被截成 `{"`，整格判不出来。所以给足 1000。
const JUDGE_MAX_TOKENS = 1000;

const JUDGE_SYSTEM =
  '你是判卷员。给你一道题、一个标准答案、一个待判的回答，请判断这个回答的结论和标准答案是否一致。\n' +
  '只看结论是否一致，不看措辞、语气、理由是否充分，也不看回答有没有被截断——只要能看出结论就照结论判。\n' +
  '注意：标准答案是「无法判断」「都不是」这类否定性结论时，回答只要表达了同样的意思（例如「信息不足」「两句都不是」）就算一致。\n' +
  '判定规则：结论与标准答案一致 → true；结论与标准答案不一致 → false；回答跑题、答非所问、或看不出任何结论 → null。\n' +
  '只输出一行 JSON，形如 {"correct": true} / {"correct": false} / {"correct": null}，不要任何解释、不要 markdown 代码块。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 全局发车闸：所有 worker 共用一个「下一次可以发请求的时刻」，谁要发就先把这个时刻往后推一格，
// 再睡到那个时刻。这样不管多少个 worker 并发，整体速率都不超过 RATE_LIMIT_RPM。
let nextSlotAt = 0;
async function takeRateLimitSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_REQUEST_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

// 和 pregen 一样：先看环境变量，没有再读 worktree 根目录的 .env。key 只进 Authorization 头。
async function loadApiKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const envPath = join(REPO_ROOT, '.env');
  let raw;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    throw new Error(`未找到 OPENROUTER_API_KEY：环境变量为空，且读不到 ${envPath}`);
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'OPENROUTER_API_KEY') continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) return value;
  }
  throw new Error(`${envPath} 里没有非空的 OPENROUTER_API_KEY`);
}

function readFlag(name) {
  const argv = process.argv;
  const prefix = `--${name}`;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === prefix) return argv[i + 1];
    if (argv[i].startsWith(`${prefix}=`)) return argv[i].slice(prefix.length + 1);
  }
  return undefined;
}

function resolveOutFile(name) {
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`只接受 scripts/out/ 下的文件名，不要带路径：${name}`);
  }
  return join(OUT_DIR, name);
}

/** 读一份已有的判卷结果（--retry-null 用）。文件不存在当成一条都没判过。 */
async function readVerdicts(name) {
  try {
    return JSON.parse(await readFile(resolveOutFile(name), 'utf8')).verdicts ?? {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

// 读一份 pregen 输出。allowMissing 用于可选的 -fix 文件：没跑补跑就不该报错。
async function readResults(name, { allowMissing = false } = {}) {
  const path = resolveOutFile(name);
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw new Error(`读不到 ${path}：${error?.message ?? error}`);
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data?.results)) {
    throw new Error(`${path} 里没有 results 数组`);
  }
  return data;
}

/**
 * 从判卷模型的回复里抠出 correct。
 *
 * 不直接 JSON.parse 整段：模型偶尔会裹一层 ```json 代码块或在前面加一句废话，
 * 所以先用正则找 "correct": <值> 这一处。抠不出来返回 undefined，由调用方当失败重试。
 */
function parseVerdict(text) {
  const match = /"correct"\s*:\s*(true|false|null)/i.exec(text);
  if (!match) return undefined;
  const token = match[1].toLowerCase();
  return token === 'true' ? true : token === 'false' ? false : null;
}

async function judgeOne({ apiKey, question, answer }) {
  const userPrompt = [
    `题目：${question.text}`,
    `标准答案：${question.expected}`,
    `待判回答：${answer}`,
  ].join('\n');

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await takeRateLimitSlot();
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          messages: [
            { role: 'system', content: JUDGE_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          // 判卷要可复现，不要采样带来的随机性。
          temperature: 0,
          max_tokens: JUDGE_MAX_TOKENS,
          stream: false,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText} ${body.slice(0, 300)}`.trim());
      }
      const data = await response.json();
      if (data?.error) throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 300)}`);

      const content = data?.choices?.[0]?.message?.content;
      const verdict = typeof content === 'string' ? parseVerdict(content) : undefined;
      if (verdict === undefined) {
        throw new Error(`判卷输出解析失败：${JSON.stringify(content).slice(0, 300)}`);
      }
      return verdict;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        // 撞限速时退避要比普通错误久：限速是按分钟结算的，1 秒后重试必然还是 429。
        const isRateLimited = /HTTP 429/.test(error?.message ?? '');
        await sleep((isRateLimited ? 20_000 : 1000) * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const inName = readFlag('in')?.trim() || 'generation-run4.json';
  const fixName = readFlag('fix')?.trim() || 'generation-run4-fix.json';
  const outName = readFlag('out')?.trim() || 'verdicts-run4.json';
  // 补判模式：判卷模型偶尔会请求失败，失败和「看不出结论」一样记成 null，两者在结果里分不出来。
  // 与其整轮重判（几百个请求、限速下要跑很久），不如只把 null 的格子再问一遍：
  // 真的没结论的格子重判还是 null，只是失败的那些会被补上。已有的 true / false 一律保留不动。
  const retryNull = process.argv.includes('--retry-null');

  const apiKey = await loadApiKey();
  const base = await readResults(inName);
  const fix = await readResults(fixName, { allowMissing: true });

  // 补跑文件按 (variant, questionId, modelId) 覆盖主文件里的同一格：补跑就是为了替掉失败的那格。
  const byCell = new Map();
  for (const source of [base, fix]) {
    if (!source) continue;
    for (const row of source.results) {
      byCell.set(`${row.variant} ${row.questionId} ${row.modelId}`, row);
    }
  }

  const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));
  // 空 answer（生成失败的格子）不送判：没东西可判，直接不进结果，读的人看到缺格就知道那格没答案。
  const rows = [...byCell.values()].filter((row) => typeof row.answer === 'string' && row.answer.trim());

  // 补判模式下先读回上一轮的结论，只留下 null（或压根没判过）的格子送判。
  const previous = retryNull ? await readVerdicts(outName) : {};
  const pending = retryNull
    ? rows.filter((row) => (previous[row.variant]?.[row.questionId]?.[row.modelId] ?? null) === null)
    : rows;

  const missingQuestions = [...new Set(rows.map((r) => r.questionId).filter((id) => !questionById.has(id)))];
  if (missingQuestions.length > 0) {
    throw new Error(`结果里有 QUESTIONS 中不存在的题目 id：${missingQuestions.join('、')}`);
  }

  const total = pending.length;
  console.log(
    retryNull
      ? `开始补判：${total} / ${rows.length} 条待补（上一轮结论为 null 的），判卷模型 ${JUDGE_MODEL}，并发 ${CONCURRENCY}`
      : `开始判卷：${total} 条回答，判卷模型 ${JUDGE_MODEL}，并发 ${CONCURRENCY}`,
  );

  let done = 0;
  let failed = 0;
  const tasks = pending.map((row) => async () => {
    try {
      const verdict = await judgeOne({ apiKey, question: questionById.get(row.questionId), answer: row.answer });
      done += 1;
      if (done % 25 === 0 || done === total) console.log(`[${done}/${total}] 判卷中`);
      return { row, verdict };
    } catch (error) {
      done += 1;
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`[${done}/${total}] ${row.variant} × ${row.questionId} × ${row.modelId} — 判卷失败：${reason}`);
      // 判卷失败和「看不出结论」在下游是一回事：都是没有可信的对错，统一记 null。
      return { row, verdict: null };
    }
  });

  const judged = await runPool(tasks, CONCURRENCY);

  // 补判模式从上一轮的结论上叠加，没送判的格子原样保留。
  const verdicts = retryNull ? previous : {};
  for (const { row, verdict } of judged) {
    ((verdicts[row.variant] ??= {})[row.questionId] ??= {})[row.modelId] = verdict;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolveOutFile(outName);
  await writeFile(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), verdicts }, null, 2)}\n`, 'utf8');

  const flat = judged.map((j) => j.verdict);
  console.log(
    `\n完成：对 ${flat.filter((v) => v === true).length} / 错 ${flat.filter((v) => v === false).length} / 无结论 ${flat.filter((v) => v === null).length}（其中判卷请求失败 ${failed} 条）`,
  );
  console.log(`已写入 ${outPath}`);
}

main().catch((error) => {
  console.error(`脚本异常退出：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

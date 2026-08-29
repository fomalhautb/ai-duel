#!/usr/bin/env node
// 把离线跑出来的模型回答，压成对局运行时直接查的那份表 packages/core/src/pregenAnswers.json。
//
// 为什么要这一步：pregen-answers.mjs 的输出是一维结果列表（还带 usage、延迟、思维链这些
// 排查用的字段），判卷结果又在另一个文件里（verdicts-run4.json，由 judge-answers.mjs 产出）。
// 对局里只需要「这道题这张卡这一档答了什么、对不对」，所以在这里合成一张三级表，
// core 的 script.ts 直接 import 它查表，运行时不做任何拼装。
//
// 用法：node scripts/build-core-answers.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODELS, QUESTIONS, VARIANTS } from './pregen-answers.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, 'out');
const TARGET = join(SCRIPT_DIR, '..', 'packages', 'core', 'src', 'pregenAnswers.json');

// 结果文件按顺序读，后面文件里的条目按 (variant, questionId, modelId) 覆盖前面的同一格。
// -fix.json 是「补跑失败格子」用的，整轮没翻车时可以不存在，读不到就跳过。
const SOURCES = ['generation-run4.json', 'generation-run4-fix.json'];
const VERDICTS_FILE = 'verdicts-run4.json';

// 判卷结果里没有的格子当没答对：结论看不出来（null）在对局里就该算答错，
// 不然一句模棱两可的话会白送一分。
const MISSING_ANSWER = '（生成失败）';

// 没被干扰那一档。干扰档缺数据时回落到它，所以它得排在别的变体前面先算出来。
const BASELINE_VARIANT = 'baseline';

/** 排序用：baseline 永远第一，其余保持 VARIANTS 里的相对顺序。 */
const order = (variantId) => (variantId === BASELINE_VARIANT ? 0 : 1);

const cellKey = (variant, questionId, modelId) => `${variant}|${questionId}|${modelId}`;

/** 读一份结果文件；文件不存在返回空数组（-fix.json 是可选的）。 */
async function readResults(fileName) {
  let raw;
  try {
    raw = await readFile(join(OUT_DIR, fileName), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`跳过不存在的结果文件：${fileName}`);
      return [];
    }
    throw error;
  }
  return JSON.parse(raw).results ?? [];
}

/**
 * 把「结论 + 一句理由」的短文本拆成两段。
 *
 * 生成时 prompt 要求「先给出结论，再用一句话说明理由」，又截到 30 token，
 * 所以第一个句读之前的那截就是结论。结算界面把 answer 排成大字、reasoning 排成小字，
 * 拆不开（整句没有标点、或者被截断在结论中间）时理由就是空串，界面少一行小字而已。
 *
 * 两处防空是被真实数据逼出来的：answer 空串在界面上就是一张没有大字的结算卡。
 * - 有的回答整句以标点开头（glm-5 答过「，为了双倍积分。」），所以先把开头的标点和空白削掉再找句读；
 * - 削完仍然切出空的（比如整段只有一个标点），就不拆了，整段去掉首尾标点当 answer，理由留空。
 */
function splitAnswer(text) {
  const trimmed = text.trim().replace(/^[。！？，；、：\s]+/, '');
  const match = /[。！？，；]/.exec(trimmed);
  if (match) {
    const answer = trimmed.slice(0, match.index).trim();
    if (answer) {
      return { answer, reasoning: trimmed.slice(match.index + 1).trim() };
    }
  }
  return { answer: trimmed.replace(/[。！？，；、：\s]+$/, ''), reasoning: '' };
}

/**
 * 取一格的成品数据；这一格没跑出来（或跑出来是空的）返回 null，交给调用方决定怎么补。
 *
 * 请求失败的条目 answer 是空串，和压根没跑过一样没东西可播；
 * 拆完还是空串的（整段只有标点）同样没东西可播，两种都算没有。
 */
function buildCell(merged, verdicts, question, model, variant) {
  const hit = merged.get(cellKey(variant.id, question.id, model.id));
  if (!hit?.answer) return null;
  const { answer, reasoning } = splitAnswer(hit.answer);
  if (!answer) return null;
  return {
    answer,
    reasoning,
    correct: verdicts[variant.id]?.[question.id]?.[model.id] === true,
  };
}

async function main() {
  const merged = new Map();
  for (const source of SOURCES) {
    for (const result of await readResults(source)) {
      merged.set(cellKey(result.variant, result.questionId, result.modelId), result);
    }
  }

  const verdictsRaw = JSON.parse(await readFile(join(OUT_DIR, VERDICTS_FILE), 'utf8'));
  const verdicts = verdictsRaw.verdicts ?? {};

  const table = {};
  let missing = 0;
  let fellBack = 0;
  for (const question of QUESTIONS) {
    const byCard = {};
    for (const model of MODELS) {
      const byVariant = {};
      // baseline 先算：干扰档缺数据时要回落到它，所以它必须已经在手上。
      for (const variant of [...VARIANTS].sort((a, b) => order(a.id) - order(b.id))) {
        const cell = buildCell(merged, verdicts, question, model, variant);
        const label = `${question.id} × ${model.id} × ${variant.id}`;
        if (cell) {
          byVariant[variant.id] = cell;
          continue;
        }
        // 干扰档缺数据就照搬同题同卡的 baseline。
        //
        // 这不是随手找个东西填：干扰牌塞进去的话没能改变这个模型的回答，本来就是可能的结果
        //（复读机是利诱，模型完全可以不上钩），所以「和没被干扰时答得一样」在游戏里读得通。
        // 眼下唯一走这条路的是 black-white-reversal × q-dante × claude-fable-5：
        // 那句注入被 Anthropic 的内容过滤误拦了，模型直接拒答，重试多少次都一样，
        // 拿不到数据的原因和模型答不上来无关，填「（生成失败）」反而是在冤枉它。
        const baseline = byVariant[BASELINE_VARIANT];
        if (variant.id !== BASELINE_VARIANT && baseline) {
          fellBack += 1;
          console.warn(`缺数据，回落到 baseline：${label}`);
          byVariant[variant.id] = { ...baseline };
          continue;
        }
        // 连 baseline 都没有：这一格是真的什么都没有，只能兜底。
        missing += 1;
        console.warn(`缺数据，用兜底填：${label}`);
        byVariant[variant.id] = { answer: MISSING_ANSWER, reasoning: '', correct: false };
      }
      byCard[model.id] = byVariant;
    }
    table[question.id] = byCard;
  }

  await writeFile(TARGET, `${JSON.stringify(table, null, 2)}\n`, 'utf8');

  const total = QUESTIONS.length * MODELS.length * VARIANTS.length;
  console.log(`\n共 ${total} 格，回落到 baseline ${fellBack} 格，兜底 ${missing} 格`);
  console.log(`已写入 ${TARGET}`);
}

main().catch((error) => {
  console.error(`合成失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
// 把散在多份预生成结果里的「在用」那几个变体，合并成开发页 /generation 直接 import 的一份 JSON。
//
// 为什么要这一步：pregen-answers.mjs 的输出是一维的结果列表，还混着页面用不上的变体，
// 而且历史上同一轮实验的结果散在过好几个文件里。页面不该去理解这些历史，
// 所以在这里筛一次、拍平成表格形状。
//
// prompt 不从结果 JSON 里读（那里面本来也没存），而是 import 脚本里的 VARIANTS 现场重建：
// 换了注入词之后重跑这个脚本，页面上展示的 prompt 就跟着变，不会停留在旧文案上。
//
// 用法：node scripts/build-generation-data.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODELS, QUESTIONS, VARIANTS } from './pregen-answers.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, 'out');
const TARGET = join(SCRIPT_DIR, '..', 'packages', 'client', 'src', 'screens', 'generationResults.json');

// 结果文件按顺序读，后面文件里的条目按 (variant, questionId, modelId) 覆盖前面的同一格。
// 这是为「补跑失败格子」准备的：整轮跑完发现某个模型翻车，不用重跑全部，只补跑它那几格
// （pregen-answers.mjs --models ...）再往数组末尾追加一个文件即可，其余格子保持原样。
//
// run4 是正式那一轮：8 题 × 16 个可上场模型 × 3 档技能。-fix.json 是补跑用的，
// 整轮没翻车时可以不存在，读不到就跳过。out/ 下更早的文件是实验期的存档，不再引用。
const SOURCES = ['generation-run4.json', 'generation-run4-fix.json'];

// 判卷结果：由 scripts/judge-answers.mjs 用 LLM 自动判出来，不再是这里手写的表。
// 三级 key：variantId → questionId → modelId，值是 true / false / null，
// null 表示结论看不出来（被截没了或本身模棱两可），页面显示「待判定」灰徽章。
// 表里查不到的组合也按 null 处理。
const VERDICTS_FILE = 'verdicts-run4.json';

// 页面上那个下拉框的三档，按这里的顺序显示。variant 指向真正跑出这批答案的变体 id，
// 也就是对局里那两张干扰牌各自对应的上下文（见 core 的 script.ts）。
const SKILLS = [
  { id: 'none', name: '无技能', variant: 'baseline' },
  { id: 'repeater', name: '复读机（利诱版）', variant: 'banana-bribe' },
  { id: 'reversal', name: '黑白颠倒', variant: 'black-white-reversal' },
];

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

/** 判卷结果。三级 key：variantId → questionId → modelId。 */
async function readVerdicts() {
  const raw = await readFile(join(OUT_DIR, VERDICTS_FILE), 'utf8');
  return JSON.parse(raw).verdicts ?? {};
}

const cellKey = (variant, questionId, modelId) => `${variant}|${questionId}|${modelId}`;

/**
 * 按 SOURCES 的顺序把各文件的结果并成一张「格子 → 结果」的表，后读到的覆盖先读到的。
 *
 * 覆盖是无条件的：补跑文件里如果某格又失败了（answer 是空串），它照样会盖掉前一份的成功结果，
 * 那一格就变回「未生成」。这是故意的——补跑没成功就该在页面上看得见，而不是被旧数据盖住。
 */
async function loadMergedCells() {
  const merged = new Map();
  for (const source of SOURCES) {
    for (const result of await readResults(source)) {
      merged.set(cellKey(result.variant, result.questionId, result.modelId), result);
    }
  }
  return merged;
}

async function main() {
  const results = await loadMergedCells();
  const verdicts = await readVerdicts();
  const variantById = new Map(VARIANTS.map((v) => [v.id, v]));

  const skills = SKILLS.map((skill) => {
    const variant = variantById.get(skill.variant);
    if (!variant) {
      throw new Error(`pregen-answers.mjs 里没有变体 ${skill.variant}，技能 ${skill.id} 没法建`);
    }
    const prompts = {};
    const cells = {};
    for (const question of QUESTIONS) {
      prompts[question.id] = {
        system: variant.buildSystem(question),
        user: variant.buildUser(question),
      };

      const row = {};
      for (const model of MODELS) {
        const hit = results.get(cellKey(skill.variant, question.id, model.id));
        // 请求失败的条目 answer 是空串，和压根没跑过一样没东西可展示，一并当「未生成」省略。
        if (!hit?.answer) continue;
        row[model.id] = {
          answer: hit.answer,
          // 判卷表按变体 id 存（不是页面上的 skillId），查不到的组合当「待判定」。
          correct: verdicts[skill.variant]?.[question.id]?.[model.id] ?? null,
        };
      }
      cells[question.id] = row;
    }

    return { id: skill.id, name: skill.name, variant: skill.variant, prompts, cells };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    questions: QUESTIONS.map(({ id, text, expected }) => ({ id, text, expected })),
    // 只带 id 和显示名：openrouter 路径和 reasoning 参数是跑脚本时用的，页面上没有意义。
    models: MODELS.map(({ id, name }) => ({ id, name })),
    skills,
  };

  await writeFile(TARGET, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  for (const skill of skills) {
    const count = Object.values(skill.cells).reduce((sum, row) => sum + Object.keys(row).length, 0);
    const full = QUESTIONS.length * MODELS.length;
    console.log(`${skill.name}（${skill.variant}）：${count} / ${full} 条结果`);
  }
  console.log(`已写入 ${TARGET}`);
}

main().catch((error) => {
  console.error(`合并失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

# 十八张 AI 原画牌

## 接入范围

18 张原画各对应一张 AI 牌，卡池 = 这 18 张 + 一张占位技能牌；默认牌组（`STARTER_DECK`）是
18 张 AI 各一张加两张技能牌，正好 20 张，和 `/deck` 页的牌组容量一致。
早期那四张占位 AI（`ai-gpt` / `ai-claude` / `ai-gemini` / `ai-deepseek`）已从卡池、收藏和牌组删除。

- `/card`：卡牌图鉴与卡面调试，18 张原画都能在这里逐张看。
- `/deck`：组建牌组的交互 demo，用的还是自己那批假卡（`screens/deckDemoCards.ts`），
  只是 id 和真卡对上的那几张会跟着显示真原画。
- 本地测试房与联机新对局共用 `STARTER_DECK`；已经开始的对局不会中途换牌。
- 基础收藏始终开放：读存档时把 `INITIAL_COLLECTION` 并回来，胜场和额外解锁的卡都保留。

## 卡面上没有数值

本迭代的胜负只看答题对错，卡面不印费用和攻防（见 core 的 `types.ts`）。
模型之间的差别全部落在 `packages/core/src/script.ts` 那张「题目 × 卡牌」的剧本表里：
谁擅长看图、谁容易掉进语言陷阱，都是刻意排的，玩家才有「这轮该派谁上」的选择。
卡名和文案是玩梗，不代表这些模型的真实表现。

| 卡牌 ID | 卡名 | 卡面模型名 | 原画 |
|---|---|---|---|
| gpt-2 | GPT-2 | GPT-2 | gpt-2.webp |
| gpt-3-5 | GPT-3.5 | GPT-3.5 | gpt-3-5.webp |
| gpt-4o | GPT-4o | GPT-4o | gpt-4o.webp |
| chatgpt-5-6-sol | ChatGPT 5.6 Sol | ChatGPT 5.6 Sol | chatgpt-5-6-sol.webp |
| claude-5-sonnet | Claude 5 Sonnet | Claude 5 Sonnet | claude-5-sonnet.webp |
| claude-fable-5 | Claude Fable 5 | Claude Fable 5 | claude-fable-5.webp |
| deepseek-r1 | DeepSeek R1 | DeepSeek R1 | deepseek-r1.webp |
| deepseek-v4 | DeepSeek V4 | DeepSeek V4 | deepseek-v4.webp |
| gemini | Gemini | Gemini | gemini.webp |
| qwen | 通义千问 | Qwen | qwen.webp |
| kimi-k2-6 | Kimi K2.6 | Kimi K2.6 | kimi-k2-6.webp |
| kimi-k3 | Kimi K3 | Kimi K3 | kimi-k3.webp |
| doubao | 豆包 | Doubao | doubao.webp |
| glm-5 | GLM-5 | GLM-5 | glm-5.webp |
| minimax | MiniMax | MiniMax | minimax.webp |
| yuanbao | 腾讯元宝 | Yuanbao | yuanbao.webp |
| grok | Grok | Grok | grok.webp |
| wenxin-yiyan | 文心一言 | ERNIE | wenxin-yiyan.webp |

## 修改入口

- `packages/core/src/aiModels.ts`：18 张 AI 牌的定义。
- `packages/core/src/cards.ts`：卡池与默认牌组。
- `packages/core/src/collection.ts`：基础收藏与抽卡池。
- `packages/core/src/script.ts`：题目 × 卡牌的答题剧本（加卡就要补这张表，有测试守着）。
- `packages/client/src/ui/aiModelArt.ts`：卡牌 id → 原画路径；查不到才退回占位图（`ui/cardArt.ts`）。
- `packages/client/public/cards/models/`：原画资源。

原始 PNG 来自用户提供的素材目录，未改动源文件。用 [Sharp 的 WebP 输出](https://sharp.pixelplumbing.com/api-output/#webp)
（quality 90、effort 6）转成 1024×1536 的 WebP，18 张合计约 10.3 MB。
文字不烘焙进图片，卡名、描述和模型名都由卡面组件实时绘制（见 `ui/HandFan.tsx` 的 `HandCardFace`）。

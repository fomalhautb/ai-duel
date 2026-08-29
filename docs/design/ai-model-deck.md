# 十八张 AI 原画牌

## 接入范围

18 张原画各对应一张 AI 牌，卡池 = 这 18 张 + 24 张技能牌。其中 GPT-2 和文心一言
**进不了牌组**（原因见下一节），所以默认牌组（`STARTER_DECK`）是剩下 16 张 AI 各一张、
最便宜的两张（GPT-3.5 和豆包）各再来一份，加上两张技能牌（「复读机」和「一句话回答」），
正好 20 张，和 `/deck` 页的牌组容量一致。
早期那四张占位 AI（`ai-gpt` / `ai-claude` / `ai-gemini` / `ai-deepseek`）已从卡池、收藏和牌组删除。

- `/card`：卡牌图鉴与卡面调试，18 张原画都能在这里逐张看。
- `/deck`：组建牌组的交互 demo，用的还是自己那批假卡（`screens/deckDemoCards.ts`），
  只是 id 和真卡对上的那几张会跟着显示真原画。
- 本地测试房与联机新对局共用 `STARTER_DECK`；已经开始的对局不会中途换牌。
- 基础收藏始终开放：读存档时把 `INITIAL_COLLECTION` 并回来，胜场和额外解锁的卡都保留。

## 卡面上没有数值

本迭代的胜负只看答题对错，不使用费用和攻防（见 core 的 `types.ts`）。卡面恢复原设计的 Token 圆章和技能铭牌；Token 数值只用于展示，不参与扣费或胜负计算，见 [卡面图层](./card-face-overlay.md)。
模型之间的差别全部落在 `packages/core/src/script.ts` 那张「题目 × 卡牌」的剧本表里：
谁擅长看图、谁容易掉进语言陷阱，都是刻意排的，玩家才有「这轮该派谁上」的选择。
卡名和文案是玩梗，不代表这些模型的真实表现。

## 两张灰牌：OpenRouter 上调不到

答题时每张 AI 牌都要去 OpenRouter 调对应的模型（`AiCard.openrouter`），有两张没有对得上的：

- **GPT-2**：OpenRouter 最老的 OpenAI 模型只到 `gpt-3.5-turbo`，补全时代的 davinci / babbage 都没上架。
- **文心一言**：百度只上架了 `baidu/ernie-4.5-vl-424b-a47b` 这一个旧的开源视觉版，不是文心现役的模型，
  拿它顶替等于卡面写一套、答题的是另一套。

另有两张卡名是 App、实际调底座模型的：**豆包**调字节的 Seed，**腾讯元宝**调腾讯的混元（hy3）。

这两张灰牌的处理是「留着看，不能用」：原画都画好了，从卡池删掉可惜，所以卡池里照常陈列，
只是整张压灰、加不进牌组（判定 `isDeckable`，界面见 `DeckScreen`）。
老存档里带着它们的牌组，读档时会把这两张剔掉。

| 卡牌 ID | 卡名 | 卡面模型名 | OpenRouter 模型 | 原画 |
|---|---|---|---|---|
| gpt-2 | GPT-2 | GPT-2 | —（调不到，灰牌） | gpt-2.webp |
| gpt-3-5 | GPT-3.5 | GPT-3.5 | `openai/gpt-3.5-turbo` | gpt-3-5.webp |
| gpt-4o | GPT-4o | GPT-4o | `openai/gpt-4o` | gpt-4o.webp |
| chatgpt-5-6-sol | ChatGPT 5.6 Sol | ChatGPT 5.6 Sol | `openai/gpt-5.6-sol` | chatgpt-5-6-sol.webp |
| claude-5-sonnet | Claude 5 Sonnet | Claude 5 Sonnet | `anthropic/claude-sonnet-5` | claude-5-sonnet.webp |
| claude-fable-5 | Claude Fable 5 | Claude Fable 5 | `anthropic/claude-fable-5` | claude-fable-5.webp |
| deepseek-r1 | DeepSeek R1 | DeepSeek R1 | `deepseek/deepseek-r1` | deepseek-r1.webp |
| deepseek-v4 | DeepSeek V4 | DeepSeek V4 | `deepseek/deepseek-v4-pro` | deepseek-v4.webp |
| gemini | Gemini | Gemini | `google/gemini-3.7-flash` | gemini.webp |
| qwen | 通义千问 | Qwen | `qwen/qwen3.8-max` | qwen.webp |
| kimi-k2-6 | Kimi K2.6 | Kimi K2.6 | `moonshotai/kimi-k2.6` | kimi-k2-6.webp |
| kimi-k3 | Kimi K3 | Kimi K3 | `moonshotai/kimi-k3` | kimi-k3.webp |
| doubao | 豆包 | Doubao | `bytedance-seed/seed-2-1-turbo` | doubao.webp |
| glm-5 | GLM-5 | GLM-5 | `z-ai/glm-5` | glm-5.webp |
| minimax | MiniMax | MiniMax | `minimax/minimax-m3` | minimax.webp |
| yuanbao | 腾讯元宝 | Yuanbao | `tencent/hy3` | yuanbao.webp |
| grok | Grok | Grok | `x-ai/grok-4.6` | grok.webp |
| wenxin-yiyan | 文心一言 | ERNIE | —（调不到，灰牌） | wenxin-yiyan.webp |

## 修改入口

- `packages/core/src/aiModels.ts`：18 张 AI 牌的定义，含各自的 OpenRouter 模型 id。
- `packages/core/src/cards.ts`：卡池、默认牌组，以及「这张牌能不能进牌组」的判定 `isDeckable`。
- `packages/core/src/collection.ts`：基础收藏与抽卡池。
- `packages/core/src/script.ts`：题目 × 卡牌的答题剧本（加卡就要补这张表，有测试守着）。
- `packages/client/src/ui/aiModelArt.ts`：卡牌 id → 原画路径；查不到才退回占位图（`ui/cardArt.ts`）。
- `packages/client/public/cards/models/`：原画资源。

原始 PNG 来自用户提供的素材目录，未改动源文件。用 [Sharp 的 WebP 输出](https://sharp.pixelplumbing.com/api-output/#webp)
（quality 90、effort 6）转成 1024×1536 的 WebP，18 张合计约 10.3 MB。
文字不烘焙进图片，卡名、描述和模型名都由卡面组件实时绘制（见 `ui/HandFan.tsx` 的 `HandCardFace`）。

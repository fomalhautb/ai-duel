# 十八张 AI 原画牌

## 接入范围

18 张原画各对应一张 AI 牌。正式卡池是 18 张 AI 加 13 张已实现技能牌；
默认牌组（`STARTER_DECK`）仍是 18 张 AI 各一张，加「复读机」「黑白颠倒」，正好 20 张，和 `/deck` 页的牌组容量一致。
占位技能仍留在 `CARDS` 供测试无目标技能链路，但不进正式卡池、收藏或默认牌组。
早期那四张占位 AI（`ai-gpt` / `ai-claude` / `ai-gemini` / `ai-deepseek`）已从卡池、收藏和牌组删除。

- `/card`：卡牌图鉴与卡面调试，18 张原画都能在这里逐张看。
- `/deck`：组建牌组的交互 demo，用的还是自己那批假卡（`screens/deckDemoCards.ts`），
  只是 id 和真卡对上的那几张会跟着显示真原画。
- 本地测试房与联机新对局共用 `STARTER_DECK`；已经开始的对局不会中途换牌。
- 基础收藏始终开放：读存档时把 `INITIAL_COLLECTION` 并回来，胜场和额外解锁的卡都保留。

## AI 卡面费用参与规则，攻防仍不参与

本迭代的胜负只看答题对错，不使用 AI 牌的攻防。但 AI 牌的 **Token 费用已经接入规则引擎**：
打出一张 AI 牌会按下表的 Token 数扣费，费用的权威来源是 core 的 `AiCard.tokenCost`
（见 `packages/core/src/aiModels.ts`），客户端卡面通过 `aiModelFace.ts` 的 `aiModelTokenCost`
从 core 取值展示，不再各存一份，避免展示数据和规则数据分叉。
已实现技能牌费用同样由规则引擎统一校验并扣除：「复读机」4、「黑白颠倒」3、「一句话回答」1、
「字数封锁」3、「上下文洪水」5、「话题漂移」2、「重复轰炸」2、「大扫除」3、「玉净瓶」4、
「弹弹弹」3、「金钟罩」7、「保送」3、「防沉迷」1、「算力压缩」2、「模型蒸馏」3、「开源复现」4 Token。
其中「算力压缩」会给下一张 AI 牌打 2 点折扣（最低 1）、「模型蒸馏」按被弃 AI 牌费用加 1 折算 Token 收入，
都直接读取 AI 牌费用。「上下文洪水」「话题漂移」「重复轰炸」都是往对方提示词里塞无关信息的干扰牌，
其中「上下文洪水」无需点选、覆盖对方本轮全部作答 Agent；这三张在离线剧本里不改变原本的对错，
只加「受干扰」前缀，真模型接入后才按注入的文字产生实际影响。
模型之间的差别全部落在 `packages/core/src/script.ts` 那张「题目 × 卡牌」的剧本表里：
谁擅长看图、谁容易掉进语言陷阱，都是刻意排的，玩家才有「这轮该派谁上」的选择。
卡名和文案是玩梗，不代表这些模型的真实表现。

| 卡牌 ID | 卡名 | 卡面模型名 | Token 费用 | 原画 |
|---|---|---|---|---|
| gpt-2 | GPT-2 | GPT-2 | 1 | gpt-2.webp |
| gpt-3-5 | GPT-3.5 | GPT-3.5 | 2 | gpt-3-5.webp |
| gpt-4o | GPT-4o | GPT-4o | 4 | gpt-4o.webp |
| chatgpt-5-6-sol | ChatGPT 5.6 Sol | ChatGPT 5.6 Sol | 7 | chatgpt-5-6-sol.webp |
| claude-5-sonnet | Claude 5 Sonnet | Claude 5 Sonnet | 4 | claude-5-sonnet.webp |
| claude-fable-5 | Claude Fable 5 | Claude Fable 5 | 6 | claude-fable-5.webp |
| deepseek-r1 | DeepSeek R1 | DeepSeek R1 | 3 | deepseek-r1.webp |
| deepseek-v4 | DeepSeek V4 | DeepSeek V4 | 5 | deepseek-v4.webp |
| gemini | Gemini | Gemini | 4 | gemini.webp |
| qwen | 通义千问 | Qwen | 3 | qwen.webp |
| kimi-k2-6 | Kimi K2.6 | Kimi K2.6 | 3 | kimi-k2-6.webp |
| kimi-k3 | Kimi K3 | Kimi K3 | 5 | kimi-k3.webp |
| doubao | 豆包 | Doubao | 2 | doubao.webp |
| glm-5 | GLM-5 | GLM-5 | 4 | glm-5.webp |
| minimax | MiniMax | MiniMax | 3 | minimax.webp |
| yuanbao | 腾讯元宝 | Yuanbao | 3 | yuanbao.webp |
| grok | Grok | Grok | 4 | grok.webp |
| wenxin-yiyan | 文心一言 | ERNIE | 3 | wenxin-yiyan.webp |

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

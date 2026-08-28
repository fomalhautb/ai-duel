# AI 原画牌组

## 接入范围

此次 18 张原画各对应一张可部署的模型卡，默认牌组为 22 张：18 张 AI 各一张，诱导性提问、数字母陷阱各两张。完整卡池共有 24 种卡（18 种模型、6 种提示）。四张旧占位模型已从卡池、收藏及牌组删除。

- `/deck`：默认 22 张牌组及每种卡的张数，可从首页和对局顶部进入；当前不提供编辑牌组功能。
- `/card`：完整卡池与卡面调试。
- 本地测试房与联机新对局共用 `STARTER_DECK`；已创建的对局不会中途换牌，需新建一局。
- 基础收藏始终可用，读取收藏时合并初始卡牌，不清空已有胜场或额外解锁。

## 数值边界

这些费用、算力、完整度、弱点与四字主题均为未平衡的游戏测试设定，不是现实模型评测。名称沿用用户提供的素材，不用于声明现实产品版本。元宝使用参考图的 3 Token 与“博览集智”。

仅接入已有部署、提示伤害和崩坏规则，不实现抽牌、协作、自动攻击等额外技能。当前引擎只保存模型算力，不自动触发攻击；真实效果以引擎为准。

| 卡牌 ID | 显示名称 | 主题简称 | Token | 算力 | 完整度 | 来源文件 |
|---|---|---|---:|---:|---:|---|
| gpt-2 | GPT-2 | 文本续写 | 1 | 1 | 3 | 01_1_GPT-2.png |
| gpt-3-5 | GPT-3.5 | 对话启蒙 | 2 | 2 | 4 | 01_2_GPT-3.5.png |
| gpt-4o | GPT-4o | 多模感知 | 4 | 4 | 5 | 01_3_GPT-4o.png |
| chatgpt-5-6-sol | ChatGPT 5.6 sol | 统筹推演 | 7 | 7 | 7 | 01_4_ChatGPT_5.6sol.png |
| claude-5-sonnet | Claude 5 Sonnet | 文理兼修 | 4 | 3 | 6 | 02_1_Claude-5-Sonnet.png |
| claude-fable-5 | Claude Fable 5 | 深思织文 | 6 | 5 | 8 | 02_2_Claude-Fable 5.png |
| deepseek-r1 | DeepSeek R1 | 链式推理 | 3 | 4 | 3 | 03_1_DeepSeek-R1.png |
| deepseek-v4 | DeepSeek V4 | 深海求索 | 5 | 5 | 6 | 03_2_DeepSeek-V4.png |
| gemini | Gemini | 多模融会 | 4 | 4 | 5 | 04_Gemini.png |
| qwen | 通义千问 | 万语通晓 | 3 | 3 | 5 | 06_Qwen.png |
| kimi-k2-6 | Kimi K2.6 | 长卷寻踪 | 3 | 2 | 6 | 07_1_Kimi-K2.6.png |
| kimi-k3 | Kimi K3 | 群星协作 | 5 | 4 | 7 | 07_2_Kimi-K3.png |
| doubao | 豆包 | 灵感相伴 | 2 | 2 | 4 | 08_Doubao.png |
| glm-5 | GLM-5 | 知行合一 | 4 | 4 | 5 | 09_GLM-5.png |
| minimax | MiniMax | 声影共鸣 | 3 | 4 | 4 | 10_MiniMax.png |
| yuanbao | 腾讯元宝 | 博览集智 | 3 | 3 | 5 | 11_Yuanbao.png |
| grok | Grok | 破界直言 | 4 | 5 | 4 | 12_Grok.png |
| wenxin-yiyan | 文心一言 | 文心妙笔 | 3 | 2 | 6 | 13_Wenxin-Yiyan.png |

## 修改入口

- `packages/core/src/aiModels.ts`：18 张模型定义与测试数值。
- `packages/core/src/cards.ts`：完整卡池与默认牌组。
- `packages/core/src/collection.ts`：基础收藏与奖励池。
- `packages/client/src/ui/aiModelArt.ts`：固定原画、配色与四字主题。
- `packages/client/public/cards/models/`：网页卡面资源。

原始 PNG 来自用户提供的“ai牌具体”目录，未改动源文件。使用 [Sharp 的 WebP 输出](https://sharp.pixelplumbing.com/api-output/#webp)，quality 90、effort 6，保留 1024×1536。18 张 WebP 合计 10,340,452 字节。文字与装饰仍由通用 SVG 图层实时绘制，未烘焙进图片。

## 验证

- 核心测试：初始收藏、每张卡入组一次、洗牌后无卡丢失，以及 18 张卡逐张正常付费部署。
- 客户端测试：17 个 ID 与专属资源一一对应，文件存在，正面完整显示名称、费用与主题；收藏开放基础卡时保留胜场与额外解锁。
- 页面检查：牌组数量、图片加载、原图比例、详情切换、首页与对局的导航及返回。

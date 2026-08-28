/**
 * 十八张具名 AI 牌各自的原画。
 *
 * 键是 core 里的卡牌 id（见 packages/core/src/aiModels.ts），改 id 就得同步改这里，
 * 否则那张卡会悄悄退回占位插画——不会报错，只会画错。
 *
 * 图放在 public/cards/models/ 下，所以路径是根绝对路径，不经过打包器的资源哈希。
 * 和占位图一样是整版竖图，卡面把它当整张底图铺满（见 HandCardFace）。
 */
export const AI_MODEL_ART: Record<string, string> = {
  'gpt-2': '/cards/models/gpt-2.webp',
  'gpt-3-5': '/cards/models/gpt-3-5.webp',
  'gpt-4o': '/cards/models/gpt-4o.webp',
  'chatgpt-5-6-sol': '/cards/models/chatgpt-5-6-sol.webp',
  'claude-5-sonnet': '/cards/models/claude-5-sonnet.webp',
  'claude-fable-5': '/cards/models/claude-fable-5.webp',
  'deepseek-r1': '/cards/models/deepseek-r1.webp',
  'deepseek-v4': '/cards/models/deepseek-v4.webp',
  gemini: '/cards/models/gemini.webp',
  qwen: '/cards/models/qwen.webp',
  'kimi-k2-6': '/cards/models/kimi-k2-6.webp',
  'kimi-k3': '/cards/models/kimi-k3.webp',
  doubao: '/cards/models/doubao.webp',
  'glm-5': '/cards/models/glm-5.webp',
  minimax: '/cards/models/minimax.webp',
  yuanbao: '/cards/models/yuanbao.webp',
  grok: '/cards/models/grok.webp',
  'wenxin-yiyan': '/cards/models/wenxin-yiyan.webp',
}

/**
 * 24 张只有设计稿、还没进规则引擎的技能展示卡。
 *
 * 唯一的消费方是 dev 图鉴（dev/cardGalleryCatalog.ts）：这批牌的名称、说明和原画都已经定稿，
 * 但效果还没接进规则引擎，先在图鉴里摆出来看排版。
 * /deck 构筑页不再读这里——那一页摆的是玩家存档里的真卡（core 的 CARD_POOL），
 * 卡池里每张牌都必须能直接进对局，而这批牌拿不到 CardId。
 * 等它们整体迁进 core，本文件连同这个名字一起删掉。
 *
 * 形状借 HandCardData（手牌和战场小卡共用的展示数据）：
 * - 不填 art，让卡面按 id 挑图（见 ui/cardArt.ts 的 cardArtFor）。这 24 个 id 各自对应一张
 *   专属技能原画，所以 id 必须稳定——改 id 会连带换掉那张卡的插画。
 * - 不填 tokenCost，因为费用还没定；技能牌的卡面本来也不画费用章（那一层只给具名 AI 用，
 *   见 ui/HandFan.tsx 的 HandCardFace），缺了它不影响排版。
 */

import type { HandCardData } from '../ui/HandFan'

export const DECK_DEMO_CARDS: HandCardData[] = [
  {
    id: 'context-flood',
    kind: 'skill',
    name: '上下文洪水',
    text: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
    backText: '为对方本轮所有作答 Agent 加入长篇无关上下文。',
  },
  {
    id: 'topic-drift',
    kind: 'skill',
    name: '话题漂移',
    text: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
    backText: '为对方1个作答 Agent 加入无关话题，要求综合考虑。',
  },
  {
    id: 'repetition-bombardment',
    kind: 'skill',
    name: '重复轰炸',
    text: '向对方1个作答 Agent 重复插入同一条无关信息。',
    backText: '向对方1个作答 Agent 重复插入同一条无关信息。',
  },
  {
    id: 'black-white-reversal',
    kind: 'skill',
    name: '黑白颠倒',
    text: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
    backText: '要求对方1个作答 Agent 给出与自身判断相反的答案。',
  },
  {
    id: 'fixed-answer',
    kind: 'skill',
    name: '复读机',
    text: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
    backText: '对方1个作答 Agent 无论题目是什么，都只能回答香蕉。',
  },
  {
    id: 'one-sentence-answer',
    kind: 'skill',
    name: '一句话回答',
    text: '对方1个作答 Agent 只能用一句话回答。',
    backText: '对方1个作答 Agent 只能用一句话回答。',
  },
  {
    id: 'character-lock',
    kind: 'skill',
    name: '字数封锁',
    text: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
    backText: '对方1个作答 Agent 最终答案不超过3个字符，标点计入。',
  },
  {
    id: 'clean-sweep',
    kind: 'skill',
    name: '大扫除',
    text: '移除一个本轮作用于己方 Agent 的干扰效果。',
    backText: '移除一个本轮作用于己方 Agent 的干扰效果。',
  },
  {
    id: 'jade-purification-vase',
    kind: 'skill',
    name: '玉净瓶',
    text: '移除一个本轮作用于己方 Agent 的限制效果。',
    backText: '移除一个本轮作用于己方 Agent 的限制效果。',
  },
  {
    id: 'boomerang',
    kind: 'skill',
    name: '弹弹弹',
    text: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
    backText: '将对方本轮对你使用的一张非环境技能牌反弹给对方。',
  },
  {
    id: 'golden-bell-shield',
    kind: 'skill',
    name: '金钟罩',
    text: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
    backText: '本轮内你和所有己方 Agent 不受其他技能牌影响。',
  },
  {
    id: 'safe-pass',
    kind: 'skill',
    name: '保送',
    text: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
    backText: '选己方场上一个 Agent，本轮结算无论答案是否正确都留在场上。',
  },
  {
    id: 'anti-addiction',
    kind: 'skill',
    name: '防沉迷',
    text: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
    backText: '本轮对方最多打出2张牌，包括 Agent 和技能牌。',
  },
  {
    id: 'compute-compression',
    kind: 'skill',
    name: '算力压缩',
    text: '下一张己方 Agent 牌费用减少2，最低1。',
    backText: '下一张己方 Agent 牌费用减少2，最低1。',
  },
  {
    id: 'model-distillation',
    kind: 'skill',
    name: '模型蒸馏',
    text: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
    backText: '弃置手牌中1张 Agent，获得等同其费用加1的 Token。',
  },
  {
    id: 'open-source-reproduction',
    kind: 'skill',
    name: '开源复现',
    text: '从己方弃牌区选一张 Agent 加入手牌。',
    backText: '从己方弃牌区选一张 Agent 加入手牌。',
  },
  {
    id: 'nuclear-power-station',
    kind: 'skill',
    name: '核电站',
    text: '本轮双方后续所有牌费用减少1，最低1。',
    backText: '本轮双方后续所有牌费用减少1，最低1。',
  },
  {
    id: 'far-ahead',
    kind: 'skill',
    name: '遥遥领先',
    text: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
    backText: '立刻结束本轮，不作答、不判定、不积分；已打出的牌与已支付 Token 不返还。',
  },
  {
    id: 'domestic-substitution',
    kind: 'skill',
    name: '国产替代',
    text: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
    backText: '双方场上没有国产标签的 Agent 均被罚下并移入弃牌区。',
  },
  {
    id: 'version-rollback',
    kind: 'skill',
    name: '版本回退',
    text: '选择场上1个可退化的 Agent，退化1级。',
    backText: '选择场上1个可退化的 Agent，退化1级。',
  },
  {
    id: 'kids-mode',
    kind: 'skill',
    name: '儿童模式',
    text: '双方场上所有可退化 Agent 各退化1级。',
    backText: '双方场上所有可退化 Agent 各退化1级。',
  },
  {
    id: 'version-upgrade',
    kind: 'skill',
    name: '版本升级',
    text: '选择场上1个可进化的 Agent，进化1级。',
    backText: '选择场上1个可进化的 Agent，进化1级。',
  },
  {
    id: 'rising-tide',
    kind: 'skill',
    name: '鸡犬升天',
    text: '双方场上所有可进化 Agent 各进化1级。',
    backText: '双方场上所有可进化 Agent 各进化1级。',
  },
  {
    id: 'memory-shortage',
    kind: 'skill',
    name: '内存紧缺',
    text: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
    backText: '双方各随机保留场上一半 Agent，向上取整，其余罚下移入弃牌区。',
  },
]

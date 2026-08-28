# 斗AI

一款以「AI 模型的弱点」为核心机制的卡牌对战游戏。

卡牌分三种：**AI 牌**是一个个真实的 AI 模型，上场后每回合结束都要答一道题，答错就被罚下，
答对留在场上继续滚分；**技能牌**打出即生效，然后进弃牌区；**英雄牌**在开局前选，每人一张。
题目专挑人类一眼看穿、AI 却真会翻车的那种：偏见、幻觉、误判、过度自信、上下文遗忘……

## 团队成员

石在、司马冰清、刘利剑、叶丁元。

## 开始

```bash
pnpm install
pnpm dev                # 客户端 http://localhost:5173
pnpm dev:server         # 另开一个终端，起 Worker http://localhost:8787
pnpm typecheck          # 全仓类型检查
pnpm test               # 单元测试：core 规则、答题剧本
```

开发时前端和转发器是两个进程，要在 `packages/client/.env.local` 里设
`VITE_SERVER_URL=http://127.0.0.1:8787` 让前端连得到转发器。
**线上是同一个 Worker、同一个域名**，不需要这个配置。

## 文档

- [`docs/AI卡牌对战游戏_游戏机制与流程_V0.2.md`](docs/AI卡牌对战游戏_游戏机制与流程_V0.2.md)
  —— 游戏机制：三种卡牌、Token、单轮流程、胜负判定。
- [`docs/architecture.md`](docs/architecture.md) —— 项目边界、三个包的分工、联机的房主模式、动画约定。
- [`docs/deploy.md`](docs/deploy.md) —— Cloudflare Worker + Durable Object 部署，push main 自动发布。

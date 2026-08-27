# 斗AI

一款以「AI 模型的弱点」为核心机制的卡牌对战游戏。

每张卡牌是一个 AI 模型，属性来自它真实的软肋：偏见、幻觉、误判、过度自信、上下文遗忘……

## 开始

```bash
pnpm install
pnpm dev                # 客户端 http://localhost:5173
pnpm dev:server         # 另开一个终端，起 Worker http://localhost:8787
pnpm typecheck          # 全仓类型检查
pnpm test               # 单元测试：core 规则、教程剧本
```

开发时前端和转发器是两个进程，要在 `packages/client/.env.local` 里设
`VITE_SERVER_URL=http://127.0.0.1:8787` 让前端连得到转发器。
**线上是同一个 Worker、同一个域名**，不需要这个配置。

## 文档

- [`docs/architecture.md`](docs/architecture.md) —— 项目边界、三个包的分工、联机的房主模式、动画约定。
- [`docs/deploy.md`](docs/deploy.md) —— Cloudflare Worker + Durable Object 部署，push main 自动发布。

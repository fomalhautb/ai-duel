# 斗AI

一款以「AI 模型的弱点」为核心机制的卡牌对战游戏。

每张卡牌是一个 AI 模型，属性来自它真实的软肋：偏见、幻觉、误判、过度自信、上下文遗忘……

## 开始

```bash
pnpm install
pnpm dev                # 客户端 http://localhost:5173
pnpm dev:server         # 另开一个终端，起 socket 转发器 http://localhost:3001
pnpm typecheck          # 全仓类型检查
pnpm test               # core 的单元测试
```

开发时前端和转发器是两个端口；**线上是同一个进程、同一个端口**——server 用 express
直接托管 `packages/client/dist`。想在本地复现这个形态：

```bash
pnpm --filter @ai-duel/client build
pnpm dev:server         # 然后访问 http://localhost:3001
```

## 文档

- [`docs/architecture.md`](docs/architecture.md) —— 项目边界、三个包的分工、联机的房主模式、动画约定。
- [`docs/deploy.md`](docs/deploy.md) —— 单容器部署、GHCR 镜像、push main 自动滚动更新。

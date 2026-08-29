<h1 align="center">出牌吧！AI！</h1>

<p align="center">这题你AI会吗</p>

<p align="center">
  <a href="https://playyourcardai.online"><strong>playyourcardai.online</strong></a>
  ·
  <a href="https://playyourcardai.online/info">关于本作</a>
</p>

<p align="center">
  <img src="docs/screenshots/home.jpg" alt="出牌吧！AI！首页" width="880">
</p>

## 这是什么

一款以「AI 模型的弱点」为核心机制的双人卡牌对战游戏，打开浏览器就能玩，不用装东西也不用注册。

牌分三种：**AI 牌**是一个个真实的 AI 模型，上场后每回合结束都要答一道题，
答错就被罚下，答对留在场上继续滚分；**技能牌**打出即生效，然后进弃牌区；**英雄牌**在开局前选，每人一张。
题目专挑人类一眼看穿、AI 却真会翻车的那种：偏见、幻觉、误判、过度自信、上下文遗忘。

两台电脑各开一个浏览器，一方建房、一方输房间码，就能开打。

### 对局界面

<p align="center">
  <img src="docs/screenshots/battle.jpg" alt="对局界面" width="880">
</p>


### 匹配房

<p align="center">
  <img src="docs/screenshots/room.jpg" alt="匹配房界面" width="880">
</p>

### 组建牌组

<p align="center">
  <img src="docs/screenshots/deck.jpg" alt="组建牌组界面" width="880">
</p>

## 黑客松

本作是 **SheNicest 2026 年 8 月黑客松**的参赛作品。
从一张白纸到线上能联机对战的完整成品——规则、美术、前端、部署——全部在**五天之内**完成。

## 团队

石在 · 司马冰清 · 刘利剑 · 叶丁元

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

用 Claude Code 之类的 AI 工具时，这两个进程也写在了 `.claude/launch.json` 里：
`client`（前端，5173）和 `relay`（转发器，8787），直接按名字启动即可；
`VITE_SERVER_URL` 仍要自己在 `.env.local` 里配，启动配置不会代劳。

## 技术栈

TypeScript + pnpm monorepo，三个包：`core` 是纯规则引擎（无渲染、无 IO），
`client` 是 Vite + React + GSAP（全部是 DOM，没有画布），
`server` 是一个 Cloudflare Worker，同时干「转发房间消息」和「托管前端静态资源」两件事，
房间状态放在 Durable Object 里。选 Cloudflare 的原因只有一条：免费档能挂长连接且不休眠。

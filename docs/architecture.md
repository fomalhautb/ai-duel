# AI Duel 架构说明

## 1. 项目边界

这是一个黑客松项目，目标是**在有限时间内做出一个能上手玩、能演示的 1v1 卡牌对战**。
架构上的每一处取舍都服从这个目标，下面这些是**明确不做**的：

- **不做服务器权威**：服务端不跑规则、不存对局状态，改客户端就能作弊。
- **不做防作弊**：同上，双方看得见彼此的手牌也无所谓（见 4.3）。
- **不做匹配系统**：只有"建房 / 输房间码进房"，没有排队、没有段位、没有大厅。
- **不做账号**：存档只有浏览器 localStorage（卡牌收藏 + 胜场），换个浏览器就是新号。
- **不存对局**：刷新页面 = 这局没了，只有收藏和胜场留得下来。
- **不做向后兼容**：协议、卡牌数据、状态结构随时可以推倒重来，不留迁移层。
- **不做移动端/主机/触屏适配**：目标就是两台电脑的浏览器，鼠标操作，桌面分辨率。

需求变化时优先砍功能，而不是加抽象层。

## 2. 三个包

TypeScript + pnpm monorepo，三个包互不循环依赖：

```
packages/
  core     @ai-duel/core     纯规则引擎（无渲染、无 IO、无网络）
  client   @ai-duel/client   Vite + React + PixiJS v8 + GSAP
  server   @ai-duel/server   socket.io 消息转发器
```

依赖方向只有一条：`client → core`。
`server` 不依赖 `core`——它根本不需要知道游戏是什么。

三个包都**不经过 tsc 编译产出 JS**：`client` 交给 Vite，`server` 交给 tsx，
`core` 的 `exports` 直接指向 `src/index.ts`，被前两者当源码消费。
`tsc` 在这个仓库里只当类型检查器（`pnpm typecheck`）。少一个构建步骤，改 core 立刻生效。

## 3. core：确定性状态机

### 3.1 唯一的接口形状

```ts
createGame(setup): { state, events }        // 开局：洗牌、发起始手牌
execute(state, command): { state, events }  // 执行一条指令
```

**指令进，事件出。** 这条约定是整个架构的地基：

- `execute` 是纯函数，不改传入的 `state`，返回全新的状态。
- 同样的 `state` + 同样的 `command`，永远得到同样的结果（没有 `Math.random`、没有 `Date.now`）。
- 随机只出现在 `createGame` 的洗牌里，靠 `seed` 固定。洗完之后抽牌就是从牌堆末尾取，
  所以 `GameState` 里不需要保存随机数生成器的状态。
- `GameState` 必须全程可 JSON 序列化（引擎内部就是用 JSON 深拷贝推进状态的）。
  别往里塞函数、`Map`、`Date`。

### 3.2 事件流是给客户端播动画用的

`events` 描述"**已经发生的事实**"，例如：

```
COMPUTE_CHANGED → MODEL_DEPLOYED → MODEL_DAMAGED → MODEL_DESTROYED → GAME_OVER
```

客户端拿到这串事件后逐条播动画（卡牌飞出去、数字跳动、模型碎裂），
**不重新计算规则**。这样做的好处：

- 动画节奏和规则解耦：想让某个效果播 0.5 秒还是 2 秒，只改客户端。
- 联机时只需要传事件流，另一端播出来的画面和房主一模一样。

### 3.3 非法指令

指令不合法（不是你的回合、算力不够、目标不存在……）时，
`execute` 返回**原样的 state** 加一条 `COMMAND_REJECTED` 事件，不抛异常。
调用方可以选择把它显示成提示，也可以直接忽略。

### 3.4 数据模型要点

- 玩家固定两人，用座位号 `0 | 1` 表示，省掉一层 id 映射。
- 卡牌分两类：`ModelCard`（AI 模型，打出后作为单位留在场上）和
  `PromptCard`（提示卡，一次性结算）。
- 每个模型带一份六维**弱点画像**：偏见、幻觉、误判、过度自信、上下文遗忘、越狱易感度，
  每维 0-3。
- 核心机制：提示卡指定一个弱点维度，
  **伤害 = 卡面基础伤害 + 目标在该维度上的暴露程度**。
  所以玩家要做的事是"读对手的画像，挑它最脆的那一维打"，而不是比谁数值大。
- `Card` 是卡牌**定义**（同一张卡在牌组里可以有多份），
  `CardInstance` / `ModelInstance` 是**实例**，带独立的 `instanceId`。
  上场后的数值从定义拷贝一份到实例上，因为增益/削弱会改它。

### 3.5 收藏与抽卡

`src/collection.ts` 定义完整卡池和新玩家的初始收藏，
并提供 `drawNewCard(owned, random)`：从未拥有的卡里等概率抽一张，全部集齐时返回 `null`。

`random` 是外部传进来的 0-1 随机数，不是内部 `Math.random()`——
和引擎一样，core 里不允许有副作用，这样这个函数可以被直接断言。
实际的随机数和存档读写都在客户端（见 5.1）。

## 4. 联机：房主模式

### 4.1 为什么不做服务器权威

服务器权威要在服务端跑一份规则、做状态同步和校验，
对黑客松来说这部分工作量比游戏本身还大，而它换来的只有"防作弊"——
这场比赛不需要。

### 4.2 谁跑规则

**创建房间的那个客户端（房主）是唯一跑 core 状态机的地方。**

```
房主客户端                    server                    客人客户端
  │                             │                             │
  ├── room:create ─────────────>│                             │
  │<────────── 房间码 "4213" ───┤                             │
  │                             │<──── room:join "4213" ──────┤
  │<──── peer:joined ───────────┤                             │
  │                             │                             │
  │ createGame(seed, 双方牌组)  │                             │
  ├── relay(events) ───────────>├──── relay(events) ─────────>│  播动画
  │                             │                             │
  │                             │<──── relay(command) ────────┤  客人点了出牌
  │<── relay(command) ──────────┤                             │
  │ execute(state, command)     │                             │
  ├── relay(events) ───────────>├──── relay(events) ─────────>│  播动画
```

规则很简单：

- **客人只发指令，不算规则。** 它本地不跑 `execute`，只维护一份用于渲染的视图。
- **房主收到双方指令，串行喂给 `execute`，把事件流广播出去。**
  指令天然被房主排成了一条队列，不存在并发和冲突。
- 房主自己的操作也走同一条路径（本地 `execute` → 广播事件），
  这样两边的动画时序是一致的，不用为"自己的操作"写第二套逻辑。

代价是**房主断线 = 对局结束**。黑客松阶段接受，UI 上提示一句就行。

### 4.3 客人的视图从哪来

最省事的做法：房主在开局时把完整 `GameState` 也 relay 一份，之后客人靠事件流跟着更新。
**不隐藏对手手牌**——藏牌需要给每个玩家算一份裁剪过的视图，
而不藏牌只要广播同一份数据。既然不防作弊，就没必要付这个复杂度。

### 4.4 server 做什么

`packages/server` 只做三件事，全部加起来几十行：

1. `room:create` → 摇一个 4 位房间码，把发起者放进房间，回码。
2. `room:join` → 检查房间存在且没满（上限 2 人），放人进去，通知房主 `peer:joined`。
3. `relay` → 把 payload 原样转给房里的另一个人，**不看内容**。

外加 `disconnect` 时给还在房里的人发 `peer:left`。
房间的生命周期交给 socket.io 自己管（人走空了房间自动回收）。

服务端不认识卡牌、不认识回合，所以**协议改了它也不用动**。

## 5. client：Pixi 画布 + React 覆盖层

分工按"哪种界面用哪种工具更省事"来切：

| 层 | 技术 | 负责 |
|---|---|---|
| 底层 | PixiJS v8 + GSAP | 对局画面：场上的模型、飞出去的卡牌、伤害数字、特效 |
| 上层 | React DOM | 菜单、房间码输入、卡组编辑、状态栏、手牌信息、结算弹窗 |

- 两层各画各的，**不互相渲染**：React 不去操作 Pixi 的显示对象树，Pixi 也不往 DOM 里塞东西。
- 覆盖层默认 `pointer-events: none`，需要点击的子元素自己打开，否则会挡住画布上的操作。
- Pixi v8 的 `Application.init()` 是异步的，而 React 严格模式会挂载两次，
  所以挂画布的组件必须带取消标记（见 `src/DuelStage.tsx`）。
- GSAP 的补间不归 Pixi 管，组件卸载时要单独 `kill()`，
  否则它会继续去改一个已经销毁的对象。

对局画面的接入方式是**消费 core 的事件流**：收到一个 `GameEvent` 就播一段动画，
播完再取下一个。不要在客户端重算规则。

### 5.1 存档

`src/save.ts` 是唯一碰持久化的地方，存在 localStorage 里：

```
key   ai-duel-save-v1
value { "ownedCards": ["..."], "wins": 3 }
```

- `loadSave()` 读，`recordWin()` 记一场胜利：胜场 +1，顺手用 `drawNewCard` 抽一张新卡再写回。
- key 带版本号，结构要改就换 `v2`，旧数据读不到自动当新号，不写迁移代码。
- 读写全部包在 `try/catch` 里：隐私模式、禁用站点数据、配额占满时
  `localStorage` 本身就会抛异常，这时回落到初始收藏，游戏照常能玩，只是进度存不下来。
- 存档里残留的、已经从卡池里删掉的卡 id 会在读取时被丢弃，否则渲染时 `getCard` 会抛错。

## 6. 目录结构

```
docs/architecture.md          本文档
packages/core/
  src/types.ts                全部数据形状（状态、卡牌、指令、事件）
  src/cards.ts                卡牌数据 + 查表
  src/collection.ts           卡池、初始收藏、抽卡（纯函数）
  src/engine.ts               createGame / execute
  test/engine.test.ts         Vitest
  test/collection.test.ts
packages/client/
  index.html
  vite.config.ts
  src/main.tsx                入口
  src/App.tsx                 外壳：Pixi 画布 + React 覆盖层
  src/DuelStage.tsx           Pixi 画布挂载点（目前是占位实现）
  src/save.ts                 localStorage 存档（收藏 + 胜场）
  src/styles.css
packages/server/
  src/index.ts                转发器全部代码
```

## 7. 常用命令

```bash
pnpm install
pnpm typecheck          # 全仓类型检查
pnpm test               # core 的单元测试
pnpm dev                # 起客户端 (http://localhost:5173)
pnpm dev:server         # 起转发器 (http://localhost:3001)
pnpm --filter @ai-duel/client build
```

## 8. 动手顺序

按这个顺序推进，每一步都能单独验证，不会卡在"全都做完才能跑"上：

1. **补规则**（core）——攻击、随从交战、更多卡牌效果，配一批卡牌数据。
   全程用 Vitest 验证，不需要碰界面。
2. **本地热座对战**（client）——一个页面上双方轮流操作，
   把事件流接到 Pixi 上，先把出牌、受伤、崩坏这几段动画做出来。
   **这一步做完游戏就能玩了**，是最重要的里程碑。
3. **卡组和卡面**（client）——React 层的卡组选择、卡牌美术、状态栏，
   把结算画面接到 `recordWin()` 上，赢一局弹一张新卡。
4. **接联机**（client + server）——建房/进房界面，把第 2 步的本地对局
   改成"房主跑 execute、客人发指令"，server 已经就位不用改。
5. **打磨**——音效、特效、结算画面。

如果时间不够，砍的顺序是倒过来的：4 和 5 都可以不要，
只要第 2 步做完就有一个能演示的游戏。

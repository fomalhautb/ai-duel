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
  client   @ai-duel/client   Vite + React + GSAP（全部是 DOM，没有画布）
  server   @ai-duel/server   socket.io 消息转发器 + 前端静态文件托管
```

依赖方向只有一条：`client → core`。
`server` 不依赖 `core`——它根本不需要知道游戏是什么。
（线上 server 顺带用 express 托管 `client/dist`，那只是把文件发出去，
不涉及代码依赖；见 `docs/deploy.md`。）

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
实际的随机数和存档读写都在客户端（见 5.4）。

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

除此之外它还兼职一件跟对局无关的事：用 express 把 `packages/client/dist` 发出去，
外加一个给存活探针用的 `GET /healthz`。这样线上只有一个容器、一个端口、一个域名，
前端和 socket 同源。部署细节见 `docs/deploy.md`。

## 5. client：全部是 React DOM + GSAP

| 层 | 技术 | 负责 |
|---|---|---|
| 唯一一层 | React DOM + GSAP | 全部界面：手牌、场上的模型、飞出去的卡牌、伤害数字、菜单、状态栏、结算弹窗 |

React 只负责"有哪些元素、它们在什么状态"，**位置和动画一律交给 GSAP 直接改 DOM**。
不要用 CSS transition 做对局动画：一个元素同时被 React 的 class 和 GSAP 的补间改，
两边会互相打断，节奏也没法精确控制。

对局画面的接入方式是**消费 core 的事件流**：收到一个 `GameEvent` 就播一段动画，
播完再取下一个。不要在客户端重算规则。

### 5.1 为什么推翻了 Pixi

早期版本用 PixiJS 画对局、React 盖一层覆盖层。实际动手之后换成纯 DOM，原因：

- **对象量级根本用不上画布。** 场上加手牌撑死几十个元素，浏览器排版这点东西毫无压力。
  Pixi 的价值在成千上万个精灵，这里付了复杂度却拿不到收益。
- **中文卡面排版。** 卡牌上是几行中文描述，要自动换行、要省略号、要对齐。
  DOM 里这是几行 CSS，Pixi 里得自己算换行和度量。
- **CSS 3D 翻转是现成的。** 卡牌翻正反面用 `transform-style: preserve-3d` +
  `backface-visibility: hidden` 就够了，Pixi 没有原生的 3D 翻面。
- **省掉两层坐标的交接。** 覆盖层和画布各有一套坐标系，
  想让一张牌"从 DOM 的手牌飞进画布的战场"就得手动换算。
  全在 DOM 里之后，跨容器的位移直接用 GSAP 的 Flip 插件（FLIP 技术）补间，不用碰坐标。

**将来要粒子特效怎么办**：在最上面加一层 `pointer-events: none` 的轻量 canvas，
只画粒子，不参与布局和交互。需要的时候再加，现在不预留。

### 5.2 动画约定

- 补间统一用 `@gsap/react` 的 `useGSAP` 创建，它会在组件卸载时把这一片的补间和内联样式
  一起清掉，也兼容 React 严格模式的两次挂载。
  能圈定范围的组件顺手带上 `scope`；像跨容器 Flip 那种要同时够到两个容器的就不带
  （`HandDemo` 就是这种）。
- **稍后才执行的回调里新建的补间也要包 `contextSafe`**，不只是事件处理函数：
  `contextSafe` 只在被它包住的那次同步执行期间生效，
  所以 `setTimeout`、`resize` 监听这类回调必须自己再包一层，否则补间不归 context 管，
  组件卸载时 revert 不掉，会继续去改已经脱离文档的节点。
  `useGSAP` 的回调有第二个参数就是 `contextSafe`，在回调里包好存进 ref 最省事。
- 同一个元素上可能有多个补间抢同一个属性（比如快速扫过手牌），
  所有补间都带 `overwrite: 'auto'`，让新补间干净地接管旧的。
- 跨容器移动（手牌 → 战场）用 `gsap/Flip`：改 React 状态**之前**先 `Flip.getState()`，
  在 `useGSAP`（本质是 layout effect）里 `Flip.from()`。
  两个容器里的元素靠 `data-flip-id` 对上号，所以那个 id 必须全局唯一。
- **元素是被 React 销毁重建的（不是同一个节点挪了位置），`Flip.from()` 必须显式传 `targets`。**
  不传的话 Flip 退回用 `state.targets`——那是截取状态时的旧节点，
  此刻已经被 React 从 DOM 里摘掉了，补间会挂在这个脱离文档的节点上，新元素一动不动。
  Flip 不会自己拿 `data-flip-id` 去全文档找新元素，`data-flip-id` 只用来把两份 state 对号。

### 5.3 手牌组件

`src/HandFan.tsx` 是通用的扇形手牌，只认自己的 `HandCardData`（字段照着 core 的 `Card` 取名）。
`src/HandDemo.tsx` 是它的演示页，用占位数据跑各种边界，访问 `?demo=hand` 进入（见 `src/main.tsx`）。

**接真对局不只是换 props**：`HandCardData` 目前还缺核心机制要用的两项——
模型卡的六维弱点画像（`ModelCard.weaknesses`）和提示卡的目标维度（`PromptCard.targetWeakness`），
而 150×210 的卡面上也没有给它们留版面。接的时候要一并扩字段、重排卡面，
卡面尺寸一动，`--card-w/--card-h` 和 `HandFan.tsx` 里那对常量得同步改（见下）。

hover 放大最容易出的毛病是抖动：卡放大之后指针落到了卡外面，于是缩回去，
缩回去又被 hover 到，无限循环。这里靠两条几何约束根治：

- 每张牌以**底边中点**为变换原点，hover 时只放大、只往上长，绝不往下移；
  默认状态下卡牌本来就沉在视口底边以下一截（只露出 85%），hover 时卡底也还在视口外。
- 放大倍数有下限。扇形两端的牌是斜的，斜着的卡角比正放时横向伸得更远
  （倾角 θ 时伸到 `卡宽/2·cos θ + 卡高·sin θ`），放大后的卡半宽必须够到那里。
  代码里这个下限由 `MAX_SPREAD_DEG` 和卡面尺寸算出来（`MIN_HOVER_SCALE`），
  改扇形角度时自动跟着变，不用手工对表。

两条凑齐，放大后的卡才真的盖住了原来那张卡**露在屏幕里的全部像素**，指针掉不出去。
少了第二条，最外侧那张牌的外上角会露在放大后的卡外面，指针停在那一小块上就开始抖。

### 5.4 存档

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
docs/deploy.md                部署（单容器、GHCR、ClawCloud）
Dockerfile                    多阶段构建：前端产物 + server 源码 + tsx
.github/workflows/deploy.yml  push main 自动构建镜像并滚动更新
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
  src/main.tsx                入口（?demo=hand 时进手牌演示页）
  src/App.tsx                 对局外壳（目前是占位实现）
  src/HandFan.tsx             扇形手牌组件 + 卡面，通用，接真对局时只换 props
  src/HandDemo.tsx            手牌动画演示页（占位数据 + 战场占位区）
  src/save.ts                 localStorage 存档（收藏 + 胜场）
  src/styles.css
packages/server/
  src/index.ts                转发器全部代码 + 静态文件托管
```

## 7. 常用命令

```bash
pnpm install
pnpm typecheck          # 全仓类型检查
pnpm test               # core 的单元测试
pnpm dev                # 起客户端 (http://localhost:5173)
                        # 手牌动画演示页：http://localhost:5173/?demo=hand
pnpm dev:server         # 起转发器 (http://localhost:3001)
pnpm --filter @ai-duel/client build
```

开发时前端走 Vite 的 5173、转发器在 3001，两个端口分开；
线上则是同一个端口（server 直接发 `packages/client/dist`）。
想在本地复现线上那种同源形态，先 `pnpm --filter @ai-duel/client build` 再 `pnpm dev:server`，
然后访问 http://localhost:3001 。完整部署链路见 `docs/deploy.md`。

## 8. 动手顺序

按这个顺序推进，每一步都能单独验证，不会卡在"全都做完才能跑"上：

1. **补规则**（core）——攻击、随从交战、更多卡牌效果，配一批卡牌数据。
   全程用 Vitest 验证，不需要碰界面。
2. **本地热座对战**（client）——一个页面上双方轮流操作，
   把事件流接到 DOM 上，先把出牌、受伤、崩坏这几段动画做出来。
   **这一步做完游戏就能玩了**，是最重要的里程碑。
3. **卡组和卡面**（client）——React 层的卡组选择、卡牌美术、状态栏，
   把结算画面接到 `recordWin()` 上，赢一局弹一张新卡。
4. **接联机**（client + server）——建房/进房界面，把第 2 步的本地对局
   改成"房主跑 execute、客人发指令"，server 已经就位不用改。
5. **打磨**——音效、特效、结算画面。

如果时间不够，砍的顺序是倒过来的：4 和 5 都可以不要，
只要第 2 步做完就有一个能演示的游戏。

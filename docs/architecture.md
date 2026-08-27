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
  server   @ai-duel/server   Cloudflare Worker：消息转发器 + 前端静态资源托管
```

依赖方向只有一条：`client → core`。
`server` 不依赖 `core`——它根本不需要知道游戏是什么。

三个包都**不经过 tsc 编译产出 JS**：`client` 交给 Vite，`server` 交给 wrangler（它自己打包上传 Worker），
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
实际的随机数和存档读写都在客户端（见 5.8）。

## 4. 联机：房主模式

### 4.1 为什么不做服务器权威

服务器权威要在服务端跑一份规则、做状态同步和校验，
对黑客松来说这部分工作量比游戏本身还大，而它换来的只有"防作弊"——
这场比赛不需要。

### 4.2 谁跑规则

**创建房间的那个客户端（房主）是唯一跑 core 状态机的地方。**

```
房主客户端                 Worker + Room DO                客人客户端
  │                             │                             │
  ├── GET /api/room ───────────>│                             │
  │<────────── 房间码 "4213" ───┤                             │
  ├─ WS /room/4213?role=host ──>│                             │
  │<────────── #room:ok ────────┤                             │
  │                             │<─ WS /room/4213?role=guest ─┤
  │<──────── #peer:joined ──────┤                             │
  │                             │                             │
  │ createGame(seed, 双方牌组)  │                             │
  ├── events ──────────────────>├─────────── >events ────────>│  播动画
  │                             │                             │
  │                             │<────────── command ─────────┤  客人打出一张牌
  │<──────── >command ──────────┤                             │
  │ execute(state, command)     │                             │
  ├── events ──────────────────>├─────────── >events ────────>│  播动画
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

`packages/server` 是一个 Cloudflare Worker，只做三件事：

1. `GET /api/room` → 摇一个没人用的 4 位房间码，回给建房的人。
2. `GET /room/:code?role=host|guest` → 升级成 WebSocket，把人放进房间（上限 2 人），
   然后通知房里原本那个人 `#peer:joined`。
3. 收到消息 → 原样转给房里的另一个人，**不看内容**。

外加连接断开时给还剩下的人发 `#peer:left`。

**一个房间 = 一个 Durable Object 实例，房间码就是它的名字。**
同一个码永远被路由到同一个实例，所以不需要维护一张全局房间表——
"房里有谁"就是"这个实例上挂着哪几条连接"。

这个结构顺带消掉了旧转发器上必须手工提防的一个坑：那时一条连接能同时待在两个房间里，
客户端进别人的房前忘了退出自己那间就会转发串台、空房还占着号。
现在一条连接绑定一个房间，换房就是换连接，同时占两间房这件事在结构上就不成立。

连接用 **WebSocket Hibernation** 托管：闲置时 DO 可以休眠，但连接不断、也不计时长费用。
这是免费档能长期挂着对局连接的前提。

服务端发下来的每一帧带一个字符前缀区分两类消息：`#` 是控制消息，`>` 是原样转发的对端载荷。
之所以不包一层 JSON，是因为**服务端绝不解析游戏载荷**——加前缀是纯字符串拼接。
所以服务端不认识卡牌、不认识回合，**协议改了它也不用动**。

## 5. client：全部是 React DOM + GSAP

| 层 | 技术 | 负责 |
|---|---|---|
| 唯一一层 | React DOM + GSAP | 全部界面：手牌、场上的模型、飞出去的卡牌、伤害数字、菜单、状态栏、结算弹窗 |

React 只负责"有哪些元素、它们在什么状态"，**位置和动画一律交给 GSAP 直接改 DOM**。
不要用 CSS transition 做对局动画：一个元素同时被 React 的 class 和 GSAP 的补间改，
两边会互相打断，节奏也没法精确控制。

对局画面的接入方式是**消费 core 的事件流**：收到一个 `GameEvent` 就播一段动画，
播完再取下一个。不要在客户端重算规则。

### 5.1 界面与路由

五个界面，路由用 wouter（2.2KB，API 是 react-router 的子集，将来要换基本只改 import）：

```
/                主网站：介绍 + 「一键开始」
/tutorial/:level 教程关卡（1..3）
/room            匹配房：自己的 4 位房间码 + 输入对方房间码
/match           联机对局
/dev/hand        手牌动画调试页
```

**「一键开始」的分流**只看存档里的 `tutorialDone`：没通关完就接着打下一关教程，
通关完了直接进匹配房。判断不看胜场，重玩教程也不会把进度往回退。

不引 Next.js 是因为这里是纯客户端游戏：SSR、RSC、服务端数据获取一项都用不上，
每个页面都得挂 `'use client'`，等于把 Next 当成一个启动更慢的 Vite。
它也解决不了部署上的难题——WebSocket 长连接 Vercel 托不住，转发器无论如何都要另找地方跑
（最后落在 Cloudflare Worker + Durable Object 上，见 `docs/deploy.md`）。

**对局状态不放在路由上。** `MatchSessionProvider` 挂在 Router 外面，持有当前这局的 driver，
房间页建好 driver 之后才跨得过跳到 `/match` 的那次卸载。它不写 localStorage，
所以刷新 `/match` 会读不到 driver，直接跳回首页——和「不存对局」是一致的。

### 5.2 MatchDriver：对局的四种来源

教程、本地热座、联机房主、联机客人，**界面完全一样**，区别只在于指令交给谁执行、局面从哪来。
这层差异收进 `src/match/driver.ts` 的 `MatchDriver` 接口：

```ts
subscribe(fn)        // 局面变了，配 useSyncExternalStore
getSnapshot()        // MatchView：state / seat / status / lastRejection
subscribeEvents(fn)  // 每批新事件，给动画层
send(command)
dispose()
```

| 实现 | 谁跑 `execute` | 对手指令来自 |
|---|---|---|
| `localDriver` | 本地 | 同一个页面（热座，`seat: 'active'` 时视角跟着行动方走） |
| `tutorialDriver` | 本地 | 关卡脚本 |
| `hostDriver` | 本地 | socket relay |
| `guestDriver` | 不跑 | 房主 relay 过来的事件流 |

`MatchStage` 只认 driver，不知道自己在打教程还是联机。**接联机时对局界面一行都不用改。**

两条订阅分开是有意的：`getSnapshot` 给的是「事件全部应用完」的结果，负责渲染；
事件流是「过程」，负责播动画。两者节奏不同，混在一起会互相牵制。
事件订阅者只允许一个，换来的性质是**没人订阅时事件会攒着，等第一个订阅者来了补发**——
driver 在构造函数里就把开局事件发出来了，而 React 要等 effect 里才订阅得上，
不攒着的话发牌动画必然丢。

### 5.3 教程

三关，全是写死的剧本。**两头都定死**才敢在引导文案里写「伤害 = 2 + 2 = 4，一击就碎」这种实数：

- **对手**按 `src/tutorial/levels.ts` 里的脚本出牌（`opponentTurns`）。
- **玩家**被界面锁住：`MatchStage` 的 `restriction` 每一步只放行引导指定的那一个动作，
  别的牌点不动、目标也选不了。

引导步骤全部走完即通关，不另设胜利条件——每一步都被锁死了，走完就等于达成了教学目标。

关卡数据有个关键技巧：**每关的牌组只用一两种卡，而且整副都是同一张**。
这样洗牌洗成什么顺序都无所谓，起手一定是那张卡，剧本不必去反推 seed 洗出了什么。
谁先手也不是单独的开关，而是靠把玩家排在 0 号还是 1 号座位决定的（引擎固定 0 号先手）。

卡池一改，剧本会**静默**失效，表现为玩家卡死在某一步点不动。
`packages/client/test/tutorial.test.ts` 把三关整段跑一遍守着这件事。

### 5.4 为什么推翻了 Pixi

早期版本用 PixiJS 画对局、React 盖一层覆盖层。实际动手之后换成纯 DOM，原因：

- **对象量级根本用不上画布。** 场上加手牌撑死几十个元素，浏览器排版这点东西毫无压力。
  Pixi 的价值在成千上万个精灵，这里付了复杂度却拿不到收益。
- **中文卡面排版。** 卡牌上是几行中文描述，要自动换行、要省略号、要对齐。
  DOM 里这是几行 CSS，Pixi 里得自己算换行和度量。
- **CSS 3D 翻转是现成的。** 卡牌翻正反面用 `transform-style: preserve-3d` 加一条
  `rotateY` 补间就够了，Pixi 没有原生的 3D 翻面。
  （正反两面谁可见另有讲究，不用 `backface-visibility`，见 5.7。）
- **省掉两层坐标的交接。** 覆盖层和画布各有一套坐标系，
  想让一张牌"从 DOM 的手牌飞进画布的战场"就得手动换算。
  全在 DOM 里之后，跨容器的位移直接用 GSAP 的 Flip 插件（FLIP 技术）补间，不用碰坐标。

**将来要粒子特效怎么办**：在最上面加一层 `pointer-events: none` 的轻量 canvas，
只画粒子，不参与布局和交互。需要的时候再加，现在不预留。

### 5.5 动画约定

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

### 5.6 手牌组件

`src/ui/HandFan.tsx` 是通用的扇形手牌，只认自己的 `HandCardData`（字段照着 core 的 `Card` 取名）。
`src/dev/HandDemo.tsx` 是它的演示页，用占位数据跑各种边界，访问 `/dev/hand` 进入。

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

**出牌只有拖拽这一条路**（炉石式，只面向电脑浏览器 + 鼠标，不做触屏适配）：
按住卡面走过 4px 才算拖拽，拖进 `dropZoneRef` 指的那块区域再松手才调 `onPlay`，
松在别处（包括拖回手牌上方）一律飞回扇形，纯点击什么都不做。几个要点：

- 用原生 pointer 事件 + `setPointerCapture` + GSAP 自己实现，没上 `Draggable` 插件。
  想要的是"卡牌中心带缓动追光标"的手感，而 `Draggable` 的刚性抓取偏移
  在从 hover 的 1.9 倍缩到拖拽的 1.1 倍时会看到明显跳变。
- 跟随用 `gsap.quickTo` 只补间 `x/y`，姿态（转正 + 缩放）另起一个补间只管 `rotation/scale`，
  两组属性不重叠才能同时跑；进入拖拽那一下的缩放位移由跟随的缓动吃掉，画面上看不见跳。
- 落点判定看**指针坐标**在不在落点区的矩形里，不是卡牌和它相交——
  这样卡画得多大、歪多少都不影响落点。
- 落点区的高亮由 `HandFan` 打两个 data 属性在落点元素上：
  `data-drop-ready`（正在拖牌）和 `data-drop-hot`（指针已经进来了），样式在 `styles.css` 里。
- 拖出来的那张牌不参与扇形排布，剩下的牌按"少了一张"重排，手牌会合拢。
- **拖拽期间倾斜自动失效**，靠的是 5.7 那个 `enabled` 回调而不是额外的开关：
  它判的是"这张牌是不是当前 hover 的那张"，而进入拖拽的第一件事就是把 hover 清空，
  于是 `attachCardTilt` 只会归零收手、不再往倾斜层写角度。抓起来那一下还会主动调一次
  `reset()`：hover 时攒下的倾斜留着不管的话，拖着一张歪的牌满屏找落点观感很差，
  而指针已经被 capture，等不到 `pointerleave` 自己来归零。

### 5.7 卡面的倾斜跟随和高光

`src/ui/cardTilt.ts` 提供 `attachCardTilt(el, opts)`：指针在卡面上移动时，
卡跟着指针做小幅三维倾斜，同时一小块白色高光跟着指针跑（模拟覆膜反光）。
手牌里只有 hover 放大的那张启用（扇形里的小卡本身是斜的，再叠倾斜会乱），
战场小卡则一直启用，幅度稍大一点补偿它显示得小。

**关键是 transform 分层**。一个元素只有一个 `transform`，几件事挤在一层就是互相覆盖，
所以每层只负责一件事：

| 手牌 | 战场小卡 | 负责 |
|---|---|---|
| `.hand-fan__slot` | `.demo__tile` | 摆位：扇形的 x / y / rotation / scale；小卡这边是 Flip 飞行 |
| `.hand-fan__tilt` | `.demo__tile-tilt` | 跟着指针的倾斜：rotationX / rotationY |
| `.hand-fan__inner` | — | 翻到背面的 3D 翻转：rotationY 180° |

倾斜层和翻转层都要 `transform-style: preserve-3d`，否则翻转层会被压成一张平面图片再倾斜。
透视（`perspective`）加在最外层，对下面几层一起生效，不用逐层加。
小卡的倾斜层同时承担裁剪（`overflow: hidden` + 圆角）：裁切边跟着卡一起转，
放在不动的 `.demo__tile` 上的话，倾斜时卡角会被一条直边削掉。

**翻面：立体感靠 `rotationY`，正反互斥靠角度驱动的 opacity 硬切，不用 `backface-visibility`。**
所有会动 `.hand-fan__inner` 的 `rotationY` 的地方都必须走 `HandFan.tsx` 里的 `flipTo()`
（现在有三处：hover 问号翻过去、离开问号翻回来、离开整张牌时 `applyLayout` 兜底翻回正面），
漏一处那张牌就会卡在正反都显示的样子。它在补间的 `onUpdate` 里每帧读 inner 当前的角度，
归一到 `[0, 360)` 后落在 `(90°, 270°)` 就把背面的 opacity 写成 1、正面写成 0，否则反过来。
硬切不做过渡：90° 时卡正好侧对观察者、投影宽度趋近于零，切换那一瞬间看不见。
判断读的是**元素当前的实际角度**而不是补间进度，所以翻过去和翻回来共用同一套逻辑，
`overwrite: 'auto'` 让新补间接管旧补间时也不用额外记状态。静止时的初始值（正面 1、背面 0）
写在 CSS 里，不靠 JS 首帧补。

之所以不用 `backface-visibility`，是因为 Chrome 实测它**在逐帧 JS 动画期间对合成层的朝向
判断不可靠**：静止时正确，一旦补间跑起来，转过 90° 之后正面并不消失，连同水平镜像一起
继续显示，直到补间结束那一刻才突然切成背面——"全程正面、结尾闪一下"。
卡面里那些被提成独立图层的子元素（`absolute` + `z-index` 的问号圆圈、
`absolute` + `mix-blend-mode` 的高光层）逃出所在 face 的拍扁、翻面后镜像漏在另一面上，
也是同一族问题。逐个元素补一份 `backface-visibility` 补不完，而且补上之后动画途中的误判
还会和 opacity 打架造成闪烁，所以这些声明现在一条都不留。

**手牌右上角的问号：视觉和热区是两个元素**，因为两者对翻面的要求正好相反。

- 看得见的圆圈（`.hand-fan__help-mark`）在翻转层**里**，正反两面各一个，
  倾斜和翻面都跟着卡一起转；正面那个放在 `.hand-fan__face--front` 里、`HandCardFace` 旁边，
  不放进 `HandCardFace`——那个组件被战场小卡复用，小卡没有翻面这回事，不该长出一个问号。
  背面那个放在 `.card-back` 里同样的位置，翻过去之后指针底下仍然压着一个问号，视觉是连续的。
  它们 `pointer-events: none`，不参与交互。
  两个圆圈（和同样分正反两份的 `.card-glare`）都不需要自己管朝向：
  该显示哪一面由所在 `.hand-fan__face` 的 opacity 决定，隐藏的那一面整层都是 0，漏不出来。
- 触发翻面的热区（`.hand-fan__help`）是一个**完全透明**的按钮，留在翻转层**外**、倾斜层里，
  位置尺寸都不动。热区绝对不能跟着翻面：跟着转的话，牌一翻到背面按钮就转到了指针够不着的
  地方，`pointerleave` 立刻把牌翻回正面，翻回来又被 hover 到，来回抖个没完。
  它靠倾斜层当绝对定位的基准，所以那一层的 `position` 不能去掉。

**命中几何只留 slot 和热区两处**：翻转层 `.hand-fan__inner` 整棵是 `pointer-events: none`，
卡面纯粹是画面。否则翻面途中 150px 宽的卡面绕 Y 轴扫出前后各 ±75px 的深度，中途会扫到热区
前面、在 `preserve-3d` 的三维命中测试里抢走指针：热区收到 `pointerleave` → 牌翻回去 →
卡面又扫回来触发 `pointerenter`，指针停着不动牌却自己来回翻。
这和 5.6 里 hover 放大要盖住原位是同一条原则——参与命中的形状不能在动画中途变形。

三个元素由 `applyLayout` 一起用 `autoAlpha` 淡入淡出（只有放大的那张牌才亮）。
必须一起，否则会出现"看得见问号却点不动"之类的错位；`autoAlpha` 归零时顺带关掉
`visibility`，没放大的手牌上那块热区也就不吃指针事件，指针扫过右上角不会误触发翻面。

高光是一层 `.card-glare`（正反两面各一层，正面在 `HandCardFace` 里，所以小卡自带），
`radial-gradient` 的圆心读 `--glare-x / --glare-y` 两个 CSS 变量（存的是指针的镜像位置，
见本节末尾），由 `gsap.quickSetter` 写在最外层上、靠继承传下去。混合模式用 `soft-light`：
卡面底色很深，`overlay` 在深色底上只是把原亮度翻一倍、仍然看不见。
卡面要 `isolation: isolate`，不然混合会拿卡背后的东西当底，高光溢出卡面。
渐变半径要写死（`circle 200px`），不写的话默认是 `farthest-corner`，
半径跟着指针到最远那个角的距离变，指针挪到卡角时反光会胀到两倍大。
半径比卡面对角线的一半（≈129px）大一截，指针挪到任何一角渐变都还没衰减完就出了卡面，
边缘不会被切出一道亮圈；代价是中间那道色标得压暗一点，否则整张卡会被提亮成一片。
背面那层直接沿用同一份 `--glare-x / --glare-y` 就行：`.hand-fan__face--back`
自带的 `rotateY(180deg)` 单看是镜像，但背面只有在 `.hand-fan__inner` 也转过 90° 之后
才显示，两个 180° 正好抵消。

**倾斜方向和高光位置是一套物理模型，改一边就得改另一边。**
倾斜是"指针在哪边、哪边就往屏幕里陷下去"，像用手指把卡牌那一角按住往下按——
反过来（指针那一角朝观察者抬起）也做过，用户实际体验后确认按下去这版手感更对。
高光跟着这个模型走，落在**指针的镜像位置**（对角）：被按下去那一角的对角翘向观察者、
正对光源，最亮的自然是它，而不是正往屏幕里陷的那一块。

`attachCardTilt` 必须在 `useGSAP` 的回调里调用：它把所有补间（`quickTo` 的内部补间、
归零补间）装在一个子 `gsap.context` 里，这个子 context 要挂到外层的 context 上，
卸载时才会被一起 revert。补间都在挂载那一刻建好，
指针回调里只给这些补间喂新值、不新建补间，所以那些回调不需要再包 `contextSafe`。
返回的 handle 有 `detach()`（摘监听 + 归零）
和 `reset()`（出牌时快速收手：出牌被拒绝的话卡还在原地，不主动归零它会僵在倾斜的样子）。

调用方（`HandFan` / `HandDemo`）都是**按元素增量挂/摘**，手牌或战场一变不能整批重挂：
`detach()` 会把倾斜和高光硬切回零，而指针很可能正停在一张没有离场的卡上，
它的倾斜会突然弹平、高光凭空消失，指针不动就不再有 `pointermove`，也就再也回不来。
另外依赖数组非空时 `useGSAP` 只在**卸载**时 revert，清理函数在依赖变化时不会跑，
所以离场元素必须在回调里自己摘掉，否则监听会一直留着。

### 5.8 存档

`src/save/save.ts` 是唯一碰持久化的地方，存在 localStorage 里：

```
key   ai-duel-save-v2
value { "ownedCards": ["..."], "wins": 3, "tutorialDone": 2 }
```

- `loadSave()` 读；`recordWin()` 记一场胜利，`completeTutorialLevel(n)` 记一关教程通关，
  两者都顺手用 `drawNewCard` 抽一张新卡再写回。
- `tutorialDone` 是已通关的关卡数（0..3），首页的「一键开始」就靠它分流。
  它用 `max` 而不是 `+1` 更新，所以重玩已通关的关卡既不会把进度退回去，也不会越刷越高。
- key 带版本号，结构要改就换 `v3`，旧数据读不到自动当新号，不写迁移代码。
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
  test/                       Vitest
packages/client/
  index.html
  vite.config.ts
  src/main.tsx                入口，只负责挂 <App>
  src/App.tsx                 路由表 + MatchSessionProvider，唯一列出全部界面的地方
  src/screens/                一个界面一个文件
    HomeScreen.tsx            主网站：介绍 + 一键开始（按 tutorialDone 分流）
    TutorialScreen.tsx        教程关卡：对局 + 分步引导 + 通关结算
    RoomScreen.tsx            匹配房：自动建房拿码 + 输码进房
    MatchScreen.tsx           联机对局：从 MatchSession 取 driver
  src/match/                  对局驱动层
    driver.ts                 MatchDriver 接口 + 订阅/快照的共用实现
    localDriver.ts            本地热座
    tutorialDriver.ts         本地 + 脚本对手
    hostDriver.ts             联机房主（唯一跑 execute 的一方）
    guestDriver.ts            联机客人（只发指令）
    useMatch.ts               把 driver 接进 React（useSyncExternalStore）
    MatchSession.tsx          持有当前对局的 driver，跨得过路由切换
  src/tutorial/levels.ts      三关的剧本数据
  src/net/
    protocol.ts               房主 ↔ 客人的消息格式
    socket.ts                 联机通道封装（原生 WebSocket：建房、进房、转发）
  src/ui/
    MatchStage.tsx            对局界面，只认一个 driver（目前是占位实现）
    HandFan.tsx               扇形手牌组件 + 卡面，通用
    cardTilt.ts               卡面跟指针的倾斜 + 微高光，手牌和战场小卡共用
    labels.ts                 六个弱点维度的中文名
  src/dev/HandDemo.tsx        手牌动画演示页（/dev/hand）
  src/save/save.ts            localStorage 存档（收藏 + 胜场 + 教程进度）
  src/styles.css
  test/tutorial.test.ts       把三关教程整段跑一遍
packages/server/
  src/index.ts                Worker 入口 + Room Durable Object（转发器全部逻辑）
  wrangler.jsonc              Worker 配置：静态资源、DO 绑定
  worker-configuration.d.ts   wrangler 生成的 Env 类型
  test/smoke.mjs              端到端冒烟测试（真起 wrangler dev、真连 WebSocket）
```

依赖方向：`screens → match / ui / tutorial / save`，`match → net / core`，
`ui` 谁也不依赖（只认自己的 props），`server` 不依赖 `core`。

## 7. 常用命令

```bash
pnpm install
pnpm typecheck          # 全仓类型检查
pnpm test               # 单元测试：core 规则、教程剧本
pnpm dev                # 起客户端 (http://localhost:5173)
                        # 手牌动画演示页：http://localhost:5173/dev/hand
                        # 端口被占时用 PORT=5174 pnpm dev
pnpm dev:server         # 起 Worker (http://localhost:8787)，同时发前端产物和 WebSocket
                        # 转发器的端到端测试：先 build 前端，再 pnpm --filter @ai-duel/server smoke
pnpm --filter @ai-duel/client build
```

**两台电脑联机**：客户端已经监听了局域网（`server.host = true`），
另一台用 `http://<你的局域网IP>:5173` 打开即可。
线上前端和转发器是同一个 Worker、同一个域名，联机地址默认就是当前页面的 origin，不用配。
本地开发是两个进程（Vite 在 5173、`wrangler dev` 在 8787），页面 origin 指不到转发器，
要在 `packages/client/.env.local` 里设 `VITE_SERVER_URL=http://<你的局域网IP>:8787` 指过去——
写 localhost 的话另一台电脑会连到它自己身上。

**静态部署**：路由用的是浏览器 history，直接把 `dist` 丢上静态托管需要配一条
「所有路径回退到 index.html」的重写规则，否则刷新 `/room` 会 404。
Vite 的 dev server 自带这个回退，开发时不用管。

## 8. 现在做到哪了

已经就位（骨架，UI 全是占位）：

- 五个界面、路由、按存档分流的「一键开始」。
- `MatchDriver` 四个实现全写完，`MatchStage` 能真的出牌、选目标、结束回合、分胜负、触发结算。
- 教程三关能整段打通，通关送卡、写进度。
- 存档 v2（收藏 + 胜场 + 教程进度）。
- 联机协议、WebSocket 封装、房主/客人两个 driver，转发器有端到端冒烟测试守着。

**还没做的**，按建议顺序：

1. **对局界面接真 UI**（client）——把 `MatchStage` 里那堆按钮换成 `HandFan` + 战场，
   把事件流接到 GSAP 上，播出牌、受伤、崩坏这几段动画。
   接 `HandFan` 前要先给 `HandCardData` 补上弱点画像和目标维度两项，
   并给它们在卡面上腾出版面（见 5.6）。
2. **补规则和卡牌数据**（core）——攻击、随从交战、更多卡牌效果。
   全程用 Vitest 验证，不需要碰界面。
   **改卡牌数值时记得跑 `pnpm test`**：教程剧本依赖具体的费用和伤害，
   改坏了测试会红，不改的话玩家会卡死在教程里。
3. **卡组选择**（client）——现在联机双方都写死用 `STARTER_DECK`。
4. **联机端到端实测**——协议和转发器都有测试，但没有在两台真机上跑过完整一局。
5. **打磨**——音效、特效、结算画面。

如果时间不够，砍的顺序是倒过来的：4 和 5 都可以不要，
只要第 1 步做完就有一个能演示的游戏。

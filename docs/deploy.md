# 部署说明

## 1. 一个 Worker 干两件事

整个项目部署成 **Cloudflare 上的一个 Worker**：

```
                    https://playyourcardai.online
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
      静态资源层（免费、不计 Worker 调用）        Worker 脚本
      /  /assets/*  以及匹配不到的路径            /api/room      摇房间码
      → packages/client/dist                     /room/:code    WebSocket 升级
                                                      │
                                                 Durable Object
                                                 一个房间一个实例
```

前端和转发器同域名，所以客户端连 WebSocket 直接用相对路径（`/room/1234?role=host`），
不需要配 CORS，也不需要维护第二个服务的地址。

选 Cloudflare 的原因就一条：**免费档能挂长连接且不休眠**。
常见的免费 PaaS（Render、Fly 之类）在免费档上会把闲置的实例睡掉，
第一个玩家建完房等对手的那几分钟正好把自己等没了。

## 2. 域名怎么接的

`playyourcardai.online` 在 Namecheap 注册，NS 指到 Cloudflare
（`clayton.ns.cloudflare.com` / `hazel.ns.cloudflare.com`），
zone 就建在跑这个 Worker 的同一个 Cloudflare 账号下。

裸域和 `www` 两个 hostname 都是 **Workers Custom Domain**，直接挂在 Worker 上，
不经过任何反向代理。DNS 记录和边缘证书由 Cloudflare 自动创建和续期，
仓库里唯一要写的就是 `wrangler.jsonc` 的 `routes`：

```jsonc
"routes": [
  { "pattern": "playyourcardai.online", "custom_domain": true },
  { "pattern": "www.playyourcardai.online", "custom_domain": true }
]
```

Worker 原本的 `ai-duel.<你的账号>.workers.dev` 仍然能访问，但**国内 DNS 会污染
`workers.dev`**——买域名就是为了绕开这一点，演示时用正式域名。

## 3. 房间码就是 Durable Object 的名字

转发器不需要自己维护一张全局房间表，「房间」这个概念直接落到了基础设施上：

- `env.ROOM.getByName("1234")` 拿到名字叫 `1234` 的那个实例，**同一个码永远路由到同一个实例**，
  不管请求从哪个机房进来。
- 一个房间的两条 WebSocket 一定落在同一个实例里，转发就是在实例内部把消息递给另一条连接。
- 房间里的连接列表由运行时保管（`ctx.getWebSockets()`），代码里没有任何内存状态，
  所以实例被回收、重建都不会丢东西。

`GET /api/room` 摇一个 4 位随机码，用 RPC 问对应的实例「你那儿几个人」，
是 0 就把这个码发给客户端，不是 0 就重摇（最多 10 次）。

## 4. 为什么一定要 WebSocket Hibernation

接受连接时用的是 `ctx.acceptWebSocket(server)`，**不是** `server.accept()`。差别很大：

| | `server.accept()` | `ctx.acceptWebSocket()` |
|---|---|---|
| 空闲时 Durable Object | 一直活着 | 休眠，从内存里卸掉 |
| 空闲时计费 | 一直按时长计 | 不计 |
| 休眠期间的连接 | —— | 不断开，客户端无感 |
| 有消息进来 | 直接进回调 | 唤醒实例，重跑构造函数，再进回调 |

一局牌里大部分时间是玩家在思考，没有任何消息。用 `server.accept()` 的话这段时间会一直烧
免费档那 13,000 GB-s/天的时长额度；用休眠就是零消耗。**这是免费档跑得起来的直接原因。**

代价是「实例被唤醒时构造函数会重跑」，所以**不能把状态放在实例的字段里**。
本项目的做法是根本不存状态：需要知道房里有谁的时候现查 `ctx.getWebSockets()`。

心跳也顺手交给运行时：`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`
让运行时直接回 `pong`，休眠中的实例不会被心跳唤醒。客户端定期发 `ping` 保活即可。

## 5. 协议

服务端**不解析游戏内容**——它不认识卡牌也不认识回合，前端协议怎么改它都不用动。
但控制消息和游戏载荷要走同一条 WebSocket，所以服务端发出去的每一帧带一个字符的前缀：

| 方向 | 帧格式 | 含义 |
|---|---|---|
| 服务端 → 客户端 | `#room:ok` | 进房成功的回执 |
| 服务端 → 客户端 | `#peer:joined` | 对手进房了 |
| 服务端 → 客户端 | `#peer:left` | 对手断了 |
| 服务端 → 客户端 | `>` + 载荷 | 对端发来的东西，原样搬运 |
| 客户端 → 服务端 | 载荷 | 不带前缀，整条都是载荷 |

加前缀是纯字符串拼接，服务端不需要看懂载荷是什么，更不会 `JSON.parse` 它。
二进制帧不加前缀原样转发（控制消息一定是文本，所以不会混）。

### 被拒绝的连接

握手会先成功、再被立刻关掉，因为浏览器的 `WebSocket` 拿不到失败握手的响应体，
只拿得到 `CloseEvent` 上的 `code` 和 `reason`——想把中文原因显示给玩家就只能走这条路。

**所以客户端不能一看到 `open` 就当进房成功了**，要等第一帧：
收到 `#room:ok` 才算进去，收到 `close` 就看关闭码。

| 关闭码 | reason | 什么时候 |
|---|---|---|
| 4000 | role 参数必须是 host 或 guest | URL 上的 `role` 不对 |
| 4001 | 房间不存在 | 以 guest 身份连一个没人的房间 |
| 4002 | 房间已满 | 房里已经两个人 |
| 4003 | 房间已被占用 | 以 host 身份连一个已经有人的房间 |

### 客户端在哪接的

`packages/client/src/net/socket.ts` 是联机通道的**唯一**封装，用浏览器原生 `WebSocket`。
上层（`screens/RoomScreen.tsx`、`match/hostDriver.ts`、`match/guestDriver.ts`）只认它导出的
`RoomHandle` 接口，所以换传输方式不会波及对局逻辑——这次从 socket.io 迁过来就只动了这一个文件。

**`join()` 的顺序有讲究**：进别人的房是「先连上目标房间，成功之后才关掉自己那条」。
反过来先关的话，目标房间不存在或已满时自己那间也跟着没了，界面上还显示着房间码，
但那个码已经是空头支票。冒烟测试第 9 项守着这条。

**没有自动重连**，这是刻意的：连不上就报错让界面显示"连不上服务器"，比无声重连转圈强。
将来如果要加，用 [`partysocket`](https://www.npmjs.com/package/partysocket)
（Cloudflare 自家 PartyKit 那套里拆出来的），别自己手写——它是 `WebSocket` 的替身，
自带指数退避重连、断线期间的发送队列和心跳，接口和原生 `WebSocket` 一样。

## 6. 免费档够不够用

| 额度 | 免费档 | 这个项目怎么花 |
|---|---|---|
| 请求数 | 10 万次/天 | 每次打开页面几次、每次建房 1 次、每条 WebSocket 升级 1 次 |
| WebSocket 入站消息 | 按 **20 条消息折算 1 次请求** | 一局牌几百条消息 = 十几次请求 |
| WebSocket 出站消息 | **不计费** | 转发出去的那一半白送 |
| CPU 时长 | 13,000 GB-s/天 | 休眠期间不算，实际只有转发那几毫秒 |

静态资源本身**完全不计费**，也不占 Worker 调用数（前提是请求没有被 `run_worker_first` 拉进 Worker）。

结论：黑客松演示的量级离额度上限差着好几个数量级。

## 7. 自动部署

`.github/workflows/deploy.yml`：push 到 `main` 或者手动触发 → 装依赖 →
`pnpm --filter @ai-duel/client build` → 在 `packages/server` 里跑 `wrangler deploy`。

**必须先构建前端**：`wrangler.jsonc` 里 `assets.directory` 指向 `../client/dist`，
而 `dist/` 是 gitignore 掉的，仓库里没有这个目录。

需要在仓库的 Settings → Secrets and variables → Actions 里配**一个** secret：

| Secret | 从哪来 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/?to=/:account/api-tokens → Create Token → Custom 里选 "Edit Cloudflare Workers" 模板 |

账户 ID 不用配成 secret，它已经写在 `wrangler.jsonc` 的 `account_id` 里了——
那是个标识符，不是凭据，没有 token 拿着它什么也做不了。

"Edit Cloudflare Workers" 模板不一定带 Zone/DNS 权限。万一部署卡在挂 custom domain 那一步报权限
错误，给 token 补上 Zone/DNS 权限，或者把 `wrangler.jsonc` 里的 `routes` 删掉——
域名已经在 Cloudflare 服务端挂好了，删掉不会解绑。

没配 secret 时工作流会**跳过部署并显示成功**，不会变红。这样别人 fork 这个仓库不会看到一片红。

## 8. 踩过的坑

**`exports` 取代了 legacy 的 `migrations`。**
老教程里的 `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]` 已经是遗留写法，
现在直接在 `exports` 里声明：

```jsonc
"exports": { "Room": { "type": "durable-object", "storage": "sqlite" } }
```

**免费档只有 SQLite 后端的 Durable Object。** `storage` 必须写 `"sqlite"`，
写成 KV 后端在免费账号上会直接部署失败。

**SPA 回退会把 Worker 整个吃掉。**
`not_found_handling: "single-page-application"` 的意思是「匹配不到静态资源就回 index.html」，
而它比 Worker 优先——结果 `/api/room` 和 WebSocket 升级请求全都拿到一份 index.html。
要 Worker 处理的路径必须在 `assets.run_worker_first` 里显式列出来：

```jsonc
"run_worker_first": ["/api/*", "/room/*"]
```

`/room/*` 在列表里是因为它一路两用：既是 WebSocket 端点，又是前端的对局页面路由。
不是升级请求时 Worker 会调 `env.ASSETS.fetch()` 把 index.html 发回去。
代价是打开对局页面会多算一次 Worker 调用。

**导航请求不会调用 Worker。**
`compatibility_date >= 2025-04-01` 之后，浏览器地址栏跳转产生的请求
（带 `Sec-Fetch-Mode: navigate` 头）会绕过 Worker 脚本，直接由静态资源层处理——
Cloudflare 这么做是为了少算一次计费调用。
WebSocket 升级请求不是导航请求，所以能正常进到 Worker。
上面 `run_worker_first` 里列出来的路径不受这条影响。

## 9. 本地跑和验证

```bash
pnpm --filter @ai-duel/client build     # 先出静态资源，Worker 要用
pnpm dev:server                         # wrangler dev，默认 http://127.0.0.1:8787

# 另开一个终端，跑端到端冒烟测试
pnpm --filter @ai-duel/server smoke
```

冒烟测试（`packages/server/test/smoke.mjs`）覆盖摇码、双方进房、转发、
房满/房间不存在的拒绝、对端断开通知、SPA 回退，以及换房之后原来那间房要被释放。
它用 Node 内置的全局 `WebSocket`，不需要额外依赖。
换个地址跑线上环境：`SMOKE_BASE=https://playyourcardai.online pnpm --filter @ai-duel/server smoke`。

改了 `wrangler.jsonc` 里的绑定之后要重新生成 `Env` 类型：

```bash
pnpm --filter @ai-duel/server types
```

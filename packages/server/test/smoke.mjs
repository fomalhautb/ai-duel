/**
 * 转发器的端到端冒烟测试。
 *
 * 跑法：先 `pnpm --filter @ai-duel/client build` 出静态资源，
 * 另开一个终端 `pnpm --filter @ai-duel/server dev`，然后 `pnpm --filter @ai-duel/server smoke`。
 * 换地址用环境变量：SMOKE_BASE=https://playyourcardai.online node test/smoke.mjs
 *
 * 用 Node 内置的全局 WebSocket（Node 22+），不引第三方库。
 *
 * 重点覆盖断线重连：那套逻辑（同一个玩家的新连接顶掉旧的、重连不误报掉线、
 * 房主客人都能回到原来的房间）全在服务端，而且只有在"旧连接还没被回收"的时候才出问题——
 * 这种时序在浏览器里基本没法稳定复现，只能在这里用两条并存的连接直接摆出来。
 */

const BASE = (process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const WS_BASE = BASE.replace(/^http/, 'ws')
/** 单条消息的等待上限。本地 wrangler dev 一般是毫秒级，给足余量。 */
const TIMEOUT_MS = 5000

let passed = 0
let failed = 0

function check(ok, label, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 每个模拟玩家一个 id，重连时沿用同一个，转发器靠它认出"还是刚才那个人"。 */
let peerSeq = 0
const newPeerId = () => `smoke-${(peerSeq += 1)}`

/**
 * 一条连上去的 WebSocket，带一个消息队列。
 *
 * 之所以要队列而不是"临时挂个 onmessage"：服务端可能在我们开始等之前就把消息发过来了
 * （比如进房回执），漏掉它测试就会假失败。
 */
class Peer {
  constructor(ws) {
    this.ws = ws
    this.inbox = []
    this.waiters = []
    this.closed = null
    ws.addEventListener('message', (event) => {
      const waiter = this.waiters.shift()
      if (waiter) waiter.resolve(event.data)
      else this.inbox.push(event.data)
    })
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(new Error(`连接已关闭：${event.code} ${event.reason}`))
      }
    })
  }

  /** 取下一条消息，超时就抛错。 */
  next() {
    if (this.inbox.length > 0) return Promise.resolve(this.inbox.shift())
    if (this.closed) {
      return Promise.reject(new Error(`连接已关闭：${this.closed.code} ${this.closed.reason}`))
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      this.waiters.push(waiter)
      setTimeout(() => {
        if (this.waiters.includes(waiter)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          reject(new Error(`等消息超时（${TIMEOUT_MS}ms）`))
        }
      }, TIMEOUT_MS)
    })
  }

  /**
   * 确认这段时间内**没有**消息进来。
   *
   * 断言"不该发的消息没发"要靠它：重连不能误报掉线这条，
   * 光看"收到了 peer:online"是不够的，还得确认没有多出来一条 peer:offline。
   */
  async quiet(ms = 400) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return this.inbox.length === 0
  }

  /** 等连接被关掉，返回关闭码和原因。 */
  waitClose() {
    if (this.closed) return Promise.resolve(this.closed)
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('close', (event) =>
        resolve({ code: event.code, reason: event.reason }),
      )
      setTimeout(() => reject(new Error(`等关闭超时（${TIMEOUT_MS}ms）`)), TIMEOUT_MS)
    })
  }
}

/**
 * 连一个房间。
 *
 * 被拒绝的连接也会先握手成功再被立刻关掉，所以这里不能一看到 open 就当成功，
 * 要等到第一帧：`#room:ok` 是进房了，close 是被拒了。
 *
 * 进房后紧跟着还有一帧对端状态（`#peer:online` / `#peer:offline`），
 * 这里一并收掉放进 peer.presence——重连回来的一方要靠它知道对手在不在。
 */
function handshake(code, role, peerId, resume) {
  return new Promise((resolve, reject) => {
    const query = `role=${role}&peer=${peerId}${resume ? '&resume=1' : ''}`
    const ws = new WebSocket(`${WS_BASE}/room/${code}?${query}`)
    const peer = new Peer(ws)
    let settled = false
    ws.addEventListener('message', (event) => {
      if (settled) return
      settled = true
      // 这一帧已经进了 Peer 的队列，取出来消费掉，后面的断言才对得上。
      peer.inbox.shift()
      if (event.data === '#room:ok') resolve(peer)
      else reject(new Error(`进房第一帧不是回执：${event.data}`))
    })
    ws.addEventListener('close', (event) => {
      if (settled) return
      settled = true
      reject(
        Object.assign(new Error(event.reason || '连接被关闭'), {
          closeCode: event.code,
          reason: event.reason,
        }),
      )
    })
    ws.addEventListener('error', () => {
      if (settled) return
      settled = true
      reject(new Error('WebSocket 连接失败'))
    })
    setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`连接超时（${TIMEOUT_MS}ms）`))
    }, TIMEOUT_MS)
  })
}

async function connect(code, role, peerId = newPeerId(), resume = false) {
  const peer = await handshake(code, role, peerId, resume)
  peer.peerId = peerId
  peer.presence = await peer.next()
  return peer
}

/** 期望这次连接被拒绝，返回关闭码和中文原因。 */
async function expectRejected(code, role, peerId = newPeerId(), resume = false) {
  try {
    const peer = await connect(code, role, peerId, resume)
    peer.ws.close()
    return null
  } catch (error) {
    return { code: error.closeCode, reason: error.reason }
  }
}

const freshCode = async () => (await (await fetch(`${BASE}/api/room`)).json()).code

async function main() {
  console.log(`目标：${BASE}\n`)

  console.log('1. GET /api/room 摇房间码')
  const created = await fetch(`${BASE}/api/room`)
  const body = await created.json()
  check(created.status === 200, 'HTTP 200', `实际 ${created.status}`)
  check(/^\d{4}$/.test(body.code ?? ''), '返回 4 位数字房间码', JSON.stringify(body))
  // 这个头只在本地开发（Vite 5173 → wrangler 8787 跨域）起作用，线上同域感觉不到它没了，
  // 所以专门守一条断言，免得哪天被顺手删掉。
  const allowOrigin = created.headers.get('access-control-allow-origin')
  check(
    allowOrigin === '*',
    '带 Access-Control-Allow-Origin: *',
    `实际 ${JSON.stringify(allowOrigin)}`,
  )
  const code = body.code

  console.log('\n2. host 进房，房里还没人')
  const hostId = newPeerId()
  const host = await connect(code, 'host', hostId)
  check(host.presence === '#peer:offline', 'host 收到 #peer:offline（房里还没人）', host.presence)

  console.log('\n3. 不带 peer 参数会被拒')
  const noPeer = await (async () => {
    try {
      const ws = new WebSocket(`${WS_BASE}/room/${code}?role=guest`)
      const peer = new Peer(ws)
      return await peer.waitClose()
    } catch {
      return null
    }
  })()
  check(noPeer?.code === 4000, '关闭码 4000', `实际 ${JSON.stringify(noPeer)}`)

  console.log('\n4. guest 进房，host 收到 peer:joined')
  const guestId = newPeerId()
  const guest = await connect(code, 'guest', guestId)
  check(guest.presence === '#peer:online', 'guest 收到 #peer:online（房主在）', guest.presence)
  const joined = await host.next()
  check(joined === '#peer:joined', 'host 收到 #peer:joined', `实际 ${JSON.stringify(joined)}`)

  console.log('\n5. 转发：guest 发的载荷 host 原样收到')
  // 故意塞一个服务端要是敢 JSON.parse 就会炸的载荷，确认它真的被当成不透明数据。
  const payload = '{"type":"COMMAND","raw":不是合法JSON,"卡牌":"GPT-4o"}'
  guest.ws.send(payload)
  const relayed = await host.next()
  check(relayed === `>${payload}`, 'host 收到 > 前缀 + 原样载荷', JSON.stringify(relayed))

  console.log('\n6. 第三个人被拒：房间已满')
  const full = await expectRejected(code, 'guest')
  check(full?.reason === '房间已满', '原因是「房间已满」', `实际 ${JSON.stringify(full)}`)

  console.log('\n7. 用没人的房间码以 guest 身份首次连：房间不存在')
  const emptyCode = await freshCode()
  const missing = await expectRejected(emptyCode, 'guest')
  check(missing?.reason === '房间不存在', '原因是「房间不存在」', `实际 ${JSON.stringify(missing)}`)

  console.log('\n8. guest 断线重连：旧连接还挂着，同一个 peer 再连一次')
  /*
   * 这是整套改造的核心场景，也是原来必然失败的地方：
   * 网络异常断开时运行时要过一阵才回收旧连接，这期间房里"还有一个 guest"。
   * 按连接数判断房满的话，重连的人会被自己的僵尸连接挡在门外，永远回不去。
   *
   * 这里故意不关旧连接，直接用同一个 peer id 再连一条，把那个时序摆出来。
   */
  const guestBack = await connect(code, 'guest', guestId, true)
  check(true, 'guest 用同一个 peer id 重连成功（没被自己的旧连接挡住）')
  check(
    guestBack.presence === '#peer:online',
    '重连方收到 #peer:online（房主还在）',
    guestBack.presence,
  )

  const zombie = await guest.waitClose()
  check(zombie.code === 4004, '旧连接被顶掉，关闭码 4004', JSON.stringify(zombie))

  const hostSaw = await host.next()
  check(
    hostSaw === '#peer:online',
    'host 收到 #peer:online（是回来了，不是新人进房）',
    `实际 ${JSON.stringify(hostSaw)}`,
  )
  /*
   * 最关键的一条：顶替旧连接不能让对手看到掉线。
   * 旧连接被关会触发服务端的关闭回调，那里如果不先确认"这个玩家真的一条连接都不剩了"，
   * 就会给 host 补一条 peer:offline——host 那边的宽限期计时随即启动，
   * 一局正常进行的对局会莫名其妙被判中断。
   */
  check(await host.quiet(), 'host 没有收到多余的 peer:offline（重连不误报掉线）', JSON.stringify(host.inbox))

  console.log('\n9. 重连之后转发照常走新连接')
  guestBack.ws.send('after-reconnect')
  const afterReconnect = await host.next()
  check(afterReconnect === '>after-reconnect', 'host 收到新连接发来的载荷', JSON.stringify(afterReconnect))

  console.log('\n10. 心跳：发 ping 收 pong，且不会被转发给对手')
  /*
   * 心跳走的是 Durable Object 的自动应答（setWebSocketAutoResponse），
   * DO 在休眠中就能回 pong，不会被唤醒也不计费——所以它既不该进 webSocketMessage，
   * 也就不该被当成载荷转发给对手。这两件事一起验，漏掉哪个都会让对手收到一堆 ping。
   */
  host.ws.send('ping')
  const pong = await host.next()
  check(pong === 'pong', 'host 收到 pong', `实际 ${JSON.stringify(pong)}`)
  check(await guestBack.quiet(), 'ping 没有被转发给对手', JSON.stringify(guestBack.inbox))

  console.log('\n11. host 断线重连：客人还在房里，房主不该被判「房间已被占用」')
  const hostBack = await connect(code, 'host', hostId, true)
  check(true, 'host 用同一个 peer id 重连成功')
  check(hostBack.presence === '#peer:online', '重连方收到 #peer:online（客人还在）', hostBack.presence)
  /*
   * 这条断言依赖上一项的心跳：本地 wrangler 里，一条**从没往上发过消息**的连接
   * 被服务端主动 close 时，关闭帧不会真的送到客户端（服务端侧停在 CLOSING）。
   * 上一项让 host 发过 ping 之后这里才稳定——真实客户端每 15 秒一次心跳，
   * 所以线上不存在"从没发过消息"的连接（见 client 的 socket.ts）。
   *
   * 顺带说明：就算关闭帧真的没送达也不影响对局。房里谁是谁按玩家 id 分组，
   * 僵尸连接和顶替它的新连接算同一个玩家，不会被当成对端，也不会占掉对手的位置。
   */
  const hostZombie = await host.waitClose()
  check(hostZombie.code === 4004, 'host 旧连接被顶掉，关闭码 4004', JSON.stringify(hostZombie))
  const guestSaw = await guestBack.next()
  check(guestSaw === '#peer:online', 'guest 收到 #peer:online', `实际 ${JSON.stringify(guestSaw)}`)
  check(await guestBack.quiet(), 'guest 没有收到多余的 peer:offline', JSON.stringify(guestBack.inbox))

  console.log('\n12. 对手真的走了，才发 peer:offline')
  guestBack.ws.close()
  const offline = await hostBack.next()
  check(offline === '#peer:offline', 'host 收到 #peer:offline', `实际 ${JSON.stringify(offline)}`)
  hostBack.ws.close()

  console.log('\n13. 两个人一起掉线：guest 带 resume 能进空房间等房主')
  /*
   * 同一个 WiFi 抽一下会让两边同时掉线。这时房里一个人都没有，
   * 按"房里没人 = 房间不存在"处理的话，两个人谁也回不去，对局必然报废。
   * 所以重连的 guest 要放进去等，只有首次进房才把空房间当成码打错了。
   */
  const lonelyCode = await freshCode()
  const resumed = await connect(lonelyCode, 'guest', newPeerId(), true)
  check(true, 'guest 带 resume=1 进了空房间')
  check(resumed.presence === '#peer:offline', '收到 #peer:offline（房主还没回来）', resumed.presence)

  const hostRejoin = await connect(lonelyCode, 'host', newPeerId(), true)
  check(hostRejoin.presence === '#peer:online', 'host 随后回来，看到客人在等', hostRejoin.presence)
  const resumedSaw = await resumed.next()
  check(resumedSaw === '#peer:online', 'guest 收到 #peer:online', `实际 ${JSON.stringify(resumedSaw)}`)
  resumed.ws.close()
  hostRejoin.ws.close()

  console.log('\n14. 静态资源与 SPA 回退')
  const indexHtml = await fetch(`${BASE}/`)
  const indexText = await indexHtml.text()
  check(indexHtml.status === 200, 'GET / 返回 200', `实际 ${indexHtml.status}`)
  check(indexText.includes('<div id="root">'), 'GET / 是 index.html')

  // 浏览器地址栏打开 /room/1234 时带 Sec-Fetch-Mode: navigate，这类请求由静态资源层直接处理，
  // 根本不会调用 Worker；这里两种都试一遍，确认走 Worker 兜底的那条路也回 index.html。
  const spa = await fetch(`${BASE}/room/1234`)
  const spaText = await spa.text()
  check(spa.status === 200, 'GET /room/1234 返回 200', `实际 ${spa.status}`)
  check(spaText === indexText, 'GET /room/1234 回落到 index.html')

  const navigated = await fetch(`${BASE}/room/1234`, { headers: { 'Sec-Fetch-Mode': 'navigate' } })
  check(
    navigated.status === 200 && (await navigated.text()) === indexText,
    '导航请求同样回落到 index.html',
  )

  console.log('\n15. 换房：进了别人的房之后，自己原来那间要被释放')
  // 照着客户端 join() 的动作走一遍：先连上目标房间，成功之后才关掉自己那条。
  // 顺序反过来（先关再连）的话，目标房间不存在或已满时自己那间也跟着没了，
  // 界面上还显示着房间码，但那个码已经是空头支票。
  const mineCode = await freshCode()
  const mine = await connect(mineCode, 'host')
  const targetCode = await freshCode()
  const target = await connect(targetCode, 'host')

  const guestOnTarget = await connect(targetCode, 'guest')
  check(Boolean(guestOnTarget), `以 guest 连进了别人的房 ${targetCode}`)

  // 进房成功了，这才关掉自己那条。关完原来那间就该空了。
  mine.ws.close()
  await new Promise((resolve) => setTimeout(resolve, 300))

  const orphan = await expectRejected(mineCode, 'guest')
  check(
    orphan?.reason === '房间不存在',
    `原来那间房 ${mineCode} 已经释放`,
    `实际 ${JSON.stringify(orphan)}`,
  )

  guestOnTarget.ws.close()
  target.ws.close()

  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\n冒烟测试崩了：', error)
  process.exit(1)
})

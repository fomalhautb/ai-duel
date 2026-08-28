/**
 * 转发器的端到端冒烟测试。
 *
 * 跑法：先 `pnpm --filter @ai-duel/client build` 出静态资源，
 * 另开一个终端 `pnpm --filter @ai-duel/server dev`，然后 `pnpm --filter @ai-duel/server smoke`。
 * 换地址用环境变量：SMOKE_BASE=https://playyourcardai.online node test/smoke.mjs
 *
 * 用 Node 内置的全局 WebSocket（Node 22+），不引第三方库。
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

  /** 等连接被关掉，返回关闭码和原因。 */
  waitClose() {
    if (this.closed) return Promise.resolve(this.closed)
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }))
      setTimeout(() => reject(new Error(`等关闭超时（${TIMEOUT_MS}ms）`)), TIMEOUT_MS)
    })
  }
}

/**
 * 连一个房间。
 *
 * 被拒绝的连接也会先握手成功再被立刻关掉，所以这里不能一看到 open 就当成功，
 * 要等到第一帧：`#room:ok` 是进房了，close 是被拒了。
 */
function connect(code, role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/room/${code}?role=${role}`)
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
      reject(Object.assign(new Error(event.reason || '连接被关闭'), {
        closeCode: event.code,
        reason: event.reason,
      }))
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

/** 期望这次连接被拒绝，返回关闭码和中文原因。 */
async function expectRejected(code, role) {
  try {
    const peer = await connect(code, role)
    peer.ws.close()
    return null
  } catch (error) {
    return { code: error.closeCode, reason: error.reason }
  }
}

async function main() {
  console.log(`目标：${BASE}\n`)

  console.log('1. GET /api/room 摇房间码')
  const created = await fetch(`${BASE}/api/room`)
  const body = await created.json()
  check(created.status === 200, 'HTTP 200', `实际 ${created.status}`)
  check(/^\d{4}$/.test(body.code ?? ''), '返回 4 位数字房间码', JSON.stringify(body))
  const code = body.code

  console.log('\n2. host 进房')
  const host = await connect(code, 'host')
  check(true, `host 连上 /room/${code}?role=host`)

  console.log('\n3. guest 进房，host 收到 peer:joined')
  const guest = await connect(code, 'guest')
  const joined = await host.next()
  check(joined === '#peer:joined', 'host 收到 #peer:joined', `实际 ${JSON.stringify(joined)}`)

  console.log('\n4. 转发：guest 发的载荷 host 原样收到')
  // 故意塞一个服务端要是敢 JSON.parse 就会炸的载荷，确认它真的被当成不透明数据。
  const payload = '{"type":"COMMAND","raw":不是合法JSON,"卡牌":"GPT-4o"}'
  guest.ws.send(payload)
  const relayed = await host.next()
  check(relayed === `>${payload}`, 'host 收到 > 前缀 + 原样载荷', JSON.stringify(relayed))

  console.log('\n5. 第三个连接被拒：房间已满')
  const full = await expectRejected(code, 'guest')
  check(full !== null, '连接被拒绝')
  check(full?.reason === '房间已满', '原因是「房间已满」', `实际 ${JSON.stringify(full)}`)

  console.log('\n6. 用没人的房间码以 guest 身份连：房间不存在')
  // 先确认这个码确实是空的：摇一个新码但不连上去。
  const emptyCode = (await (await fetch(`${BASE}/api/room`)).json()).code
  const missing = await expectRejected(emptyCode, 'guest')
  check(missing !== null, '连接被拒绝')
  check(missing?.reason === '房间不存在', '原因是「房间不存在」', `实际 ${JSON.stringify(missing)}`)

  console.log('\n7. guest 断开，host 收到 peer:left')
  guest.ws.close()
  const left = await host.next()
  check(left === '#peer:left', 'host 收到 #peer:left', `实际 ${JSON.stringify(left)}`)
  host.ws.close()

  console.log('\n8. 静态资源与 SPA 回退')
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
  check(navigated.status === 200 && (await navigated.text()) === indexText, '导航请求同样回落到 index.html')

  console.log('\n9. 换房：进了别人的房之后，自己原来那间要被释放')
  // 照着客户端 join() 的动作走一遍：先连上目标房间，成功之后才关掉自己那条。
  // 顺序反过来（先关再连）的话，目标房间不存在或已满时自己那间也跟着没了，
  // 界面上还显示着房间码，但那个码已经是空头支票。
  const mineCode = (await (await fetch(`${BASE}/api/room`)).json()).code
  const mine = await connect(mineCode, 'host')
  const targetCode = (await (await fetch(`${BASE}/api/room`)).json()).code
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

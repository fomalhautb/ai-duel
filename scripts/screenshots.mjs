#!/usr/bin/env node
/**
 * 给 README 拍截图。
 *
 *   node scripts/screenshots.mjs                          # 自己起一个 dev server 再拍
 *   node scripts/screenshots.mjs --url https://playyourcardai.online   # 拍线上
 *   node scripts/screenshots.mjs --only home,deck         # 只重拍其中几张
 *
 * 出图落在 docs/screenshots/，文件名就是下面 SHOTS 里的 name，README 直接引用这几个路径，
 * 所以改名之前先看一眼 README。图是要提交进仓库的（GitHub 上的 README 只能引仓库里的文件）。
 *
 * 用 Playwright 而不是手动截屏：这几页以后还要跟着改版重拍，手动截的尺寸和时机每次都不一样，
 * README 里几张图会渐渐对不上。脚本至少保证分辨率一致、都等到动画停了再按快门。
 *
 * 四张图的取景思路：
 * - home  首页，游戏的门面；
 * - room  匹配房，联机是怎么开始的看这一张；
 * - battle 对局界面，走首页的「测试对局」入口——它就地造一局本地对局，不用真凑两台机器；
 * - deck  组建牌组页，卡牌长什么样看这一张。
 *
 * 拍之前要装浏览器内核：`pnpm exec playwright install chromium`（Playwright 装的是库，浏览器要另下）。
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots')

/**
 * 视口。和整个前端的设计基准一样是 16:9（设计稿 1672×941），对局页和牌组页本来就把版面
 * 锁在 16:9 舞台里，比例对不上就会在上下留出空白边。1600×900 是这条比例上一个够清晰、
 * 文件又不至于太大的档位。
 */
const VIEWPORT = { width: 1600, height: 900 }

/** 自己起 dev server 时用的端口。刻意不用默认的 5173：那个端口经常被别的 worktree 占着。 */
const DEV_PORT = 5273

/** 自己起转发器时用的端口。同样避开默认的 8787，免得撞上手边已经开着的 `pnpm dev:server`。 */
const RELAY_PORT = 8887

/**
 * 每张图：进哪个页面、等什么出现、再多等多久。
 *
 * settleMs 是等 GSAP 那些入场动画演完——它们没有"结束"信号可以等，只能给个宽裕的时长。
 * 拍出来的图像是动画演到一半，把对应那条调大。
 */
const SHOTS = [
  {
    name: 'home',
    title: '首页',
    path: '/',
    // 首页把素材全部加载完才一次性亮出来，在那之前只有加载动画（见 HomeScreen）。
    waitFor: '.home__stage',
    settleMs: 2500,
  },
  {
    name: 'room',
    title: '匹配房',
    path: '/room',
    // 这一页一进来就先找转发器要一个 4 位房间码，要不到就整个左半边变成「连接失败」，
    // 所以它是唯一一张要连转发器的图（needsRelay）。
    // 等 .room__code-value：这个节点只有码真的拿到手之后才出现，等到它就等到了正常的样子。
    needsRelay: true,
    prepare: prepareRoom,
    waitFor: '.room__code-value',
    settleMs: 1500,
  },
  {
    name: 'battle',
    title: '对局界面',
    path: '/',
    // /match 直接敲进去会因为读不到 driver 被弹回首页（对局不存盘），
    // 所以从首页点「测试对局」，让它就地造一局再跳过去。
    // 进去之后还要真出牌：空场只有一片蓝底，看不出这游戏在玩什么。
    prepare: prepareBattle,
    waitFor: '.hand-fan__slot',
    settleMs: 2000,
  },
  {
    name: 'deck',
    title: '组建牌组',
    path: '/deck',
    waitFor: '.deck-scaler',
    settleMs: 2500,
  },
]

const args = parseArgs(process.argv.slice(2))
const only = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null
const shots = only ? SHOTS.filter((shot) => only.has(shot.name)) : SHOTS

if (shots.length === 0) {
  console.error(`--only 没匹配到任何一张图。可选：${SHOTS.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

await main()

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  // 给了 --url 就直接拍那个地址（线上版、或者自己已经起好的 dev server），不再另起进程。
  // 转发器只有拍 room 那张时才需要，别的图不用为它多等一次启动。
  const needsRelay = shots.some((shot) => shot.needsRelay)
  const relay = args.url || !needsRelay ? null : await startRelay()
  const server = args.url ? null : await startDevServer()
  const baseUrl = args.url ?? `http://localhost:${DEV_PORT}`

  const browser = await chromium.launch()
  try {
    for (const shot of shots) {
      // 每张图开一个全新的 context：存档在 localStorage 里，上一张留下的状态
      // （比如测试对局记的胜场）不该带进下一张。
      const context = await browser.newContext({ viewport: VIEWPORT })
      const page = await context.newPage()
      try {
        await page.goto(baseUrl + shot.path, { waitUntil: 'load' })
        if (shot.prepare) await shot.prepare(page)
        if (shot.waitFor) await page.waitForSelector(shot.waitFor)
        await page.waitForTimeout(shot.settleMs)

        // 存 jpeg 不存 png：这几张都是满屏插画，png 一张要 2MB，而它们最终只在 README 里
        // 按 880px 宽显示，看不出压缩痕迹，仓库却要背着这些图一直传下去。
        const file = path.join(OUT_DIR, `${shot.name}.jpg`)
        await page.screenshot({ path: file, type: 'jpeg', quality: 88 })
        console.log(`✓ ${shot.title}  →  ${path.relative(REPO_ROOT, file)}`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
    server?.stop()
    relay?.stop()
  }
}

/**
 * 匹配房这一页本身不用操作，只把左下角的「测试房」入口藏掉——
 * 那是个只在开发时用的本地对局入口，正式玩不到，留在图里会让人以为游戏里有这个功能。
 */
async function prepareRoom(page) {
  await page.addStyleTag({ content: '.room__dev { display: none !important; }' })
}

/**
 * 从首页进测试对局，摆出一个「我方场上有 AI 牌、手里还剩几张」的局面。
 *
 * 为什么要费这个劲：刚开局的场是空的，截出来就是一大片蓝底，
 * README 里那张图应该让人一眼看出这是张什么样的牌桌。
 *
 * 局面靠的是真实操作（拖牌），不是塞状态，所以拍出来的就是玩家会看到的样子。
 * 唯一一处作弊是最后把 dev 测试面板藏掉——那块东西只在测试房里挂，正式对局没有。
 */
async function prepareBattle(page) {
  await page.waitForSelector('.home__stage')
  await page.getByRole('button', { name: '测试对局' }).click()
  await page.waitForSelector('.battle-frame')
  // 开局先抛硬币定先手，硬币演完这个节点才会从 DOM 里撤掉。
  // 万一这一版没有硬币，detached 会立刻满足，不会白等。
  await page.waitForSelector('.coin-toss', { state: 'detached', timeout: 30_000 })
  await page.waitForSelector('.hand-fan__slot')
  await page.waitForTimeout(2000)

  // 先手是抛硬币定的（测试房的 seed 就是当前时间），可能轮到对方先出。
  // 对方是没人操作的空位，只能用测试面板把他那一手结束掉，把回合要回来。
  // .hand-fan 上的 data-locked 就是「现在轮不到你」，它消失了才轮到我方。
  await page.getByRole('button', { name: '测试面板' }).click()
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('.hand-fan[data-locked]').count()) === 0) break
    await page.getByRole('button', { name: '结束出牌' }).click()
    await page.waitForTimeout(1800)
  }

  // 有多少 Token 就出多少张，出不动了自然停。data-unaffordable 是「这轮买不起」。
  // 每次都挑最便宜的一张：开局只有 4 点 Token，随手抓一张 4 费的就把额度一次用光。
  // 先出便宜的能多摆一张是一张——手牌是随机发的，有时候第二张也买不起，那就只有一张。
  for (let i = 0; i < 2; i += 1) {
    const affordable = page.locator('.hand-fan__slot:not([data-unaffordable])')
    if ((await affordable.count()) === 0) break
    await dragToBoard(page, affordable.nth(await cheapestIndex(affordable)))
  }

  await page.getByRole('button', { name: '收起面板' }).click()
  // 指针挪开：停在哪张牌上那张就会一直抬着，截出来像是有人正指着它。
  await page.mouse.move(20, 20)
  // 测试面板的入口按钮收起后还留在角落，只有测试房才有，藏掉免得看图的人以为游戏里有这个。
  await page.addStyleTag({ content: '.battle-dev { display: none !important; }' })
}

/**
 * 在一组手牌里找出 Token 费用最低的那张，返回它在这组里的下标。
 *
 * 费用没有单独的 data 属性，卡面左上角那个数字就是它，也是卡里的第一个数字，
 * 所以直接从文本里抠。抠不出来（卡面改版了）就当它很贵，排到最后，脚本还是能往下走。
 */
async function cheapestIndex(slots) {
  const costs = await slots.evaluateAll((nodes) =>
    nodes.map((node) => {
      const match = node.textContent.match(/\d+/)
      return match ? Number(match[0]) : Number.POSITIVE_INFINITY
    }),
  )
  return costs.indexOf(Math.min(...costs))
}

/**
 * 把一张手牌拖到场上。
 *
 * 出牌只认拖拽（见 ui/useCardDrag.ts），没有点一下就出的入口，所以只能真的走一遍
 * 按下 — 移动 — 松手。中间分成 20 小步是必须的：一步跳到终点的话，拖拽逻辑
 * 收不到足够的 pointermove，判不出这是拖不是点。
 */
async function dragToBoard(page, slot) {
  const card = await slot.boundingBox()
  const board = await page.locator('.battle__board').boundingBox()
  // 按在卡的上部：手牌是扇形叠着的，卡的下半截被旁边的牌压住，按下去抓到的是别人。
  const from = { x: card.x + card.width / 2, y: card.y + 40 }
  const to = { x: board.x + board.width / 2, y: board.y + board.height * 0.7 }

  await page.mouse.move(from.x, from.y)
  await page.waitForTimeout(150)
  await page.mouse.down()
  const STEPS = 20
  for (let i = 1; i <= STEPS; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / STEPS,
      from.y + ((to.y - from.y) * i) / STEPS,
    )
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(250)
  await page.mouse.up()
  // 等落场动画演完，手牌也合拢回去。
  await page.waitForTimeout(2200)
}

/**
 * 起一个只给截图用的 dev server，返回一个能关掉它的把手。
 *
 * 顺手把 VITE_SERVER_URL 指到本地转发器：/room 那张图要靠它拿房间码。
 * 环境变量里的 VITE_ 变量优先级高于 .env.local，所以开发者本机怎么配都盖不掉这一条。
 */
async function startDevServer() {
  return startProcess({
    label: 'dev server',
    port: DEV_PORT,
    cwd: path.join(REPO_ROOT, 'packages', 'client'),
    argv: ['exec', 'vite', '--port', String(DEV_PORT), '--strictPort'],
    env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${RELAY_PORT}` },
    probePath: '/',
  })
}

/**
 * 起一个只给截图用的转发器（`wrangler dev`），返回一个能关掉它的把手。
 *
 * 探活打的是 `/api/room`——它就是页面进来要码时打的那个接口，能返回码才算真的能用。
 * 每探一次会多摇一个房间码出来，摇出来没人用也不占什么，房间是空的自己就没了。
 */
async function startRelay() {
  // wrangler 启动时会校验静态资源目录存不存在，客户端没 build 过它就直接报错退出。
  // 截图的页面是 vite 提供的，走不到这个目录，所以空目录就够它过这一关。
  await mkdir(path.join(REPO_ROOT, 'packages', 'client', 'dist'), { recursive: true })

  return startProcess({
    label: '转发器',
    port: RELAY_PORT,
    cwd: path.join(REPO_ROOT, 'packages', 'server'),
    argv: ['exec', 'wrangler', 'dev', '--port', String(RELAY_PORT)],
    env: process.env,
    probePath: '/api/room',
  })
}

/**
 * 起一个后台进程，等它在自己的端口上应答，返回一个能关掉它的把手。
 *
 * detached + kill 整个进程组：pnpm 会再 fork 出真正的进程（vite / wrangler），只杀 pnpm 的话
 * 子进程会活下来占着端口，下次跑脚本就撞上端口冲突直接失败。
 */
async function startProcess({ label, port, cwd, argv, env, probePath }) {
  console.log(`起${label}（端口 ${port}）…`)
  const child = spawn('pnpm', argv, { cwd, env, stdio: 'ignore', detached: true })

  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // 已经自己退了就没什么可杀的。
    }
  }
  // 脚本中途崩了也要把进程带走，否则端口一直被占着。
  process.on('exit', stop)

  const url = `http://localhost:${port}${probePath}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return { stop }
    } catch {
      // 还没起来，接着轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  stop()
  throw new Error(`${label} 60 秒还没起来（${url}）`)
}

/** 只认 `--key value` 和 `--key=value` 两种写法，够这个脚本用了。 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      out[arg.slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return out
}

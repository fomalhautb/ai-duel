import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BATTLE_ASSETS,
  CARD_ART_ASSETS,
  CARD_ART_FULL_ASSETS,
  CARD_BACK_ASSETS,
  CARD_BACK_FULL_ASSETS,
} from '../src/ui/backgroundPreload'
import { DECK_ASSETS } from '../src/screens/DeckScreen'
import { HERO_ASSETS } from '../src/screens/HeroScreen'
import { HOME_ASSETS } from '../src/screens/HomeScreen'
import { INFO_ASSETS } from '../src/screens/InfoScreen'
import { ROOM_ASSETS } from '../src/screens/RoomScreen'
import { TRACK_SOURCE } from '../src/ui/backgroundMusic'

/**
 * 预加载清单和 public/ 里实际的图必须一一对上。
 *
 * 守的是同一个毛病的两面：
 *   - 清单里有、文件没有 → 那张图永远加载失败，卡面是个裂图；
 *   - 文件有、清单里没有 → 那张图要等真用到时才开始下，玩家先看到一块白再看到它显影。
 * 后者正是这次要修的：24 张技能牌原画一直没进任何清单，出牌的那一刻才开始下载。
 * 两种都不会让程序报错，只会让画面变难看，所以只能靠测试盯着。
 *
 * 直接扫目录而不是维护一份"应该有哪些文件"的名单：那份名单本身也会漂移，
 * 等于把同一个问题往后推一层。
 */

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url))

/**
 * 要盯的文件类型。
 *
 * 只管图：音乐是边播边下的，不该也不能整首等在 loader 后面（它自己那份检查在最后一组）；
 * favicon.svg 由浏览器自己按 <link> 取。
 * png / jpg 也列进来不是因为还有这两种文件，恰恰相反——scripts/optimize-images.sh
 * 已经把它们全转成了 webp，这里列上是为了下面那条"public 下只有 webp"的断言能抓到漏网的。
 */
const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg']

/** public/ 下全部图片，返回的是页面里用的那种根绝对路径（'/cards/models/gpt-2.webp'）。 */
function listPublicImages(): string[] {
  const found: string[] = []
  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      const url = `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, url)
      else if (IMAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(url)
    }
  }
  walk(PUBLIC_DIR, '')
  return found.sort()
}

/**
 * 全部清单合到一起。
 *
 * CARD_ART_ASSETS 和 CARD_BACK_ASSETS 已经并在 BATTLE_ASSETS 里了，这里再列一遍是故意的：
 * 哪天有人把它们从 BATTLE_ASSETS 里摘出去单独排队，这份合集不用跟着改。
 *
 * 末尾那两份原画清单是"只登记、不下载"的：界面上已经没有一处引用 1024×1536 的原画
 *（卡面一律走 600 宽那一档，见 src/ui/cardArtThumb.ts），但文件还留在 public/ 下，
 * 所以必须登记，否则下面第一条断言会把它们报成漏网。
 */
const ALL_MANIFESTS = [
  BATTLE_ASSETS,
  CARD_ART_ASSETS,
  CARD_BACK_ASSETS,
  CARD_ART_FULL_ASSETS,
  CARD_BACK_FULL_ASSETS,
  DECK_ASSETS,
  HERO_ASSETS,
  HOME_ASSETS,
  INFO_ASSETS,
  ROOM_ASSETS,
]

describe('图片预加载清单', () => {
  const publicImages = listPublicImages()
  const listed = new Set(ALL_MANIFESTS.flat())

  it('public/ 下的每一张图都登记在某份清单里', () => {
    // 逐个报缺失的文件名，而不是只说数字对不上——加图忘了登记的人要的是"哪一张"。
    expect(publicImages.filter((url) => !listed.has(url))).toEqual([])
  })

  it('清单里的每个地址在 public/ 下都有对应文件', () => {
    const existing = new Set(publicImages)
    expect([...listed].filter((url) => !existing.has(url)).sort()).toEqual([])
  })

  it('public/ 下只有 webp（png / jpg 都已转掉）', () => {
    // 同一张图有两种格式时，代码引哪个全凭记忆，改图很容易只换掉没人用的那份。
    // 新图请跑 scripts/optimize-images.sh 转格式，然后把代码里的引用改成 .webp。
    expect(publicImages.filter((url) => !url.endsWith('.webp'))).toEqual([])
  })

  it('46 张卡面正面，三档各算一遍', () => {
    // 这次白卡的根因就是这批图一张都没进清单。数字写死，少一张要有人解释为什么。
    expect(CARD_ART_FULL_ASSETS).toHaveLength(46)
    expect(CARD_ART_ASSETS).toHaveLength(46)
    expect(DECK_ASSETS.filter((url) => url.startsWith('/cards/thumbs/'))).toHaveLength(46)
  })

  it('对局要下的卡面是 600 宽那一档，不是原画', () => {
    // 档位一旦和卡面组件（HandCardFace 铺的是 midFor(...)）分家，预载的和显示的就是两个 URL：
    // 图照下不误、卡面照白不误，而且白下三倍大的流量。这条断言是那个错误的唯一拦网。
    const cards = BATTLE_ASSETS.filter((url) => url.startsWith('/cards/'))
    expect(cards.filter((url) => !url.startsWith('/cards/mid/'))).toEqual([])
    // 正面 46 + 两张卡背。
    expect(cards).toHaveLength(48)
  })

  it('原画一张都不进后台预载队列', () => {
    // 界面上没有一处引用原画，排进队列就是白下 15 MB。
    // 队列的内容见 backgroundPreload 的 PRELOAD_GROUPS；这里从外面能看到的入口是各页清单。
    const queued = new Set([
      ...BATTLE_ASSETS,
      ...DECK_ASSETS,
      ...HERO_ASSETS,
      ...HOME_ASSETS,
      ...INFO_ASSETS,
      ...ROOM_ASSETS,
    ])
    const leaked = [...CARD_ART_FULL_ASSETS, ...CARD_BACK_FULL_ASSETS].filter((url) =>
      queued.has(url),
    )
    expect(leaked).toEqual([])
  })
})

/**
 * 背景音乐不进预加载清单（边播边下），但同样怕改名和格式漂移，所以单独核一遍。
 */
describe('背景音乐', () => {
  const files = readdirSync(`${PUBLIC_DIR}/music`).sort()

  it('四首曲子在 public/music/ 下都有对应文件', () => {
    const listed = Object.values(TRACK_SOURCE).map((url) => url.replace('/music/', '')).sort()
    expect(files).toEqual(listed)
  })

  it('public/music/ 下只有 m4a（mp3 都已转掉）', () => {
    // 换/加曲目请跑 scripts/optimize-music.sh，别直接把 mp3 丢进来：
    // 同样的听感 mp3 要大一倍，而 audio 元素是 preload='auto'，整首都会跟当前页面抢带宽。
    expect(files.filter((name) => !name.endsWith('.m4a'))).toEqual([])
  })
})

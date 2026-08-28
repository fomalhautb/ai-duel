import { useEffect, useMemo, useRef, useState } from 'react'

/* ============================================================
   纸纹调参面板（开发工具，不要出现在正式对局界面里）
   ------------------------------------------------------------
   从原来那个静态设计参考页底部的 script 移植过来（页面现在是 /design）。
   拖滑条会按当前值重新生成两张噪声 data URI 写回 :root，
   全站（页面背景、卡面、卡背）一起变；不透明度和暗角浓度是独立的
   CSS 变量，拖它们不重算噪声。
   ============================================================ */

type TunerKey =
  | 'mBf'
  | 'mOct'
  | 'mSurf'
  | 'mElev'
  | 'mSeed'
  | 'mAlpha'
  | 'fBf'
  | 'fOct'
  | 'fSeed'
  | 'fAlpha'
  | 'vig'

type TunerState = Record<TunerKey, number>

type MottleParams = Pick<TunerState, 'mBf' | 'mOct' | 'mSurf' | 'mElev' | 'mSeed'>
type FiberParams = Pick<TunerState, 'fBf' | 'fOct' | 'fSeed'>

/**
 * 初始值必须和 paper.css 里烘死的那两个 data URI 完全一致。
 * 面板一挂载就整个重算一遍写回 :root，所以对不上的话打开页面
 * 纹理会「跳」一下——等于每次开面板都自检一次。
 */
const DEFAULTS: TunerState = {
  mBf: 0.0059,
  mOct: 2,
  mSurf: 15,
  mElev: 56,
  mSeed: 17,
  mAlpha: 0.7,
  fBf: 0.63,
  fOct: 3,
  fSeed: 5,
  fAlpha: 0.92,
  vig: 0.63,
}

/** 暗角滑条 0~1 是「强度」，不是 alpha 本身，乘这个上限才是写进 rgba 的值。
    拆成两个数是为了让滑条 0~1 的整个行程都落在「看得出变化」的区间里，
    直接把 alpha 摊到 0~1 的话超过 0.3 就已经黑得不像纸了。 */
const VIG_MAX_ALPHA = 0.3

/** 图块尺寸不开放调节：改了它 stitchTiles 的接缝对不上。 */
const MOTTLE_TILE = 900
const FIBER_TILE = 240

/** 面板会往 :root 上写的全部变量。卸载时按这份名单清干净——
    这几个变量首页背景也在用，不清的话从调参页离开后主页纸纹
    会一直带着调过的参数。 */
const TUNED_VARS = [
  '--tex-mottle',
  '--tex-fiber',
  '--mottle-alpha',
  '--fiber-alpha',
  '--vignette-alpha',
] as const

/* ----------------------------------------------------------
   两张噪声图的生成
   ----------------------------------------------------------
   整个 SVG 交给 encodeURIComponent 统一转义，不手写 %23 之类。
   它会把 # < > " 都编码掉，剩下没编码的 ' ( ) 在
   url("...") 的双引号里是合法字符，所以拼出来一定能用。 */
function toUrl(svg: string) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'
}

function buildMottle(s: MottleParams) {
  const n = MOTTLE_TILE
  return toUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' width='" + n + "' height='" + n + "'>" +
      "<filter id='m' x='0' y='0' width='" +
      n +
      "' height='" +
      n +
      "' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'>" +
      "<feTurbulence type='fractalNoise' baseFrequency='" +
      s.mBf +
      "' numOctaves='" +
      s.mOct +
      "' seed='" +
      s.mSeed +
      "' stitchTiles='stitch'/>" +
      "<feDiffuseLighting lighting-color='#ffffff' surfaceScale='" +
      s.mSurf +
      "' diffuseConstant='1'>" +
      "<feDistantLight azimuth='45' elevation='" +
      s.mElev +
      "'/>" +
      '</feDiffuseLighting>' +
      '<feComponentTransfer>' +
      "<feFuncR type='linear' slope='0.47' intercept='0.591'/>" +
      "<feFuncG type='linear' slope='0.52' intercept='0.548'/>" +
      "<feFuncB type='linear' slope='0.60' intercept='0.478'/>" +
      '</feComponentTransfer>' +
      '</filter>' +
      "<rect width='" +
      n +
      "' height='" +
      n +
      "' filter='url(#m)'/>" +
      '</svg>',
  )
}

function buildFiber(s: FiberParams) {
  const n = FIBER_TILE
  return toUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' width='" + n + "' height='" + n + "'>" +
      "<filter id='f' x='0' y='0' width='" +
      n +
      "' height='" +
      n +
      "' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'>" +
      "<feTurbulence type='fractalNoise' baseFrequency='" +
      s.fBf +
      "' numOctaves='" +
      s.fOct +
      "' seed='" +
      s.fSeed +
      "' stitchTiles='stitch'/>" +
      "<feColorMatrix type='matrix' values='0.34 0.33 0.33 0 0 0.34 0.33 0.33 0 0 0.34 0.33 0.33 0 0 0 0 0 0 1'/>" +
      '<feComponentTransfer>' +
      "<feFuncR type='linear' slope='0.34' intercept='0.83'/>" +
      "<feFuncG type='linear' slope='0.34' intercept='0.83'/>" +
      "<feFuncB type='linear' slope='0.34' intercept='0.83'/>" +
      '</feComponentTransfer>' +
      '</filter>' +
      "<rect width='" +
      n +
      "' height='" +
      n +
      "' filter='url(#f)'/>" +
      '</svg>',
  )
}

/** 三位小数够用，避免 0.5*0.3 这种浮点尾巴写进 CSS */
function vigAlpha(vig: number) {
  return +(vig * VIG_MAX_ALPHA).toFixed(3)
}

/** 导出用的暗角渐变。alpha 必须留成 var(--vignette-alpha) 而不是写死数值：
    面板运行时只改 --vignette-alpha 这一个变量，靠 var() 把新值透进渐变里。
    要是导出时把当前 alpha 烘进 rgba()，粘回 paper.css 后这条链路就断了，
    下次再开面板拖暗角滑条会毫无反应。 */
function vignetteCss() {
  return (
    'radial-gradient(ellipse 130% 100% at 50% 42%,\n' +
    '                rgba(0,0,0,0) 45%, rgba(122,106,74,var(--vignette-alpha)) 100%)'
  )
}

/* ----------------------------------------------------------
   面板行配置
   ----------------------------------------------------------
   demo 里每行还带一个 layer 字段，用来标记「这个滑条脏了哪一层」。
   这里不需要：两张图各自用 useMemo 缓存，依赖数组已经把
   「哪些参数属于哪一层」表达清楚了，不相干的滑条不会触发重算。 */
type TunerRow =
  | { type: 'group'; text: string }
  | { type: 'range'; key: TunerKey; label: string; min: number; max: number; step: number; dec: number }
  | { type: 'seed'; key: TunerKey; label: string }

const ROWS: TunerRow[] = [
  { type: 'group', text: '大尺度斑驳 · --tex-mottle' },
  { type: 'range', key: 'mBf', label: 'baseFrequency', min: 0.002, max: 0.05, step: 0.0001, dec: 4 },
  { type: 'range', key: 'mOct', label: 'numOctaves', min: 1, max: 6, step: 1, dec: 0 },
  { type: 'range', key: 'mSurf', label: 'surfaceScale', min: 1, max: 30, step: 0.5, dec: 1 },
  { type: 'range', key: 'mElev', label: '光照 elevation', min: 20, max: 90, step: 1, dec: 0 },
  { type: 'range', key: 'mAlpha', label: '图层不透明度', min: 0, max: 1, step: 0.01, dec: 2 },
  { type: 'seed', key: 'mSeed', label: 'seed' },

  { type: 'group', text: '细颗粒 · --tex-fiber' },
  { type: 'range', key: 'fBf', label: 'baseFrequency', min: 0.3, max: 1.2, step: 0.01, dec: 2 },
  { type: 'range', key: 'fOct', label: 'numOctaves', min: 1, max: 4, step: 1, dec: 0 },
  { type: 'range', key: 'fAlpha', label: '图层不透明度', min: 0, max: 1, step: 0.01, dec: 2 },
  { type: 'seed', key: 'fSeed', label: 'seed' },

  { type: 'group', text: '暗角 · --vignette' },
  { type: 'range', key: 'vig', label: '暗角强度', min: 0, max: 1, step: 0.01, dec: 2 },
]

function fmt(dec: number, v: number) {
  return dec === 0 ? String(v) : v.toFixed(dec)
}

function summaryText(s: TunerState) {
  return (
    '斑驳  bf ' +
    s.mBf +
    ' · oct ' +
    s.mOct +
    ' · surf ' +
    s.mSurf +
    ' · elev ' +
    s.mElev +
    ' · seed ' +
    s.mSeed +
    ' · α ' +
    s.mAlpha +
    '\n' +
    '颗粒  bf ' +
    s.fBf +
    ' · oct ' +
    s.fOct +
    ' · seed ' +
    s.fSeed +
    ' · α ' +
    s.fAlpha +
    '\n' +
    '暗角  强度 ' +
    s.vig +
    ' → rgba α ' +
    vigAlpha(s.vig)
  )
}

/** 拼出可以整段替换 paper.css 里 :root 对应几行的 CSS */
function exportCss(s: TunerState) {
  return (
    '/* 纸纹参数\n' +
    '   ' +
    summaryText(s).replace(/\n/g, '\n   ') +
    ' */\n' +
    ':root {\n' +
    '  --tex-mottle: ' +
    buildMottle(s) +
    ';\n\n' +
    '  --tex-fiber: ' +
    buildFiber(s) +
    ';\n\n' +
    '  --mottle-alpha: ' +
    s.mAlpha +
    ';\n' +
    '  --fiber-alpha:  ' +
    s.fAlpha +
    ';\n\n' +
    '  --vignette-alpha: ' +
    vigAlpha(s.vig) +
    ';\n' +
    '  --vignette: ' +
    vignetteCss() +
    ';\n' +
    '}\n'
  )
}

/** 非安全上下文（比如某些 file:// 场景）没有 clipboard API，退回老办法 */
function legacyCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

export type PaperTunerProps = {
  className?: string
}

/**
 * 纸纹调参面板。挂上就会接管 :root 上的纸纹变量，卸载时全部还回去。
 *
 * 只该出现在开发用的设计页上：它是 position: fixed 钉在视口右上角的浮层，
 * 而且写的是全局变量，出现在对局界面里会连带改掉整场比赛的画面。
 */
export function PaperTuner({ className = '' }: PaperTunerProps) {
  const [state, setState] = useState<TunerState>(DEFAULTS)
  const [collapsed, setCollapsed] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  const { mBf, mOct, mSurf, mElev, mSeed, mAlpha, fBf, fOct, fSeed, fAlpha, vig } = state

  /* 两张图各自缓存：拖细颗粒的滑条时不会连带重算 900px 那张斑驳图
     （feTurbulence + feDiffuseLighting 解码一次要几十毫秒）。 */
  const mottleUrl = useMemo(
    () => buildMottle({ mBf, mOct, mSurf, mElev, mSeed }),
    [mBf, mOct, mSurf, mElev, mSeed],
  )
  const fiberUrl = useMemo(() => buildFiber({ fBf, fOct, fSeed }), [fBf, fOct, fSeed])

  /* ----------------------------------------------------------
     写回 :root：rAF 合并
     ----------------------------------------------------------
     range 的 input 事件一秒能来上百次，每次都 setProperty 会让浏览器
     反复解码那张 900px 的图，不合并会直接拖死。 */
  const pendingRef = useRef<Record<string, string> | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    pendingRef.current = {
      '--tex-mottle': mottleUrl,
      '--tex-fiber': fiberUrl,
      /* 这三个是纯变量改动，零成本，每次都写一遍省得再做脏标记 */
      '--mottle-alpha': String(mAlpha),
      '--fiber-alpha': String(fAlpha),
      '--vignette-alpha': String(vigAlpha(vig)),
    }
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const pending = pendingRef.current
      pendingRef.current = null
      if (!pending) return
      for (const [name, value] of Object.entries(pending)) {
        document.documentElement.style.setProperty(name, value)
      }
    })
  }, [mottleUrl, fiberUrl, mAlpha, fAlpha, vig])

  /* 卸载时把内联变量摘掉，让 :root 退回 paper.css 里烘死的那一套。
     不摘的话调过参数再离开这个页面，全站纸纹会一直保持调完的样子。 */
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      /* 取消之后必须把 id 清零。StrictMode 下 React 会「装作」卸载再挂回来，
         ref 是同一个：留着旧 id 的话，重新挂载后上面那个 effect 会以为
         已经排过队了，直接 return，纸纹变量就再也写不出去。 */
      rafRef.current = 0
      for (const name of TUNED_VARS) document.documentElement.style.removeProperty(name)
    },
    [],
  )

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    },
    [],
  )

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok })
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2600)
  }

  function copyCurrent() {
    const text = exportCss(state)
    const done = (ok: boolean) =>
      showToast(ok ? '已复制，可直接粘进 :root' : '复制失败，请手动选中摘要', ok)

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => done(true),
        () => done(legacyCopy(text)),
      )
      return
    }
    done(legacyCopy(text))
  }

  const summary = summaryText(state)

  return (
    <aside
      className={`paper-tuner ${collapsed ? 'paper-tuner--collapsed' : ''} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
    >
      <div className="paper-tuner__hd">
        <span className="paper-tuner__title">纸纹调参</span>
        <button
          type="button"
          className="paper-tbtn paper-tbtn--sm"
          aria-expanded={!collapsed}
          aria-controls="paper-tuner-body"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {/* 收起是 CSS 的 display: none（见 paper.css），节点一直在 */}
      <div className="paper-tuner__bd" id="paper-tuner-body">
        {ROWS.map((row, i) => {
          if (row.type === 'group') {
            return (
              <div className="paper-tuner__group" key={`g${i}`}>
                {row.text}
              </div>
            )
          }
          if (row.type === 'seed') {
            return (
              <div className="paper-tuner__seed" key={row.key}>
                <span>
                  {row.label}：<b className="paper-tuner__val">{state[row.key]}</b>
                </span>
                <button
                  type="button"
                  className="paper-tbtn paper-tbtn--sm"
                  onClick={() =>
                    setState((s) => ({ ...s, [row.key]: Math.floor(Math.random() * 9999) + 1 }))
                  }
                >
                  随机
                </button>
              </div>
            )
          }
          return (
            <div className="paper-tuner__row" key={row.key}>
              {/* 标签和滑条是并排的两行，不能用 <label> 包住滑条（会被拉进同一行 flex），
                  所以标注改挂在 input 的 aria-label 上。 */}
              <div className="paper-tuner__lb">
                <span>{row.label}</span>
                <b className="paper-tuner__val">{fmt(row.dec, state[row.key])}</b>
              </div>
              <input
                type="range"
                aria-label={row.label}
                min={row.min}
                max={row.max}
                step={row.step}
                value={state[row.key]}
                onChange={(e) =>
                  setState((s) => ({ ...s, [row.key]: parseFloat(e.target.value) }))
                }
              />
            </div>
          )
        })}

        <div className="paper-tuner__summary">{summary}</div>

        <div className="paper-tuner__acts">
          <button
            type="button"
            className="paper-tbtn"
            onClick={() => {
              setState(DEFAULTS)
              showToast('已恢复初始参数', true)
            }}
          >
            重置
          </button>
          <button type="button" className="paper-tbtn paper-tbtn--primary" onClick={copyCurrent}>
            复制当前参数
          </button>
        </div>

        <div
          className={`paper-tuner__toast ${
            toast ? (toast.ok ? 'paper-tuner__toast--ok' : 'paper-tuner__toast--fail') : ''
          }`.trim()}
        >
          {toast?.text ?? ''}
        </div>
      </div>
    </aside>
  )
}

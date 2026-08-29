/**
 * /design 设计参考页 —— 纸面元素的样板间。
 *
 * 内容来自原来的 packages/client/paper-demo.html（那个静态页已经删掉）：
 * 一页把纸纹、按钮、图标、卡牌、卡背和结构层小件全摆出来，配上说明文字，
 * 说清每个视觉决定「为什么是这个值」。改这套视觉之前先看这一页。
 *
 * 和 demo 的两点不同：
 * 1. 元件全部换成 src/ui/paper 下的组件和 src/ui/PlaqueButton，不再是一次性 HTML。
 *    这一页因此顺带是组件库的回归测试：组件改坏了这里第一个看出来。
 * 2. 纸底不再写在 body 上（app 的 html/body 归 styles.css 管，是深色底），
 *    改成根节点的 .paper-page + .grain，页面自成一体地嵌在深色外壳里。
 *
 * PaperTuner 会接管 :root 上的纸纹变量，离开本页时它自己摘干净——
 * 所以只该挂在这一页，别搬去对局界面。
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { HandDrawnFilterDefs } from '../ui/HandDrawnFilterDefs'
import { PlaqueButton } from '../ui/PlaqueButton'
import {
  ManaMeter,
  OrnateTitle,
  PaperCard,
  PaperCardBack,
  PaperIcon,
  PaperIconDefs,
  PaperTabs,
  PaperTuner,
  PortraitFrame,
  TurnBadge,
} from '../ui/paper'
import type { PaperIconName, PaperIconRough } from '../ui/paper'
import { CardFaceOverlay } from '../ui/CardFaceOverlay'
import { CARD_ART_PLACEHOLDERS } from '../ui/cardArt'
import './design.css'

const OVERLAY_SAMPLES = [
  { art: CARD_ART_PLACEHOLDERS[0], name: '星火先知', skillName: '洞察先机', cost: 2 },
  { art: CARD_ART_PLACEHOLDERS[1], name: '青瓷学者', skillName: '博览集智', cost: 3 },
  { art: CARD_ART_PLACEHOLDERS[2], name: '灵感织梦师', skillName: '多模态创作', cost: 6 },
  { art: CARD_ART_PLACEHOLDERS[3], name: '边界漫游者', skillName: '突破思维边界', cost: 10 },
]

/** 主题色色板：变量名 + 中文标签，区块六直接照这份渲染。 */
const TONES: { label: string; varName: string }[] = [
  { label: '绿', varName: '--c-green' },
  { label: '赭红', varName: '--c-rust' },
  { label: '蓝', varName: '--c-blue' },
  { label: '紫', varName: '--c-purple' },
  { label: '黄', varName: '--c-gold' },
  { label: '生命红', varName: '--c-life' },
  { label: '星图蓝', varName: '--night' },
  { label: '墨蓝', varName: '--navy' },
]

/**
 * 图标区的一格：同一个图标并排看两种上色，左墨色右主题色。
 *
 * 两只图标故意用不同的 rough 编号——四个滤镜只差 seed，相邻图标共用一个
 * 就会歪成一模一样的形状，反而比不歪更假。
 */
function IconCell({
  accent,
  label,
  name,
  inkRough,
  accentRough,
}: {
  accent: string
  label: string
  name: PaperIconName
  inkRough: PaperIconRough
  accentRough: PaperIconRough
}) {
  return (
    <div className="design-icon-cell" style={{ '--accent': accent } as CSSProperties}>
      <div className="design-icon-pair">
        <span className="design-ink">
          <PaperIcon name={name} rough={inkRough} />
        </span>
        <span className="design-accent">
          <PaperIcon name={name} rough={accentRough} />
        </span>
      </div>
      {label}
    </div>
  )
}

export function DesignScreen() {
  useEffect(() => {
    if (window.location.hash === '#card-overlay') document.getElementById('card-overlay')?.scrollIntoView()
  }, [])
  /* tab 在 demo 里是死的，这里接上状态：组件本来就支持 onChange，
     能点一下才验证得了「切换后下划线跟着走」。 */
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div className="design-page paper-page grain">
      {/* 全页共用的 SVG 定义，各挂一次：少了 <use> 找不到 symbol、
          CSS 里的 url(#…) 找不到滤镜。两者都是 0 尺寸，不占布局。 */}
      <HandDrawnFilterDefs />
      <PaperIconDefs />

      <PaperTuner />

      <main className="paper-page__inner design-main">
        <h1 className="design-title">古典星图 · 铜版画 · 水彩纸</h1>
        <p className="design-sub">纯 CSS / 内联 SVG 元素验证 —— 人物肖像与水彩 logo 另由 AI 生图</p>

        {/* ========== 1. 纸纹理 ========== */}
        <section className="design-section">
          <OrnateTitle>一 · 米色纸纹理</OrnateTitle>

          <div className="design-swatches">
            <div className="design-swatch">① 纯底色 --paper</div>
            <div className="design-swatch grain tex-mottle">② + 大尺度斑驳</div>
            <div className="design-swatch grain">③ + 细颗粒</div>
            <div className="design-swatch grain design-swatch--vignette">④ + 暗角（完整）</div>
          </div>

          <p className="design-note">
            整页背景就是第四块的做法，两层噪声都烘焙成 data URI 背景图，用 multiply 压在底色上。
            <br />② <b>大尺度斑驳</b>：低频柏林噪声 <code>fractalNoise</code>（baseFrequency 0.0059 ≈
            一团 170px、numOctaves 2）当高度场，交给 <code>feDiffuseLighting</code> 打一束斜光
            （surfaceScale 15、方位角 45°、仰角 56°）。光是照在噪声的起伏上，出来的是纸纤维的凹凸浮雕，
            比把噪声直接当灰度铺上去「纸」得多。<code>feComponentTransfer</code> 把打光结果线性压到
            0.89～1.0，并且故意让上四分之一顶到 1.0 被截断：受光面就是底色本身，只有背光的纤维才真的压暗。
            不截断的话整张纸会均匀发灰，看着像皮革；截断后平均只掉 2% 亮度，纸色不跑掉。
            三个通道斜率不同（B 最陡）所以暗部偏暖，像旧纸的黄斑。 这一层整体只叠 70%（
            <code>--mottle-alpha</code>）：浮雕本身够重，全量压上去纸会显得「起皱」。
            <br />③ <b>细颗粒</b>：高频噪声（baseFrequency 0.63 / numOctaves 3）压到 0.87～1.0，
            截断点落在中位数上，颗粒只往下压不往上提，补 1～5px 的纸面粗糙度。
            这个尺度上光影就是噪点本身，不需要再打光。它只是薄薄一层砂面，所以几乎全留（0.92）。
            <br />④ <b>暗角</b>：一层超大范围的 radial-gradient（rgba 浓度 0.189），
            只是让四周比中间稍沉一点。
            <br />
            打光很贵，所以是整块 rect 连 filter 一起烘进 data URI（浏览器只在首次解码时算一次），
            而不是当成实时的 CSS filter。图块 900px 并开 <code>stitchTiles</code>，
            噪声在图块边界首尾相接，平铺时看不出网格。纹理做成可复用的 <code>.grain</code>，
            两层分别铺在 <code>::before</code> 和 <code>::after</code>，各自有独立的{' '}
            <code>opacity</code>；<code>pointer-events: none</code> 不影响点击、
            <code>border-radius: inherit</code> 自动贴合宿主圆角。
            因为宿主的两个伪元素都被纹理占用了，卡牌 / 卡背的内框只能改成真实子元素
            <code>&lt;i class="paper-card__frame"&gt;</code>。
            <br />
            整页外壳是 <code>.paper-page</code>（纸底色 + 暗角）配 <code>.grain</code>，
            demo 里这套写在 <code>body</code> 上，现在搬到一个普通 div：app 的 html / body
            归 styles.css 管，是深色底。纸纹层 <code>position: absolute</code> 铺满这个
            div、跟着内容一起滚；只有暗角还留在视口级别（<code>background-attachment: fixed</code>）——
            暗角是打在纸上的灯光，钉住反而自然。 页面尺度上正文包一层
            <code>.paper-page__inner</code>（带 z-index）把两层纹理都压到内容底下；
            只有卡牌那种小面积宿主才让 <code>::after</code> 的细颗粒浮在文字之上。
            <br />
            右上角的<b>调参面板</b>可以实时改这两层的参数：拖滑条会按当前值重新生成两个 data URI 写回
            <code>:root</code>，全页（背景、卡面、按钮、卡背）一起变；不透明度和暗角浓度是独立 CSS 变量，
            拖它们不重算噪声。选好之后按「复制当前参数」，得到一段可以直接粘进
            <code>paper.css</code> 的完整 CSS。面板卸载时会把写进 <code>:root</code>
            的变量全部摘掉，离开本页后别的界面退回烘死的那一套。
          </p>
        </section>

        {/* ========== 2. 结束回合按钮 ========== */}
        <section className="design-section">
          <OrnateTitle>二 · 结束回合按钮</OrnateTitle>

          <div className="design-btn-row">
            <PlaqueButton>结束回合</PlaqueButton>
            <PlaqueButton disabled>结束回合</PlaqueButton>
            <span className="design-note design-note--inline">← 常态（可 hover / 按下） · 禁用态</span>
          </div>

          <p className="design-note">
            深墨蓝八角匾额。外轮廓由 <code>clip-path</code> 的八边形切出，框内三道旧金属细线、
            四角折线和左右星芒是内联 SVG；整块框线套 <code>#ai-duel-rough-button</code>、
            文字套 <code>#ai-duel-rough-icon</code>，都是页面上公共的手绘滤镜——
            同一个 id 浏览器只算一次噪声，不为按钮单开一份只差 seed 的私有滤镜。
            <br />
            表面纹理是 styles.css 里的 <code>--battle-grain</code> 那张噪声图，配
            <code>background-blend-mode: screen</code> 压在墨蓝底上（demo 里走的是{' '}
            <code>.grain.on-dark</code> 那套两层纸纹；按钮改用更轻的单层图，是因为它的两个伪元素
            要留给内高光和压入时的内阴影）。本页不在 <code>.battle</code> 作用域里，
            <code>--battle-grain</code> 在 design.css 的页面根类上补了一份，见那里的注释。
            <br />
            hover 时底色提亮、内线转赭红、文字转暖白；按下时整块以底边为支点压入 6px 并纵向压扁 4%，
            内阴影同步加深，看着像匾额被按进墙里而不是整体平移。<code>PlaqueButton</code> 用
            <code>data-pressed</code> 兜住最短 70ms 的压入姿态，点得再快也看得见这一下。
            禁用态用灰底 + <code>saturate(.25)</code> 一次性去色。
            <br />
            按钮刻意没有投影：<code>clip-path</code> 的裁剪发生在 <code>filter</code> 之后，
            投影会全部落在八角形之外，一个像素都留不下，只白白换来每次 hover / 按压一整轮离屏滤镜。
          </p>
        </section>

        {/* ========== 3. 手绘图标 ========== */}
        <section className="design-section">
          <OrnateTitle>三 · 手绘质感图标</OrnateTitle>

          <div className="design-icon-grid">
            <IconCell
              accent="var(--c-rust)"
              label="剑 · 攻击"
              name="sword"
              inkRough={1}
              accentRough={2}
            />
            <IconCell
              accent="var(--c-blue)"
              label="盾 · 防御"
              name="shield"
              inkRough={2}
              accentRough={3}
            />
            <IconCell
              accent="var(--c-life)"
              label="心 · 生命"
              name="heart"
              inkRough={3}
              accentRough={4}
            />
            <IconCell
              accent="var(--c-purple)"
              label="法力珠"
              name="mana"
              inkRough={4}
              accentRough={1}
            />
          </div>

          <div
            className="design-filter-compare"
            style={{ '--accent': 'var(--c-green)' } as CSSProperties}
          >
            <div className="design-icon-cell">
              <span className="design-ink">
                <PaperIcon name="shield" rough="none" className="design-ico--big" />
              </span>
              无 filter（几何感）
            </div>
            <div className="design-icon-cell">
              <span className="design-ink">
                <PaperIcon name="shield" rough={2} className="design-ico--big" />
              </span>
              有 filter（手绘感）
            </div>
            <div className="design-icon-cell">
              <span className="design-accent">
                <PaperIcon name="mana" rough="none" className="design-ico--big" />
              </span>
              无 filter
            </div>
            <div className="design-icon-cell">
              <span className="design-accent">
                <PaperIcon name="mana" rough={4} className="design-ico--big" />
              </span>
              有 filter
            </div>
          </div>

          <p className="design-note">
            图标全部写成 <code>&lt;symbol&gt;</code> 放页顶（<code>PaperIconDefs</code>），用{' '}
            <code>&lt;use&gt;</code> 复用；描边写 <code>currentColor</code>，所以外层容器改{' '}
            <code>color</code> 就换色（这里由 <code>--accent</code> 驱动）。 手绘感来自两层：一是
            feTurbulence + feDisplacementMap（scale 3～3.6）让边缘轻微歪扭， 二是每个图标都叠了第二条略偏移、
            更细更淡的描边模拟重描，fill 用 currentColor 加 12%～28% 透明度做水彩没涂满的效果。 scale
            再大就从「手绘」变成「融化」，3～4 是这个尺寸下的安全区。
            <br />
            四个滤镜只差 seed，<code>PaperIcon</code> 的 <code>rough</code> 属性 1～4 就是挑哪个 seed；
            同屏相邻的图标要错开，都用同一个的话一排图标会歪成一模一样的形状，反而更假。
            <code>rough="none"</code> 完全不套滤镜，就是上面对比图左边那种几何感。
            <br />
            噪声只叠两个八度，demo 里写的是三个：第三个八度的振幅只有第一个的四分之一，
            配上 scale≈3 的位移落到画面上不到 ±0.4px，和「手绘的抖」分不出来，
            而 WebKit 是在 CPU 上逐像素算这条噪声的，少一个八度省掉大约三分之一的计算量。
          </p>
        </section>

        {/* ========== 4. 卡牌 ========== */}
        <section className="design-section">
          <OrnateTitle>四 · 卡牌框架</OrnateTitle>

          <div className="design-card-row">
            <PaperCard name="苔原守望" cost={2} atk={2} def={5} accent="green" icon="shield" />
            <PaperCard name="赤铜之刃" cost={4} atk={6} def={3} accent="rust" icon="sword" selected />
            <PaperCard name="子夜观星" cost={3} atk={3} def={4} accent="blue" icon="mana" />
            <PaperCard name="紫垣秘祝" cost={6} atk={5} def={7} accent="purple" icon="heart" />
          </div>

          <p className="design-note">
            150×225 纸白卡：外框 + <code>.paper-card__frame</code> 内框构成双线，
            四角是旋转 45° 的小方块当菱形花饰。 费用是细线圆底座（圆环内还有一道主题色细圆）。
            中央放射线是 16 根内联 SVG 细线，染 <code>currentColor</code> 走主题色、套{' '}
            <code>#ai-duel-rough-rays</code> 歪扭，中间那个图标是水彩 logo 的占位。
            名称上方的分隔线中间嵌一颗主题色小菱形。底部攻防栏用剑/盾图标 + 一道竖细线分隔。
            整张卡叠 <code>.grain</code>；内框走真实子元素而不是 <code>::before</code>，
            就是因为伪元素让给纸纹了。
            <br />
            第二张是选中态：赭红加粗描边、上移 14px、柔和投影； 加粗时同步把 padding 减
            1px，避免内部元素跟着位移。
            <br />
            全卡换色只需要传 <code>accent</code>，组件把它翻成容器上的 <code>--accent</code>，
            四角菱形、费用内圈、放射线和分隔线菱形一起跟着走。 卡内三处图标（logo / 攻 / 防）在组件里固定用
            rough 1 / 2 / 3，同屏不会歪成同一条线。
          </p>
        </section>

        {/* ========== 插画卡共用图层 ========== */}
        <section className="design-section" id="card-overlay">
          <OrnateTitle>插画卡 · 通用信息图层</OrnateTitle>
          <div className="design-card-row">
            {OVERLAY_SAMPLES.map((sample) => (
              <div className="design-overlay-card" key={sample.art}>
                <img className="card-face__art" src={sample.art} alt="" />
                <CardFaceOverlay {...sample} />
              </div>
            ))}
          </div>
          <p className="design-note">
            原始插画不烘焙文字。<code>CardFaceOverlay</code> 独立绘制左上费用圆章和底部双线铭牌，
            上排是 4～6 字技能简称，下排是卡名；<code>cost / skillName / name / accent</code> 都可单独传入。
            费用章保持正圆，铭牌按卡宽缩放，手牌和原图同为 2:3，使用同一套布局。
            配色沿用本页色板，纸面复用 <code>.grain</code>，文字不套滤镜以保留小尺寸可读性。
            此处展示的是 AI 牌图层，其 Token 数值暂不参与规则；已实现技能牌的费用已经接入对局。
            <a href="/card">打开卡牌图鉴</a>
          </p>
        </section>

        {/* ========== 5. 卡背 / 空槽 ========== */}
        <section className="design-section">
          <OrnateTitle>五 · 卡背 / 空卡槽</OrnateTitle>

          <div className="design-card-row">
            <PaperCardBack />
            <PaperCardBack slot />
            <span className="design-note design-note--inline">
              ← 实体卡背（墨蓝、纹样明显） · 空槽（同结构，虚线框 + 整体压淡）
            </span>
          </div>

          <p className="design-note">
            卡背和空槽是同一套 DOM 结构，只靠一个 <code>slot</code> 属性切换：
            背景换成近乎透明的墨蓝、边框改虚线、罗盘不透明度从 0.62 降到 0.28。 罗盘纹样是内联 SVG
            的同心圆 + 十字刻度 + 斜向短刻度 + 中央四角星， 全部 <code>currentColor</code>（米色），套{' '}
            <code>#ai-duel-rough-compass</code>（scale 2.0，比图标小，因为线更长、更细，位移放大后容易断）。
            <br />
            实体卡背叠 <code>.grain.on-dark</code>：同样两张纹理图先 <code>invert</code> 再{' '}
            <code>screen</code>，压暗的纤维翻成微微发亮的丝缕，墨蓝底上才不会出现一块块黑斑。
            空槽不叠纹理——它本来就该淡到几乎不存在，再加纹理只会变脏。
          </p>
        </section>

        {/* ========== 6. 其余结构层小件 ========== */}
        <section className="design-section">
          <OrnateTitle>六 · 结构层小件</OrnateTitle>

          <div className="design-bits">
            <div>
              <div className="design-bit-label">法力计</div>
              <ManaMeter current={9} max={12} />
            </div>

            <div>
              <div className="design-bit-label">顶栏 tab</div>
              <PaperTabs
                items={['对战', '牌组', '图鉴']}
                active={activeTab}
                onChange={setActiveTab}
              />
            </div>

            <div>
              <div className="design-bit-label">小标题装饰（卡牌详情）</div>
              <OrnateTitle small as="h3" className="design-orn-title-sample">
                卡牌详情
              </OrnateTitle>
            </div>
          </div>

          <div className="design-bits design-bits--row2">
            <div>
              <div className="design-bit-label">回合徽章（战场中线）</div>
              <TurnBadge turn={6} />
            </div>

            <div>
              <div className="design-bit-label">拱窗头像框</div>
              <PortraitFrame name="李飞飞" hp={23} mp={6} />
            </div>

            <div>
              <div className="design-bit-label">主题色（低饱和水彩）</div>
              <div className="design-tone-row">
                {TONES.map((tone) => (
                  <span
                    key={tone.varName}
                    className="design-tone"
                    style={{ background: `var(${tone.varName})` }}
                  >
                    {tone.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="design-note">
            法力计：Garamond 数字 + 一排点，点的总数就是上限，点亮几个就是当前值
            （实心 / 描线只差一个修饰类）。 回合徽章：flex 两侧 <code>::before</code> /{' '}
            <code>::after</code> 拉出横线，中间夹一个深蓝小匾，数字用赭红强调；
            线是撑开的，回合数涨到两位也不会把小匾推歪。
            <br />
            拱窗头像框：上两角 70px 圆角做成拱形，双线框跟着圆角内缩；
            内部先铺星图蓝 + 几颗星点和连线占位（正式项目里换成人物肖像），
            名牌横幅用负 margin 压在框底，本身也是纸白双线小匾。
            <br />
            顶栏 tab：当前项下方一条赭红短横线，横线的 <code>::before</code> /{' '}
            <code>::after</code> 旋转 45° 做两个端点上的小菱形。 每一项是 <code>&lt;button&gt;</code>{' '}
            而不是 <code>&lt;span&gt;</code>，键盘能 Tab 过去、回车能选中——上面这组是活的，点点看。
            <br />
            小标题装饰复用了本页每个区块的标题样式（<code>OrnateTitle</code> 的 <code>small</code>），
            正式项目里直接当「卡牌详情」标题用。
          </p>
        </section>
      </main>
    </div>
  )
}

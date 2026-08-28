# 插画卡通用正面图层

## 组成

`HandCardFace` 保留原始插画，叠加独立的 `CardFaceOverlay`：左上费用圆章，底部纸面双线铭牌，技能简称在上、卡名在下。费用直接读取卡牌数据，不使用元宝概念稿中的占位数值。

图层的输入为 `cost`、`skillName`、`name` 和 `accent`。它只负责外观，不定义技能或改变游戏规则。

```tsx
<div style={{ position: 'relative', width: 300, aspectRatio: '2 / 3' }}>
  <img src="/cards/example.webp" alt="" style={{ width: '100%', height: '100%' }} />
  <CardFaceOverlay cost={3} skillName="博览集智" name="腾讯元宝" accent="var(--c-green)" />
</div>
```

以上费用与名称仅为组件用法示例，不代表正式卡池。

## 配色与文字

- 复用 `/design` 的 `--paper`、`--paper-shade`、`--ink`、`--line-dark`、`--c-*` 和 `.grain` 纸纹；费用章使用插画主色的深色版本，金属描边使用金色与原有线色混合。
- `cardPresentation.ts` 统一分配展示数据，18 张具名 AI 的原画、配色和四字主题在 `aiModelArt.ts` 维护。简称不新增登场效果。
- 插画按卡牌定义 ID 分配。在对局转换成实例 ID 之前固定 `art`，因此同张牌的图鉴、手牌与场上实例不会换图。
- `HandCardData.art`、`accent` 可由调用方覆盖；增加新插画时补充对应配色即可，不需要重新生成文字图片。
- 铭牌使用 SVG `viewBox` 缩放，文字用 [`textLength` / `lengthAdjust`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/textLength) 控制最大宽度。长名称不会被截断，但极长名称会压缩，应优先提供适合卡面的短名称。
- 圆章独立保持 1:1；铭牌按卡宽缩放。5:7 游戏卡使用现有的 `object-fit: cover`，会轻微裁掉 2:3 插画上下边缘；选原图比例可查看完整构图。
- 图层不接受指针事件，不修改扇形、拖拽、倾斜、翻面或飞行动画。纸纹只作用于小面积铭牌与费用章，不给字形添加噪声滤镜。

## 展示与检查

- `/card`：全卡池缩略图已应用新图层。右侧可开关图层、战斗信息，并切换 150×210、300×420、300×450 三种预览尺寸。
- `/deck`：查看默认 22 张牌组及每种卡的数量，18 张具名 AI 均已加入。接入清单与数值边界见 [AI 原画牌组](./ai-model-deck.md)。
- `/design#card-overlay`：四种配色及 4～6 字简称、两位数费用的组件示例。
- 对局：`showCombatStats` 默认开启，铭牌上方保留当前算力、完整度、弱点或提示伤害；首页橱窗与图鉴默认展示纯卡面。
- 完整描述并入 `cardBackText`，图鉴的背面长文可滚动查看；对局沿用原有指针事件限制，隐藏牌背仍不显示牌名或效果。

自动化覆盖位于 `packages/client/test/cardFace.test.tsx`，检查全卡池简称、实例数值、插画稳定性、纯卡面开关、长名称、转义和背面文案。

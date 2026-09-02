#!/usr/bin/env bash
#
# 从卡面原画烤出两档缩小版。
#
# 为什么需要：原画一律 1024×1536，而界面上没有任何一处把卡画到那么大。
# 让浏览器拿 1024 宽的图去画一张 150 宽的卡，等于每张卡都要解码整张 157 万像素的大图
# 再做一次高倍降采样；一屏几十张时解码耗时和内存都很可观，滚动、拖拽、出牌动画会掉帧。
# 手机上更要命：内存吃紧时 Safari 会把解码结果丢掉，下次绘制现解一张，正好卡在动画帧里。
#
# 两档产物，各有各的用处：
#   thumbs/ 300 宽 —— 牌库页的卡池格子、小卡这类**列表**场景。一屏铺几十张，越小越好。
#   mid/    600 宽 —— 卡面组件（ui/HandFan.tsx 的 HandCardFace）真正显示的那一档。
#                     全站的卡面都是同一个组件画的，所以这一档同时服务手牌、战场小卡、
#                     强制展示、回合结算和牌库的放大查看。
#
# 600 是照**全站最大的那一处**定的：桌面上手牌 hover 放大到顶时，卡面按 262 CSS 像素排版
#（150 × .hand-fan__tilt 的 zoom 1.75），2 倍 DPR 下要 524 个设备像素。
# 其余场景都更小：桌面放大查看 150×1.7×2 = 510，手机放大查看 150×2.2×0.38×3 ≈ 376，
# 手机手牌静置约 170。所以 600 一档就把所有卡面场景盖住了，原画在界面上已经没有使用场景
#（见 src/ui/cardArtThumb.ts 和 src/ui/backgroundPreload.ts 的说明）。
#
# 两档的取图范围不一样，别写反：
#   - thumbs 跳过名字里带 card-back 的背面图。背面没有列表场景，烤了也没人引用。
#   - mid 一张不落，**背面也要烤**：对局里手牌背面、对手那排牌背都只有 150×225，
#     和正面一样吃不消 1024 宽的原图。
#
# 什么时候要重跑：
#   - public/cards/ 下新增、替换或删除了原画（新 AI 卡、新技能卡、换插画、加占位图）；
#   - 改了下面任何一档的宽高或 QUALITY（比如卡面排版变大，600 宽不够清晰了）。
# 子目录有多少烤多少，新开一层目录（models/、skills/…）不用改脚本。
# 脚本是幂等的，每次全量重烤覆盖，不做增量判断——几十张图总共几秒，不值得为此引入时间戳比对。
#
# 用法（在仓库任意目录下都能跑）：
#   packages/client/scripts/gen-card-thumbs.sh
#
# 依赖 ffmpeg（需带 libwebp 编码器）。本机装在 /opt/homebrew/bin/ffmpeg，
# 不在 PATH 里时脚本会退回这个绝对路径。

set -euo pipefail

# 尺寸写死而不是按比例算：所有原画都是同一规格（1024×1536，2:3），
# 写死能顺带在下面校验源图比例是否跑偏。
QUALITY=80

# 脚本位置推算出 packages/client，这样从哪个目录调用都一样。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
CARDS_DIR="$CLIENT_DIR/public/cards"

FFMPEG="$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)"
if [ ! -x "$FFMPEG" ]; then
  echo "找不到 ffmpeg，请先安装（brew install ffmpeg）" >&2
  exit 1
fi

# 烤一档。
#   $1 目录名（也是路径前缀，要和 src/ui/cardArtThumb.ts 里的常量对上）
#   $2 宽  $3 高
#   $4 取图范围：all = 连背面一起烤，no-backs = 跳过名字里带 card-back 的
bake() {
  local name="$1" width="$2" height="$3" scope="$4"
  local out_dir="$CARDS_DIR/$name"

  # 整个目录先删再建：原画删掉后，对应的旧产物必须跟着消失，
  # 否则会留下永远没人引用、还要跟着部署的僵尸文件。
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  local total_bytes=0 count=0 src rel dst bytes

  # 产物路径镜像原图路径：cards/models/x.webp -> cards/<name>/models/x.webp。
  # 保持同构是为了让 src/ui/cardArtThumb.ts 能纯靠字符串拼接推出路径，不用维护映射表。
  while IFS= read -r src; do
    rel="${src#"$CARDS_DIR"/}"
    dst="$out_dir/$rel"
    # 逐张按需建目录，而不是在循环外把已知的几个子目录写死：
    # 原画目录会随着卡种增加（models/、skills/…），写死的话新目录下第一张就会因为
    # 目标目录不存在而让 ffmpeg 报错，加卡的人未必想得到要回来改脚本。
    mkdir -p "$(dirname "$dst")"

    # -nostdin 不能省：循环体的标准输入就是下面那条 find 的输出，
    # 而 ffmpeg 默认会去读标准输入找交互按键，一读就把还没轮到的文件名吃掉，
    # 表现为随机某张图报「路径少了开头一个字符」。
    "$FFMPEG" -nostdin -v error -y -i "$src" \
      -vf "scale=$width:$height:flags=lanczos" \
      -c:v libwebp -quality "$QUALITY" -compression_level 6 \
      "$dst"

    bytes=$(/usr/bin/stat -f%z "$dst")
    total_bytes=$((total_bytes + bytes))
    count=$((count + 1))
  # 已经烤好的那几档自己也在 CARDS_DIR 下，必须排除，否则会把产物再缩一遍
  # （尤其两档之间：mid 先烤好，轮到 thumbs 时就会把它当源图）。
  # 这里靠 -prune 剪掉整棵子树；上面的 rm -rf 只删得掉本档自己，管不到别档。
  done < <(
    if [ "$scope" = "no-backs" ]; then
      find "$CARDS_DIR" -type d -name "$THUMB_DIR_NAME" -prune -o \
        -type d -name "$MID_DIR_NAME" -prune -o \
        -name '*.webp' ! -name '*card-back*' -type f -print | sort
    else
      find "$CARDS_DIR" -type d -name "$THUMB_DIR_NAME" -prune -o \
        -type d -name "$MID_DIR_NAME" -prune -o \
        -name '*.webp' -type f -print | sort
    fi
  )

  printf '%-8s %3d 张，%4dx%-4d 合计 %7.1f KB\n' \
    "$name/" "$count" "$width" "$height" "$(echo "scale=2; $total_bytes / 1024" | bc)"
}

# 目录名单独抽出来，是因为上面那两条 find 要用它们把已经烤好的档剪掉。
THUMB_DIR_NAME=thumbs
MID_DIR_NAME=mid

bake "$MID_DIR_NAME" 600 900 all
bake "$THUMB_DIR_NAME" 300 450 no-backs

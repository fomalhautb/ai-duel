#!/usr/bin/env bash
#
# 生成卡面原画的缩略图。
#
# 为什么需要：原画是 1024×1536，但牌库页的卡池格子和小卡只有 150×225 左右。
# 让浏览器把 1024 宽的图缩到 150 宽显示，等于每张卡都要解码整张大图再做一次高倍降采样；
# 一屏铺 20~30 张时解码耗时和显存都很可观，滚动和拖拽会掉帧。
# 所以预先离线烤一份 300 宽（2 倍 DPR 下正好够用）的小图，列表场景直接加载它。
#
# 什么时候要重跑：
#   - public/cards/ 下新增、替换或删除了原画（新 AI 卡、换插画、加占位图）；
#   - 改了下面的 THUMB_W / THUMB_H / QUALITY（比如列表卡尺寸变大，300 宽不够清晰了）。
# 脚本是幂等的，每次全量重烤覆盖，不做增量判断——22 张图总共几秒，不值得为此引入时间戳比对。
#
# 用法（在仓库任意目录下都能跑）：
#   packages/client/scripts/gen-card-thumbs.sh
#
# 依赖 ffmpeg（需带 libwebp 编码器）。本机装在 /opt/homebrew/bin/ffmpeg，
# 不在 PATH 里时脚本会退回这个绝对路径。

set -euo pipefail

# 缩略图尺寸。原画一律 1024×1536（2:3），这里保持同样比例，
# 尺寸写死而不是按比例算：所有原画都是同一规格，写死能顺带在下面校验源图比例是否跑偏。
THUMB_W=300
THUMB_H=450
QUALITY=80

# 脚本位置推算出 packages/client，这样从哪个目录调用都一样。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
CARDS_DIR="$CLIENT_DIR/public/cards"
THUMBS_DIR="$CARDS_DIR/thumbs"

FFMPEG="$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)"
if [ ! -x "$FFMPEG" ]; then
  echo "找不到 ffmpeg，请先安装（brew install ffmpeg）" >&2
  exit 1
fi

# 整个 thumbs/ 目录先删再建：原画删掉后，对应的旧缩略图必须跟着消失，
# 否则会留下永远没人引用、还要跟着部署的僵尸文件。
rm -rf "$THUMBS_DIR"
mkdir -p "$THUMBS_DIR/models"

total_bytes=0
count=0

# 缩略图路径镜像原图路径：cards/models/x.webp -> cards/thumbs/models/x.webp。
# 保持同构是为了让 src/ui/cardArtThumb.ts 能纯靠字符串拼接推出路径，不用维护映射表。
while IFS= read -r src; do
  rel="${src#"$CARDS_DIR"/}"
  dst="$THUMBS_DIR/$rel"

  # -nostdin 不能省：循环体的标准输入就是下面那条 find 的输出，
  # 而 ffmpeg 默认会去读标准输入找交互按键，一读就把还没轮到的文件名吃掉，
  # 表现为随机某张图报「路径少了开头一个字符」。
  "$FFMPEG" -nostdin -v error -y -i "$src" \
    -vf "scale=$THUMB_W:$THUMB_H:flags=lanczos" \
    -c:v libwebp -quality "$QUALITY" -compression_level 6 \
    "$dst"

  bytes=$(/usr/bin/stat -f%z "$dst")
  total_bytes=$((total_bytes + bytes))
  count=$((count + 1))
  printf '%-40s %6.1f KB\n' "thumbs/$rel" "$(echo "scale=2; $bytes / 1024" | bc)"
# thumbs/ 自己也在 CARDS_DIR 下，重跑时必须排除，否则会把缩略图再缩一遍。
# 这里靠 -prune 剪掉整棵子树；上面的 rm -rf 已经删过一次，双保险。
done < <(find "$CARDS_DIR" -path "$THUMBS_DIR" -prune -o -name '*.webp' -type f -print | sort)

printf '\n共 %d 张，合计 %.1f KB\n' "$count" "$(echo "scale=2; $total_bytes / 1024" | bc)"

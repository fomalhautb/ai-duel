#!/usr/bin/env bash
#
# 压缩 public/ 下的所有图片。
#
# 为什么需要：整站的图加起来 29 MB，其中卡面原画（1024×1536）单张就有 400~650 KB。
# 这些图是直接从出图工具导出的，压缩率给得很松——同样的画面按 webp q80 重编一遍能省掉一半，
# 100% 放大对比看不出差别（画风是铅笔排线，本来就没有大片平滑渐变会暴露块效应）。
# 而所有图都要在加载界面里等完（见 src/ui/backgroundPreload.ts），省下来的每一 MB
# 都直接变成玩家少等的时间。第一次跑下来是 29 MB → 17.2 MB。
#
# 音乐不归这个脚本管，见同目录的 optimize-music.sh。
#
# 两件事：
#   1. 把 png / jpg 一律转成 webp 并删掉原文件。public/ 下只留 webp（favicon.svg 除外），
#      免得同一张图有两种格式、代码引哪个全凭记忆。**转完要自己去改代码里的引用**，
#      脚本不碰源码。
#   2. 把已有的 webp 按下面的参数重编一遍。
#
# 可以反复跑：只有"新结果比现有文件小 MIN_GAIN_PCT% 以上"才会覆盖。
# 第二次跑时现有文件已经是 q80 的产物，重编省不出这么多，于是原样保留，
# 不会每跑一次就叠一层有损压缩。加了新原画之后直接重跑即可。
#
# 用法（在仓库任意目录下都能跑）：
#   packages/client/scripts/optimize-images.sh
#
# 依赖 cwebp（brew install webp）和 ffprobe（brew install ffmpeg，只用来读原图的透明通道）。

set -euo pipefail

# 有损压缩的质量。80 是试出来的：卡面原画从 640 KB 降到 320 KB，
# 把两版裁同一块贴在一起 100% 对比，排线和金线的细节都还在。
# 再往下（75 以下）大色块边缘开始出现轻微的带状，放大查看那种整屏大卡上能看出来。
QUALITY=80

# 省不到这个百分比就保留原文件。
# 这道判断同时管两件事：避免为几 KB 的收益白搭一次有损重编，
# 以及让脚本可以反复跑而不会一次次叠加压缩损失。
MIN_GAIN_PCT=10

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$CLIENT_DIR/public"
# 缩略图是 gen-card-thumbs.sh 的产物，源图换了要整批重烤，不是在这儿逐张重压。
THUMBS_DIR="$PUBLIC_DIR/cards/thumbs"

CWEBP="$(command -v cwebp || echo /opt/homebrew/bin/cwebp)"
if [ ! -x "$CWEBP" ]; then
  echo "找不到 cwebp，请先安装（brew install webp）" >&2
  exit 1
fi
FFPROBE="$(command -v ffprobe || echo /opt/homebrew/bin/ffprobe)"
if [ ! -x "$FFPROBE" ]; then
  echo "找不到 ffprobe，请先安装（brew install ffmpeg）" >&2
  exit 1
fi

before_total=0
after_total=0

# 把一张图编码成 webp 写到 $2。
#
# -sharp_yuv：webp 的有损模式内部是 4:2:0，色度要减半采样。默认那种快速平均法会让
# 深蓝底上的金色描边发灰发糊，而卡面上到处是这种细金线。这个选项改用更准的算法，
# 编码慢一点，画面明显干净。
# -alpha_q 100：透明通道走无损。房间页那些雕花挂件是抠出来的，边缘一旦被有损压过就会长毛边。
# -metadata none：丢掉出图工具塞进来的 EXIF / ICC，单张能省几 KB，而且我们全站按 sRGB 显示。
encode() {
  "$CWEBP" -quiet -q "$QUALITY" -m 6 -sharp_yuv -alpha_q 100 -metadata none "$1" -o "$2"
}

# 无损重编（只换更狠的压缩搜索，画面一个像素都不变）。
# 给本来就是无损的图用：它们是纯色块的界面切图，转成有损反而更大也更糊。
encode_lossless() {
  "$CWEBP" -quiet -lossless -z 9 -m 6 -metadata none "$1" -o "$2"
}

# 决定一张图用哪种编码：源图是无损 webp 的继续无损，其余（有损 webp、png、jpg）走有损。
#
# 判据是"源文件本身是不是无损"而不是"有没有透明通道"：透明通道跟画面内容无关，
# 卡背那种整张插画就算带透明边也该有损压；真正不能有损的是那些线条界面切图，
# 而它们当初就是按无损导出的。png 一律按有损处理——public 下的 png 都是整张插画。
encode_auto() {
  local src="$1" dst="$2"
  if [ "${src##*.}" = "webp" ] && is_lossless "$src"; then
    encode_lossless "$src" "$dst"
  else
    encode "$src" "$dst"
  fi
}

is_lossless() {
  # ffprobe 把无损 webp 报成 bgra / rgb24 之类，有损的一律是 yuv420p。
  # 用它而不是 webpinfo，是因为 webpinfo 不一定跟 cwebp 一起装。
  [ "$("$FFPROBE" -v error -show_entries stream=pix_fmt -of csv=p=0 "$1" 2>/dev/null)" != "yuv420p" ]
}

# 报告一张图的处理结果，并把体积计入总账。
report() {
  local label="$1" before="$2" after="$3"
  before_total=$((before_total + before))
  after_total=$((after_total + after))
  printf '%-52s %7.1f KB -> %7.1f KB  (%s)\n' \
    "$label" \
    "$(echo "scale=2; $before / 1024" | bc)" \
    "$(echo "scale=2; $after / 1024" | bc)" \
    "$4"
}

tmp="$(mktemp -t optimize-images)"
trap 'rm -f "$tmp"' EXIT

while IFS= read -r src; do
  rel="${src#"$PUBLIC_DIR"/}"
  before=$(/usr/bin/stat -f%z "$src")

  encode_auto "$src" "$tmp"
  after=$(/usr/bin/stat -f%z "$tmp")

  # 非 webp 一律换掉，哪怕体积没变小：目标是 public 下只剩一种格式。
  # 真出现"转完更大"的情况（很小的 png 有可能），也就多几 KB，换来的是不用再记哪张图是什么格式。
  if [ "${src##*.}" != "webp" ]; then
    mv "$tmp" "${src%.*}.webp"
    rm -f "$src"
    report "$rel -> ${rel%.*}.webp" "$before" "$after" "转 webp"
    continue
  fi

  # 用整数百分比比较，省得为一次判断引入浮点。
  if [ $((after * 100)) -le $((before * (100 - MIN_GAIN_PCT))) ]; then
    mv "$tmp" "$src"
    report "$rel" "$before" "$after" "重压"
  else
    report "$rel" "$before" "$before" "已够小，跳过"
  fi
done < <(
  find "$PUBLIC_DIR" -path "$THUMBS_DIR" -prune -o \
    \( -name '*.webp' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) -type f -print | sort
)

printf '\n合计 %.1f MB -> %.1f MB\n' \
  "$(echo "scale=2; $before_total / 1048576" | bc)" \
  "$(echo "scale=2; $after_total / 1048576" | bc)"

# 原画换了，缩略图必须跟着重烤，否则列表里还是老图（而且和放大后的原画对不上）。
echo
echo "重烤缩略图…"
"$SCRIPT_DIR/gen-card-thumbs.sh" >/dev/null
echo "缩略图已更新（$(du -sh "$THUMBS_DIR" | cut -f1)）"

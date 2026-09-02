#!/usr/bin/env bash
#
# 压缩 public/music/ 下的背景音乐：mp3 → AAC（.m4a），删掉原文件。
#
# 为什么需要：四首循环 BGM 原本是 190 kbps 的 mp3，加起来 8.8 MB，比全站图片压完之后还大。
# 它们不是点了才下的：ui/backgroundMusic.ts 给 audio 元素设了 preload='auto'，
# 进哪一页就整首往下拉，正好和那一页的图抢带宽。
#
# 为什么是 AAC 而不是别的：
# - 同码率下 AAC 明显比 mp3 好，96 kbps 用来垫背景已经绰绰有余（何况音量只开到 0.9）；
# - .m4a 里的 AAC 是所有目标浏览器都认的，不用为 Safari 另备一份。
#   Opus 同码率还要更好，但 Safari 对它的支持要看版本，多一份回落文件不值这点收益。
#
# 音源本身已经是有损的 mp3，这里是二次压缩，所以码率不敢再往下压。
# 将来拿到无损母带的话，直接从母带编到 96 kbps 会比这一版干净。
#
# 转完要自己去改 ui/backgroundMusic.ts 里的地址，脚本不碰源码。
# 可以反复跑：mp3 转完就删了，第二次跑没有文件可转，直接空跑。
#
# 用法（在仓库任意目录下都能跑）：
#   packages/client/scripts/optimize-music.sh
#
# 依赖 ffmpeg（brew install ffmpeg）。

set -euo pipefail

# 立体声总码率。背景音乐一直压在音效和人声念白之下，96k 的 AAC 听不出和原文件的差别。
BITRATE=96k

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
MUSIC_DIR="$CLIENT_DIR/public/music"

FFMPEG="$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)"
if [ ! -x "$FFMPEG" ]; then
  echo "找不到 ffmpeg，请先安装（brew install ffmpeg）" >&2
  exit 1
fi

before_total=0
after_total=0

shopt -s nullglob
for src in "$MUSIC_DIR"/*.mp3; do
  dst="${src%.mp3}.m4a"
  before=$(/usr/bin/stat -f%z "$src")

  # -nostdin 理由同 gen-card-thumbs.sh：循环体的标准输入不是给 ffmpeg 读的。
  # -vn 丢掉内嵌封面图：mp3 把封面存成一路视频流，m4a 的容器不收，不丢的话 ffmpeg 直接报错退出。
  # 封面本身也用不上——页面里没有任何地方显示曲目信息。
  # -movflags +faststart 把索引挪到文件开头，边下边播时不用等整首下完才出声。
  "$FFMPEG" -nostdin -v error -y -i "$src" -vn \
    -c:a aac -b:a "$BITRATE" -movflags +faststart "$dst"

  after=$(/usr/bin/stat -f%z "$dst")
  rm -f "$src"
  before_total=$((before_total + before))
  after_total=$((after_total + after))
  printf '%-28s %7.1f KB -> %7.1f KB\n' \
    "$(basename "$dst")" \
    "$(echo "scale=2; $before / 1024" | bc)" \
    "$(echo "scale=2; $after / 1024" | bc)"
done

if [ "$before_total" -eq 0 ]; then
  echo "public/music/ 下没有 mp3，无事可做。"
  exit 0
fi

printf '\n合计 %.1f MB -> %.1f MB\n' \
  "$(echo "scale=2; $before_total / 1048576" | bc)" \
  "$(echo "scale=2; $after_total / 1048576" | bc)"

#!/usr/bin/env python3
"""
把 /room 匹配房的整张 UI 素材图切成一张张独立的元素图，输出到
packages/client/public/room/，供 RoomScreen.tsx / room.css 直接当 <img> 用。

素材图 assets/room-ui-sheet.png 是 3344x1882（去掉了背景和文字），正好是页面
1672x941 舞台的 2 倍，且每个元素都画在它在页面上应处的位置。所以切片的包围盒
除以 2 就是它在舞台上的落位，再折算成 CSS 单位：
    left / width  = 原图 x / 2 / 16.72   (cqi，1cqi = 舞台宽的 1%)
    top  / height = 原图 y / 2 / 9.41    (%，相对舞台高)
脚本最后打印的 manifest 就是这些数字，room.css 里直接抄。

跑法（在仓库根目录）：
    python3 assets/slice-room-ui.py
换了素材图之后重跑一遍即可；若元素挪了位置，改下面 REGIONS 里的粗略区域再跑。

依赖：Pillow、cwebp（brew install webp）。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "assets" / "room-ui-sheet.png"
OUT_DIR = ROOT / "packages" / "client" / "public" / "room"

# 素材图相对舞台的倍率，以及舞台尺寸。折算落位全靠这三个数。
SCALE = 2
STAGE_W = 1672
STAGE_H = 941

# 收紧包围盒时认为「有内容」的 alpha 阈值。羽化边的 alpha 很低，
# 阈值太高会把柔边当空白切掉，太低又会被 PNG 里几乎不可见的噪点撑开。
ALPHA_FLOOR = 8
# 收紧后向外补回来的余量，防止把羽化的最外圈切没。
PAD = 4

# 面板切片要挖空的内芯（原图像素，x0, y0, x1, y1）。
#
# 面板那块粗略区域必然把里面的房间码匾、复制框、分隔线、输入框、加入按钮一起框进来，
# 但这些元素各自还要单独切一份出来做成可交互的元素叠在面板上，留在面板底图里就会重影
# （一 hover 或按下，底下那份不动的影子就露出来了）。所以先把这块内芯的 alpha 抹掉，
# 面板底图只剩双线框本身。
#
# 这个矩形是量出来的：往外它包住全部子元素（子元素占 x 437~2933、y 534~1176），
# 往内它不碰面板边框的任何一根线（边框在这段 y 里最内只到 x=365 / x=2977，
# 在这段 x 里最内只到 y=504 / y=1199，四条边留了 20px 以上的余量）。
PANEL_HOLLOW = (390, 512, 2961, 1186)

# 每个切片的粗略区域（原图像素，x0, y0, x1, y1）和压缩方式。
# lossless=True 给线稿类（透明内芯、细金线）：有损会把发丝线压出彩边；
# lossless=False 给纸质实心块（匾额、按钮、横幅）：面积大，无损体积翻好几倍。
#
# 每条边都要给 tighten 留出余量：粗略边界压在元素身上时，tighten 的夹紧会把元素本身
# 削掉一截（见 tighten 的说明）。所以边界一律放在元素之间的空白里，宽出来的部分
# tighten 会自己收回去。放宽的上限是「不要碰到邻居的像素」——中间那几件挨得近，
# 下面注掉的读数就是量出来的安全范围。
REGIONS: list[tuple[str, tuple[int, int, int, int], bool]] = [
    ("back-arrow", (100, 92, 217, 201), True),
    ("book", (2809, 92, 2968, 209), True),
    ("flourish-l", (844, 184, 1246, 301), True),
    ("flourish-r", (2098, 184, 2475, 301), True),
    ("substar-l", (1170, 368, 1271, 426), True),
    ("substar-r", (2065, 368, 2165, 426), True),
    ("panel", (268, 460, 3076, 1237), True),
    ("code-plaque", (426, 694, 1430, 970), False),
    # 左边界只能放到 1420：匾额的右角在这一段 y 里伸到 x=1419，再往左就把匾额切进来了
    # （复制框自己从 1433 起，1420~1432 是两者之间的空白）。
    ("copy-frame", (1420, 711, 1622, 945), True),
    ("divider", (1630, 518, 1714, 1187), True),
    # 输入框右缘 2507、加入按钮左缘 2534，中间这段空白两边各让 20px。
    ("input-frame", (1731, 736, 2528, 970), True),
    ("join-btn", (2513, 744, 2943, 970), False),
    # 两块横幅上下都留够余量：实测它们的实际范围是 y 1279~1615，
    # 左横幅 x 415~1649、右横幅 x 1692~2945，粗略区域刚好卡在边上会削掉一排像素。
    ("banner-deck", (400, 1262, 1662, 1630), False),
    ("banner-hero", (1680, 1262, 2958, 1630), False),
    ("foot", (1271, 1647, 2090, 1800), True),
]


# 画在面板框里、CSS 上也做成面板子元素的那几件。它们的落位要相对面板算（见落位 B）。
PANEL_CHILDREN = frozenset(
    {"code-plaque", "copy-frame", "divider", "input-frame", "join-btn"}
)


def stage_box(box: tuple[int, int, int, int]) -> tuple[float, float, float, float]:
    """把原图包围盒换算成舞台上的 (left cqi, top %, width cqi, height %)。"""
    x0, y0, x1, y1 = box
    return (
        x0 / SCALE / (STAGE_W / 100),
        y0 / SCALE / (STAGE_H / 100),
        (x1 - x0) / SCALE / (STAGE_W / 100),
        (y1 - y0) / SCALE / (STAGE_H / 100),
    )


def tighten(
    sheet: Image.Image, name: str, box: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """把粗略区域收紧到里面真正有像素的范围，再向外留 PAD。

    收紧只在这块区域内部做（先 crop 再算包围盒），所以邻居元素的像素不会被算进来；
    向外补的 PAD 同样夹回原区域，避免补出去反而吃到邻居。

    夹回去这一下是有风险的：粗略边界如果正压在元素身上，被夹掉的就不只是那 4px 余量，
    而是元素本身的一截，切出来的图会缺一块而脚本毫无反应。所以只要哪条边夹到了底，
    就打一条警告——它未必真丢了东西（边界正好落在元素外沿也会触发），但值得回去看一眼
    素材图，确认那条边是不是该往外放宽。
    """
    x0, y0, x1, y1 = box
    crop = sheet.crop(box)
    alpha = crop.getchannel("A")
    # point 把 alpha 二值化成掩码，getbbox 再取掩码里非零像素的包围盒。
    mask = alpha.point(lambda value: 255 if value > ALPHA_FLOOR else 0)
    inner = mask.getbbox()
    if inner is None:
        raise SystemExit(f"区域 {box} 里没有任何不透明像素，检查素材图或坐标")
    ix0, iy0, ix1, iy1 = inner
    tight = (
        max(x0, x0 + ix0 - PAD),
        max(y0, y0 + iy0 - PAD),
        min(x1, x0 + ix1 + PAD),
        min(y1, y0 + iy1 + PAD),
    )
    for edge, rough_value, tight_value in zip(("左", "上", "右", "下"), box, tight):
        if rough_value == tight_value:
            print(
                f"警告：{name} 的{edge}边收紧后仍贴着粗略区域（{edge}={rough_value}），"
                f"内容可能被切掉；把 REGIONS 里这条边往外挪到元素之间的空白处再跑一次。",
                file=sys.stderr,
            )
    return tight


def encode(png_path: Path, webp_path: Path, lossless: bool) -> None:
    args = ["cwebp", "-quiet", "-alpha_q", "100"]
    if lossless:
        args += ["-lossless", "-z", "9"]
    else:
        # -q 92 是画质和体积的折中；实心纸面上的颗粒噪点很吃码率，再低会糊。
        args += ["-q", "92"]
    args += [str(png_path), "-o", str(webp_path)]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"cwebp 失败（{png_path.name}）：{result.stderr.strip()}")


def main() -> None:
    if not SHEET.exists():
        raise SystemExit(f"找不到素材图 {SHEET}")
    sheet = Image.open(SHEET).convert("RGBA")
    if sheet.size != (STAGE_W * SCALE, STAGE_H * SCALE):
        print(
            f"注意：素材图 {sheet.size} 不是舞台 {STAGE_W}x{STAGE_H} 的 {SCALE} 倍，"
            "下面折算出来的落位可能对不上",
            file=sys.stderr,
        )

    # 面板专用的一份副本：先把内芯抹掉再切，其余切片仍然从原图上取，
    # 否则被挖掉的那些子元素自己也没得切了。
    hollowed = sheet.copy()
    hollowed.paste(
        Image.new("RGBA", (PANEL_HOLLOW[2] - PANEL_HOLLOW[0], PANEL_HOLLOW[3] - PANEL_HOLLOW[1])),
        PANEL_HOLLOW[:2],
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = OUT_DIR / ".tmp-png"
    tmp_dir.mkdir(exist_ok=True)

    rows: list[tuple[str, tuple[int, int, int, int], int]] = []
    for name, rough, lossless in REGIONS:
        source = hollowed if name == "panel" else sheet
        box = tighten(source, name, rough)
        png_path = tmp_dir / f"{name}.png"
        webp_path = OUT_DIR / f"{name}.webp"
        source.crop(box).save(png_path)
        encode(png_path, webp_path, lossless)
        png_path.unlink()
        rows.append((name, box, webp_path.stat().st_size))

    tmp_dir.rmdir()

    print(f"\n切片输出到 {OUT_DIR}\n")
    header = f"{'name':<12} {'原图包围盒 x0,y0,x1,y1':<26} {'尺寸':<12} {'体积':>8}"
    print(header)
    print("-" * len(header))
    for name, (x0, y0, x1, y1), size in rows:
        box_text = f"{x0},{y0},{x1},{y1}"
        wh = f"{x1 - x0}x{y1 - y0}"
        print(f"{name:<12} {box_text:<26} {wh:<12} {size / 1024:>7.1f}K")

    print("\n落位 A：直接挂在舞台上的元素（left/width 用 cqi，top/height 用舞台高的 %）")
    print("最后一列是同一个高度换成 cqi 的写法，给那些父元素高度不定、%")
    print("算不出来的地方用（舞台宽高比钉死，两种写法等价）。\n")
    header = f"{'name':<12} {'left':>9} {'top':>9} {'width':>9} {'height':>9} {'height':>9}"
    print(header)
    print("-" * len(header))
    for name, box, _ in rows:
        left, top, width, height = stage_box(box)
        print(
            f"{name:<12} {left:>8.2f}c {top:>8.2f}% {width:>8.2f}c {height:>8.2f}%"
            f" {height * STAGE_H / STAGE_W:>8.2f}c"
        )

    print("\n落位 B：面板内那几件，相对面板左上角（四个值都用 cqi）")
    print("面板里的 % 是相对面板自己的宽高的，对不上上面那张表的舞台百分比；")
    print("cqi 横纵通用，所以面板内一律用 cqi。\n")
    panel_box = next(box for name, box, _ in rows if name == "panel")
    panel_left, panel_top, _, _ = stage_box(panel_box)
    header = f"{'name':<12} {'left':>9} {'top':>9} {'width':>9} {'height':>9}"
    print(header)
    print("-" * len(header))
    for name, box, _ in rows:
        if name not in PANEL_CHILDREN:
            continue
        left, top, width, height = stage_box(box)
        print(
            f"{name:<12} {left - panel_left:>8.2f}c"
            f" {(top - panel_top) * STAGE_H / STAGE_W:>8.2f}c"
            f" {width:>8.2f}c {height * STAGE_H / STAGE_W:>8.2f}c"
        )


if __name__ == "__main__":
    main()

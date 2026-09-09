#!/usr/bin/env python3
"""Gera os icones PNG do app sem dependencias externas.

Desenho: fundo azul-noite arredondado, lua crescente creme e algumas estrelas.
Uso: python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (11, 15, 22)
CARD = (24, 34, 52)
MOON = (255, 214, 165)
STAR = (233, 238, 247)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icons")

STARS = [(0.70, 0.26, 0.045), (0.79, 0.44, 0.030), (0.62, 0.47, 0.022)]


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def coverage(dist, radius, feather):
    """Anti-aliasing: 1 dentro, 0 fora, rampa suave na borda."""
    return min(1.0, max(0.0, (radius - dist) / feather + 0.5))


def rounded_box_distance(x, y, half, radius):
    """Distancia com sinal ate a borda de um quadrado de cantos arredondados."""
    dx = max(abs(x) - (half - radius), 0.0)
    dy = max(abs(y) - (half - radius), 0.0)
    return math.hypot(dx, dy) - radius


def render(size, maskable=False):
    """Retorna bytes RGB da imagem size x size."""
    pad = 0.0 if not maskable else size * 0.10
    inner = size - 2 * pad
    feather = max(1.0, size / 96)
    # centro da lua e do "recorte" que forma o crescente
    cx, cy = pad + inner * 0.44, pad + inner * 0.52
    r = inner * 0.30
    cut_dx, cut_dy = r * 0.55, -r * 0.30
    cut_r = r * 0.92

    rows = []
    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            color = BG
            # cartao arredondado
            box_d = rounded_box_distance(x - size / 2, y - size / 2, inner / 2, inner * 0.22)
            a = coverage(box_d, 0.0, feather)
            if a > 0:
                color = blend(color, CARD, a)
            # lua crescente = circulo cheio menos circulo deslocado
            d_moon = math.hypot(x - cx, y - cy)
            d_cut = math.hypot(x - (cx + cut_dx), y - (cy + cut_dy))
            a_moon = coverage(d_moon, r, feather) * (1.0 - coverage(d_cut, cut_r, feather))
            if a_moon > 0:
                color = blend(color, MOON, a_moon)
            # estrelas
            for sx, sy, sr in STARS:
                d = math.hypot(x - (pad + inner * sx), y - (pad + inner * sy))
                a_star = coverage(d, inner * sr, feather)
                if a_star > 0:
                    color = blend(color, STAR, a_star)
            row += bytes(color)
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, maskable, name in (
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (512, True, "icon-maskable-512.png"),
        (180, False, "apple-touch-icon.png"),
    ):
        write_png(os.path.join(OUT, name), render(size, maskable), size)
        print("gerado", name)


if __name__ == "__main__":
    main()

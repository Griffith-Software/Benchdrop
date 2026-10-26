# SPDX-License-Identifier: LicenseRef-Apache-2.0-with-Commons-Clause
# Copyright (c) 2026 Richard Griffith (d/b/a Griffith Software) — https://griffith.software
"""
Generates the seamless wood-plank texture used behind the whole UI.

CSS gradients can only make hard, evenly-spaced lines, which read as stripes
rather than timber. This paints actual grain: horizontal fibres that wander,
per-plank colour variation, soft seams with a lit edge below each one, and a
little fine noise on top. The result tiles in both directions.

Regenerate with:  python3 build/make-wood.py   (needs Pillow)
"""
import base64, math, os, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 512, 512          # tile size
PLANK_H = 128            # 4 planks per tile -> tiles vertically
random.seed(7)           # keep the texture identical between runs

# Palettes. The same grain routine paints both themes.
PALETTES = {
    'dark':  {'base': (46, 32, 22),    'variation': 9, 'grain': 20.0, 'seam': 165, 'lit': 22},
    # Whitewash (pickling): a thinned white settles INTO the open grain, so
    # the grain reads lighter than the board rather than darker — "a
    # sun-bleached negative of the natural wood". The wash is wiped along the
    # length, so it survives unevenly: streaks of heavier and thinner cover,
    # with the timber's warm tannins showing through where it's thin.
    'whitewash': {
        'base': (236, 233, 226),   # cool off-white board
        'under': (206, 190, 165),  # warm timber showing through thin cover
        'pore': (252, 251, 249),   # white sitting in the open grain
        'variation': 5, 'seam': 78, 'lit': 140,
    },
}
BASE = PALETTES['dark']['base']
VARIATION = PALETTES['dark']['variation']


def build_whitewash():
    """Pickled / whitewashed boards.

    Real grain isn't a wave: the lines sit at irregular intervals, vary in
    width and darkness, and run mostly straight with a slow drift along the
    board. Each board here gets its own set of lines with random spacing and
    weight, and the wash is painted as a semi-transparent white that settles
    into those lines and thins out in streaks where it was wiped back.
    """
    pal = PALETTES['whitewash']
    base, under, pore = pal['base'], pal['under'], pal['pore']
    random.seed(11)

    img = Image.new("RGB", (W, H), base)
    px = img.load()
    planks = H // PLANK_H

    boards = []
    for _ in range(planks):
        lines = []
        pos = random.uniform(0, .04)
        while pos < 1.0:
            lines.append({
                'pos': pos,
                'width': random.uniform(.0030, .010),
                'strength': random.uniform(.30, .75),
            })
            pos += random.uniform(.028, .105)      # irregular spacing
        boards.append({
            'lines': lines,
            'drift': [(1, random.uniform(0, math.tau), random.uniform(.010, .028)),
                      (2, random.uniform(0, math.tau), random.uniform(.004, .012))],
            'cover': random.uniform(.66, .90),
            'streak': [(random.choice([1, 2, 3, 5]), random.uniform(0, math.tau)) for _ in range(4)],
            'tone': random.randint(-pal['variation'], pal['variation']),
        })

    for y in range(H):
        p = y // PLANK_H
        local_y = (y % PLANK_H) / PLANK_H
        b = boards[p]

        for x in range(W):
            u = x / W
            drift = sum(a * math.sin(math.tau * f * u + ph) for f, ph, a in b['drift'])
            yy = local_y + drift

            # Strongest nearby grain line wins.
            in_pore = 0.0
            for ln in b['lines']:
                dy = (yy - ln['pos']) / ln['width']
                if -3.0 < dy < 3.0:
                    v = ln['strength'] * math.exp(-dy * dy)
                    if v > in_pore:
                        in_pore = v

            streak = sum(math.sin(math.tau * f * u + ph) for f, ph in b['streak']) / len(b['streak'])
            cover = max(0.0, min(1.0, b['cover'] + 0.16 * streak - 0.05 * math.sin(math.tau * 3 * local_y)))

            r = under[0] + (base[0] - under[0]) * cover
            g = under[1] + (base[1] - under[1]) * cover
            bl = under[2] + (base[2] - under[2]) * cover
            r += (pore[0] - r) * in_pore
            g += (pore[1] - g) * in_pore
            bl += (pore[2] - bl) * in_pore

            v = b['tone']
            px[x, y] = (max(0, min(255, int(r + v))),
                        max(0, min(255, int(g + v))),
                        max(0, min(255, int(bl + v * 0.9))))

    d = ImageDraw.Draw(img, "RGBA")

    # A couple of knots per tile, drawn as soft rings of the warm undertone.
    for _ in range(3):
        kx = random.randint(40, W - 40)
        kp = random.randrange(planks)
        ky = kp * PLANK_H + random.randint(30, PLANK_H - 30)
        for i, rr in enumerate((16, 11, 6)):
            a = 40 + i * 18
            d.ellipse([kx - rr * 1.6, ky - rr, kx + rr * 1.6, ky + rr],
                      outline=(168, 146, 114, a), width=2)

    for p in range(planks):
        y = p * PLANK_H
        d.line([(0, y), (W, y)], fill=(120, 108, 92, pal['seam']), width=2)
        d.line([(0, y + 2), (W, y + 2)], fill=(255, 255, 255, pal['lit']), width=1)

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    noise = Image.effect_noise((W, H), 14).convert("L").point(lambda v: 128 + (v - 128) * 0.20)
    return Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.06)


def build(palette='dark'):
    pal = PALETTES[palette]
    base, variation = pal['base'], pal['variation']
    random.seed(7)  # same grain in both themes

    img = Image.new("RGB", (W, H), base)
    px = img.load()

    planks = H // PLANK_H
    plank_tone = [random.randint(-variation, variation) for _ in range(planks)]

    # Per-plank grain: how many lines, and how much they wander along the
    # length of the board. Integer frequencies keep the wander seamless.
    grain = []
    for _ in range(planks):
        grain.append({
            "lines": random.uniform(13, 22),
            "wander": [
                (random.choice([1, 2]), random.uniform(0, math.tau), random.uniform(.030, .060)),
                (random.choice([3, 5]), random.uniform(0, math.tau), random.uniform(.010, .022)),
            ],
            "tone_wave": (random.choice([1, 2]), random.uniform(0, math.tau)),
            "phase": random.uniform(0, 1),
        })

    for y in range(H):
        p = y // PLANK_H
        local_y = (y % PLANK_H) / PLANK_H
        g = grain[p]
        tone = plank_tone[p]

        for x in range(W):
            u = x / W

            # Grain lines run along the board and drift as they go.
            drift = sum(a * math.sin(math.tau * f * u + ph) for f, ph, a in g["wander"])
            t = abs(math.sin(math.tau * g["lines"] * (local_y + drift + g["phase"])))

            # Narrow dark lines where the wave crosses zero.
            dark = (1.0 - t) ** 5

            # Slow lightness change down the length of the board.
            tf, tp = g["tone_wave"]
            sweep = math.sin(math.tau * tf * u + tp)

            v = tone + 5.5 * sweep - pal['grain'] * dark
            r = max(0, min(255, int(base[0] + v * 1.18)))
            gg = max(0, min(255, int(base[1] + v * 0.86)))
            b = max(0, min(255, int(base[2] + v * 0.62)))
            px[x, y] = (r, gg, b)

    # Plank seams: a dark groove with a lit edge just beneath it.
    d = ImageDraw.Draw(img, "RGBA")
    for p in range(planks):
        y = p * PLANK_H
        d.line([(0, y), (W, y)], fill=(0, 0, 0, pal['seam']), width=2)
        d.line([(0, y + 2), (W, y + 2)], fill=(255, 245, 225, pal['lit']), width=1)

    img = img.filter(ImageFilter.GaussianBlur(0.45))

    noise = Image.effect_noise((W, H), 14).convert("L").point(lambda v: 128 + (v - 128) * 0.22)
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.045)
    return img


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for name, out_name in (("dark", "wood.png"), ("whitewash", "wood-light.png")):
        tex = build_whitewash() if name == "whitewash" else build(name)
        out = os.path.join(here, out_name)
        tex.save(out, optimize=True)
        print(f"wrote {out_name} ({os.path.getsize(out)/1024:.0f} KB)")

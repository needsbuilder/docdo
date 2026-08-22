#!/usr/bin/env python3
"""인쇄본 없이 폰 촬영 조건을 근사한다. 실촬영 대체가 아니라 '심한 열화에서 깨지는지' 사전 점검용.
적용: 원근 왜곡(기울여 찍기) → 조명 그라디언트(한쪽 밝음) → 축소(폰 해상도) → JPEG 압축 → 약한 블러/노이즈"""
import sys, os, random
from PIL import Image, ImageEnhance, ImageFilter

def perspective_coeffs(src, dst):
    import numpy as np
    A = []
    for (x, y), (X, Y) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y]); A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    A = np.array(A, dtype=float)
    B = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(A, B)

def simulate(path, out, level="mid", seed=7):
    random.seed(seed)
    im = Image.open(path).convert("RGB")
    w, h = im.size
    k = {"light": 0.010, "mid": 0.022, "hard": 0.040}[level]
    dx, dy = w * k, h * k
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(dx * random.uniform(.4, 1), dy * random.uniform(.4, 1)),
           (w - dx * random.uniform(.2, .8), dy * random.uniform(.2, 1)),
           (w - dx * random.uniform(.4, 1), h - dy * random.uniform(.3, 1)),
           (dx * random.uniform(.2, .9), h - dy * random.uniform(.4, 1))]
    im = im.transform((w, h), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC, fillcolor=(238, 238, 236))
    ang = {"light": 0.8, "mid": 2.0, "hard": 3.5}[level]
    im = im.rotate(random.uniform(-ang, ang), resample=Image.BICUBIC, expand=False, fillcolor=(238, 238, 236))
    # 조명 그라디언트 (한쪽에서 들어오는 빛)
    grad = Image.linear_gradient("L").resize((w, h)).rotate(random.uniform(0, 360), fillcolor=128)
    strength = {"light": 0.10, "mid": 0.20, "hard": 0.32}[level]
    im = Image.composite(im, ImageEnhance.Brightness(im).enhance(1 + strength), grad.point(lambda v: int(v * 0.6)))
    im = ImageEnhance.Brightness(im).enhance({"light": 0.98, "mid": 0.94, "hard": 0.88}[level])
    im = ImageEnhance.Contrast(im).enhance({"light": 0.99, "mid": 0.95, "hard": 0.90}[level])
    # 폰 촬영 해상도로 축소 (긴 변 1600px — 설계서 §12 압축 기준)
    scale = 1600 / max(w, h)
    if scale < 1: im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    im = im.filter(ImageFilter.GaussianBlur({"light": 0.3, "mid": 0.6, "hard": 1.0}[level]))
    q = {"light": 88, "mid": 78, "hard": 65}[level]
    im.save(out, "JPEG", quality=q)
    return os.path.getsize(out)

if __name__ == "__main__":
    level = sys.argv[1] if len(sys.argv) > 1 else "mid"
    os.makedirs(f"fixtures/photo_{level}", exist_ok=True)
    for f in sorted(os.listdir("fixtures/team")):
        if not f.endswith(".png"): continue
        out = f"fixtures/photo_{level}/" + f.replace(".png", ".jpg")
        n = simulate("fixtures/team/" + f, out, level)
        print(f"  {f[:34]:36s} → {n//1024:4d} KB")

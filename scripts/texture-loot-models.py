"""Bake compact painted textures into the coin and heart pickup GLBs."""

from __future__ import annotations

import io
import json
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SIZE = 256


def coin_texture() -> bytes:
    image = Image.new("RGB", (SIZE, SIZE), (104, 55, 8))
    pixels = image.load()
    cx, cy, radius = 96, 128, 83
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy) / radius
            shine = max(0.0, 1.0 - math.hypot(dx + 31, dy + 38) / 150)
            ring = 0.5 + 0.5 * math.cos(min(r, 1) * math.pi * 8)
            if r <= 1:
                edge = max(0.0, (r - 0.73) / 0.27)
                gold = 0.58 + shine * 0.27 + ring * 0.05 + edge * 0.14
                pixels[x, y] = (
                    min(255, int(255 * gold)),
                    min(230, int(154 * gold)),
                    min(100, int(34 * gold)),
                )
    draw = ImageDraw.Draw(image)
    # Raised rims and a simple Antrom crown that stays legible from above.
    draw.ellipse((17, 49, 175, 207), outline=(255, 224, 105), width=7)
    draw.ellipse((29, 61, 163, 195), outline=(133, 72, 10), width=3)
    crown = [(56, 139), (56, 105), (76, 122), (96, 83), (116, 122), (137, 105), (137, 139)]
    draw.polygon(crown, fill=(255, 220, 85), outline=(115, 58, 7))
    draw.rectangle((57, 139, 136, 157), fill=(230, 154, 27), outline=(255, 230, 125), width=3)
    for x in (67, 96, 126):
        draw.ellipse((x - 6, 143, x + 6, 155), fill=(255, 238, 151))
    # The right side of the atlas is the milled edge.
    draw.rectangle((199, 20, 250, 235), fill=(180, 105, 15))
    for y in range(24, 235, 13):
        draw.rectangle((199, y, 250, y + 5), fill=(255, 210, 66))
    return png_bytes(image)


def heart_texture() -> bytes:
    image = Image.new("RGB", (SIZE, SIZE), (120, 7, 22))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            # Painted ruby-red gradient with a soft lower-right shadow.
            highlight = max(0.0, 1.0 - math.hypot(x - 78, y - 65) / 205)
            shade = 0.68 + highlight * 0.46 - (x + y) / 1700
            pixels[x, y] = (
                min(255, int(242 * shade)),
                min(105, int(35 * shade)),
                min(125, int(56 * shade)),
            )
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((37, 24, 129, 116), fill=(255, 236, 220, 105))
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    image = Image.alpha_composite(image.convert("RGBA"), glow)
    draw = ImageDraw.Draw(image)
    draw.ellipse((62, 48, 91, 79), fill=(255, 244, 235, 225))
    draw.ellipse((69, 55, 81, 67), fill=(255, 255, 255, 245))
    return png_bytes(image.convert("RGB"))


def orb_texture(kind: str) -> bytes:
    """Paint a seamless-ish magical surface with a readable front rune."""
    image = Image.new("RGB", (SIZE, SIZE))
    pixels = image.load()
    ember = kind == "ember"
    for y in range(SIZE):
        for x in range(SIZE):
            wave = 0.5 + 0.5 * math.sin(x * 0.12 + math.sin(y * 0.08) * 2.2)
            glow = max(0.0, 1.0 - math.hypot(x - 128, y - 122) / 175)
            if ember:
                pixels[x, y] = (int(88 + 86 * glow + 28 * wave), int(12 + 35 * glow), 4)
            else:
                pixels[x, y] = (int(32 + 45 * glow), int(15 + 31 * wave), int(91 + 113 * glow))
    draw = ImageDraw.Draw(image)
    if ember:
        hot = (255, 213, 66)
        # Branching molten seams and a flame sigil on the forward face.
        for shift in (-256, 0, 256):
            draw.line([(shift + 6, 210), (shift + 47, 166), (shift + 31, 126), (shift + 74, 82), (shift + 58, 32)], fill=(255, 111, 18), width=5)
        draw.polygon([(128, 42), (91, 116), (119, 101), (101, 185), (157, 119), (134, 126), (158, 61)],
                     fill=hot, outline=(255, 246, 159))
        draw.ellipse((113, 112, 143, 153), fill=(255, 247, 174))
    else:
        bright = (166, 221, 255)
        # Shield and orbit lines distinguish protection from the warm ember.
        draw.ellipse((20, 54, 236, 204), outline=(94, 111, 255), width=7)
        draw.ellipse((48, 35, 208, 221), outline=(129, 83, 255), width=5)
        shield = [(128, 44), (185, 71), (176, 151), (128, 207), (80, 151), (71, 71)]
        draw.line(shield + [shield[0]], fill=bright, width=8, joint="curve")
        draw.line([(128, 61), (128, 183)], fill=(218, 239, 255), width=7)
        draw.line([(94, 111), (162, 111)], fill=(218, 239, 255), width=7)
    return png_bytes(image)


def png_bytes(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def create_orb(path: Path, kind: str, texture: bytes) -> None:
    """Write a small UV sphere GLB with its painted texture embedded."""
    segments, rings, radius = 24, 12, 0.23
    positions: list[float] = []
    normals: list[float] = []
    uvs: list[float] = []
    indices: list[int] = []
    for ring in range(rings + 1):
        v = ring / rings
        theta = v * math.pi
        sy, sr = math.cos(theta), math.sin(theta)
        for segment in range(segments + 1):
            u = segment / segments
            phi = u * math.pi * 2
            nx, nz = math.sin(phi) * sr, math.cos(phi) * sr
            positions.extend((nx * radius, sy * radius, nz * radius))
            normals.extend((nx, sy, nz))
            uvs.extend((u, v))
    stride = segments + 1
    for ring in range(rings):
        for segment in range(segments):
            a = ring * stride + segment
            b = a + stride
            indices.extend((a, b, a + 1, a + 1, b, b + 1))

    chunks = [
        struct.pack("<" + "f" * len(positions), *positions),
        struct.pack("<" + "f" * len(normals), *normals),
        struct.pack("<" + "f" * len(uvs), *uvs),
        struct.pack("<" + "H" * len(indices), *indices),
    ]
    binary = bytearray()
    views: list[dict] = []
    for chunk, target in zip(chunks, (34962, 34962, 34962, 34963)):
        while len(binary) % 4:
            binary.append(0)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(chunk), "target": target})
        binary.extend(chunk)
    while len(binary) % 4:
        binary.append(0)
    image_view = len(views)
    views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(texture)})
    binary.extend(texture)
    while len(binary) % 4:
        binary.append(0)

    count = (rings + 1) * (segments + 1)
    emissive = [0.7, 0.18, 0.025] if kind == "ember" else [0.18, 0.15, 0.75]
    doc = {
        "asset": {"generator": "DG-realms textured loot generator", "version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": f"{kind}_pickup"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{
            "name": kind,
            "pbrMetallicRoughness": {
                "baseColorFactor": [1, 1, 1, 1], "baseColorTexture": {"index": 0},
                "metallicFactor": 0.15 if kind == "ember" else 0.35, "roughnessFactor": 0.3,
            },
            "emissiveFactor": emissive, "emissiveTexture": {"index": 0},
        }],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3",
             "min": [-radius, -radius, -radius], "max": [radius, radius, radius]},
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": count, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": len(indices), "type": "SCALAR",
             "min": [0], "max": [count - 1]},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
        "images": [{"name": f"{kind}_paint", "bufferView": image_view, "mimeType": "image/png"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "textures": [{"sampler": 0, "source": 0}],
    }
    json_chunk = json.dumps(doc, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_chunk) + 8 + len(binary))
        + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
        + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    )


def read_glb(path: Path) -> tuple[dict, bytearray]:
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        raise ValueError(f"{path} is not a GLB")
    json_len = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20 : 20 + json_len])
    chunk = 20 + json_len
    bin_len = struct.unpack_from("<I", raw, chunk)[0]
    return doc, bytearray(raw[chunk + 8 : chunk + 8 + bin_len])


def values(doc: dict, binary: bytearray, accessor_index: int, width: int) -> list[tuple[float, ...]]:
    accessor = doc["accessors"][accessor_index]
    view = doc["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return [
        struct.unpack_from("<" + "f" * width, binary, offset + i * width * 4)
        for i in range(accessor["count"])
    ]


def write_uvs(doc: dict, binary: bytearray, kind: str) -> None:
    primitive = doc["meshes"][0]["primitives"][0]
    positions = values(doc, binary, primitive["attributes"]["POSITION"], 3)
    normals = values(doc, binary, primitive["attributes"]["NORMAL"], 3)
    uv_accessor = doc["accessors"][primitive["attributes"]["TEXCOORD_0"]]
    uv_view = doc["bufferViews"][uv_accessor["bufferView"]]
    offset = uv_view.get("byteOffset", 0) + uv_accessor.get("byteOffset", 0)

    for i, ((x, y, z), (nx, ny, _nz)) in enumerate(zip(positions, normals)):
        if kind == "coin":
            if abs(ny) > 0.65:
                # Circular faces occupy the left 75% of the atlas.
                u = 0.375 + x / 0.5
                v = 0.5 + z / 0.5
            else:
                # The thin rim uses the milled strip on the right.
                u = 0.78 + ((math.atan2(z, x) / (2 * math.pi)) % 1.0) * 0.20
                v = 0.10 + y / 0.058
        else:
            # The heart is a shallow extrusion, so one front projection paints
            # both broad faces and gives its edge the same dark ruby color.
            u = 0.5 + x / 0.39
            v = 0.06 + y / 0.36 * 0.88
        struct.pack_into("<ff", binary, offset + i * 8, u, v)


def save_textured(path: Path, kind: str, texture: bytes) -> None:
    doc, binary = read_glb(path)
    # Make regeneration idempotent: discard a texture embedded by an earlier
    # run while retaining the vertex/index buffer views.
    geometry_views = [view for view in doc["bufferViews"] if "target" in view]
    geometry_end = max(view.get("byteOffset", 0) + view["byteLength"] for view in geometry_views)
    doc["bufferViews"] = geometry_views
    binary = binary[:geometry_end]
    doc.pop("images", None)
    doc.pop("samplers", None)
    doc.pop("textures", None)
    write_uvs(doc, binary, kind)
    while len(binary) % 4:
        binary.append(0)
    image_offset = len(binary)
    binary.extend(texture)
    while len(binary) % 4:
        binary.append(0)

    image_view = len(doc["bufferViews"])
    doc["bufferViews"].append({"buffer": 0, "byteOffset": image_offset, "byteLength": len(texture)})
    doc["images"] = [{"name": f"{kind}_paint", "bufferView": image_view, "mimeType": "image/png"}]
    doc["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    doc["textures"] = [{"sampler": 0, "source": 0}]

    material = doc["materials"][0]
    pbr = material["pbrMetallicRoughness"]
    pbr["baseColorFactor"] = [1, 1, 1, 1]
    pbr["baseColorTexture"] = {"index": 0}
    material["emissiveTexture"] = {"index": 0}
    if kind == "coin":
        pbr["metallicFactor"] = 0.72
        pbr["roughnessFactor"] = 0.3
        material["emissiveFactor"] = [0.22, 0.12, 0.025]
    else:
        pbr["metallicFactor"] = 0
        pbr["roughnessFactor"] = 0.32
        material["emissiveFactor"] = [0.18, 0.025, 0.035]

    doc["buffers"][0]["byteLength"] = len(binary)
    json_chunk = json.dumps(doc, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    header = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_chunk) + 8 + len(binary))
    path.write_bytes(
        header
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(binary), b"BIN\x00")
        + binary
    )


if __name__ == "__main__":
    save_textured(ROOT / "models/loot/coin.glb", "coin", coin_texture())
    save_textured(ROOT / "models/loot/heart.glb", "heart", heart_texture())
    create_orb(ROOT / "models/loot/ember.glb", "ember", orb_texture("ember"))
    create_orb(ROOT / "models/loot/ward.glb", "ward", orb_texture("ward"))
    print("Embedded painted textures in coin, heart, ember and ward pickups")

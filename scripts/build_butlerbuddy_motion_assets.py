#!/usr/bin/env python3
"""Build aligned animated ButlerBuddy WebP assets from a 5x4 RGBA storyboard."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image


STATES = ("idle", "working", "celebrating", "comforting", "sleeping")
SEQUENCES = {
    "idle": (0, 1, 2, 1, 3, 1, 0),
    "working": (0, 1, 2, 3, 2, 1, 0),
    "celebrating": (0, 1, 2, 3, 2, 1, 0),
    "comforting": (0, 1, 2, 3, 2, 1, 0),
    "sleeping": (0, 1, 2, 3, 2, 1, 0),
}
KEY_DURATIONS_MS = {
    "idle": (700, 400, 120, 400, 480, 400, 700),
    "working": (160, 160, 160, 180, 160, 160, 160),
    "celebrating": (500, 500, 450, 1_100, 450, 500, 500),
    "comforting": (600, 500, 500, 800, 500, 500, 600),
    "sleeping": (550, 450, 550, 750, 550, 450, 550),
}
POSTER_FRAME = {
    "idle": 0,
    "working": 1,
    "celebrating": 3,
    "comforting": 1,
    "sleeping": 0,
}

CANVAS_SIZE = 512
TARGET_VISIBLE_WIDTH = 440
TARGET_VISIBLE_HEIGHT = 400
GROUND_Y = 456
GRID_MARGIN = 5


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    return alpha.getbbox()


def extract_storyboard_cells(sheet: Image.Image) -> dict[str, list[Image.Image]]:
    width, height = sheet.size
    result: dict[str, list[Image.Image]] = {}
    for row, state in enumerate(STATES):
        row_frames: list[Image.Image] = []
        y0 = round(row * height / len(STATES)) + GRID_MARGIN
        y1 = round((row + 1) * height / len(STATES)) - GRID_MARGIN
        for column in range(4):
            x0 = round(column * width / 4) + GRID_MARGIN
            x1 = round((column + 1) * width / 4) - GRID_MARGIN
            row_frames.append(sheet.crop((x0, y0, x1, y1)).convert("RGBA"))
        result[state] = row_frames
    return result


def normalize_state_frames(frames: list[Image.Image]) -> list[Image.Image]:
    boxes = [box for frame in frames if (box := alpha_bbox(frame))]
    if not boxes:
        raise ValueError("state row contains no visible pixels")
    union = (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )
    union_width = union[2] - union[0]
    union_height = union[3] - union[1]
    scale = min(
        TARGET_VISIBLE_WIDTH / union_width,
        TARGET_VISIBLE_HEIGHT / union_height,
    )
    output_width = max(1, round(union_width * scale))
    output_height = max(1, round(union_height * scale))
    left = (CANVAS_SIZE - output_width) // 2
    top = GROUND_Y - output_height

    normalized: list[Image.Image] = []
    for frame in frames:
        cropped = frame.crop(union)
        resized = cropped.resize(
            (output_width, output_height), Image.Resampling.LANCZOS
        )
        canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        canvas.alpha_composite(resized, (left, top))
        normalized.append(canvas)
    return normalized


def expand_animation(
    keyframes: list[Image.Image], state: str
) -> tuple[list[Image.Image], list[int]]:
    indices = SEQUENCES[state]
    return (
        [keyframes[index] for index in indices],
        list(KEY_DURATIONS_MS[state]),
    )


def encode_webp(
    frames: list[Image.Image],
    durations: list[int],
    frame_dir: Path,
    output_path: Path,
) -> None:
    img2webp = shutil.which("img2webp")
    if not img2webp:
        raise RuntimeError("img2webp is required to encode ButlerBuddy motion assets")
    frame_dir.mkdir(parents=True, exist_ok=True)
    command = [
        img2webp,
        "-loop",
        "0",
        "-mixed",
        "-kmin",
        "3",
        "-kmax",
        "5",
    ]
    for index, (frame, duration) in enumerate(zip(frames, durations, strict=True)):
        frame_path = frame_dir / f"{index:02d}.png"
        frame.save(frame_path, optimize=True)
        command.extend(
            ["-d", str(duration), "-q", "80", "-m", "4", str(frame_path)]
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command.extend(["-o", str(output_path)])
    subprocess.run(command, check=True, capture_output=True, text=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--storyboard", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    sheet = Image.open(args.storyboard).convert("RGBA")
    cells = extract_storyboard_cells(sheet)
    output = args.output
    posters = output / "posters"
    frames_root = output / ".frames"
    shutil.rmtree(frames_root, ignore_errors=True)
    posters.mkdir(parents=True, exist_ok=True)

    for state in STATES:
        keyframes = normalize_state_frames(cells[state])
        keyframes[POSTER_FRAME[state]].save(
            posters / f"{state}.png", optimize=True
        )
        frames, durations = expand_animation(keyframes, state)
        encode_webp(
            frames,
            durations,
            frames_root / state,
            output / f"{state}.webp",
        )
    shutil.rmtree(frames_root, ignore_errors=True)


if __name__ == "__main__":
    main()

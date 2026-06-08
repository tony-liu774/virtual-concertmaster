#!/usr/bin/env python3
"""
Preprocess sheet-music screenshots before OMR.

The OMR engines are sensitive to browser chrome, dark backgrounds, skew,
low contrast, and missing margins. This script tries to turn whatever the
user uploads into a cleaner black-on-white page image:
  1. crop to the largest bright paper-like region,
  2. deskew near-horizontal staff lines,
  3. crop to ink with a controlled margin,
  4. adaptive-threshold and pad the output.
"""

import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def clamp_rect(x, y, w, h, width, height, pad=0):
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(width, x + w + pad)
    y2 = min(height, y + h + pad)
    return x1, y1, x2, y2


def crop_to_paper(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    bright = cv2.inRange(gray, 178, 255)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    best_area = 0
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < width * height * 0.18:
            continue
        if w < width * 0.35 or h < height * 0.25:
            continue
        if area > best_area:
            best = (x, y, w, h)
            best_area = area

    if not best:
        return image

    x, y, w, h = best
    x1, y1, x2, y2 = clamp_rect(x, y, w, h, width, height, pad=12)
    return image[y1:y2, x1:x2]


def deskew(gray):
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 50, 150, apertureSize=3)
    min_len = max(80, gray.shape[1] // 8)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=90, minLineLength=min_len, maxLineGap=12)

    if lines is None:
        return gray

    angles = []
    for line in lines[:, 0]:
        x1, y1, x2, y2 = line
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        if -7 <= angle <= 7:
            angles.append(angle)

    if len(angles) < 5:
        return gray

    angle = float(np.median(angles))
    if abs(angle) < 0.15:
        return gray

    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderValue=255)


def crop_to_ink(gray):
    denoised = cv2.medianBlur(gray, 3)
    thresh = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        41,
        15,
    )
    ink = 255 - thresh
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    points = cv2.findNonZero(ink)
    if points is None:
        return gray

    x, y, w, h = cv2.boundingRect(points)
    height, width = gray.shape[:2]
    pad_x = max(40, int(width * 0.035))
    pad_y = max(40, int(height * 0.035))
    x1, y1, x2, y2 = clamp_rect(x, y, w, h, width, height, pad=0)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(width, x2 + pad_x)
    y2 = min(height, y2 + pad_y)
    return gray[y1:y2, x1:x2]


def normalize_size(gray):
    height, width = gray.shape[:2]
    longest = max(width, height)
    if longest < 1800:
        scale = 1800 / longest
    elif longest > 3600:
        scale = 3600 / longest
    else:
        scale = 1.0

    if abs(scale - 1.0) < 0.01:
        return gray

    interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interpolation)


def preprocess(input_path, output_path):
    image = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not read image: {input_path}")

    image = crop_to_paper(image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)
    gray = crop_to_ink(gray)
    gray = normalize_size(gray)
    gray = cv2.medianBlur(gray, 3)

    clean = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        51,
        13,
    )
    clean = cv2.copyMakeBorder(clean, 80, 80, 80, 80, cv2.BORDER_CONSTANT, value=255)
    cv2.imwrite(str(output_path), clean)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    preprocess(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()

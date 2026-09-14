"""Fabrique de scenes synthetiques pour tester la chaine metrique.

On construit une scene dont l'echelle vraie est connue, on la projette dans
des cameras virtuelles avec distorsion et bruit, on ecrit un modele COLMAP
au format texte, puis on verifie que la chaine retrouve l'echelle imposee.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from photoscan3d.colmap_io import _distort, rotmat_to_qvec
from photoscan3d.markers import BoardSpec
from photoscan3d.scale import MarkerObservation


def look_at(eye: np.ndarray, target: np.ndarray, up=(0.0, 0.0, 1.0)):
    """Pose monde -> camera d'une camera placee en ``eye`` visant ``target``."""
    forward = target - eye
    forward = forward / np.linalg.norm(forward)
    up = np.asarray(up, dtype=float)
    if abs(forward @ up) > 0.999:
        up = np.array([0.0, 1.0, 0.0])
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    R = np.vstack((right, down, forward))
    return R, -R @ eye


def camera_ring(center: np.ndarray, radius: float, elevations_deg, per_ring: int):
    """Cameras reparties sur plusieurs couronnes autour de la scene."""
    poses = []
    for elevation in elevations_deg:
        phi = np.radians(elevation)
        for k in range(per_ring):
            theta = 2 * np.pi * k / per_ring
            eye = center + radius * np.array([
                np.cos(phi) * np.cos(theta),
                np.cos(phi) * np.sin(theta),
                np.sin(phi),
            ])
            poses.append(look_at(eye, center))
    return poses


def project(R, t, params, points_world, rng=None, noise_px=0.0):
    """Projette des points 3D avec un modele SIMPLE_RADIAL (f, cx, cy, k1)."""
    f, cx, cy, k1 = params
    camera_points = (R @ points_world.T).T + t
    if np.any(camera_points[:, 2] <= 0):
        return None
    normalized = camera_points[:, :2] / camera_points[:, 2:3]
    distorted = _distort(normalized, k1, 0.0, 0.0, 0.0)
    pixels = np.column_stack((f * distorted[:, 0] + cx, f * distorted[:, 1] + cy))
    if noise_px and rng is not None:
        pixels = pixels + rng.normal(0.0, noise_px, pixels.shape)
    return pixels


def build_scene(spec: BoardSpec, scale_mm_per_unit: float, *, n_rings=(20, 70),
                per_ring: int = 12, noise_px: float = 0.0, seed: int = 0,
                k1: float = -0.02, width: int = 4032, height: int = 3024):
    """Genere un modele COLMAP texte et les observations de marqueurs.

    Retourne ``(lignes_cameras, lignes_images, observations, poses)``.
    """
    rng = np.random.default_rng(seed)
    board = spec.corner_positions()
    marker_ids = sorted(board)

    # Coins de la planche exprimes dans les unites arbitraires du modele,
    # puis places par une transformation rigide quelconque.
    angle = 0.7
    R_world = np.array([
        [np.cos(angle), -np.sin(angle), 0.0],
        [np.sin(angle), np.cos(angle), 0.0],
        [0.0, 0.0, 1.0],
    ])
    offset = np.array([3.1, -1.7, 0.4])
    corners_units = {
        marker_id: (R_world @ (board[marker_id] / scale_mm_per_unit).T).T + offset
        for marker_id in marker_ids
    }

    all_units = np.vstack([corners_units[m] for m in marker_ids])
    center = all_units.mean(axis=0)
    extent = np.linalg.norm(all_units.max(axis=0) - all_units.min(axis=0))
    poses = camera_ring(center, radius=1.2 * extent,
                        elevations_deg=n_rings, per_ring=per_ring)

    f = 0.85 * width
    params = (f, width / 2, height / 2, k1)
    camera_lines = [f"1 SIMPLE_RADIAL {width} {height} {f} {width/2} {height/2} {k1}"]

    image_lines: list[str] = []
    observations: list[MarkerObservation] = []
    for index, (R, t) in enumerate(poses, start=1):
        qvec = rotmat_to_qvec(R)
        image_lines.append(
            f"{index} {qvec[0]} {qvec[1]} {qvec[2]} {qvec[3]} "
            f"{t[0]} {t[1]} {t[2]} 1 img{index:04d}.jpg")
        image_lines.append("")
        for marker_id in marker_ids:
            pixels = project(R, t, params, corners_units[marker_id],
                             rng=rng, noise_px=noise_px)
            if pixels is None:
                continue
            inside = ((pixels[:, 0] >= 0) & (pixels[:, 0] < width)
                      & (pixels[:, 1] >= 0) & (pixels[:, 1] < height))
            if not inside.all():
                continue
            observations.append(MarkerObservation(index, marker_id, pixels))
    return camera_lines, image_lines, observations, poses


def write_model(directory: Path, camera_lines, image_lines, point_lines=()):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "cameras.txt").write_text(
        "# CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]\n" + "\n".join(camera_lines) + "\n",
        encoding="utf-8")
    (directory / "images.txt").write_text(
        "# IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME\n"
        + "\n".join(image_lines) + "\n", encoding="utf-8")
    (directory / "points3D.txt").write_text(
        "# POINT3D_ID X Y Z R G B ERROR TRACK[]\n"
        + ("\n".join(point_lines) + "\n" if point_lines else ""), encoding="utf-8")
    return directory

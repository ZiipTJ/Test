"""Manipulation des maillages produits par OpenMVS : mise a l'echelle et export.

OpenMVS travaille dans les unites arbitraires de COLMAP. C'est ici que le
facteur metrique determine par ``scale`` est applique, et que le modele est
decline dans les formats attendus par un logiciel de CAO.
"""

from __future__ import annotations

import shutil
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class MeshStats:
    vertices: int
    triangles: int
    bbox_min: np.ndarray
    bbox_max: np.ndarray

    @property
    def dimensions(self) -> np.ndarray:
        return self.bbox_max - self.bbox_min

    def summary(self, unit: str = "mm") -> str:
        dx, dy, dz = self.dimensions
        return (f"{self.vertices} sommets, {self.triangles} triangles\n"
                f"Encombrement : {dx:.2f} x {dy:.2f} x {dz:.2f} {unit}")


def _parse_face_indices(tokens: list[str], vertex_count: int) -> list[int]:
    """Extrait les indices de sommets d'une ligne ``f``, base 0.

    Le format OBJ autorise ``v``, ``v/vt``, ``v//vn`` et les indices negatifs
    relatifs a la fin du fichier.
    """
    indices = []
    for token in tokens:
        raw = int(token.split("/")[0])
        indices.append(raw - 1 if raw > 0 else vertex_count + raw)
    return indices


def read_obj(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Lit les sommets et les triangles d'un OBJ (les polygones sont triangules)."""
    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("v "):
                parts = line.split()
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith("f "):
                indices = _parse_face_indices(line.split()[1:], len(vertices))
                for k in range(1, len(indices) - 1):
                    triangles.append((indices[0], indices[k], indices[k + 1]))
    return (np.array(vertices, dtype=float).reshape(-1, 3),
            np.array(triangles, dtype=np.int64).reshape(-1, 3))


def mesh_stats(vertices: np.ndarray) -> MeshStats:
    if len(vertices) == 0:
        zero = np.zeros(3)
        return MeshStats(0, 0, zero, zero)
    return MeshStats(len(vertices), 0, vertices.min(axis=0), vertices.max(axis=0))


def scale_obj(source: str | Path, destination: str | Path, factor: float) -> MeshStats:
    """Recopie un OBJ en multipliant les coordonnees par ``factor``.

    Les normales et les coordonnees de texture sont invariantes par
    homothetie positive : seules les lignes ``v`` sont touchees. Le fichier
    de materiaux et les textures sont copies a cote.
    """
    if factor <= 0:
        raise ValueError("le facteur d'echelle doit etre strictement positif")
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    vertices: list[list[float]] = []
    with open(source, "r", encoding="utf-8", errors="replace") as src, \
            open(destination, "w", encoding="utf-8") as dst:
        for line in src:
            if line.startswith("v "):
                parts = line.split()
                scaled = [float(parts[i]) * factor for i in (1, 2, 3)]
                vertices.append(scaled)
                extra = " ".join(parts[4:])
                dst.write(f"v {scaled[0]:.6f} {scaled[1]:.6f} {scaled[2]:.6f}"
                          + (f" {extra}\n" if extra else "\n"))
            elif line.startswith("mtllib "):
                name = line.split(maxsplit=1)[1].strip()
                dst.write(f"mtllib {Path(name).name}\n")
            else:
                dst.write(line)

    _copy_material_files(source, destination)
    return mesh_stats(np.array(vertices, dtype=float).reshape(-1, 3))


def _copy_material_files(source: Path, destination: Path) -> None:
    """Copie le .mtl et les textures referencees a cote du nouvel OBJ."""
    if source.parent.resolve() == destination.parent.resolve():
        return
    for mtl in source.parent.glob(f"{source.stem}*.mtl"):
        shutil.copy2(mtl, destination.parent / mtl.name)
        for line in mtl.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip().lower().startswith("map_"):
                texture = source.parent / Path(line.split()[-1]).name
                if texture.exists():
                    shutil.copy2(texture, destination.parent / texture.name)


def write_binary_stl(path: str | Path, vertices: np.ndarray,
                     triangles: np.ndarray) -> Path:
    """Ecrit un STL binaire, format attendu par la CAO et l'impression 3D."""
    path = Path(path)
    corners = vertices[triangles]  # (T, 3, 3)
    normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0)

    with open(path, "wb") as handle:
        handle.write(b"PhotoScan3D - millimetres".ljust(80, b"\0"))
        handle.write(struct.pack("<I", len(triangles)))
        payload = np.hstack((normals, corners.reshape(-1, 9))).astype("<f4")
        for row in payload:
            handle.write(row.tobytes())
            handle.write(b"\0\0")
    return path


def export_stl_from_obj(obj_path: str | Path, stl_path: str | Path) -> MeshStats:
    vertices, triangles = read_obj(obj_path)
    write_binary_stl(stl_path, vertices, triangles)
    stats = mesh_stats(vertices)
    return MeshStats(stats.vertices, len(triangles), stats.bbox_min, stats.bbox_max)

"""Lecture des modeles COLMAP (formats binaire et texte).

Un modele COLMAP est un triplet de fichiers ``cameras``, ``images`` et
``points3D`` decrivant les intrinseques, les poses et le nuage epars.
Seule la lecture est necessaire : c'est COLMAP qui ecrit, nous exploitons.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# (nom, nombre de parametres) indexe par l'identifiant de modele COLMAP.
CAMERA_MODELS = {
    0: ("SIMPLE_PINHOLE", 3),
    1: ("PINHOLE", 4),
    2: ("SIMPLE_RADIAL", 4),
    3: ("RADIAL", 5),
    4: ("OPENCV", 8),
    5: ("OPENCV_FISHEYE", 8),
    6: ("FULL_OPENCV", 12),
    7: ("FOV", 5),
    8: ("SIMPLE_RADIAL_FISHEYE", 4),
    9: ("RADIAL_FISHEYE", 5),
    10: ("THIN_PRISM_FISHEYE", 12),
}
CAMERA_MODEL_IDS = {name: model_id for model_id, (name, _) in CAMERA_MODELS.items()}


class UnsupportedCameraModel(ValueError):
    """Modele de camera dont nous ne savons pas retirer la distorsion."""


@dataclass(frozen=True)
class Camera:
    id: int
    model: str
    width: int
    height: int
    params: np.ndarray

    @property
    def K(self) -> np.ndarray:
        """Matrice intrinseque 3x3."""
        fx, fy, cx, cy = self._pinhole_params()
        return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]])

    def _pinhole_params(self) -> tuple[float, float, float, float]:
        p = self.params
        if self.model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL", "RADIAL",
                          "SIMPLE_RADIAL_FISHEYE", "RADIAL_FISHEYE"):
            return float(p[0]), float(p[0]), float(p[1]), float(p[2])
        if self.model in ("PINHOLE", "OPENCV", "OPENCV_FISHEYE", "FULL_OPENCV",
                          "THIN_PRISM_FISHEYE"):
            return float(p[0]), float(p[1]), float(p[2]), float(p[3])
        raise UnsupportedCameraModel(self.model)

    def _distortion(self) -> np.ndarray:
        """Coefficients [k1, k2, p1, p2] du modele de distorsion radiale/tangentielle."""
        p = self.params
        if self.model in ("SIMPLE_PINHOLE", "PINHOLE"):
            return np.zeros(4)
        if self.model == "SIMPLE_RADIAL":
            return np.array([p[3], 0.0, 0.0, 0.0])
        if self.model == "RADIAL":
            return np.array([p[3], p[4], 0.0, 0.0])
        if self.model == "OPENCV":
            return np.array([p[4], p[5], p[6], p[7]])
        if self.model == "FULL_OPENCV":
            return np.array([p[4], p[5], p[6], p[7]])
        raise UnsupportedCameraModel(
            f"{self.model} : utilisez les images redressees par image_undistorter"
        )

    def normalize(self, points_2d: np.ndarray) -> np.ndarray:
        """Passe des pixels aux coordonnees camera normalisees, distorsion retiree.

        ``points_2d`` est un tableau (N, 2) en pixels ; le retour est (N, 2).
        """
        pts = np.asarray(points_2d, dtype=float).reshape(-1, 2)
        fx, fy, cx, cy = self._pinhole_params()
        xy = np.column_stack(((pts[:, 0] - cx) / fx, (pts[:, 1] - cy) / fy))
        k1, k2, p1, p2 = self._distortion()
        if not np.any([k1, k2, p1, p2]):
            return xy
        return _undistort_iterative(xy, k1, k2, p1, p2)


def _distort(xy: np.ndarray, k1: float, k2: float, p1: float, p2: float) -> np.ndarray:
    x, y = xy[:, 0], xy[:, 1]
    r2 = x * x + y * y
    radial = 1.0 + r2 * (k1 + k2 * r2)
    dx = 2.0 * p1 * x * y + p2 * (r2 + 2.0 * x * x)
    dy = p1 * (r2 + 2.0 * y * y) + 2.0 * p2 * x * y
    return np.column_stack((x * radial + dx, y * radial + dy))


def _undistort_iterative(xy: np.ndarray, k1: float, k2: float, p1: float, p2: float,
                         iterations: int = 20) -> np.ndarray:
    """Inverse le modele de distorsion par iterations de point fixe amorties."""
    undistorted = xy.copy()
    for _ in range(iterations):
        residual = _distort(undistorted, k1, k2, p1, p2) - xy
        undistorted -= residual
        if np.max(np.abs(residual)) < 1e-10:
            break
    return undistorted


@dataclass(frozen=True)
class Image:
    id: int
    qvec: np.ndarray  # quaternion (w, x, y, z), monde -> camera
    tvec: np.ndarray
    camera_id: int
    name: str
    xys: np.ndarray
    point3D_ids: np.ndarray

    @property
    def R(self) -> np.ndarray:
        return qvec_to_rotmat(self.qvec)

    @property
    def projection_matrix(self) -> np.ndarray:
        """Matrice 3x4 [R|t] agissant sur des coordonnees normalisees."""
        return np.hstack((self.R, self.tvec.reshape(3, 1)))

    @property
    def center(self) -> np.ndarray:
        """Position de la camera dans le repere monde."""
        return -self.R.T @ self.tvec


@dataclass(frozen=True)
class Point3D:
    id: int
    xyz: np.ndarray
    rgb: np.ndarray
    error: float
    track: np.ndarray  # paires (image_id, point2D_idx)


@dataclass
class Reconstruction:
    cameras: dict[int, Camera]
    images: dict[int, Image]
    points3D: dict[int, Point3D]

    @property
    def mean_reprojection_error(self) -> float:
        if not self.points3D:
            return float("nan")
        return float(np.mean([p.error for p in self.points3D.values()]))

    @property
    def mean_track_length(self) -> float:
        if not self.points3D:
            return float("nan")
        return float(np.mean([len(p.track) for p in self.points3D.values()]))

    def image_by_name(self, name: str) -> Image | None:
        for image in self.images.values():
            if image.name == name:
                return image
        return None


def qvec_to_rotmat(qvec: np.ndarray) -> np.ndarray:
    w, x, y, z = (float(v) for v in qvec)
    return np.array([
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y],
        [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
        [2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y],
    ])


def rotmat_to_qvec(R: np.ndarray) -> np.ndarray:
    trace = np.trace(R)
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        q = np.array([0.25 / s, (R[2, 1] - R[1, 2]) * s,
                      (R[0, 2] - R[2, 0]) * s, (R[1, 0] - R[0, 1]) * s])
    else:
        i = int(np.argmax(np.diag(R)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = 2.0 * np.sqrt(1.0 + R[i, i] - R[j, j] - R[k, k])
        q = np.empty(4)
        q[0] = (R[k, j] - R[j, k]) / s
        q[i + 1] = 0.25 * s
        q[j + 1] = (R[j, i] + R[i, j]) / s
        q[k + 1] = (R[k, i] + R[i, k]) / s
    return q / np.linalg.norm(q)


# --------------------------------------------------------------------------
# Lecture binaire
# --------------------------------------------------------------------------

def _read(fid, fmt: str):
    size = struct.calcsize(fmt)
    data = fid.read(size)
    if len(data) != size:
        raise EOFError("fichier COLMAP tronque")
    return struct.unpack(fmt, data)


def _read_cameras_bin(path: Path) -> dict[int, Camera]:
    cameras: dict[int, Camera] = {}
    with open(path, "rb") as fid:
        (count,) = _read(fid, "<Q")
        for _ in range(count):
            camera_id, model_id, width, height = _read(fid, "<iiQQ")
            model, num_params = CAMERA_MODELS[model_id]
            params = np.array(_read(fid, f"<{num_params}d"))
            cameras[camera_id] = Camera(camera_id, model, width, height, params)
    return cameras


def _read_images_bin(path: Path) -> dict[int, Image]:
    images: dict[int, Image] = {}
    with open(path, "rb") as fid:
        (count,) = _read(fid, "<Q")
        for _ in range(count):
            image_id, qw, qx, qy, qz, tx, ty, tz, camera_id = _read(fid, "<idddddddi")
            name_bytes = bytearray()
            while True:
                char = fid.read(1)
                if char in (b"\x00", b""):
                    break
                name_bytes += char
            (num_points,) = _read(fid, "<Q")
            flat = np.array(_read(fid, "<" + "ddq" * num_points)) if num_points else np.empty(0)
            flat = flat.reshape(-1, 3)
            images[image_id] = Image(
                id=image_id,
                qvec=np.array([qw, qx, qy, qz]),
                tvec=np.array([tx, ty, tz]),
                camera_id=camera_id,
                name=name_bytes.decode("utf-8"),
                xys=flat[:, :2].copy() if num_points else np.empty((0, 2)),
                point3D_ids=flat[:, 2].astype(np.int64) if num_points else np.empty(0, np.int64),
            )
    return images


def _read_points3D_bin(path: Path) -> dict[int, Point3D]:
    points: dict[int, Point3D] = {}
    with open(path, "rb") as fid:
        (count,) = _read(fid, "<Q")
        for _ in range(count):
            point_id, x, y, z, r, g, b, error = _read(fid, "<QdddBBBd")
            (track_length,) = _read(fid, "<Q")
            track = np.array(_read(fid, "<" + "ii" * track_length)).reshape(-1, 2) \
                if track_length else np.empty((0, 2), np.int64)
            points[point_id] = Point3D(point_id, np.array([x, y, z]),
                                       np.array([r, g, b]), error, track)
    return points


# --------------------------------------------------------------------------
# Lecture texte
# --------------------------------------------------------------------------

def _iter_data_lines(path: Path):
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith("#"):
                yield line


def _read_cameras_txt(path: Path) -> dict[int, Camera]:
    cameras: dict[int, Camera] = {}
    for line in _iter_data_lines(path):
        parts = line.split()
        camera_id, model = int(parts[0]), parts[1]
        cameras[camera_id] = Camera(camera_id, model, int(parts[2]), int(parts[3]),
                                    np.array([float(v) for v in parts[4:]]))
    return cameras


def _read_images_txt(path: Path) -> dict[int, Image]:
    """Lit ``images.txt``, ou chaque image occupe deux lignes.

    La seconde ligne (les observations 2D) est vide lorsque le modele a ete
    exporte sans les points ; elle ne peut donc pas etre ignoree comme une
    ligne blanche sans desynchroniser la lecture.
    """
    with open(path, "r", encoding="utf-8") as handle:
        lines = [line.rstrip("\n") for line in handle
                 if not line.lstrip().startswith("#")]

    images: dict[int, Image] = {}
    index = 0
    while index < len(lines):
        header = lines[index].strip()
        index += 1
        if not header:
            continue
        observations = lines[index].strip() if index < len(lines) else ""
        index += 1

        parts = header.split()
        image_id = int(parts[0])
        values = observations.split()
        flat = np.array([float(v) for v in values]).reshape(-1, 3) if values \
            else np.empty((0, 3))
        images[image_id] = Image(
            id=image_id,
            qvec=np.array([float(v) for v in parts[1:5]]),
            tvec=np.array([float(v) for v in parts[5:8]]),
            camera_id=int(parts[8]),
            name=" ".join(parts[9:]),
            xys=flat[:, :2].copy(),
            point3D_ids=flat[:, 2].astype(np.int64),
        )
    return images


def _read_points3D_txt(path: Path) -> dict[int, Point3D]:
    points: dict[int, Point3D] = {}
    for line in _iter_data_lines(path):
        parts = line.split()
        point_id = int(parts[0])
        track = np.array([int(v) for v in parts[8:]]).reshape(-1, 2) \
            if len(parts) > 8 else np.empty((0, 2), np.int64)
        points[point_id] = Point3D(
            point_id,
            np.array([float(v) for v in parts[1:4]]),
            np.array([int(v) for v in parts[4:7]]),
            float(parts[7]),
            track,
        )
    return points


def read_model(model_dir: str | Path) -> Reconstruction:
    """Charge un modele COLMAP, en detectant le format binaire ou texte."""
    model_dir = Path(model_dir)
    if (model_dir / "cameras.bin").exists():
        return Reconstruction(
            cameras=_read_cameras_bin(model_dir / "cameras.bin"),
            images=_read_images_bin(model_dir / "images.bin"),
            points3D=_read_points3D_bin(model_dir / "points3D.bin"),
        )
    if (model_dir / "cameras.txt").exists():
        return Reconstruction(
            cameras=_read_cameras_txt(model_dir / "cameras.txt"),
            images=_read_images_txt(model_dir / "images.txt"),
            points3D=_read_points3D_txt(model_dir / "points3D.txt"),
        )
    raise FileNotFoundError(f"aucun modele COLMAP dans {model_dir}")


def find_largest_model(sparse_dir: str | Path) -> Path:
    """Retourne le sous-modele contenant le plus d'images alignees.

    Le mapper COLMAP produit ``sparse/0``, ``sparse/1``... quand la scene se
    fragmente ; le plus gros est celui qui nous interesse.
    """
    sparse_dir = Path(sparse_dir)
    candidates = [d for d in sorted(sparse_dir.iterdir()) if d.is_dir()] \
        if sparse_dir.is_dir() else []
    if not candidates:
        raise FileNotFoundError(f"aucune reconstruction dans {sparse_dir}")
    best, best_count = None, -1
    for candidate in candidates:
        try:
            count = len(read_model(candidate).images)
        except (FileNotFoundError, EOFError, KeyError):
            continue
        if count > best_count:
            best, best_count = candidate, count
    if best is None:
        raise FileNotFoundError(f"aucune reconstruction lisible dans {sparse_dir}")
    return best

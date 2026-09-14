"""Mise a l'echelle metrique d'une reconstruction par marqueurs ArUco.

La photogrammetrie ne restitue la scene qu'a un facteur d'echelle pres. Ce
module triangule les coins des marqueurs dans le repere arbitraire de
COLMAP, les recale sur la geometrie connue de la planche imprimee, et en
deduit le facteur « unites du modele -> millimetres » ainsi qu'une mesure
honnete de l'incertitude qui l'accompagne.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .colmap_io import Reconstruction
from .markers import BoardSpec

# Un coin triangule sous un angle trop faible est mal contraint en profondeur.
MIN_TRIANGULATION_ANGLE_DEG = 3.0
MAX_REPROJECTION_ERROR_PX = 2.0
MIN_VIEWS_PER_CORNER = 3
# Seules les paires suffisamment eloignees servent a estimer la dispersion :
# sur une base courte, le bruit de triangulation domine la mesure.
MIN_BASELINE_RATIO = 0.8
# Plancher d'incertitude relative. Le residu de recalage et la dispersion ne
# voient que les erreurs aleatoires ; la localisation des coins de marqueurs
# et l'impression de la planche introduisent en plus un biais systematique,
# mesure autour de 0,1 % sur des images de synthese exemptes de tout autre
# defaut. Annoncer mieux serait mentir.
SYSTEMATIC_FLOOR_RELATIVE = 1e-3


@dataclass(frozen=True)
class MarkerObservation:
    """Les quatre coins d'un marqueur detectes dans une image donnee."""

    image_id: int
    marker_id: int
    corners_px: np.ndarray  # (4, 2), ordre aruco : HG, HD, BD, BG


@dataclass
class ScaleResult:
    """Facteur d'echelle et diagnostics associes."""

    scale_mm_per_unit: float
    n_markers: int
    n_corners: int
    n_images: int
    fit_rms_mm: float
    relative_std: float
    planarity_mm: float
    baseline_mm: float
    warnings: list[str] = field(default_factory=list)

    @property
    def expected_accuracy_mm(self) -> float:
        """Incertitude indicative sur une cote de l'ordre de la base de mesure.

        On combine l'erreur de recalage, la dispersion mesuree et un plancher
        systematique incompressible : c'est un ordre de grandeur de controle,
        pas une incertitude normative.
        """
        relative = max(self.relative_std, SYSTEMATIC_FLOOR_RELATIVE)
        return float(np.hypot(self.fit_rms_mm, relative * self.baseline_mm))

    def summary(self) -> str:
        lines = [
            f"Echelle          : {self.scale_mm_per_unit:.6g} mm/unite",
            f"Marqueurs        : {self.n_markers} ({self.n_corners} coins tries)"
            f" sur {self.n_images} images",
            f"Residu de recalage : {self.fit_rms_mm:.3f} mm RMS",
            f"Dispersion        : {self.relative_std * 100:.3f} %",
            f"Planeite planche  : {self.planarity_mm:.3f} mm d'ecart max",
            f"Incertitude indicative : +/- {self.expected_accuracy_mm:.2f} mm"
            f" sur {self.baseline_mm:.0f} mm",
        ]
        return "\n".join(lines)


class ScaleEstimationError(RuntimeError):
    """L'echelle n'a pas pu etre determinee de facon fiable."""


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------

def detect_markers(image_path: str | Path, spec: BoardSpec,
                   max_width: int = 3000) -> dict[int, np.ndarray]:
    """Detecte les marqueurs de la planche dans une image.

    Retourne ``{marker_id: coins (4, 2) en pixels de l'image d'origine}``.
    L'image est reduite pour la detection puis les coins sont ramenes a
    l'echelle initiale, le raffinement sous-pixel etant fait a pleine
    resolution.
    """
    import cv2

    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(f"image illisible : {image_path}")

    scale = min(1.0, max_width / image.shape[1])
    working = cv2.resize(image, None, fx=scale, fy=scale,
                         interpolation=cv2.INTER_AREA) if scale < 1.0 else image

    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, spec.dictionary))
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    corners, ids, _ = cv2.aruco.ArucoDetector(dictionary, params).detectMarkers(working)
    if ids is None:
        return {}

    valid = set(spec.marker_ids)
    detections: dict[int, np.ndarray] = {}
    for corner_set, marker_id in zip(corners, ids.flatten()):
        marker_id = int(marker_id)
        if marker_id not in valid:
            continue
        points = corner_set.reshape(4, 2).astype(np.float32) / scale
        if scale < 1.0:
            # Raffinement final dans l'image pleine resolution.
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.01)
            points = cv2.cornerSubPix(image, points, (7, 7), (-1, -1), criteria)
        detections[marker_id] = points.reshape(4, 2).astype(float)
    return detections


def detect_in_reconstruction(rec: Reconstruction, image_dir: str | Path,
                             spec: BoardSpec,
                             progress=None) -> list[MarkerObservation]:
    """Detecte les marqueurs dans toutes les images alignees par COLMAP."""
    image_dir = Path(image_dir)
    observations: list[MarkerObservation] = []
    images = sorted(rec.images.values(), key=lambda img: img.name)
    for index, image in enumerate(images):
        path = image_dir / image.name
        if not path.exists():
            continue
        for marker_id, corners in detect_markers(path, spec).items():
            observations.append(MarkerObservation(image.id, marker_id, corners))
        if progress is not None:
            progress(index + 1, len(images))
    return observations


# --------------------------------------------------------------------------
# Geometrie
# --------------------------------------------------------------------------

def triangulate(projections: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Triangulation DLT multi-vues.

    ``projections`` : (M, 3, 4) matrices [R|t] agissant sur des coordonnees
    normalisees. ``points`` : (M, 2) observations normalisees correspondantes.
    """
    rows = []
    for P, (x, y) in zip(projections, points):
        rows.append(x * P[2] - P[0])
        rows.append(y * P[2] - P[1])
    _, _, Vt = np.linalg.svd(np.asarray(rows))
    homogeneous = Vt[-1]
    if abs(homogeneous[3]) < 1e-12:
        raise ScaleEstimationError("point a l'infini : geometrie degeneree")
    return homogeneous[:3] / homogeneous[3]


def _reprojection_errors(projections: np.ndarray, points: np.ndarray,
                         X: np.ndarray) -> np.ndarray:
    homogeneous = np.append(X, 1.0)
    projected = projections @ homogeneous  # (M, 3)
    depths = projected[:, 2]
    if np.any(depths <= 0):
        return np.full(len(points), np.inf)
    return np.linalg.norm(projected[:, :2] / depths[:, None] - points, axis=1)


def _max_ray_angle_deg(centers: np.ndarray, X: np.ndarray) -> float:
    rays = X - centers
    norms = np.linalg.norm(rays, axis=1, keepdims=True)
    if np.any(norms < 1e-12):
        return 0.0
    rays = rays / norms
    cosines = np.clip(rays @ rays.T, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosines.min())))


def umeyama_similarity(source: np.ndarray, target: np.ndarray
                       ) -> tuple[float, np.ndarray, np.ndarray, float]:
    """Recalage par similitude (Umeyama 1991) : target ~= s * R @ source + t.

    Retourne ``(s, R, t, rms)``, le RMS etant exprime dans l'unite de
    ``target``.
    """
    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)
    if source.shape != target.shape or source.shape[0] < 3:
        raise ScaleEstimationError("recalage impossible : correspondances insuffisantes")

    n = source.shape[0]
    mu_source, mu_target = source.mean(axis=0), target.mean(axis=0)
    source_c, target_c = source - mu_source, target - mu_target
    variance = float((source_c ** 2).sum() / n)
    if variance < 1e-18:
        raise ScaleEstimationError("recalage impossible : points confondus")

    covariance = (target_c.T @ source_c) / n
    U, D, Vt = np.linalg.svd(covariance)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1.0
    R = U @ S @ Vt
    s = float(np.trace(np.diag(D) @ S) / variance)
    t = mu_target - s * R @ mu_source
    residuals = target - (s * (R @ source.T).T + t)
    rms = float(np.sqrt((residuals ** 2).sum() / n))
    return s, R, t, rms


def _planarity_mm(points_mm: np.ndarray) -> float:
    """Ecart maximal a un plan ajuste, en mm : detecte une planche gondolee."""
    centered = points_mm - points_mm.mean(axis=0)
    _, _, Vt = np.linalg.svd(centered)
    return float(np.abs(centered @ Vt[2]).max())


def _pairwise_relative_std(reconstructed: np.ndarray, expected: np.ndarray,
                           min_baseline: float) -> float:
    """Dispersion relative des rapports de distances sur les longues bases."""
    expected_d = np.linalg.norm(expected[:, None, :] - expected[None, :, :], axis=-1)
    measured_d = np.linalg.norm(
        reconstructed[:, None, :] - reconstructed[None, :, :], axis=-1)
    iu = np.triu_indices(len(expected), k=1)
    expected_d, measured_d = expected_d[iu], measured_d[iu]
    keep = (expected_d >= min_baseline) & (measured_d > 1e-12)
    if keep.sum() < 3:
        return float("nan")
    ratios = expected_d[keep] / measured_d[keep]
    median = float(np.median(ratios))
    # Ecart-type robuste (MAD normalise) : insensible aux quelques coins faux.
    mad = float(np.median(np.abs(ratios - median)))
    return 1.4826 * mad / median if median > 0 else float("nan")


# --------------------------------------------------------------------------
# Estimation
# --------------------------------------------------------------------------

def triangulate_corners(rec: Reconstruction, observations: list[MarkerObservation],
                        spec: BoardSpec) -> tuple[np.ndarray, np.ndarray, list[int], list[str]]:
    """Triangule chaque coin de marqueur vu dans assez d'images.

    Retourne les coins reconstruits (unites du modele), les coins attendus
    (mm), les identifiants de marqueurs retenus et les avertissements.
    """
    board = spec.corner_positions()
    warnings: list[str] = []

    grouped: dict[tuple[int, int], list[tuple[int, np.ndarray]]] = {}
    for observation in observations:
        if observation.marker_id not in board:
            continue
        for corner_index in range(4):
            grouped.setdefault((observation.marker_id, corner_index), []).append(
                (observation.image_id, observation.corners_px[corner_index]))

    focals = [rec.cameras[img.camera_id].K[0, 0] for img in rec.images.values()]
    mean_focal = float(np.mean(focals)) if focals else 1.0
    max_error = MAX_REPROJECTION_ERROR_PX / mean_focal

    reconstructed, expected, marker_ids = [], [], []
    rejected_views = rejected_angle = rejected_error = 0
    for (marker_id, corner_index), views in sorted(grouped.items()):
        if len(views) < MIN_VIEWS_PER_CORNER:
            rejected_views += 1
            continue
        projections, normalized, centers = [], [], []
        for image_id, corner_px in views:
            image = rec.images[image_id]
            camera = rec.cameras[image.camera_id]
            projections.append(image.projection_matrix)
            normalized.append(camera.normalize(corner_px)[0])
            centers.append(image.center)
        projections = np.array(projections)
        normalized = np.array(normalized)

        try:
            X = triangulate(projections, normalized)
        except (ScaleEstimationError, np.linalg.LinAlgError):
            rejected_error += 1
            continue
        if _max_ray_angle_deg(np.array(centers), X) < MIN_TRIANGULATION_ANGLE_DEG:
            rejected_angle += 1
            continue
        errors = _reprojection_errors(projections, normalized, X)
        if np.median(errors) > max_error:
            rejected_error += 1
            continue

        reconstructed.append(X)
        expected.append(board[marker_id][corner_index])
        marker_ids.append(marker_id)

    if rejected_views:
        warnings.append(
            f"{rejected_views} coins vus dans moins de {MIN_VIEWS_PER_CORNER} images ignores")
    if rejected_angle:
        warnings.append(
            f"{rejected_angle} coins ecartes : angle de triangulation trop faible")
    if rejected_error:
        warnings.append(f"{rejected_error} coins ecartes : reprojection incoherente")

    return np.array(reconstructed), np.array(expected), marker_ids, warnings


def estimate_scale(rec: Reconstruction, observations: list[MarkerObservation],
                   spec: BoardSpec) -> ScaleResult:
    """Determine le facteur d'echelle metrique et son incertitude."""
    reconstructed, expected, marker_ids, warnings = triangulate_corners(
        rec, observations, spec)
    if len(reconstructed) < 6:
        raise ScaleEstimationError(
            f"seulement {len(reconstructed)} coins exploitables : la planche est-elle "
            "visible et nette dans plusieurs photos ?")

    scale, R, t, rms = umeyama_similarity(reconstructed, expected)

    # Rejet des correspondances aberrantes, puis recalage definitif.
    residuals = np.linalg.norm(
        expected - (scale * (R @ reconstructed.T).T + t), axis=1)
    threshold = max(3.0 * float(np.median(residuals)), 0.05 * spec.marker_mm)
    keep = residuals <= threshold
    if keep.sum() < len(keep) and keep.sum() >= 6:
        warnings.append(f"{int((~keep).sum())} coins aberrants ecartes du recalage")
        reconstructed, expected = reconstructed[keep], expected[keep]
        marker_ids = [mid for mid, k in zip(marker_ids, keep) if k]
        scale, R, t, rms = umeyama_similarity(reconstructed, expected)

    fitted_mm = scale * (R @ reconstructed.T).T + t
    planarity = _planarity_mm(fitted_mm)
    relative_std = _pairwise_relative_std(
        reconstructed, expected, MIN_BASELINE_RATIO * spec.marker_mm)

    used_markers = sorted(set(marker_ids))
    used_images = {o.image_id for o in observations if o.marker_id in set(used_markers)}

    if len(used_markers) < 2:
        warnings.append(
            "un seul marqueur exploite : base de mesure tres courte, "
            "l'echelle sera peu precise")
    if rms > 0.02 * spec.marker_mm:
        warnings.append(
            f"residu de recalage eleve ({rms:.2f} mm) : planche gondolee, "
            "deplacee en cours de prise de vue, ou taille de marqueur mal saisie")
    if planarity > 0.02 * spec.marker_mm:
        warnings.append(
            f"planche non plane ({planarity:.2f} mm) : la coller sur un support rigide")

    baseline = float(np.linalg.norm(expected.max(axis=0) - expected.min(axis=0)))
    return ScaleResult(
        scale_mm_per_unit=scale,
        n_markers=len(used_markers),
        n_corners=len(reconstructed),
        n_images=len(used_images),
        fit_rms_mm=rms,
        relative_std=0.0 if np.isnan(relative_std) else relative_std,
        planarity_mm=planarity,
        baseline_mm=baseline,
        warnings=warnings,
    )

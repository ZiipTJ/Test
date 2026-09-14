"""Test de bout en bout de la chaine metrique sur des images synthetisees.

On fabrique de vraies images d'une planche ArUco vue sous plusieurs angles,
on les fait passer par la detection OpenCV puis par l'estimation d'echelle,
et on verifie que la dimension imposee est retrouvee. C'est le seul test qui
exerce le detecteur lui-meme.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from photoscan3d.colmap_io import read_model, rotmat_to_qvec
from photoscan3d.images import inspect_images, prepare_images
from photoscan3d.markers import MM_PER_INCH, BoardSpec, render_board
from photoscan3d.scale import MarkerObservation, detect_markers, estimate_scale
from tests.synthetic import look_at, write_model

WIDTH, HEIGHT = 1600, 1200
BOARD_DPI = 200
MARGIN_MM = 10.0
TRUE_SCALE = 0.25  # mm par unite du modele


def _render_views(spec: BoardSpec, directory: Path):
    """Rend la planche vue par plusieurs cameras virtuelles sans distorsion.

    La planche etant plane, chaque vue s'obtient exactement par une
    homographie appliquee a l'image de la planche.
    """
    import cv2

    board_image = render_board(spec, dpi=BOARD_DPI, margin_mm=MARGIN_MM)
    px_per_mm = BOARD_DPI / MM_PER_INCH
    height_px, width_px = board_image.shape
    source_corners = np.float32([[0, 0], [width_px, 0],
                                 [width_px, height_px], [0, height_px]])
    # Coins de l'image de planche, exprimes en mm dans le repere planche.
    corners_mm = np.array([
        [-MARGIN_MM, -MARGIN_MM],
        [width_px / px_per_mm - MARGIN_MM, -MARGIN_MM],
        [width_px / px_per_mm - MARGIN_MM, height_px / px_per_mm - MARGIN_MM],
        [-MARGIN_MM, height_px / px_per_mm - MARGIN_MM],
    ])
    corners_units = np.column_stack(
        (corners_mm / TRUE_SCALE, np.zeros(len(corners_mm))))

    focal = 0.9 * WIDTH
    K = np.array([[focal, 0, WIDTH / 2], [0, focal, HEIGHT / 2], [0, 0, 1.0]])
    center = np.append(
        np.array([spec.width_mm, spec.height_mm]) / 2 / TRUE_SCALE, 0.0)
    radius = 1.4 * spec.diagonal_mm / TRUE_SCALE

    views = []
    # Les marqueurs sont dessines avec l'axe y vers le bas dans le plan z = 0 :
    # leur face imprimee regarde donc vers les z negatifs. Vues du mauvais
    # cote, ils apparaitraient en miroir et ne seraient pas decodables.
    for elevation in (-35.0, -60.0):
        for k in range(12):
            theta = 2 * np.pi * k / 12
            phi = np.radians(elevation)
            eye = center + radius * np.array([
                np.cos(phi) * np.cos(theta), np.cos(phi) * np.sin(theta), np.sin(phi)])
            R, t = look_at(eye, center)
            camera_points = (R @ corners_units.T).T + t
            pixels = (K @ (camera_points / camera_points[:, 2:3]).T).T[:, :2]

            H = cv2.getPerspectiveTransform(source_corners, pixels.astype(np.float32))
            view = cv2.warpPerspective(board_image, H, (WIDTH, HEIGHT),
                                       flags=cv2.INTER_AREA,
                                       borderMode=cv2.BORDER_CONSTANT,
                                       borderValue=200)
            views.append((R, t, view))

    paths = []
    for index, (_, _, view) in enumerate(views, start=1):
        path = directory / f"vue{index:03d}.jpg"
        cv2.imwrite(str(path), view, [cv2.IMWRITE_JPEG_QUALITY, 96])
        paths.append(path)
    return views, paths, focal


class EndToEndScaleTest(unittest.TestCase):
    spec = BoardSpec(rows=3, cols=4, marker_mm=40.0, gap_mm=12.0)

    def test_scale_is_recovered_from_rendered_photographs(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            photos = tmp / "photos"
            photos.mkdir()
            views, paths, focal = _render_views(self.spec, photos)

            camera_lines = [f"1 PINHOLE {WIDTH} {HEIGHT} {focal} {focal} "
                            f"{WIDTH / 2} {HEIGHT / 2}"]
            image_lines = []
            observations = []
            for index, ((R, t, _), path) in enumerate(zip(views, paths), start=1):
                q = rotmat_to_qvec(R)
                image_lines.append(
                    f"{index} {q[0]} {q[1]} {q[2]} {q[3]} {t[0]} {t[1]} {t[2]} "
                    f"1 {path.name}")
                image_lines.append("")
                for marker_id, corners in detect_markers(path, self.spec).items():
                    observations.append(MarkerObservation(index, marker_id, corners))

            rec = read_model(write_model(tmp / "sparse", camera_lines, image_lines))
            result = estimate_scale(rec, observations, self.spec)

        # Les 12 marqueurs doivent etre vus dans la grande majorite des vues.
        self.assertGreater(len(observations), 12 * len(views) * 0.8)
        self.assertEqual(result.n_markers, 12)
        relative_error = abs(result.scale_mm_per_unit - TRUE_SCALE) / TRUE_SCALE
        self.assertLess(relative_error, 5e-3, f"erreur d'echelle {relative_error:.2%}")
        self.assertLess(result.fit_rms_mm, 1.0)
        self.assertLess(result.expected_accuracy_mm, 2.0)

    def test_photo_inspection_and_preparation_on_rendered_views(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            photos = tmp / "photos"
            photos.mkdir()
            _, paths, _ = _render_views(self.spec, photos)

            report = inspect_images(paths)
            prepared = prepare_images(paths, tmp / "prep", max_size=800)

        # 24 vues : au-dessus du minimum absolu, en dessous du recommande.
        self.assertFalse(report.has_blocking_issue)
        self.assertTrue(any("insuffisant pour" in d.message
                            for d in report.diagnostics))
        self.assertTrue(report.uniform_optics)
        self.assertEqual(len(prepared), len(paths))
        self.assertTrue(all(path.suffix == ".jpg" for path in prepared))


if __name__ == "__main__":
    unittest.main()

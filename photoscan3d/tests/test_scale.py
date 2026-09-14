"""Verifie que la chaine retrouve une echelle vraie imposee."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from photoscan3d.colmap_io import read_model
from photoscan3d.markers import BoardSpec
from photoscan3d.scale import (ScaleEstimationError, estimate_scale,
                               triangulate, umeyama_similarity)
from tests.synthetic import build_scene, write_model


class UmeyamaTest(unittest.TestCase):
    def test_recovers_known_similarity(self):
        rng = np.random.default_rng(3)
        source = rng.normal(size=(40, 3))
        angle = 0.9
        R_true = np.array([[np.cos(angle), -np.sin(angle), 0],
                           [np.sin(angle), np.cos(angle), 0],
                           [0, 0, 1.0]])
        target = 7.25 * (R_true @ source.T).T + np.array([2.0, -3.0, 0.5])

        scale, R, t, rms = umeyama_similarity(source, target)

        self.assertAlmostEqual(scale, 7.25, places=9)
        np.testing.assert_allclose(R, R_true, atol=1e-9)
        self.assertLess(rms, 1e-9)

    def test_handles_coplanar_points(self):
        """La planche est plane : le recalage doit rester bien defini."""
        rng = np.random.default_rng(5)
        source = np.column_stack((rng.normal(size=(30, 2)), np.zeros(30)))
        target = 0.4 * source + np.array([1.0, 1.0, 1.0])

        scale, _, _, rms = umeyama_similarity(source, target)

        self.assertAlmostEqual(scale, 0.4, places=9)
        self.assertLess(rms, 1e-9)

    def test_rejects_degenerate_input(self):
        with self.assertRaises(ScaleEstimationError):
            umeyama_similarity(np.zeros((2, 3)), np.zeros((2, 3)))


class TriangulationTest(unittest.TestCase):
    def test_recovers_point_from_three_views(self):
        from tests.synthetic import look_at

        X = np.array([0.3, -0.2, 1.1])
        projections, observations = [], []
        for eye in ([3.0, 0.0, 1.0], [0.0, 3.0, 1.2], [-2.0, -2.0, 0.9]):
            R, t = look_at(np.array(eye), X)
            camera_point = R @ X + t
            projections.append(np.hstack((R, t.reshape(3, 1))))
            observations.append(camera_point[:2] / camera_point[2])

        recovered = triangulate(np.array(projections), np.array(observations))

        np.testing.assert_allclose(recovered, X, atol=1e-9)


class ScaleEstimationTest(unittest.TestCase):
    spec = BoardSpec(rows=3, cols=4, marker_mm=40.0, gap_mm=12.0)

    def _run(self, scale_mm_per_unit, noise_px, **kwargs):
        cameras, images, observations, _ = build_scene(
            self.spec, scale_mm_per_unit, noise_px=noise_px, **kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            model_dir = write_model(Path(tmp) / "sparse", cameras, images)
            rec = read_model(model_dir)
        return estimate_scale(rec, observations, self.spec)

    def test_exact_scene_is_recovered_to_machine_precision(self):
        result = self._run(0.25, noise_px=0.0)

        self.assertAlmostEqual(result.scale_mm_per_unit, 0.25, places=7)
        self.assertLess(result.fit_rms_mm, 1e-5)
        self.assertLess(result.planarity_mm, 1e-5)
        self.assertEqual(result.n_markers, 12)
        self.assertEqual(result.n_corners, 48)

    def test_realistic_noise_stays_under_one_per_mille(self):
        """0,3 px de bruit de detection : l'erreur d'echelle doit rester < 0,1 %."""
        result = self._run(0.25, noise_px=0.3)

        relative_error = abs(result.scale_mm_per_unit - 0.25) / 0.25
        self.assertLess(relative_error, 1e-3)
        self.assertLess(result.fit_rms_mm, 0.5)

    def test_scale_is_independent_of_model_units(self):
        """Le meme scan exprime dans d'autres unites doit donner la meme metrique."""
        fine = self._run(0.25, noise_px=0.0)
        coarse = self._run(4.0, noise_px=0.0)

        self.assertAlmostEqual(fine.scale_mm_per_unit, 0.25, places=7)
        self.assertAlmostEqual(coarse.scale_mm_per_unit, 4.0, places=6)
        self.assertAlmostEqual(fine.baseline_mm, coarse.baseline_mm, places=6)

    def test_uniformly_larger_board_scales_the_result_proportionally(self):
        """Une planche homothetique de 2,5 % deplace l'echelle de 2,5 %."""
        cameras, images, observations, _ = build_scene(self.spec, 0.25, noise_px=0.0)
        with tempfile.TemporaryDirectory() as tmp:
            rec = read_model(write_model(Path(tmp) / "sparse", cameras, images))
        larger = BoardSpec(rows=3, cols=4, marker_mm=41.0, gap_mm=12.3)

        result = estimate_scale(rec, observations, larger)

        self.assertAlmostEqual(result.scale_mm_per_unit / 0.25, 1.025, places=6)
        self.assertLess(result.fit_rms_mm, 1e-5)

    def test_inconsistent_board_shows_up_in_the_residual(self):
        """Une geometrie de planche fausse mais non homothetique laisse un residu."""
        cameras, images, observations, _ = build_scene(self.spec, 0.25, noise_px=0.0)
        with tempfile.TemporaryDirectory() as tmp:
            rec = read_model(write_model(Path(tmp) / "sparse", cameras, images))
        exact = estimate_scale(rec, observations, self.spec)

        # Taille de marqueur fausse sans corriger l'espacement : la planche
        # decrite ne peut plus coincider avec celle qui a ete photographiee.
        inconsistent = estimate_scale(
            rec, observations, BoardSpec(rows=3, cols=4, marker_mm=41.0, gap_mm=12.0))

        self.assertGreater(inconsistent.fit_rms_mm, 10 * max(exact.fit_rms_mm, 1e-6))
        self.assertGreater(inconsistent.fit_rms_mm, 0.1)

    def test_too_few_observations_is_reported(self):
        cameras, images, observations, _ = build_scene(self.spec, 0.25, noise_px=0.0)
        with tempfile.TemporaryDirectory() as tmp:
            rec = read_model(write_model(Path(tmp) / "sparse", cameras, images))

        with self.assertRaises(ScaleEstimationError):
            estimate_scale(rec, observations[:1], self.spec)


if __name__ == "__main__":
    unittest.main()

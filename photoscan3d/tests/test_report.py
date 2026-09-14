"""Le rapport doit rester lisible et honnete, avec ou sans echelle."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from photoscan3d.config import Settings
from photoscan3d.mesh import MeshStats
from photoscan3d.pipeline import PipelineResult
from photoscan3d.report import build_html, write_report
from photoscan3d.scale import ScaleResult


def _result(scale: ScaleResult | None) -> PipelineResult:
    return PipelineResult(
        output_dir=Path("/tmp/scan_piece"),
        obj_path=Path("/tmp/scan_piece/modele_mm.obj"),
        stl_path=Path("/tmp/scan_piece/modele_mm.stl"),
        scale=scale,
        stats=MeshStats(1000, 1800, np.zeros(3), np.array([80.0, 40.0, 20.0])),
        registered_images=96,
        total_images=100,
        reprojection_error_px=0.62,
        duration_s=4200.0,
        warnings=["planche non plane (0,9 mm)"],
    )


def _scale(accuracy_driver: float) -> ScaleResult:
    return ScaleResult(scale_mm_per_unit=0.25, n_markers=12, n_corners=48,
                       n_images=90, fit_rms_mm=accuracy_driver,
                       relative_std=0.0005, planarity_mm=0.05, baseline_mm=240.0)


class ReportTest(unittest.TestCase):
    def test_metric_report_states_the_uncertainty(self):
        html = build_html(_result(_scale(0.08)), Settings())

        self.assertIn("Echelle metrique fiable", html)
        self.assertIn("0.25 mm/unite", html)
        self.assertIn("planche non plane", html)
        self.assertIn("96 / 100", html)

    def test_poor_scale_is_not_presented_as_reliable(self):
        html = build_html(_result(_scale(5.0)), Settings())

        self.assertIn("peu fiable", html)
        self.assertNotIn("Echelle metrique fiable", html)

    def test_report_without_scale_says_so_plainly(self):
        html = build_html(_result(None), Settings())

        self.assertIn("Modele sans echelle", html)
        self.assertNotIn("mm/unite", html)

    def test_written_file_is_self_contained(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_report(_result(_scale(0.1)), Settings(), tmp)
            content = path.read_text(encoding="utf-8")

        self.assertEqual(path.name, "rapport.html")
        self.assertIn("<style>", content)
        self.assertNotIn("http://", content)


if __name__ == "__main__":
    unittest.main()

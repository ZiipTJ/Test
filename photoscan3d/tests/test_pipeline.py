"""Comportements de la chaine testables sans COLMAP ni OpenMVS installes."""

from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path

from photoscan3d.config import QUALITY_PRESETS, Settings
from photoscan3d.pipeline import (Cancelled, Pipeline, PipelineError,
                                  estimate_runtime_hint)


def _settings_without_tools() -> Settings:
    return Settings(colmap_path="/introuvable/colmap", openmvs_dir="/introuvable")


class ToolchainGuardTest(unittest.TestCase):
    def test_missing_tools_are_named_before_any_work_starts(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Pipeline(tmp, Path(tmp) / "out", _settings_without_tools())

            with self.assertRaises(PipelineError) as raised:
                pipeline.run()

        message = str(raised.exception)
        self.assertIn("Outils manquants", message)
        self.assertIn("colmap", message)
        # Rien ne doit etre ecrit tant que la chaine ne peut pas aboutir.
        self.assertFalse((Path(tmp) / "out").exists())


class CancellationTest(unittest.TestCase):
    def test_a_cancelled_run_stops_immediately(self):
        cancel = threading.Event()
        cancel.set()
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Pipeline(tmp, Path(tmp) / "out", Settings(),
                                cancel_event=cancel)

            with self.assertRaises((Cancelled, PipelineError)):
                pipeline.run()


class RuntimeHintTest(unittest.TestCase):
    def test_hint_grows_with_photo_count_and_quality(self):
        draft = estimate_runtime_hint(100, QUALITY_PRESETS["brouillon"])
        precise = estimate_runtime_hint(100, QUALITY_PRESETS["precis"])

        self.assertIn("minutes", draft)
        self.assertIn("heures", precise)
        self.assertIn("100 photos", precise)

    def test_small_batches_are_expressed_in_minutes(self):
        self.assertIn("minutes", estimate_runtime_hint(20, QUALITY_PRESETS["standard"]))


class TexturedOutputLookupTest(unittest.TestCase):
    def test_the_most_recent_obj_is_picked_up(self):
        """Le nom du fichier produit par TextureMesh varie selon les versions."""
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "scene_mesh.obj").write_text("v 0 0 0\n", encoding="utf-8")
            newest = work / "scene_texture.obj"
            newest.write_text("v 1 1 1\n", encoding="utf-8")
            import os
            os.utime(newest, (2_000_000_000, 2_000_000_000))
            pipeline = Pipeline(tmp, work / "out", Settings())

            found = pipeline._newest_obj(work, since=0.0)

        self.assertEqual(found.name, "scene_texture.obj")

    def test_absence_of_output_is_reported_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Pipeline(tmp, Path(tmp) / "out", Settings())

            with self.assertRaises(PipelineError) as raised:
                pipeline._newest_obj(Path(tmp), since=0.0)

        self.assertIn("TextureMesh", str(raised.exception))


if __name__ == "__main__":
    unittest.main()

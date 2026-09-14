"""Test de fumee de l'interface, execute sans affichage (plateforme offscreen).

Il ne verifie pas l'apparence mais le cablage : construction de la fenetre,
collecte des reglages, glisser-deposer, generation de la planche.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

try:
    from PySide6.QtWidgets import QApplication
    PYSIDE_AVAILABLE = True
except ImportError:  # pragma: no cover - depend de l'environnement
    PYSIDE_AVAILABLE = False


@unittest.skipUnless(PYSIDE_AVAILABLE, "PySide6 absent")
class MainWindowTest(unittest.TestCase):
    application = None

    @classmethod
    def setUpClass(cls):
        cls._config = tempfile.TemporaryDirectory()
        os.environ["XDG_CONFIG_HOME"] = cls._config.name
        os.environ["APPDATA"] = cls._config.name
        cls.application = QApplication.instance() or QApplication([])

    @classmethod
    def tearDownClass(cls):
        cls._config.cleanup()

    def _window(self):
        from photoscan3d.gui import MainWindow
        return MainWindow()

    def test_window_builds_and_reads_back_its_settings(self):
        window = self._window()
        try:
            window.marker_spin.setValue(39.87)
            window.rows_spin.setValue(2)
            window.cols_spin.setValue(5)
            window.input_edit.setText("/tmp/photos")

            settings = window._collect_settings()
            spec = settings.board_spec()

            self.assertAlmostEqual(spec.marker_mm, 39.87, places=2)
            self.assertEqual((spec.rows, spec.cols), (2, 5))
            self.assertTrue(Path(settings.path()).exists())
        finally:
            window.deleteLater()

    def test_choosing_photos_proposes_an_output_folder(self):
        window = self._window()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                photos = Path(tmp) / "piece"
                photos.mkdir()

                window.output_edit.clear()
                window.input_edit.setText(str(photos))

                self.assertEqual(window.output_edit.text(),
                                 str(photos.parent / "piece_scan"))
        finally:
            window.deleteLater()

    def test_quality_note_mentions_the_runtime(self):
        window = self._window()
        try:
            window.quality_combo.setCurrentIndex(
                window.quality_combo.findData("precis"))

            self.assertIn("Temps indicatif", window.quality_note.text())
        finally:
            window.deleteLater()

    def test_toolchain_dialog_reports_what_is_missing(self):
        from photoscan3d.config import Settings
        from photoscan3d.gui import ToolchainDialog

        dialog = ToolchainDialog(Settings(colmap_path="", openmvs_dir=""))
        try:
            dialog.colmap_edit.setText("/introuvable/colmap")
            dialog._detect()

            self.assertIn("INTROUVABLE", dialog.status.text())
        finally:
            dialog.deleteLater()

    def test_board_generation_writes_a_printable_file(self):
        from photoscan3d.markers import BoardSpec
        from photoscan3d.markers import write_printable_board

        with tempfile.TemporaryDirectory() as tmp:
            path = write_printable_board(BoardSpec(), Path(tmp) / "planche.pdf")

            self.assertTrue(path.exists())
            self.assertGreater(path.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()

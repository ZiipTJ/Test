"""Verifie la mise a l'echelle metrique et les exports de maillage."""

from __future__ import annotations

import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from photoscan3d.mesh import (export_stl_from_obj, read_obj, scale_obj,
                              write_binary_stl)

CUBE_OBJ = """# cube unite
mtllib /ailleurs/scene.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
vt 0 0
vn 0 0 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 3 4 8 7
f 2 3 7 6
f 1 4 8 5
"""


class ObjReadingTest(unittest.TestCase):
    def test_quads_are_triangulated(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cube.obj"
            path.write_text(CUBE_OBJ, encoding="utf-8")

            vertices, triangles = read_obj(path)

        self.assertEqual(vertices.shape, (8, 3))
        self.assertEqual(triangles.shape, (12, 3))  # 6 quads -> 12 triangles
        self.assertTrue((triangles >= 0).all() and (triangles < 8).all())

    def test_negative_indices_are_relative_to_the_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.obj"
            path.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n",
                            encoding="utf-8")

            _, triangles = read_obj(path)

        np.testing.assert_array_equal(triangles, [[0, 1, 2]])


class ScaleObjTest(unittest.TestCase):
    def test_only_vertices_are_scaled(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "cube.obj"
            source.write_text(CUBE_OBJ, encoding="utf-8")
            destination = Path(tmp) / "out" / "cube_mm.obj"

            stats = scale_obj(source, destination, 42.5)

            content = destination.read_text(encoding="utf-8")
            vertices, triangles = read_obj(destination)

        # Un cube unite mis a l'echelle mesure 42,5 mm de cote.
        np.testing.assert_allclose(stats.dimensions, [42.5, 42.5, 42.5], atol=1e-6)
        np.testing.assert_allclose(vertices.max(axis=0), [42.5, 42.5, 42.5], atol=1e-6)
        self.assertEqual(len(triangles), 12)
        self.assertIn("vt 0 0", content)      # texture inchangee
        self.assertIn("vn 0 0 1", content)    # normale inchangee
        self.assertIn("mtllib scene.mtl", content)  # chemin ramene au dossier

    def test_rejects_non_positive_factor(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "cube.obj"
            source.write_text(CUBE_OBJ, encoding="utf-8")
            with self.assertRaises(ValueError):
                scale_obj(source, Path(tmp) / "o.obj", 0.0)


class StlExportTest(unittest.TestCase):
    def test_binary_stl_header_and_triangle_count(self):
        vertices = np.array([[0.0, 0, 0], [10, 0, 0], [0, 10, 0]])
        triangles = np.array([[0, 1, 2]])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.stl"

            write_binary_stl(path, vertices, triangles)
            raw = path.read_bytes()

        self.assertEqual(len(raw), 84 + 50)
        self.assertEqual(struct.unpack("<I", raw[80:84])[0], 1)
        normal = struct.unpack("<3f", raw[84:96])
        np.testing.assert_allclose(normal, [0.0, 0.0, 1.0], atol=1e-6)

    def test_round_trip_from_obj_keeps_dimensions(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "cube.obj"
            source.write_text(CUBE_OBJ, encoding="utf-8")
            scaled = Path(tmp) / "cube_mm.obj"
            scale_obj(source, scaled, 30.0)

            stats = export_stl_from_obj(scaled, Path(tmp) / "cube.stl")

        self.assertEqual(stats.triangles, 12)
        np.testing.assert_allclose(stats.dimensions, [30, 30, 30], atol=1e-6)


if __name__ == "__main__":
    unittest.main()

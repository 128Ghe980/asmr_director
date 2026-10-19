"""Small-file receipt regressions: no compiler, native process, GPU or models."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('build_native_fixed', Path(__file__).with_name('build_native_fixed.py'))
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class VerifyExistingTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='voxcpm2-receipt-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.paths = {
            'ROOT': self.root,
            'OBJ': self.root / 'runtime.obj',
            'LIB': self.root / 'runtime.lib',
            'EXE': self.root / 'cli.exe',
            'RECEIPT': self.root / 'build-receipt.json',
        }
        self.patcher = patch.multiple(builder, **self.paths)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        for name in ('OBJ', 'LIB', 'EXE'):
            self.paths[name].write_bytes(('synthetic ' + name).encode())
        original = self.root / 'original.cpp'
        original.write_bytes(b'unchanged original')
        source = self.root / 'runtime.cpp'
        source.write_bytes(b'patched source')
        (self.root / '04_help_no_models.stdout.log').write_text('Usage: cli --low-vram\n', encoding='utf-8')
        (self.root / '04_help_no_models.stderr.log').write_text('', encoding='utf-8')
        self.record = {
            'version': 1,
            'status': 'compiled_help_verified_no_model_runs',
            'steps': [
                {'name': name, 'exit_code': code}
                for name, code in (
                    ('01_compile_runtime', 0), ('02_runtime_library', 0),
                    ('03_link_cli', 0), ('04_help_no_models', 1),
                )
            ],
            'protected_inputs_before': [builder.identity(original)],
            'patched_sources': [builder.identity(source)],
            'outputs': [builder.identity(self.paths[name]) for name in ('OBJ', 'LIB', 'EXE')],
        }
        self.write_receipt()

    def write_receipt(self):
        self.paths['RECEIPT'].write_text(json.dumps(self.record), encoding='utf-8')

    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()):
            builder.verify_existing()

    def test_unchanged_artifacts_keep_the_original_identities(self):
        self.verify()
        self.verify()
        actual = json.loads(self.paths['RECEIPT'].read_text(encoding='utf-8'))
        self.assertEqual(actual['outputs'], self.record['outputs'])
        self.assertEqual(actual['status'], 'compiled_help_verified_no_model_runs')

    def test_replaced_artifact_cannot_be_blessed_by_old_help_log(self):
        for name in ('OBJ', 'LIB', 'EXE'):
            with self.subTest(artifact=name):
                original = self.paths[name].read_bytes()
                before = self.paths['RECEIPT'].read_bytes()
                # Keep file length identical: byte count alone is insufficient.
                self.paths[name].write_bytes(b'X' * len(original))
                with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
                    self.verify()
                self.assertEqual(self.paths['RECEIPT'].read_bytes(), before)
                self.assertFalse((self.root / 'build-receipt.pending.json').exists())
                self.paths[name].write_bytes(original)

    def test_completed_receipt_cannot_reset_or_remove_output_identities(self):
        for replacement in (None, [], {}):
            with self.subTest(outputs=replacement):
                if replacement is None:
                    self.record.pop('outputs', None)
                else:
                    self.record['outputs'] = replacement
                self.write_receipt()
                before = self.paths['RECEIPT'].read_bytes()
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.assertEqual(self.paths['RECEIPT'].read_bytes(), before)

    def test_legacy_help_exit_one_can_initialize_outputs_once(self):
        self.record['status'] = 'failed'
        self.record['error'] = "RuntimeError('04_help_no_models failed; inspect isolated logs.')"
        self.record.pop('outputs')
        self.write_receipt()
        original = self.paths['RECEIPT'].read_bytes()
        self.verify()
        self.assertEqual((self.root / 'first-build-receipt.json').read_bytes(), original)
        self.verify()
        before = self.paths['RECEIPT'].read_bytes()
        self.paths['EXE'].write_bytes(b'replacement executable')
        with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
            self.verify()
        self.assertEqual(self.paths['RECEIPT'].read_bytes(), before)
        self.assertEqual((self.root / 'first-build-receipt.json').read_bytes(), original)

    def test_failed_record_with_existing_outputs_cannot_rebaseline(self):
        self.record['status'] = 'failed'
        self.write_receipt()
        before = self.paths['RECEIPT'].read_bytes()
        self.paths['EXE'].write_bytes(b'replacement executable')
        with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
            self.verify()
        self.assertEqual(self.paths['RECEIPT'].read_bytes(), before)
        self.assertFalse((self.root / 'first-build-receipt.json').exists())


if __name__ == '__main__':
    unittest.main()

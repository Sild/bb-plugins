import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sync_plugins import sync


class PluginSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.root = base / "repo"
        self.source = base / "active"
        self.target = self.root / "plugins/notes"
        (self.root / ".bb").mkdir(parents=True)
        self.target.mkdir(parents=True)
        self.source.mkdir()
        manifest = '{"name":"bb-plugin-notes"}\n'
        for directory in [self.source, self.target]:
            (directory / "package.json").write_text(manifest)
            (directory / "server.ts").write_text('const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n')
        (self.root / ".bb/plugins.json").write_text(json.dumps({"schemaVersion": 1, "plugins": [{"name": "notes", "source": "./plugins/notes"}]}, indent=2) + '\n')
        self.inventory = [{"id": "notes", "source": "path:" + str(self.source), "enabled": True, "status": "running"}]

    def capture(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return sync(self.root, self.inventory)

    def test_preserves_portability_patch_and_merges_new_source_change(self):
        (self.target / "server.ts").write_text('const a = 10;\n\nconst b = 2;\n\nconst c = 3;\n')
        self.capture()
        (self.source / "server.ts").write_text('const a = 1;\n\nconst b = 2;\n\nconst c = 30;\n')
        self.assertEqual(self.capture(), ['plugins/notes/server.ts'])
        self.assertEqual((self.target / "server.ts").read_text(), 'const a = 10;\n\nconst b = 2;\n\nconst c = 30;\n')
        self.assertEqual(self.capture(), [])

    def test_conflict_leaves_all_files_unchanged(self):
        self.capture()
        (self.target / "server.ts").write_text('local\n')
        (self.source / "server.ts").write_text('remote\n')
        (self.source / "new.ts").write_text('new\n')
        with self.assertRaisesRegex(ValueError, 'Sync conflict'):
            self.capture()
        self.assertEqual((self.target / "server.ts").read_text(), 'local\n')
        self.assertFalse((self.target / "new.ts").exists())

    def test_additions_deletions_and_repo_only_files(self):
        (self.target / "portable.ts").write_text('portable\n')
        self.capture()
        (self.source / "server.ts").unlink()
        (self.source / "new.ts").write_text('new\n')
        self.capture()
        self.assertFalse((self.target / "server.ts").exists())
        self.assertEqual((self.target / "portable.ts").read_text(), 'portable\n')
        self.assertEqual((self.target / "new.ts").read_text(), 'new\n')

    def test_new_active_plugin_is_indexed_and_state_and_secrets_are_excluded(self):
        (self.root / ".bb/plugins.json").write_text('{"schemaVersion":1,"plugins":[]}\n')
        # An unrelated existing destination cannot be silently overwritten.
        (self.target / "server.ts").unlink()
        (self.source / "node_modules").mkdir()
        (self.source / "node_modules/generated.ts").write_text('generated\n')
        (self.source / ".env").write_text('PRIVATE=value\n')
        (self.source / "credentials.json").write_text('{}\n')
        self.capture()
        entries = json.loads((self.root / ".bb/plugins.json").read_text())['plugins']
        self.assertEqual(entries, [{"name": "notes", "source": "./plugins/notes"}])
        self.assertTrue((self.target / "server.ts").exists())
        for path in ['node_modules', '.env', 'credentials.json']:
            self.assertFalse((self.target / path).exists())

    def test_disabled_and_failed_plugins_are_skipped(self):
        self.capture()
        (self.source / "server.ts").write_text('new\n')
        self.inventory[0]['enabled'] = False
        self.assertEqual(self.capture(), [])
        self.inventory[0].update(enabled=True, status='error')
        self.assertEqual(self.capture(), [])

    def test_symlink_destination_cannot_write_outside_repo(self):
        self.capture()
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        (self.target / 'nested').symlink_to(outside, target_is_directory=True)
        (self.source / 'nested').mkdir()
        (self.source / 'nested/new.ts').write_text('new\n')
        with self.assertRaisesRegex(ValueError, 'symlink destination'):
            self.capture()
        self.assertFalse((outside / 'new.ts').exists())

    def test_top_level_symlink_cannot_alias_another_plugin(self):
        other = self.target.with_name('other')
        self.target.rename(other)
        self.target.symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink destination'):
            self.capture()
        self.assertEqual((other / 'server.ts').read_text(), 'const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n')

    def settings_fixture(self, mode):
        def output(command, text):
            if command[1:3] == ['plugin', 'list']:
                return json.dumps({'plugins': self.inventory})
            return json.dumps({'schema': {'mode': {'type': 'string'}, 'password': {'type': 'string', 'secret': True}, 'apiKey': {'type': 'secret'}},
                               'values': {'mode': mode, 'password': 'private', 'apiKey': 'private', 'unknown': 'private'}})
        return output

    def preset_fixture(self):
        directory = self.root / 'preset'
        directory.mkdir()
        path = directory / 'settings.json'
        path.write_text(json.dumps({'plugins': [{'id': 'notes', 'source': 'collection:notes', 'enabled': True}], 'pluginSettings': {}}, indent=2) + '\n')
        return path

    def test_capture_only_declared_nonsecret_settings(self):
        preset = self.preset_fixture()
        with patch('sync_plugins.subprocess.check_output', side_effect=self.settings_fixture('stable')):
            sync(self.root)
        self.assertEqual(json.loads(preset.read_text())['pluginSettings'], {'notes': {'mode': 'stable'}})
        self.assertNotIn('private', preset.read_text())

    def test_setting_conflict_also_prevents_source_writes(self):
        preset = self.preset_fixture()
        with patch('sync_plugins.subprocess.check_output', side_effect=self.settings_fixture('stable')):
            sync(self.root)
        local = json.loads(preset.read_text())
        local['pluginSettings']['notes']['mode'] = 'repo'
        preset.write_text(json.dumps(local, indent=2) + '\n')
        (self.source / 'new.ts').write_text('new\n')
        with patch('sync_plugins.subprocess.check_output', side_effect=self.settings_fixture('active')):
            with self.assertRaisesRegex(ValueError, 'Sync conflict'):
                sync(self.root)
        self.assertFalse((self.target / 'new.ts').exists())
        self.assertEqual(json.loads(preset.read_text())['pluginSettings']['notes']['mode'], 'repo')

    def test_manifest_mismatch_stops_capture(self):
        (self.source / 'package.json').write_text('{"name":"bb-plugin-other"}')
        with self.assertRaisesRegex(ValueError, 'identity does not match'):
            self.capture()


if __name__ == '__main__':
    unittest.main()

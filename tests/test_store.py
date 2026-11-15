"""Offline packaging contracts; these are not Umbrel runtime tests."""
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
APP_ID = "leoparm-mediadec"
APP = ROOT / APP_ID
IMAGE = "leoparm/mediadec:0.1.6@sha256:bc18bb01dcf90925261c5ac8bd4ba8fffb95a80fbb0819a13417c8a9b9beb4fe"


class StoreTests(unittest.TestCase):
    def load_yaml(self, path):
        self.assertTrue(path.is_file(), f"Missing package file: {path.relative_to(ROOT)}")
        return yaml.safe_load(path.read_text())

    def test_store_identity(self):
        self.assertEqual(self.load_yaml(ROOT / "umbrel-app-store.yml"),
                         {"id": "leoparm", "name": "LeoParm's Apps"})

    def test_single_app_manifest(self):
        manifest = self.load_yaml(APP / "umbrel-app.yml")
        self.assertEqual(sorted(p.parent.name for p in ROOT.glob("*/umbrel-app.yml")), [APP_ID])
        self.assertEqual(manifest["id"], APP_ID)
        self.assertTrue(manifest["id"].startswith(self.load_yaml(ROOT / "umbrel-app-store.yml")["id"] + "-"))
        self.assertEqual(manifest["manifestVersion"], 2.0)
        self.assertEqual(manifest["storage"], {"dataRoot": "data"})
        self.assertEqual(manifest["name"], "MediaDec")
        self.assertEqual(manifest["version"], "0.1.6-umbrel.1")
        image_tag = self.load_yaml(APP / "docker-compose.yml")["services"]["server"]["image"].split(":", 1)[1].split("@", 1)[0]
        app_version, package_revision = manifest["version"].split("-umbrel.")
        self.assertEqual(app_version, image_tag)
        self.assertTrue(package_revision.isdigit() and int(package_revision) > 0)
        self.assertEqual(manifest["port"], 3009)
        for field in ("dependencies", "gallery"):
            self.assertEqual(manifest[field], [])
        self.assertEqual(manifest["defaultUsername"], "admin")
        self.assertTrue(manifest["deterministicPassword"])
        for field in ("path", "defaultPassword"):
            self.assertEqual(manifest[field], "")
        self.assertIn("Radarr", manifest["releaseNotes"])
        self.assertIn("Sonarr", manifest["releaseNotes"])
        self.assertEqual(manifest["folderAccess"], [{
            "id": "media-library", "name": "Media Library",
            "note": "Appears at /Media. MediaDec can rename, rewrite, or delete files. Use a test folder first.",
            "mounts": [{"service": "server", "targetPath": "/Media", "readOnly": False}],
        }])
        self.assertEqual(manifest["repo"], "https://github.com/dorym/umbrel_app_store")
        self.assertEqual(manifest["support"], "https://github.com/dorym/umbrel_app_store/issues")
        for phrase in ("x86_64", "test folder", "rename", "delete"):
            self.assertIn(phrase, manifest["description"])

    def test_compose_wiring_and_least_host_access(self):
        compose = self.load_yaml(APP / "docker-compose.yml")
        self.assertEqual(set(compose), {"version", "services"})
        self.assertEqual(set(compose["services"]), {"app_proxy", "server"})
        proxy = compose["services"]["app_proxy"]
        self.assertEqual(proxy, {"environment": {
            "APP_HOST": f"{APP_ID}_server_1", "APP_PORT": 3000}})
        server = compose["services"]["server"]
        self.assertEqual(server["image"], IMAGE)
        self.assertEqual(server["platform"], "linux/amd64")
        self.assertEqual(server["command"], [
            "/bin/sh", "-ec",
            "node /umbrel-bootstrap.cjs && (node /umbrel-discovery.cjs || true) && unset UMBREL_APP_PASSWORD && exec npm start",
        ])
        self.assertTrue(server["init"])
        self.assertEqual(server["restart"], "on-failure")
        self.assertEqual(server["environment"], {
            "CACHE_DB_PATH": "/db/cache.db", "MEDIA_ROOT": "/Media",
            "UMBREL_APP_PASSWORD": "${APP_PASSWORD}"})
        self.assertEqual(server["volumes"], [
            "${APP_DATA_DIR}/data/db:/db", "${APP_DATA_DIR}/data/media:/Media",
            "${APP_DATA_DIR}/bootstrap.cjs:/umbrel-bootstrap.cjs:ro",
            "${APP_DATA_DIR}/discovery.cjs:/umbrel-discovery.cjs:ro"])
        for template in ("bootstrap.cjs.template", "discovery.cjs.template"):
            self.assertTrue((APP / template).is_file())
            self.assertNotIn("$", (APP / template).read_text(),
                             "Umbrel envsubst must not rewrite JavaScript")
        allowed = {"image", "platform", "command", "init", "restart", "environment", "volumes", "user"}
        self.assertFalse(set(server) - allowed, "Unexpected privileges, ports, networks, or runtime settings")
        for source in ("db", "media"):
            self.assertTrue((APP / "data" / source / ".gitkeep").is_file())
            self.assertEqual(sorted(p.name for p in (APP / "data" / source).iterdir()), [".gitkeep"])

    def test_readme_documents_boundaries_and_setup(self):
        path = ROOT / "README.md"
        self.assertTrue(path.is_file(), "Missing installation and safety documentation")
        text = path.read_text()
        for phrase in ("https://github.com/dorym/umbrel_app_store", "umbrelOS 2.0", "x86_64", "amd64",
                       "arm64", "test folder", "rename", "rewrite", "delete", "/Media", "/db/cache.db",
                       "fresh app-data", "not a migration", "Require Umbrel login", "compiled application code",
                       "external data mounts", "packaging support", "upstream license", "0.1.6",
                       "not been tested through Umbrel", "python -m unittest discover -s tests -v"):
            self.assertIn(phrase, text)
        self.assertNotIn("latest@", text)

    def test_ci_validates_contract_and_bootstrap_with_read_permissions(self):
        workflows = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
        self.assertEqual([p.name for p in workflows], ["validate.yml"])
        workflow = self.load_yaml(workflows[0])
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        # PyYAML's YAML 1.1 treats an unquoted 'on' as a boolean; keep it quoted.
        self.assertEqual(workflow["on"], {"push": None, "pull_request": None, "workflow_dispatch": None})
        self.assertEqual(set(workflow["jobs"]), {"validate", "bootstrap"})
        bootstrap = workflow["jobs"]["bootstrap"]
        self.assertEqual(bootstrap["runs-on"], "ubuntu-latest")
        self.assertEqual(bootstrap["timeout-minutes"], 10)
        self.assertEqual(bootstrap["steps"][0], {
            "uses": "actions/checkout@v4", "with": {"persist-credentials": False}})
        command = bootstrap["steps"][1]["run"]
        for required in ("docker run --rm", "--network none", IMAGE,
                         "--entrypoint node", "--test /bootstrap.test.cjs /discovery.test.cjs"):
            self.assertIn(required, command)
        for forbidden in ("--privileged", "docker.sock", "secrets."):
            self.assertNotIn(forbidden, command)
        self.assertTrue((ROOT / "tests" / "bootstrap.test.cjs").is_file())
        job = workflow["jobs"]["validate"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        self.assertEqual(job["timeout-minutes"], 5)
        steps = job["steps"]
        self.assertEqual(steps, [
            {"uses": "actions/checkout@v4", "with": {"persist-credentials": False}},
            {"uses": "actions/setup-python@v5", "with": {"python-version": "3.13"}},
            {"run": "python -m pip install -r requirements-dev.txt"},
            {"run": "python -m unittest discover -s tests -v"},
            {"run": "git diff --check"},
        ])
        self.assertEqual((ROOT / "requirements-dev.txt").read_text(), "PyYAML==6.0.2\n")
        self.assertTrue((ROOT / ".gitignore").is_file())
        for entry in (".venv/", "__pycache__/", "*.py[cod]", ".env"):
            self.assertIn(entry, (ROOT / ".gitignore").read_text().splitlines())

    def test_icon_is_local_original_svg_without_external_content(self):
        import xml.etree.ElementTree as ET
        path = ROOT / "assets" / "mediadec.svg"
        self.assertTrue(path.is_file(), "Missing community app icon")
        svg = ET.fromstring(path.read_text())
        self.assertEqual(svg.tag, "{http://www.w3.org/2000/svg}svg")
        self.assertEqual(svg.attrib["viewBox"], "0 0 256 256")
        allowed = {"svg", "title", "rect", "path", "circle"}
        for element in svg.iter():
            self.assertIn(element.tag.split("}")[-1], allowed)
            for attribute in element.attrib:
                self.assertNotIn(attribute.lower(), {"href", "onload", "onclick", "style"})
        self.assertEqual(self.load_yaml(APP / "umbrel-app.yml")["icon"],
                         "https://raw.githubusercontent.com/dorym/umbrel_app_store/main/assets/mediadec.svg")


if __name__ == "__main__":
    unittest.main()

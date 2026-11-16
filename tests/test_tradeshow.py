"""Tradeshow packaging contracts, not a real Umbrel installation test."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
import yaml

ROOT = Path(__file__).resolve().parents[1]
APP_ID = "leoparm-tradeshow"
APP = ROOT / APP_ID
IMAGE = "leoparm/tradeshow:0.1.1@sha256:804ce66897bf26772fda742e31eed8c8c35661a4f6a803773b009abcb21848fe"


class TradeshowPackageTests(unittest.TestCase):
    def load(self, name):
        path = APP / name
        self.assertTrue(path.is_file(), f"Missing Tradeshow package file: {name}")
        return yaml.safe_load(path.read_text())

    def test_manifest_and_manual_first_user_setup(self):
        manifest = self.load("umbrel-app.yml")
        self.assertEqual(manifest["id"], APP_ID)
        self.assertEqual(manifest["name"], "Tradeshow")
        self.assertEqual(manifest["manifestVersion"], 2.0)
        self.assertEqual(manifest["storage"], {"dataRoot": "data"})
        self.assertEqual(manifest["version"], "0.1.1-umbrel.1")
        self.assertEqual(manifest["category"], "finance")
        self.assertEqual(manifest["port"], 3057)
        self.assertTrue(manifest.get("requiresHttps", False))
        for name in ("defaultUsername", "defaultPassword", "path", "releaseNotes"):
            self.assertEqual(manifest[name], "")
        for name in ("dependencies", "gallery"):
            self.assertEqual(manifest[name], [])
        self.assertFalse(manifest.get("deterministicPassword", False))
        self.assertNotIn("folderAccess", manifest)
        for phrase in ("Create admin account", "x86_64", "SEC-01", "not financial advice"):
            self.assertIn(phrase, manifest["description"])
        self.assertEqual(manifest["repo"], "https://github.com/dorym/umbrel_app_store")
        self.assertEqual(manifest["support"], "https://github.com/dorym/umbrel_app_store/issues")

    def test_compose_pin_proxy_and_persistent_sqlite(self):
        compose = self.load("docker-compose.yml")
        self.assertEqual(set(compose), {"version", "services"})
        self.assertEqual(set(compose["services"]), {"app_proxy", "server"})
        self.assertEqual(compose["services"]["app_proxy"], {"environment": {
            "APP_HOST": "leoparm-tradeshow_server_1", "APP_PORT": 3000}})
        server = compose["services"]["server"]
        self.assertEqual(server["image"], IMAGE)
        self.assertEqual(server["platform"], "linux/amd64")
        self.assertEqual(server["environment"], {
            "NODE_ENV": "production", "HOSTNAME": "0.0.0.0", "PORT": "3000",
            "SQLITE_PATH": "/app/data/tradeshow.db", "AUTH_SECRET": "${APP_SEED}",
            "AUTH_TRUST_HOST": "true", "AUTH_COOKIE_NAMESPACE": APP_ID,
            "AUTH_URL": "https://${DEVICE_DOMAIN_NAME}:${APP_PROXY_PORT}",
        })
        self.assertEqual(server["volumes"], ["${APP_DATA_DIR}/data:/app/data"])
        self.assertEqual(server["restart"], "on-failure")
        self.assertTrue(server["init"])
        self.assertEqual(set(server), {"image", "platform", "environment", "volumes", "restart", "init"})
        self.assertEqual(sorted(p.name for p in (APP / "data").iterdir()), [".gitkeep"])
        version = self.load("umbrel-app.yml")["version"].split("-umbrel.")[0]
        self.assertEqual(version, server["image"].split(":", 1)[1].split("@", 1)[0])

    def test_inventory_and_browser_ports_preserve_mediadec(self):
        manifests = [yaml.safe_load(p.read_text()) for p in ROOT.glob("*/umbrel-app.yml")]
        self.assertEqual(sorted(m["id"] for m in manifests), ["leoparm-mediadec", APP_ID])
        self.assertEqual(len({m["port"] for m in manifests}), len(manifests))
        mediadec = next(m for m in manifests if m["id"] == "leoparm-mediadec")
        self.assertEqual(mediadec["version"], "0.1.7-umbrel.1")

    def test_original_local_icon_has_no_external_or_executable_content(self):
        path = ROOT / "assets" / "tradeshow.svg"
        self.assertTrue(path.is_file())
        svg = ET.fromstring(path.read_text())
        self.assertEqual(svg.attrib["viewBox"], "0 0 256 256")
        for element in svg.iter():
            self.assertIn(element.tag.split("}")[-1], {"svg", "title", "rect", "path", "circle"})
            for attribute in element.attrib:
                self.assertNotIn(attribute.lower(), {"href", "onclick", "onload", "style"})
        self.assertEqual(self.load("umbrel-app.yml")["icon"],
                         "https://raw.githubusercontent.com/dorym/umbrel_app_store/main/assets/tradeshow.svg")

    def test_documentation_discloses_setup_privacy_and_security_limits(self):
        path = ROOT / "docs" / "tradeshow.md"
        self.assertTrue(path.is_file())
        text = path.read_text()
        for phrase in ("0.1.1-umbrel.1", IMAGE, "APP_SEED", "AUTH_SECRET", "Create admin account",
                       "Require Umbrel login", "not a migration", "SEC-01", "15.3.1", "arm64",
                       "not been tested through Umbrel", "financial advice", "3057", "no all-layer"):
            self.assertIn(phrase, text)
        self.assertIn("Tradeshow", (ROOT / "README.md").read_text())

    def test_ci_exercises_pinned_native_image_without_secrets_or_host_access(self):
        workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "validate.yml").read_text())
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        self.assertIn("tradeshow", workflow["jobs"])
        job = workflow["jobs"]["tradeshow"]
        self.assertEqual(job["timeout-minutes"], 10)
        self.assertEqual(job["steps"][0], {
            "uses": "actions/checkout@v4", "with": {"persist-credentials": False}})
        command = job["steps"][1]["run"]
        for required in ("docker run --rm", "--network none", "--entrypoint node", IMAGE,
                         "--test /tradeshow-image.test.cjs"):
            self.assertIn(required, command)
        for forbidden in ("--privileged", "docker.sock", "secrets.", "--publish"):
            self.assertNotIn(forbidden, command)


if __name__ == "__main__":
    unittest.main()

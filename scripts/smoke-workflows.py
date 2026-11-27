#!/usr/bin/env python3
"""Verify published workflow installs with the Skills CLI in temporary projects."""

import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
from zipfile import ZipFile
import tempfile
from threading import Thread

ROOT = Path(__file__).resolve().parents[1]
# A workflow entry and a standalone skill, both installed alone from the site root.
ROOT_SKILLS = ("full-stop", "tdd")


class LocalServer(ThreadingHTTPServer):
    request_queue_size = 128


class QuietFiles(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass


@contextmanager
def serve(directory):
    handler = partial(QuietFiles, directory=str(directory))
    with LocalServer(("127.0.0.1", 0), handler) as server:
        worker = Thread(target=server.serve_forever)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join()


def run_cli(cli, project, *args):
    subprocess.run(
        ["node", str(cli), *args], cwd=project, check=True, timeout=240,
        env={**os.environ, "DISABLE_TELEMETRY": "1"},
    )


def install(cli, project, url, skill="*"):
    run_cli(cli, project, "add", url, "--skill", skill, "--agent", "codex", "--copy", "--yes")


def file_paths(root):
    return {p.relative_to(root) for p in root.rglob("*") if p.is_file()}


def verify_install(project, workflow_url, members, site, artifact):
    installed = project / ".agents/skills"
    lock = json.loads((project / "skills-lock.json").read_text())["skills"]
    expected = {name for names in members.values() for name in names}
    assert set(lock) == expected, (workflow_url, sorted(lock), sorted(expected))
    index = json.loads(artifact.read_text())
    index["skills"] = [entry for entry in index["skills"] if entry["name"] in expected]
    assert {entry["name"] for entry in index["skills"]} == expected, (workflow_url, artifact)
    assert {skill.name for skill in installed.iterdir()} == expected
    for skill, entry in lock.items():
        assert entry["sourceType"] == "well-known", (skill, entry)
        assert entry["sourceUrl"].rstrip("/") == workflow_url, (skill, entry)
        assert entry["wellKnownDigest"], (skill, entry)
        assert (installed / skill / "SKILL.md").is_file()
    for entry in index["skills"]:
        digest = entry["digest"].removeprefix("sha256:")
        archive = site / "archives" / (digest + ".zip")
        installed_files = installed / entry["name"]
        with ZipFile(archive) as package:
            assert set(package.namelist()) == {p.as_posix() for p in file_paths(installed_files)}
            for path in package.namelist():
                assert package.read(path) == (installed_files / path).read_bytes(), path


def smoke(cli, base, work, migration, site):
    for path in sorted((ROOT / "packs").glob("*.json")):
        url = f"{base}/workflows/{path.stem}"
        project = work / path.stem
        project.mkdir()
        if migration and path.stem == "full-stop":
            install(cli, project, migration)
            old = json.loads((project / "skills-lock.json").read_text())["skills"]
            assert old["full-stop"]["sourceUrl"].rstrip("/") == migration
        install(cli, project, url)
        verify_install(project, url, json.loads(path.read_text())["members"], site,
                       site / "workflows" / path.stem / ".well-known/agent-skills/index.json")
        print(f"Verified {url}", flush=True)
    # The root index lists every local skill and installs any one alone, without its workflow.
    root_index = json.loads((site / ".well-known/agent-skills/index.json").read_text())
    local = {path.name for path in (ROOT / "skills").iterdir() if path.is_dir()}
    assert {entry["name"] for entry in root_index["skills"]} == local, sorted(local)
    for name in ROOT_SKILLS:
        project = work / f"root-{name}"
        project.mkdir()
        install(cli, project, base, name)
        verify_install(project, base, {"local": [name]}, site, site / ".well-known/agent-skills/index.json")
        print(f"Verified {base} --skill {name}", flush=True)


def update_across_releases(cli, site, work):
    # Keep the install URL stable while switching from a previous release to the build.
    staged = work / "site"
    staged.mkdir()
    name = "full-stop"
    index = staged / "workflows" / name / ".well-known/skills"
    content = index / name / "SKILL.md"
    content.parent.mkdir(parents=True)
    content.write_text("---\nname: full-stop\ndescription: Prior release.\n---\nPrevious revision.\n")
    (index / "index.json").write_text(json.dumps({"skills": [
        {"name": name, "description": "Prior release.", "files": ["SKILL.md"]}
    ]}))
    project = work / "updating"
    project.mkdir()
    with serve(staged) as base:
        url = f"{base}/workflows/{name}"
        install(cli, project, url)
        installed = project / ".agents/skills" / name / "SKILL.md"
        assert installed.read_bytes() == content.read_bytes()
        (staged / "workflows").rename(work / "previous")
        (staged / "archives").symlink_to(site / "archives", target_is_directory=True)
        (staged / "workflows").symlink_to(site / "workflows", target_is_directory=True)
        run_cli(cli, project, "update", name, "--project", "--yes")
        assert installed.read_bytes() == (ROOT / "skills" / name / "SKILL.md").read_bytes()
        lock = json.loads((project / "skills-lock.json").read_text())["skills"]
        assert set(lock) == {name} and lock[name]["sourceUrl"] == url
        print("Verified an installed skill updates across releases.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True, help="Skills CLI bin/cli.mjs")
    location = parser.add_mutually_exclusive_group(required=True)
    location.add_argument("--site", type=Path, help="Generated static site directory")
    location.add_argument("--url", help="Vercel deployment origin")
    parser.add_argument("--migrate-from", help="Also migrate a live legacy Full Stop install")
    args = parser.parse_args()
    cli = args.cli.resolve(strict=True)
    with tempfile.TemporaryDirectory() as temporary:
        work = Path(temporary)
        if args.site:
            site = args.site.resolve(strict=True)
            update_across_releases(cli, site, work)
            with serve(site) as base:
                smoke(cli, base, work, args.migrate_from, site)
        else:
            smoke(cli, args.url.rstrip("/"), work, args.migrate_from, ROOT / "dist")


if __name__ == "__main__":
    main()

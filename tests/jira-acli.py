"""Offline behavior checks. The ACLI double stores both endpoints like Jira."""

import argparse
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import string
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "jira-acli" / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


md = load("md_to_adf")
jira = load("jira")


def doc(text):
    return {"type": "doc", "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


class FakeACLI:
    def __init__(self, fixed_mapping=False):
        self.items = {key: {"key": key, "fields": {"summary": key, "description": doc("Old"), "issuelinks": []}}
                      for key in ("PROJ-1", "PROJ-2", "PROJ-3")}
        self.calls = []
        self.fixed_mapping = fixed_mapping
        self.ignore_delete = False
        self.ignore_edit = False
        self.fail_create = False
        self.hide_readback = False
        self.next_id = 100
        self.on_edit = None

    def add(self, subject, object_, type_name="Blocks"):
        self.next_id += 1
        link_id = str(self.next_id)
        labels = ("relates to", "relates to") if type_name == "Relates" else ("blocks", "is blocked by")
        type_ = {"name": type_name, "outward": labels[0], "inward": labels[1]}
        self.items[subject]["fields"]["issuelinks"].append(
            {"id": link_id, "type": type_, "outwardIssue": {"key": object_}})
        self.items[object_]["fields"]["issuelinks"].append(
            {"id": link_id, "type": type_, "inwardIssue": {"key": subject}})
        return link_id

    def __call__(self, *args):
        self.calls.append(args)
        if args[0] == "view":
            item = copy.deepcopy(self.items[args[1]])
            fields = args[args.index("--fields") + 1].split(",")
            item["fields"] = {key: value for key, value in item["fields"].items() if key in fields}
            if self.hide_readback:
                item["fields"]["issuelinks"] = []
            return json.dumps(item)
        if args[:2] == ("link", "type"):
            return json.dumps({"issueLinkTypes": [{"name": "Blocks"}, {"name": "Relates"}]})
        if args[:2] == ("link", "create"):
            if self.fail_create:
                raise ValueError("simulated uncertain create failure")
            in_, out = args[args.index("--in") + 1], args[args.index("--out") + 1]
            self.add(*( (out, in_) if self.fixed_mapping else (in_, out) ),
                     type_name=args[args.index("--type") + 1])
            return "SUCCESS: misleading direction"
        if args[:2] == ("link", "delete"):
            if not self.ignore_delete:
                for item in self.items.values():
                    item["fields"]["issuelinks"] = [link for link in item["fields"]["issuelinks"]
                                                      if link["id"] != args[args.index("--id") + 1]]
            return "SUCCESS"
        if args[0] == "edit":
            if self.on_edit:
                self.on_edit()
            if not self.ignore_edit:
                file = Path(args[args.index("--description-file") + 1])
                self.items[args[args.index("--key") + 1]]["fields"]["description"] = json.loads(file.read_text())
            return "SUCCESS"
        raise AssertionError(f"unexpected ACLI call {args}")

    def writes(self):
        return [args for args in self.calls if args[0] == "edit" or args[:2] in (("link", "create"), ("link", "delete"))]


class MarkdownTests(unittest.TestCase):
    def test_structures_and_unicode(self):
        value = md.convert("# Goal\nWrapped café\ncontinues.\n\n### Scope\n- **Bold** and `code`\n- [Docs](https://example.com)\n\n3. Three\n4. Four\n\n```python\n  x = '**literal**'\n```\n")
        self.assertEqual([node["type"] for node in value["content"]],
                         ["heading", "paragraph", "heading", "bulletList", "orderedList", "codeBlock"])
        self.assertEqual(value["content"][1]["content"][0]["text"], "Wrapped café continues.")
        self.assertEqual(value["content"][3]["content"][0]["content"][0]["content"], [
            {"type": "text", "text": "Bold", "marks": [{"type": "strong"}]},
            {"type": "text", "text": " and "},
            {"type": "text", "text": "code", "marks": [{"type": "code"}]},
        ])
        link = value["content"][3]["content"][1]["content"][0]["content"][0]
        self.assertEqual(link["marks"], [{"type": "link", "attrs": {"href": "https://example.com"}}])
        self.assertEqual(value["content"][4]["attrs"], {"order": 3})
        self.assertEqual(value["content"][5], {"type": "codeBlock", "attrs": {"language": "python"},
                                               "content": [{"type": "text", "text": "  x = '**literal**'"}]})

    def test_mark_combinations_and_escapes(self):
        nodes = md.inline("**Use `code` here**")
        self.assertEqual(nodes[1]["marks"], [{"type": "code"}])
        self.assertEqual(md.inline(r"\*\*literal\*\*"), [{"type": "text", "text": "**literal**"}])
        self.assertEqual(md.inline("[`code`](https://example.com)")[0]["marks"],
                         [{"type": "link", "attrs": {"href": "https://example.com"}}, {"type": "code"}])
        self.assertEqual(md.inline("[Docs](https://example.com/a_(b))")[0]["marks"][0]["attrs"]["href"],
                         "https://example.com/a_(b)")
        self.assertEqual(md.convert("```\n\n``` ")["content"], [{"type": "codeBlock"}])
        self.assertEqual(md.inline("**Use `**literal**` here**"), [
            {"type": "text", "text": "Use ", "marks": [{"type": "strong"}]},
            {"type": "text", "text": "**literal**", "marks": [{"type": "code"}]},
            {"type": "text", "text": " here", "marks": [{"type": "strong"}]},
        ])

    def test_empty_and_unsupported_input(self):
        self.assertEqual(md.convert("")["content"], [{"type": "paragraph"}])
        for text in ("- first\n  - nested", "| table |", "> quote", "```\nunclosed", "![image](https://example.com)",
                     "See ![image](https://example.com)"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                md.convert(text)

    def test_all_ascii_punctuation_escapes(self):
        for character in string.punctuation:
            with self.subTest(character=character):
                self.assertEqual(md.inline("\\" + character), [{"type": "text", "text": character}])
        self.assertEqual(md.inline(r"Cost: \$5; \#tag; \- item"),
                         [{"type": "text", "text": "Cost: $5; #tag; - item"}])
        self.assertEqual(md.inline(r"keep\n"), [{"type": "text", "text": r"keep\n"}])

    def test_escapes_inside_strong_content(self):
        for source, value in ((r"**a\***", "a*"), (r"**a\\**", "a\\"),
                              (r"**a\n**", r"a\n"), (r"**a\`**", "a`")):
            with self.subTest(source=source):
                self.assertEqual(md.inline(source),
                                 [{"type": "text", "text": value, "marks": [{"type": "strong"}]}])
        self.assertEqual(md.inline(r"**a\* `code`**"), [
            {"type": "text", "text": "a* ", "marks": [{"type": "strong"}]},
            {"type": "text", "text": "code", "marks": [{"type": "code"}]},
        ])

    def test_escaped_image_marker_backslash_parity(self):
        for count in range(5):
            source = "\\" * count + "![Docs](https://example.com)"
            with self.subTest(count=count):
                if count % 2:
                    nodes = md.convert(source)["content"][0]["content"]
                    self.assertEqual(nodes, [
                        {"type": "text", "text": "\\" * (count // 2) + "!"},
                        {"type": "text", "text": "Docs", "marks": [
                            {"type": "link", "attrs": {"href": "https://example.com"}}]},
                    ])
                else:
                    with self.assertRaises(ValueError):
                        md.convert(source)

    def test_fences_close_with_same_character_and_sufficient_length(self):
        for opening, closing in (("```", "````"), ("~~~~", "~~~~~  ")):
            with self.subTest(opening=opening):
                self.assertEqual(md.convert(f"{opening}\nx\n{closing}")["content"],
                                 [{"type": "codeBlock", "content": [{"type": "text", "text": "x"}]}])
        for closing in ("``", "``` trailing", "~~~~"):
            with self.subTest(closing=closing), self.assertRaisesRegex(ValueError, "unclosed"):
                md.convert(f"```\nx\n{closing}")

    def test_real_isolated_cli_and_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "description.json"
            command = [sys.executable, "-I", str(SCRIPTS / "md_to_adf.py"), "-", str(target)]
            first = subprocess.run(command, input="### Café\n", encoding="utf-8", capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["content"][0]["type"], "heading")
            second = subprocess.run(command, input="Overwrite", encoding="utf-8", capture_output=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["content"][0]["type"], "heading")


class JiraTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fake = FakeACLI()
        self.mock = patch.object(jira, "acli", self.fake)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def args(self, **overrides):
        return argparse.Namespace(**{"subject": "PROJ-1", "object": "PROJ-2", "type": "Blocks",
                                     "apply": True, **overrides})

    def description_args(self, **overrides):
        file = self.root / "description.json"
        file.write_text(json.dumps(doc("New")), encoding="utf-8")
        return argparse.Namespace(**{"key": "PROJ-1", "file": str(file), "backup_dir": str(self.root / "backups"),
                                     "apply": True, **overrides})

    def test_backups_are_complete_unique_private(self):
        first = Path(jira.backup("PROJ-1", self.root / "backups"))
        second = Path(jira.backup("PROJ-1", self.root / "backups"))
        self.assertNotEqual(first, second)
        self.assertEqual(json.loads(first.read_text()), self.fake.items["PROJ-1"])
        if os.name != "nt":
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            self.assertEqual(first.parent.stat().st_mode & 0o777, 0o700)

    def test_replacement_has_backup_before_edit_and_readback(self):
        args = self.description_args()
        def inspect_backup():
            backups = list(Path(args.backup_dir).glob("*.json"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(json.loads(backups[0].read_text())["fields"]["description"], doc("Old"))
        self.fake.on_edit = inspect_backup
        with contextlib.redirect_stderr(io.StringIO()):
            result = jira.description(args)
        self.assertEqual(result["status"], "verified")
        self.assertTrue(Path(result["backup"]).exists())
        self.assertEqual(self.fake.items["PROJ-1"]["fields"]["description"], doc("New"))
        self.assertEqual(self.fake.calls[-1][0], "view")
        self.assertEqual(jira.description(args)["status"], "already-correct")
        self.assertEqual(len(self.fake.writes()), 1)

    def test_failed_backup_blocks_replacement(self):
        args = self.description_args(backup_dir=str(self.root / "not-a-directory"))
        Path(args.backup_dir).write_text("occupied")
        with self.assertRaises(OSError):
            jira.description(args)
        self.assertFalse(self.fake.writes())

    def test_description_preview_and_failed_readback(self):
        args = self.description_args(apply=False)
        self.assertEqual(jira.description(args)["status"], "planned")
        self.assertFalse(self.fake.writes())
        self.assertFalse(Path(args.backup_dir).exists())
        args.apply = True
        self.fake.ignore_edit = True
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaisesRegex(ValueError, "readback differs"):
            jira.description(args)
        self.assertEqual(len(list(Path(args.backup_dir).glob("*.json"))), 1)

    def test_link_preview_and_current_mapping(self):
        self.assertEqual(jira.link(self.args(apply=False))["flags"], {"--in": "PROJ-1", "--out": "PROJ-2"})
        self.assertFalse(self.fake.writes())
        result = jira.link(self.args())
        self.assertEqual(result["status"], "verified")
        self.assertEqual(self.fake.calls[-2][1], "PROJ-1")
        self.assertEqual(self.fake.calls[-1][1], "PROJ-2")
        self.assertEqual(jira.link(self.args())["status"], "already-correct")
        self.assertEqual(len(self.fake.writes()), 1)

    def test_future_mapping_corrects_only_new_link_then_stops(self):
        unrelated = self.fake.add("PROJ-1", "PROJ-3")
        self.fake.fixed_mapping = True
        result = jira.link(self.args())
        self.assertEqual(result["status"], "corrected-mapping")
        self.assertEqual([call[:2] for call in self.fake.writes()],
                         [("link", "create"), ("link", "delete"), ("link", "create")])
        self.assertIn(unrelated, jira.ids(jira.pair("PROJ-1", "PROJ-3")))
        self.assertNotIn(result["removed_link_id"], jira.ids(jira.pair("PROJ-1", "PROJ-2")))
        self.assertEqual(jira.relationship(jira.pair("PROJ-1", "PROJ-2"), "PROJ-1", "PROJ-2", "Blocks"),
                         set(result["link_ids"]))

    def test_corrected_mapping_has_nonzero_cli_exit(self):
        self.fake.fixed_mapping = True
        output = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")
        with patch.object(sys, "argv", ["jira.py", "link", "PROJ-1", "Blocks", "PROJ-2", "--apply"]), \
                patch.object(sys, "stdout", output):
            self.assertEqual(jira.main(), 2)
        output.flush()
        self.assertEqual(json.loads(output.buffer.getvalue())["status"], "corrected-mapping")

    def test_unknown_type_and_self_link_never_write(self):
        for args in (self.args(type="Relates To"), self.args(object="PROJ-1")):
            with self.subTest(args=args), self.assertRaises(ValueError):
                jira.link(args)
        self.assertFalse(self.fake.writes())

    def test_existing_reverse_and_one_sided_links_block_writes(self):
        self.fake.add("PROJ-2", "PROJ-1")
        with self.assertRaisesRegex(ValueError, "pre-existing reverse"):
            jira.link(self.args())
        self.assertFalse(self.fake.writes())
        self.fake.items["PROJ-2"]["fields"]["issuelinks"] = []
        with self.assertRaisesRegex(ValueError, "endpoints disagree"):
            jira.link(self.args())
        self.assertFalse(self.fake.writes())

    def test_symmetric_existing_link_in_either_direction(self):
        self.fake.add("PROJ-2", "PROJ-1", "Relates")
        self.assertEqual(jira.link(self.args(type="Relates"))["status"], "already-correct")
        self.assertFalse(self.fake.writes())

    def test_failed_correction_delete_does_not_recreate(self):
        self.fake.fixed_mapping = True
        self.fake.ignore_delete = True
        with self.assertRaisesRegex(ValueError, "still present"):
            jira.link(self.args())
        self.assertEqual(len(self.fake.writes()), 2)

    def test_uncertain_create_does_not_retry(self):
        self.fake.fail_create = True
        with self.assertRaisesRegex(ValueError, "uncertain create"):
            jira.link(self.args())
        self.assertEqual(len(self.fake.writes()), 1)

    def test_unlink_requires_both_endpoints_and_verifies_deletion(self):
        id_ = self.fake.add("PROJ-1", "PROJ-2")
        args = self.args(id=id_, apply=False)
        self.assertEqual(jira.unlink(args)["status"], "planned")
        self.assertFalse(self.fake.writes())
        args.apply = True
        self.assertEqual(jira.unlink(args)["status"], "verified-deleted")
        self.assertNotIn(id_, jira.ids(jira.pair("PROJ-1", "PROJ-2")))
        with self.assertRaisesRegex(ValueError, "not present"):
            jira.unlink(args)
        self.assertEqual(len(self.fake.writes()), 1)

    def test_unlink_success_text_cannot_hide_failed_delete(self):
        id_ = self.fake.add("PROJ-1", "PROJ-2")
        self.fake.ignore_delete = True
        with self.assertRaisesRegex(ValueError, "still present"):
            jira.unlink(self.args(id=id_))

    def test_key_validation_and_missing_fields_fail_closed(self):
        for text in ("PROJ-1,PROJ-2", "../PROJ-1", "--jql", "PROJ-0"):
            with self.subTest(text=text), self.assertRaises(argparse.ArgumentTypeError):
                jira.key(text)
        del self.fake.items["PROJ-1"]["fields"]["description"]
        with self.assertRaisesRegex(ValueError, "missing requested fields"):
            jira.backup("PROJ-1", self.root / "backups")
        self.assertFalse((self.root / "backups").exists())

    def test_incomplete_link_metadata_cannot_be_mistaken_for_symmetric(self):
        self.fake.add("PROJ-2", "PROJ-1")
        self.fake.items["PROJ-1"]["fields"]["issuelinks"][0]["type"] = {"name": "Blocks"}
        with self.assertRaisesRegex(ValueError, "missing link type descriptions"):
            jira.link(self.args())
        self.assertFalse(self.fake.writes())


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Back up Jira items, replace descriptions, and verify directed links via ACLI."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


BACKUP_FIELDS = "summary,description,issuelinks"


def key(value):
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*-[1-9]\d*", value):
        raise argparse.ArgumentTypeError("expected one Jira key, such as PROJ-123")
    return value


def acli(*args):
    try:
        result = subprocess.run(["acli", "jira", "workitem", *args], capture_output=True,
                                encoding="utf-8", timeout=45, check=False)
    except subprocess.TimeoutExpired as error:
        raise ValueError("ACLI timed out; a write may have completed. Read back before retrying.") from error
    if result.returncode:
        raise ValueError(f"ACLI failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def view(issue, fields=BACKUP_FIELDS):
    data = json.loads(acli("view", issue, "--fields", fields, "--json"))
    if not isinstance(data, dict) or data.get("key") != issue or not isinstance(data.get("fields"), dict):
        raise ValueError(f"unexpected view payload for {issue}")
    if any(field not in data["fields"] for field in fields.split(",")):
        raise ValueError(f"missing requested fields for {issue}")
    if "issuelinks" in fields.split(","):
        links = data["fields"]["issuelinks"]
        if not isinstance(links, list):
            raise ValueError(f"expected an issuelinks array for {issue}")
        for entry in links:
            if not isinstance(entry, dict) or not entry.get("id") or not isinstance(entry.get("type"), dict):
                raise ValueError(f"incomplete link data for {issue}")
            if not all(isinstance(entry["type"].get(field), str) and entry["type"][field]
                       for field in ("name", "inward", "outward")):
                raise ValueError(f"missing link type descriptions for {issue}")
            endpoints = [entry[field] for field in ("inwardIssue", "outwardIssue") if field in entry]
            if len(endpoints) != 1 or not isinstance(endpoints[0], dict) or not endpoints[0].get("key"):
                raise ValueError(f"incomplete link endpoint for {issue}")
    return data


def backup(issue, directory, snapshot=None):
    snapshot = snapshot if snapshot is not None else view(issue)
    root = Path(directory).expanduser()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    fd, name = tempfile.mkstemp(prefix=f"{issue}-{stamp}-", suffix=".json", dir=root)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    return str(Path(name).resolve())


def pair(subject, object_):
    return view(subject, "issuelinks"), view(object_, "issuelinks")


def matching(item, other, type_name, direction):
    return {str(link["id"]) for link in item["fields"]["issuelinks"]
            if link.get("type", {}).get("name", "").casefold() == type_name.casefold()
            and link.get(direction, {}).get("key") == other and link.get("id")}


def relationship(items, subject, object_, type_name, reverse=False):
    left, right = ("inwardIssue", "outwardIssue") if reverse else ("outwardIssue", "inwardIssue")
    a = matching(items[0], object_, type_name, left)
    b = matching(items[1], subject, type_name, right)
    # Symmetric types can be stored from either endpoint's perspective.
    symmetric = any(link.get("type", {}).get("name", "").casefold() == type_name.casefold()
                    and link["type"]["inward"] == link["type"]["outward"]
                    for item in items for link in item["fields"]["issuelinks"])
    if symmetric:
        a |= matching(items[0], object_, type_name, right)
        b |= matching(items[1], subject, type_name, left)
    if a != b:
        raise ValueError(f"endpoints disagree for {subject} {type_name} {object_}: {sorted(a)} / {sorted(b)}; stop the batch")
    return a


def ids(items):
    return {str(link["id"]) for item in items for link in item["fields"]["issuelinks"]}


def create(subject, object_, type_name, swapped=False):
    in_, out = (object_, subject) if swapped else (subject, object_)
    acli("link", "create", "--in", in_, "--out", out, "--type", type_name, "--yes")


def link(args):
    if args.subject == args.object:
        raise ValueError("choose two different endpoints")
    before = pair(args.subject, args.object)
    correct = relationship(before, args.subject, args.object, args.type)
    if correct:
        return {"status": "already-correct", "link_ids": sorted(correct)}
    reverse = relationship(before, args.subject, args.object, args.type, reverse=True)
    if reverse:
        raise ValueError(f"pre-existing reverse link(s) {sorted(reverse)}; inspect intent before changing them")
    types = json.loads(acli("link", "type", "--json"))
    names = [item["name"] for item in types["issueLinkTypes"]]
    if args.type not in names:
        raise ValueError(f"unknown exact link type {args.type!r}; available: {', '.join(names)}")
    if not args.apply:
        return {"status": "planned", "subject": args.subject, "type": args.type, "object": args.object,
                "flags": {"--in": args.subject, "--out": args.object}}
    create(args.subject, args.object, args.type)
    after = pair(args.subject, args.object)
    correct = relationship(after, args.subject, args.object, args.type)
    if correct:
        return {"status": "verified", "link_ids": sorted(correct)}
    new_reverse = relationship(after, args.subject, args.object, args.type, reverse=True) - ids(before)
    if len(new_reverse) != 1:
        raise ValueError(f"link direction unverified; new IDs: {sorted(ids(after) - ids(before))}; stop the batch")
    wrong = next(iter(new_reverse))
    acli("link", "delete", "--id", wrong, "--yes")
    if wrong in ids(pair(args.subject, args.object)):
        raise ValueError(f"reversed link {wrong} still present; stop the batch")
    create(args.subject, args.object, args.type, swapped=True)
    corrected = pair(args.subject, args.object)
    correct = relationship(corrected, args.subject, args.object, args.type)
    if not correct:
        raise ValueError(f"swapped flags also failed verification; new IDs: {sorted(ids(corrected) - ids(before))}; stop the batch")
    return {"status": "corrected-mapping", "link_ids": sorted(correct), "removed_link_id": wrong,
            "action": "Stop the batch and report ACLI mapping drift so the skill can be updated."}


def unlink(args):
    before = pair(args.subject, args.object)
    for item, other in zip(before, (args.object, args.subject)):
        if not any(str(entry.get("id")) == args.id and
                   (entry.get("outwardIssue", {}).get("key") == other or
                    entry.get("inwardIssue", {}).get("key") == other)
                   for entry in item["fields"]["issuelinks"]):
            raise ValueError(f"link {args.id} is not present between both specified endpoints")
    if not args.apply:
        return {"status": "planned", "delete_link_id": args.id}
    acli("link", "delete", "--id", args.id, "--yes")
    if args.id in ids(pair(args.subject, args.object)):
        raise ValueError(f"link {args.id} still present after delete; stop the batch")
    return {"status": "verified-deleted", "link_id": args.id}


def description(args):
    document = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if (not isinstance(document, dict) or document.get("type") != "doc" or document.get("version") != 1
            or not isinstance(document.get("content"), list)):
        raise ValueError("description must be an ADF v1 document; use md_to_adf.py for Markdown")
    current = view(args.key)
    if current["fields"]["description"] == document:
        return {"status": "already-correct"}
    if not args.apply:
        return {"status": "planned", "key": args.key, "replaces_entire_description": True,
                "backup_dir": str(Path(args.backup_dir).expanduser())}
    saved = backup(args.key, args.backup_dir, current)
    print(f"Backup: {saved}", file=sys.stderr, flush=True)
    # Freeze exactly the reviewed document instead of rereading a mutable input.
    with tempfile.TemporaryDirectory(prefix="jira-acli-") as temporary:
        frozen = Path(temporary) / "description.json"
        frozen.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        acli("edit", "--key", args.key, "--description-file", str(frozen), "--yes")
    if view(args.key, "description")["fields"]["description"] != document:
        raise ValueError(f"description readback differs; inspect live ADF and backup {saved} before retrying")
    return {"status": "verified", "key": args.key, "backup": saved}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "description"):
        command = commands.add_parser(name)
        command.add_argument("key", type=key)
        command.add_argument("--backup-dir", default="~/.jira-acli/backups")
        if name == "description":
            command.add_argument("file", help="complete replacement ADF JSON")
            command.add_argument("--apply", action="store_true", help="perform the authorized write")
    for name in ("link", "unlink"):
        command = commands.add_parser(name)
        command.add_argument("subject", type=key)
        if name == "link":
            command.add_argument("type", help="exact Jira link type name, such as Blocks")
        command.add_argument("object", type=key)
        if name == "unlink":
            command.add_argument("id", help="exact link ID from readback")
        command.add_argument("--apply", action="store_true", help="perform the authorized write")
    args = parser.parse_args()
    try:
        if args.command == "backup":
            result = {"status": "backed-up", "key": args.key, "backup": backup(args.key, args.backup_dir)}
        else:
            result = {"link": link, "unlink": unlink, "description": description}[args.command](args)
        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
        return 2 if result["status"] == "corrected-mapping" else 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"jira: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

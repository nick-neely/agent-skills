#!/usr/bin/env python3
"""Convert a documented Markdown subset to ADF using only the standard library."""

import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


TOKEN = re.compile(r"\\([\\`*\[\]()_])|`([^`\n]+)`|\*\*((?:`[^`\n]+`|[^`\n])+?)\*\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)")
LIST = re.compile(r"^(-|\*|\d+[.)])\s+(.+)$")


def inline(text, marks=()):
    nodes = []

    def append(value, active=marks):
        if not value:
            return
        node = {"type": "text", "text": value}
        if active:
            node["marks"] = list(active)
        if nodes and nodes[-1].get("marks") == node.get("marks"):
            nodes[-1]["text"] += value
        else:
            nodes.append(node)

    offset = 0
    for match in TOKEN.finditer(text):
        append(text[offset:match.start()])
        escaped, code, strong, label, url = match.groups()
        if escaped:
            append(escaped)
        elif code:
            # ADF permits code + link, but not code + strong.
            active = tuple(mark for mark in marks if mark["type"] == "link")
            append(code, active + ({"type": "code"},))
        elif strong:
            nodes.extend(inline(strong, marks + ({"type": "strong"},)))
        else:
            if match.start() and text[match.start() - 1] == "!":
                raise ValueError("images are outside the supported Markdown subset")
            parsed = urlsplit(url)
            if not ((parsed.scheme in ("http", "https") and parsed.netloc)
                    or (parsed.scheme == "mailto" and parsed.path)):
                raise ValueError("links require an absolute http(s) or mailto URL")
            nodes.extend(inline(label, marks + ({"type": "link", "attrs": {"href": url}},)))
        offset = match.end()
    append(text[offset:])
    return nodes


def paragraph(text):
    nodes = inline(text)
    return {"type": "paragraph", **({"content": nodes} if nodes else {})}


def convert(markdown):
    content, pending = [], []
    active_list = None
    fence, language, code = None, None, []

    def flush():
        if pending:
            content.append(paragraph(" ".join(pending)))
            pending.clear()

    for number, raw in enumerate(markdown.splitlines(), 1):
        line = raw.rstrip()
        if fence:
            if re.fullmatch(re.escape(fence) + r"\s*", line):
                node = {"type": "codeBlock"}
                if language:
                    node["attrs"] = {"language": language}
                code_text = "\n".join(code)
                if code_text:
                    node["content"] = [{"type": "text", "text": code_text}]
                content.append(node)
                fence = None
            else:
                code.append(raw)
            continue
        if not line:
            flush()
            active_list = None
            continue
        opening = re.fullmatch(r"(`{3,}|~{3,})([\w+-]*)\s*", line)
        heading = re.fullmatch(r"(#{1,6})\s+(.+)", line)
        item = LIST.match(line)
        if opening:
            flush()
            active_list = None
            fence, language = opening.groups()
            code = []
        elif heading:
            flush()
            active_list = None
            content.append({"type": "heading", "attrs": {"level": len(heading[1])},
                            "content": inline(heading[2])})
        elif item:
            flush()
            kind = "bulletList" if item[1] in ("-", "*") else "orderedList"
            if active_list is None or active_list["type"] != kind:
                active_list = {"type": kind, "content": []}
                if kind == "orderedList":
                    active_list["attrs"] = {"order": int(item[1][:-1])}
                content.append(active_list)
            active_list["content"].append({"type": "listItem", "content": [paragraph(item[2])]})
        else:
            if (line[0].isspace() or line.startswith((">", "|", "![", "```", "~~~", "<"))
                    or re.fullmatch(r"[-*_]{3,}", line)):
                raise ValueError(f"line {number}: unsupported block; use flat lists, paragraphs, headings or fences")
            active_list = None
            pending.append(line)
    if fence:
        raise ValueError("unclosed code fence")
    flush()
    return {"type": "doc", "version": 1, "content": content or [paragraph("")]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="UTF-8 Markdown file, or - for stdin")
    parser.add_argument("destination", nargs="?", default="-", help="new JSON file, or - for stdout")
    args = parser.parse_args()
    try:
        text = sys.stdin.buffer.read().decode("utf-8") if args.source == "-" else Path(args.source).read_text(encoding="utf-8")
        payload = json.dumps(convert(text), ensure_ascii=False, indent=2) + "\n"
        if args.destination == "-":
            sys.stdout.buffer.write(payload.encode("utf-8"))
        else:
            with Path(args.destination).open("x", encoding="utf-8") as handle:
                handle.write(payload)
    except (OSError, ValueError) as error:
        parser.exit(1, f"md_to_adf: {error}\n")


if __name__ == "__main__":
    main()

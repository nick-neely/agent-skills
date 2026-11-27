"""Write a reproducible Skills CLI archive from a staged skill directory."""

from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(sys.argv[1])
with ZipFile(sys.argv[2], "w") as archive:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            entry = ZipInfo(path.relative_to(root).as_posix())
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED)

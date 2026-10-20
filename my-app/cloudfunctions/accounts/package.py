"""为 Day 27 注册 HTTP 函数打包，只收录本目录源码与锁定的生产依赖。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json

function_dir = Path(__file__).resolve().parent
archive_path = function_dir.parent / "accounts.zip"
source_names = ("index.js", "register.js", "package.json", "package-lock.json", "scf_bootstrap")
sources = [(function_dir / name, name) for name in source_names]
dependencies = function_dir / "node_modules"
if not dependencies.is_dir():
    raise SystemExit("请先在 accounts 目录执行 npm ci --omit=dev --ignore-scripts。")
for source in sorted(dependencies.rglob("*")):
    if source.is_file() and not source.is_symlink():
        sources.append((source, source.relative_to(function_dir).as_posix()))

with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
    for source, name in sources:
        content = source.read_bytes()
        if name in source_names:
            content = source.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
        entry = ZipInfo(name)
        entry.create_system = 3
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = (0o100755 if name == "scf_bootstrap" else 0o100644) << 16
        archive.writestr(entry, content)

print(json.dumps({"archive": str(archive_path), "files": len(sources), "bytes": archive_path.stat().st_size,
                  "说明": "启动文件为 LF 与 0755；不包含测试、配置、日志或凭证。"}, ensure_ascii=False))

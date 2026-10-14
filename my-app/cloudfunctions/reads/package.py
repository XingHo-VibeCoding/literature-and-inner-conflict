"""为 Day 17 读取函数生成带 Linux 启动权限的代码包。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

function_dir = Path(__file__).resolve().parent
archive_path = function_dir.parent / "reads.zip"
sources = [(function_dir / name, name) for name in
           ("index.js", "service.js", "auth.js", "db.js", "package.json", "scf_bootstrap")]
# 使用同一份已发布书库；仅在上传包里复制，不另建源码书库。
sources.append((function_dir.parent.parent / "shared" / "catalog.json", "catalog.json"))

with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
    for source, name in sources:
        content = source.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
        entry = ZipInfo(name)
        entry.create_system = 3
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = (0o100755 if name == "scf_bootstrap" else 0o100644) << 16
        archive.writestr(entry, content.encode("utf-8"))

print(f"已生成部署包：{archive_path}")
print("顶层七文件；启动文件为 LF 和 0755；不包含配置、日志、测试或密码。")

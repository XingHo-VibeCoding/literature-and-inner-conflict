"""为 Windows 上的 Day 15 云函数生成带 Linux 执行权限的部署包。"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

function_dir = Path(__file__).resolve().parent
archive_path = function_dir.parent / "health.zip"

# 只打包运行所需的三个文件，不夹带前端、配置、日志或打包脚本。
with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
    for name in ("index.js", "package.json", "scf_bootstrap"):
        content = (function_dir / name).read_text(encoding="utf-8-sig")
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        entry = ZipInfo(name)
        entry.create_system = 3
        entry.compress_type = ZIP_DEFLATED
        # 启动文件使用 0755，另外两个文件使用 0644。
        entry.external_attr = (0o100755 if name == "scf_bootstrap" else 0o100644) << 16
        archive.writestr(entry, content.encode("utf-8"))

print(f"已生成部署包：{archive_path}")
print("顶层文件：index.js、package.json、scf_bootstrap；启动文件为 LF 和 0755。")

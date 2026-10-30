# PyInstaller spec for the AI form-check server bundled in the desktop app.
# Build from the repo root:  pyinstaller desktop/ai-server/smartphysio-ai.spec
# Output: dist/smartphysio-ai/ (a folder, not one file, so it starts fast).
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

REPO = Path(SPECPATH).resolve().parents[1]

# Model files keep their repo-relative folders, because the predictors find
# them relative to their own source location (Path(__file__).parents[...]).
# Only top-level files: best_model/candidates/ holds unused alternatives.
datas = []
for model_dir in ("ml/models/best_model", "ml_imu/models/best_model"):
    for f in sorted((REPO / model_dir).iterdir()):
        if f.is_file():
            datas.append((str(f), model_dir))

# uvicorn picks its event loop and protocol modules by name at runtime, and
# joblib-unpickled models reference sklearn classes PyInstaller can't see.
hiddenimports = collect_submodules("uvicorn") + collect_submodules("sklearn")

a = Analysis(
    [str(REPO / "desktop" / "ai-server" / "run_server.py")],
    pathex=[str(REPO)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["torch", "pandas", "matplotlib", "tkinter", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="smartphysio-ai",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="smartphysio-ai", upx=False)

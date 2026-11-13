#!/usr/bin/env bash
# Rebuilds the two 3D model files the app ships:
#   frontend/public/models/body.glb     (the mannequin, from Mixamo's X Bot)
#   frontend/public/models/muscles.glb  (muscle areas, from Z-Anatomy)
#
# Usage:
#   tools/body-model/build.sh <path/to/X_Bot.fbx> <path/to/Z-Anatomy/Startup.blend>
#
# Neither source file is in this repository. See tools/body-model/README.md
# for where to get them and which tool versions were used.
set -euo pipefail

FBX="${1:?Give the path to X_Bot.fbx}"
BLEND="${2:?Give the path to Z-Anatomy Startup.blend}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"          # git-ignored
OUT="$REPO/frontend/public/models"
PYTHON="${PYTHON:-python3}"   # a Python with `bpy==4.2.0` installed, or set BLENDER=/path/to/blender
mkdir -p "$BUILD"

# 1. X Bot: FBX -> glTF (keeps the skeleton and skin weights; one binary file).
FBX2GLTF="$(npm exec --yes --package=fbx2gltf@0.9.7-p1 -- node -e "console.log(require.resolve('fbx2gltf/bin/'+({linux:'Linux',darwin:'Darwin',win32:'Windows_NT'})[process.platform]+'/FBX2glTF'+(process.platform==='win32'?'.exe':'')))")"
"$FBX2GLTF" --binary --input "$FBX" --output "$BUILD/body_raw"

# 2. Muscles: taken from Z-Anatomy and fitted onto the X Bot.
if [ -n "${BLENDER:-}" ]; then
  "$BLENDER" -b "$BLEND" --python "$HERE/extract_muscles.py" -- --body "$BUILD/body_raw.glb" --out "$BUILD/muscles_raw.glb"
else
  "$PYTHON" "$HERE/extract_muscles.py" -- --blend "$BLEND" --body "$BUILD/body_raw.glb" --out "$BUILD/muscles_raw.glb"
fi

# 3. Compress both with Meshopt (no Draco: the app bundles only the Meshopt decoder).
#    Meshes are kept separate and unsimplified, so bones and muscle names survive.
GT="npx --yes @gltf-transform/cli@4.5.1"
$GT optimize "$BUILD/body_raw.glb" "$OUT/body.glb" --compress meshopt --texture-compress false \
  --simplify false --join false --flatten false --prune true
$GT optimize "$BUILD/muscles_raw.glb" "$OUT/muscles.glb" --compress meshopt --texture-compress false \
  --simplify false --join false --flatten false --instance false --prune false

ls -l "$OUT"/body.glb "$OUT"/muscles.glb
echo "Done. Check the result at /demo/body in the dev server (see README.md)."

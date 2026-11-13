# Body model tools

These scripts rebuild the two 3D files the app ships in `frontend/public/models/`:

| File | What it is | Size |
| --- | --- | --- |
| `body.glb` | The rigged mannequin (Mixamo X Bot) | about 270 KB |
| `muscles.glb` | 42 muscle areas (21 muscles, left and right) fitted onto it | about 285 KB |

The app loads both from its own files. Nothing is fetched from the internet at run time.

## What you need

1. **`X_Bot.fbx`**: download the "X Bot" character from [mixamo.com](https://www.mixamo.com) with your own Adobe account (FBX Binary, T-pose, with skin). **Do not put it in this repository.** Adobe's terms let us use it in the app, but not hand the raw character file to people outside the team, and this repository is public.
2. **Z-Anatomy**: download `Z-Anatomy.zip` from <https://github.com/Z-Anatomy/Models-of-human-anatomy> and unzip it. The file needed is `Z-Anatomy/Startup.blend` (about 300 MB unzipped). **Do not commit it either.**
3. **Node 20 or newer** (for `npx`).
4. **Blender 4.2**, or Python 3.11 with `pip install bpy==4.2.0` (the same thing without the window).

Versions used for the committed files: FBX2glTF 0.9.7 (npm `fbx2gltf@0.9.7-p1`), `@gltf-transform/cli` 4.5.1, `bpy` 4.2.0, `gltfjsx` 6.5.3 (only to generate the first draft of `MannequinModel.tsx`).

## Rebuild

```bash
# with the bpy Python package
PYTHON=/path/to/venv/bin/python tools/body-model/build.sh /path/to/X_Bot.fbx /path/to/Z-Anatomy/Startup.blend

# or with a normal Blender install
BLENDER=/path/to/blender tools/body-model/build.sh /path/to/X_Bot.fbx /path/to/Z-Anatomy/Startup.blend
```

Intermediate files go to `tools/body-model/build/`, which is git-ignored.

## Check the result

```bash
cd frontend && npm run dev
```

Open `/demo/body`. It is a developer page that reads and writes nothing. Useful addresses:

- `/demo/body?raw=1&view=arm&elbow=135` elbow bend (try 0, 45, 90, 135)
- `/demo/body?raw=1&view=leg&knee=90` knee bend
- `/demo/body?raw=1&shoulder=90` shoulder raise
- `/demo/body?muscles=1&musel=1&joints=0` every muscle area
- `/demo/body?sel=right-elbow&range=100-135` target arc and moving forearm
- `/demo/body?mode=setup&pods=1` pod positions
- `/demo/body?mode=live&elbow=70&drift=25&fault=1&range=100-135` the Live panel

## How the muscles are fitted

`extract_muscles.py` explains each step at the top of the file. In short: each muscle keeps its real outline from Z-Anatomy, but is laid flat onto the mannequin's skin, because the mannequin's proportions are not a real person's. Treat the result as "this area of the body", not as an anatomical model. Limb muscles are cut off at the joints so they do not stick out when the joint bends. They move with their bone; they do not change shape.

## Licences

- **X Bot**: Adobe Mixamo character. Royalty free for personal, commercial and non-profit projects; no credit required; the raw character file may not be passed on to others. Re-read Adobe's Mixamo FAQ before a public launch.
- **Z-Anatomy**: CC BY-SA 4.0. It is built on BodyParts3D (© The Database Center for Life Science, CC BY-SA 2.1 Japan). `muscles.glb` is made from it, so `muscles.glb` is also CC BY-SA 4.0 and must keep its credit. See `frontend/public/models/README.md`.

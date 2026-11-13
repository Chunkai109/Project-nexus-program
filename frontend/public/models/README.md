# 3D models

Both files are built by `tools/body-model/build.sh`. See `tools/body-model/README.md` for the exact steps.

## body.glb

- **What:** the rigged mannequin used across the app.
- **Source:** "X Bot" character from Adobe Mixamo (<https://www.mixamo.com>), downloaded by the team as a binary FBX in T-pose.
- **Author:** Adobe.
- **Licence:** Adobe Mixamo terms. Royalty free for personal, commercial and non-profit projects. No credit required. The raw character file may not be passed on to others, so the source FBX is not in this repository.
- **Conversion:** FBX2glTF 0.9.7 (FBX to binary glTF), then `@gltf-transform/cli` 4.5.1 `optimize` with Meshopt compression. The model's own materials are replaced in code with the app's colours.

## muscles.glb

- **What:** 42 muscle areas (21 muscles, left and right), each a separate mesh named by the app's muscle id (for example `right-biceps-brachii`).
- **Source:** Z-Anatomy, <https://github.com/Z-Anatomy/Models-of-human-anatomy>.
- **Authors:** Z-Anatomy (Gauthier Kervyn, Marcin Zielinski, Lluis Vinent and contributors), based on BodyParts3D, © The Database Center for Life Science (Kousaku Okubo and colleagues).
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). BodyParts3D is CC BY-SA 2.1 Japan. **This file is an adaptation and stays under CC BY-SA 4.0.** If you share it, keep this credit and the same licence.
- **Changes made:** only the muscles the app lists were taken; each was cut to its outward-facing side, laid onto the mannequin's surface, simplified to about 900 triangles, mirrored for the left side, and compressed with Meshopt (`tools/body-model/extract_muscles.py`). The shapes are no longer anatomically exact.

The app shows this credit on the sign-in page and on the physio Settings page: "Muscle models: Z-Anatomy, CC BY-SA 4.0 (based on BodyParts3D, CC BY-SA 2.1 JP)".

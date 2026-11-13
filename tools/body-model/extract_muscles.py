"""
Extract the muscles SmartPhysio lists (frontend/src/lib/muscles.ts) from
Z-Anatomy and fit them onto the X Bot mannequin as thin surface patches.

Run (Blender 4.2, or the `bpy` Python package of the same version):

    blender -b <Z-Anatomy>/Startup.blend --python tools/body-model/extract_muscles.py -- \
        --body tools/body-model/build/body_raw.glb --out tools/body-model/build/muscles_raw.glb

    # or, with `pip install bpy==4.2.0`:
    python tools/body-model/extract_muscles.py -- --blend <Z-Anatomy>/Startup.blend \
        --body tools/body-model/build/body_raw.glb --out tools/body-model/build/muscles_raw.glb

What it does, per muscle:
  1. Joins the Z-Anatomy objects that make up the muscle (e.g. both heads of
     biceps brachii), right side, and keeps the half that faces out of the body.
  2. Each muscle follows one body segment (upper arm, forearm, thigh, shin or
     torso). Every point is described by how far along that segment's bone it
     is and which way round the bone it faces, measured between the segment's
     joints in Z-Anatomy (arms down) and replayed on the matching X Bot bones
     (T-pose).
  3. The point is then moved along that direction until it sits on the X Bot's
     skin, plus a small offset. So the outline is the real muscle's outline,
     with no gaps and nothing poking through. Limb muscles are cut at their
     two joints so nothing sticks out when a joint bends.
  4. Simplifies it, mirrors it for the left side, and names each mesh by the
     app's muscleId. The bone it moves with is stored as a custom property.

Source: Z-Anatomy (https://github.com/Z-Anatomy/Models-of-human-anatomy),
CC BY-SA 4.0, based on BodyParts3D (CC BY-SA 2.1 Japan). The exported file
stays under CC BY-SA 4.0.
"""
import math
import sys

import bpy  # must come first: with the pip `bpy` package it is what makes bmesh and mathutils importable
import bmesh  # noqa: E402
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


BLEND = arg('--blend')
BODY = arg('--body')
OUT = arg('--out')
if not BODY or not OUT:
    raise SystemExit('usage: ... -- [--blend Startup.blend] --body body_raw.glb --out muscles_raw.glb')

if BLEND:
    # Scripts embedded in the file are not run.
    bpy.ops.wm.open_mainfile(filepath=BLEND, use_scripts=False)

# --------------------------------------------------------------------------
# The app's muscles: muscleId slug -> (Z-Anatomy objects, segment, bone, layer)
# `layer` orders overlapping patches: higher sits further out.
# --------------------------------------------------------------------------
MUSCLES = {
    'pectoralis-major': (['Clavicular head of pectoralis major muscle', 'Sternocostal head of pectoralis major muscle', '(Abdominal part of pectoralis major muscle)'], 'torso', 'Spine2', 2),
    'pectoralis-minor': (['Pectoralis minor muscle'], 'torso', 'Spine2', 1),
    'latissimus-dorsi': (['Latissimus dorsi muscle'], 'torso', 'Spine1', 1),
    'trapezius': (['Descending part of trapezius muscle', 'Transverse part of trapezius muscle', 'Ascending part of trapezius muscle'], 'torso', 'Spine2', 3),
    'rhomboids': (['Rhomboid major muscle', 'Rhomboid minor muscle'], 'torso', 'Spine2', 2),
    'anterior-deltoid': (['Clavicular part of deltoid muscle'], 'upper_arm', 'RightArm', 3),
    'lateral-deltoid': (['Acromial part of deltoid muscle'], 'upper_arm', 'RightArm', 3),
    'posterior-deltoid': (['Scapular spinal part of deltoid muscle'], 'upper_arm', 'RightArm', 3),
    'biceps-brachii': (['Long head of biceps brachii', 'Short head of biceps brachii'], 'upper_arm', 'RightArm', 2),
    'triceps-brachii': (['Long head of triceps brachii', 'Lateral head of triceps brachii', 'Medial head of triceps brachii'], 'upper_arm', 'RightArm', 2),
    'flexor-carpi-radialis': (['Flexor carpi radialis'], 'forearm', 'RightForeArm', 2),
    'extensor-carpi-radialis': (['Extensor carpi radialis longus', 'Extensor carpi radialis brevis'], 'forearm', 'RightForeArm', 2),
    'rectus-abdominis': (['Rectus abdominis muscle'], 'torso', 'Spine', 3),
    'external-oblique': (['External abdominal oblique muscle'], 'torso', 'Spine', 2),
    'erector-spinae': (['Iliocostalis lumborum muscle', 'Longissimus thoracis muscle', 'Spinalis thoracis muscle'], 'torso', 'Spine1', 0),
    'vastus-medialis': (['Vastus medialis muscle'], 'thigh', 'RightUpLeg', 2),
    'biceps-femoris': (['Long head of biceps femoris', 'Short head of biceps femoris'], 'thigh', 'RightUpLeg', 2),
    'adductor-longus': (['Adductor longus'], 'thigh', 'RightUpLeg', 2),
    'gastrocnemius': (['Medial head of gastrocnemius', 'Lateral head of gastrocnemius'], 'shin', 'RightLeg', 3),
    'soleus': (['Soleus muscle'], 'shin', 'RightLeg', 2),
    'tibialis-anterior': (['Tibialis anterior muscle'], 'shin', 'RightLeg', 2),
}

BASE_OFFSET = 0.0030  # metres above the skin
LAYER_STEP = 0.0012
TARGET_TRIS = 900     # per muscle, per side
FRONT = Vector((0, -1, 0))  # both models face -Y in Blender


def world_verts(name):
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != 'MESH':
        raise SystemExit(f'Z-Anatomy object not found: {name!r}')
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def end_point(verts, top, band=0.02):
    """Centre of the top or bottom slice of a long bone = the joint it ends at."""
    zs = [v.z for v in verts]
    edge = max(zs) if top else min(zs)
    pts = [v for v in verts if abs(v.z - edge) <= band]
    return sum(pts, Vector()) / len(pts)


# ---- Joints in Z-Anatomy (right side), from its bones ----
humerus, radius, ulna = world_verts('Humerus.r'), world_verts('Radius.r'), world_verts('Ulna.r')
femur, tibia = world_verts('Femur.r'), world_verts('Tibia.r')
Z = {
    'shoulder': end_point(humerus, True, 0.03),
    'elbow': end_point(humerus, False),
    'wrist': end_point(radius + ulna, False),
    'hip': end_point(femur, True, 0.03),
    'knee': end_point(femur, False),
    'ankle': end_point(tibia, False),
}


def mirrored(p):
    return Vector((-p.x, p.y, p.z))


# ---- Read each muscle's geometry (world space, modifiers applied) before the scene is cleared ----
def read_muscle(names):
    deps = bpy.context.evaluated_depsgraph_get()
    verts, faces = [], []
    for base in names:
        obj = bpy.data.objects.get(base + '.r')
        if obj is None or obj.type != 'MESH':
            raise SystemExit(f'Z-Anatomy muscle not found: {base}.r')
        ev = obj.evaluated_get(deps)
        me = ev.to_mesh()
        off = len(verts)
        verts += [ev.matrix_world @ v.co for v in me.vertices]
        faces += [[off + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return verts, faces


SOURCE = {slug: read_muscle(spec[0]) for slug, spec in MUSCLES.items()}

# ---- Load the X Bot ----
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=BODY)
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
surface = next(o for o in bpy.data.objects if o.type == 'MESH' and 'Surface' in o.name)


def bone(name):
    return armature.matrix_world @ armature.data.bones['mixamorig:' + name].head_local


X = {
    'shoulder': bone('RightArm'), 'elbow': bone('RightForeArm'), 'wrist': bone('RightHand'),
    'hip': bone('RightUpLeg'), 'knee': bone('RightLeg'), 'ankle': bone('RightFoot'),
}

# Body in rest pose (skin and joint balls together), split by the bone each
# triangle moves with. A muscle is only ever placed on the part of the body it
# belongs to, so a thigh muscle cannot land on the hips or on the other leg.
PART_BONES = {
    'upper_arm': ('RightArm',),
    'forearm': ('RightForeArm',),
    'thigh': ('RightUpLeg',),
    'shin': ('RightLeg',),
    'torso': ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'RightShoulder', 'LeftShoulder'),
}


def body_trees():
    verts, tris = [], {k: [] for k in PART_BONES}
    for part in [o for o in bpy.data.objects if o.type == 'MESH']:
        me = part.data
        off = len(verts)
        verts += [part.matrix_world @ v.co for v in me.vertices]
        names = {g.index: g.name.replace('mixamorig:', '') for g in part.vertex_groups}
        for poly in me.polygons:
            weight = {}
            for vi in poly.vertices:
                for g in me.vertices[vi].groups:
                    weight[names[g.group]] = weight.get(names[g.group], 0) + g.weight
            owner = max(weight, key=weight.get) if weight else ''
            for segment, bones in PART_BONES.items():
                if owner in bones:
                    ids = [off + i for i in poly.vertices]
                    tris[segment] += [(ids[0], ids[i], ids[i + 1]) for i in range(1, len(ids) - 1)]
    return {segment: BVHTree.FromPolygons(verts, t) for segment, t in tris.items()}


BODY_TREES = body_trees()


def frame(axis):
    """Right-handed frame: u runs along the limb, f points as far forward as it can, n completes it."""
    u = axis.normalized()
    f = (FRONT - FRONT.dot(u) * u)
    if f.length < 1e-4:
        f = Vector((1, 0, 0)) - Vector((1, 0, 0)).dot(u) * u
    f.normalize()
    return u, f, u.cross(f)


# How far out from the limb's centre line the skin can be (metres, X Bot).
REACH = {'upper_arm': 0.10, 'forearm': 0.085, 'thigh': 0.115, 'shin': 0.10, 'torso': 0.30}


def limb_coords(a, b, segment):
    """
    Describes a point by where it is along the bone (t) and which way round the
    bone it faces (angle), in Z-Anatomy; and gives back the matching centre-line
    point and outward direction on the X Bot.
    """
    z0, z1, x0, x1 = Z[a], Z[b], X[a], X[b]
    uz, fz, nz = frame(z1 - z0)
    ux, fx, nx = frame(x1 - x0)
    lz, lx = (z1 - z0).length, (x1 - x0).length

    def to_param(p):
        d = p - z0
        t = d.dot(uz) / lz
        r = d - d.dot(uz) * uz
        return t, math.atan2(r.dot(nz), r.dot(fz)), (r.normalized() if r.length > 1e-6 else fz)

    def to_body(t, ang):
        return x0 + ux * (t * lx), fx * math.cos(ang) + nx * math.sin(ang)
    return to_param, to_body, lx / lz


def torso_coords():
    """The trunk: t is the height between hips (0) and shoulders (1); the angle goes round the vertical centre line."""
    zs, zh = (Z['shoulder'] + mirrored(Z['shoulder'])) / 2, (Z['hip'] + mirrored(Z['hip'])) / 2
    xs, xh = (X['shoulder'] + mirrored(X['shoulder'])) / 2, (X['hip'] + mirrored(X['hip'])) / 2

    def to_param(p):
        t = (p.z - zh.z) / (zs.z - zh.z)
        r = Vector((p.x, p.y - (zh.y + (zs.y - zh.y) * t), 0))
        return t, math.atan2(r.x, -r.y), (r.normalized() if r.length > 1e-6 else FRONT)

    def to_body(t, ang):
        centre = Vector((0, xh.y + (xs.y - xh.y) * t, xh.z + (xs.z - xh.z) * t))
        return centre, Vector((math.sin(ang), -math.cos(ang), 0))
    return to_param, to_body, (xs.z - xh.z) / (zs.z - zh.z)


COORDS = {
    'upper_arm': limb_coords('shoulder', 'elbow', 'upper_arm'),
    'forearm': limb_coords('elbow', 'wrist', 'forearm'),
    'thigh': limb_coords('hip', 'knee', 'thigh'),
    'shin': limb_coords('knee', 'ankle', 'shin'),
    'torso': torso_coords(),
}


def press_onto_body(bm, offset, body_tree):
    for v in bm.verts:
        hit, normal, _i, _d = body_tree.find_nearest(v.co)
        if hit is not None:
            v.co = hit + normal * offset


def build(slug, segment, layer):
    """
    Places one muscle on the X Bot. Every point keeps its place along the bone
    and its direction round the bone, and is moved in or out along that
    direction until it sits on the X Bot's skin. So the outline is the real
    muscle's outline, and the patch cannot float above the body or sink into it.
    """
    verts, faces = SOURCE[slug]
    to_param, to_body, scale = COORDS[segment]
    reach = REACH[segment]
    body_tree = BODY_TREES[segment]
    offset = BASE_OFFSET + layer * LAYER_STEP
    bm = bmesh.new()
    bverts = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([bverts[i] for i in f])
        except ValueError:
            pass  # duplicate face in the source
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()

    # Keep only the side of the muscle that faces out of the body.
    inner = [f for f in bm.faces if f.normal.dot(to_param(f.calc_center_median())[2]) < 0.2]
    bmesh.ops.delete(bm, geom=inner, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    was = {f: max(e.calc_length() for e in f.edges) * scale for f in bm.faces}
    lost = []
    for v in bm.verts:
        t, ang, _r = to_param(v.co)
        # A limb muscle is kept only between its two joints: anything past them
        # would sit on the next body part and stick out when the joint bends.
        if segment != 'torso' and not (0.05 <= t <= 1.0):
            lost.append(v)
            continue
        centre, out = to_body(t, ang)
        # Look from outside straight in at the centre line: the first thing seen is the skin.
        hit, normal, _i, _d = body_tree.ray_cast(centre + out * reach, -out, reach)
        if hit is None:
            lost.append(v)
            continue
        if normal.dot(out) < 0:
            normal = -normal
        v.co = hit + normal * offset
    bmesh.ops.delete(bm, geom=lost, context='VERTS')
    # Drop triangles that got stretched across a gap between two parts of the body.
    torn = [f for f in bm.faces if f.is_valid and max(e.calc_length() for e in f.edges) > 3 * was.get(f, 0) + 0.012]
    bmesh.ops.delete(bm, geom=torn, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    me = bpy.data.meshes.new(slug)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(slug, me)
    bpy.context.scene.collection.objects.link(obj)

    # Simplify, then smooth and press again so the patch hugs the surface.
    tris = len(me.polygons)
    if tris > TARGET_TRIS:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = TARGET_TRIS / tris
    smooth = obj.modifiers.new('smooth', 'SMOOTH')
    smooth.iterations = 3
    smooth.factor = 0.5
    deps = bpy.context.evaluated_depsgraph_get()
    final = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    obj.modifiers.clear()
    obj.data = final
    bm = bmesh.new()
    bm.from_mesh(final)
    press_onto_body(bm, offset, body_tree)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(final)
    bm.free()
    for p in final.polygons:
        p.use_smooth = True
    return obj


exported = []
for slug, (_names, segment, bone_name, layer) in MUSCLES.items():
    right = build(slug, segment, layer)
    right.name = right.data.name = f'right-{slug}'
    right['bone'] = 'mixamorig:' + bone_name
    right['source'] = 'Z-Anatomy, CC BY-SA 4.0 (based on BodyParts3D, CC BY-SA 2.1 JP)'

    left = right.copy()
    left.data = right.data.copy()
    bpy.context.scene.collection.objects.link(left)
    left.name = left.data.name = f'left-{slug}'
    left['bone'] = 'mixamorig:' + bone_name.replace('Right', 'Left')
    bm = bmesh.new()
    bm.from_mesh(left.data)
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(left.data)
    bm.free()
    exported += [right, left]
    print(f'muscle {slug:26} tris={len(right.data.polygons):5d} segment={segment:9} bone={bone_name}')

# ---- Export only the muscles ----
for o in list(bpy.data.objects):
    o.select_set(o in exported)
bpy.context.view_layer.objects.active = exported[0]
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_extras=True,
    export_yup=True,
    export_apply=True,
    export_materials='NONE',
    export_normals=True,
    export_texcoords=False,
    export_animations=False,
    export_skins=False,
)
print(f'wrote {OUT} with {len(exported)} muscle meshes')

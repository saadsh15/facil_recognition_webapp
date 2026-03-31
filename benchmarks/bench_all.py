"""
bench_all.py — Baseline performance benchmarks for FaceRec.

Run from the backend/ directory:
    cd backend && ../.venv/bin/python3 ../benchmarks/bench_all.py

Measures:
  1. MTCNN detect() latency
  2. FaceNet embed() latency
  3. full detect_and_embed() pipeline latency
  4. FrameStore get_raw() / set_raw() copy overhead
  5. JPEG encode latency (cv2.imencode)
  6. pgvector find_match_voting() DB query latency (1 face, 5 faces, 10 faces in DB)
  7. list_faces() query latency (outerjoin + count)
  8. get_thumbnail() query latency (repeated hits — caching absent)
  9. LANCZOS vs BILINEAR thumbnail resize latency
 10. thumbnail base64 encode latency
"""

import os
import sys
import time
import statistics
import numpy as np

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://facerec:facerec_pass@localhost:5432/facerec_db")
os.chdir(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.getcwd())

import cv2
import torch
from PIL import Image

# ── helpers ──────────────────────────────────────────────────────────────────

def bench(label: str, fn, n: int = 20) -> dict:
    # Warm-up
    for _ in range(3):
        fn()
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000)
    mean = statistics.mean(times)
    med  = statistics.median(times)
    mn   = min(times)
    mx   = max(times)
    print(f"  {label:<55} mean={mean:7.2f}ms  median={med:7.2f}ms  min={mn:6.2f}ms  max={mx:6.2f}ms")
    return {"label": label, "mean": mean, "median": med, "min": mn, "max": mx}


def make_test_frame(w=640, h=480):
    return np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)


def make_test_embedding():
    e = np.random.randn(512).astype(np.float32)
    return e / np.linalg.norm(e)


results = {}

# ── 1. Model loading (one-time) ────────────────────────────────────────────
print("\n[ Loading models... ]")
from recognition import get_models
mtcnn, resnet = get_models()
print("  Models loaded OK.\n")

# ── 2. MTCNN detect latency ────────────────────────────────────────────────
print("[ 1. MTCNN detect() latency ]")
test_frame = make_test_frame()
pil_img = Image.fromarray(cv2.cvtColor(test_frame, cv2.COLOR_BGR2RGB))
results["mtcnn_detect"] = bench(
    "mtcnn.detect() on 640x480 frame (no faces)",
    lambda: mtcnn.detect(pil_img),
    n=20,
)

# ── 3. FaceNet embed latency ───────────────────────────────────────────────
print("\n[ 2. FaceNet embed() latency ]")
dummy_tensor = torch.randint(0, 255, (3, 160, 160), dtype=torch.uint8)
from recognition import embed
results["embed"] = bench(
    "embed() single 160x160 face tensor",
    lambda: embed(dummy_tensor),
    n=30,
)

# ── 4. Full detect_and_embed pipeline ─────────────────────────────────────
print("\n[ 3. detect_and_embed() pipeline ]")
from recognition import detect_and_embed
results["detect_and_embed_no_face"] = bench(
    "detect_and_embed() 640x480, 0 faces",
    lambda: detect_and_embed(pil_img),
    n=20,
)

# ── 5. FrameStore copy overhead ───────────────────────────────────────────
print("\n[ 4. FrameStore copy overhead ]")
from camera import FrameStore
fs = FrameStore()
frame = make_test_frame()
fs.set_raw(frame)
results["framestore_get_raw"] = bench(
    "FrameStore.get_raw() — 640x480 BGR copy",
    lambda: fs.get_raw(),
    n=100,
)
results["framestore_set_raw"] = bench(
    "FrameStore.set_raw() — store new frame",
    lambda: fs.set_raw(frame),
    n=100,
)
results["framestore_get_annotated_same_ver"] = bench(
    "FrameStore.get_annotated() — same version (no copy)",
    lambda: fs.get_annotated(since_version=fs._annotated_version),
    n=100,
)

# ── 6. JPEG encode latency ────────────────────────────────────────────────
print("\n[ 5. JPEG encode latency ]")
frame_bgr = make_test_frame()
results["jpeg_encode_q80"] = bench(
    "cv2.imencode('.jpg', frame, quality=80) — 640x480",
    lambda: cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80]),
    n=50,
)
results["jpeg_encode_q50"] = bench(
    "cv2.imencode('.jpg', frame, quality=50) — 640x480",
    lambda: cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 50]),
    n=50,
)

# ── 7. Thumbnail resize: LANCZOS vs BILINEAR ──────────────────────────────
print("\n[ 6. Thumbnail resize quality comparison ]")
pil_face = Image.fromarray(np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8))
results["resize_lanczos"] = bench(
    "PIL resize 200x200 → 120x120, LANCZOS",
    lambda: pil_face.resize((120, 120), Image.LANCZOS),
    n=100,
)
results["resize_bilinear"] = bench(
    "PIL resize 200x200 → 120x120, BILINEAR",
    lambda: pil_face.resize((120, 120), Image.BILINEAR),
    n=100,
)

# ── 8. Base64 thumbnail encode ────────────────────────────────────────────
print("\n[ 7. Thumbnail base64 encode ]")
import io, base64
def encode_thumbnail():
    buf = io.BytesIO()
    pil_face.save(buf, format="JPEG", quality=75)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
results["thumbnail_b64"] = bench(
    "PIL JPEG save + base64 encode (120x120)",
    encode_thumbnail,
    n=100,
)

# ── 9. DB: find_match_voting with varying DB sizes ────────────────────────
print("\n[ 8. DB: find_match_voting() latency ]")
from database import create_db
from models import Person, FaceEmbedding, Base
from sqlalchemy import text

engine, SessionLocal = create_db(os.environ["DATABASE_URL"])

# Seed test data
def seed_persons(n: int):
    with SessionLocal() as s:
        s.execute(text("DELETE FROM face_embeddings WHERE person_id IN (SELECT id FROM persons WHERE name LIKE 'bench_%')"))
        s.execute(text("DELETE FROM persons WHERE name LIKE 'bench_%'"))
        s.commit()
    with SessionLocal() as s:
        for i in range(n):
            p = Person(name=f"bench_{i}")
            s.add(p)
            s.flush()
            emb = make_test_embedding()
            fe = FaceEmbedding(person_id=p.id, embedding=emb.tolist())
            s.add(fe)
        s.commit()

def cleanup():
    with SessionLocal() as s:
        s.execute(text("DELETE FROM face_embeddings WHERE person_id IN (SELECT id FROM persons WHERE name LIKE 'bench_%')"))
        s.execute(text("DELETE FROM persons WHERE name LIKE 'bench_%'"))
        s.commit()

from recognition import find_match_voting
query_emb = make_test_embedding()

for n_persons in [5, 20, 100]:
    seed_persons(n_persons)
    with SessionLocal() as s:
        results[f"find_match_voting_{n_persons}_persons"] = bench(
            f"find_match_voting() — {n_persons} persons in DB",
            lambda: find_match_voting(query_emb, s),
            n=30,
        )
cleanup()

# ── 10. DB: list_faces() outerjoin query ─────────────────────────────────
print("\n[ 9. DB: list_faces() outerjoin+count query ]")
seed_persons(50)
from sqlalchemy import func
from models import Person, FaceEmbedding

def list_faces_query():
    with SessionLocal() as s:
        return (
            s.query(Person, func.count(FaceEmbedding.id).label("emb_count"))
            .outerjoin(FaceEmbedding, FaceEmbedding.person_id == Person.id)
            .group_by(Person.id)
            .order_by(Person.created_at.desc())
            .all()
        )

results["list_faces_50"] = bench(
    "list_faces() outerjoin+count — 50 persons",
    list_faces_query,
    n=20,
)
cleanup()

# ── 11. DB: get_thumbnail repeated (no cache) ────────────────────────────
print("\n[ 10. DB: get_thumbnail() repeated — no cache ]")
seed_persons(1)
with SessionLocal() as s_seed:
    person = s_seed.query(Person).filter(Person.name == "bench_0").first()
    person_id = person.id

def get_thumbnail_query():
    with SessionLocal() as s:
        return (
            s.query(FaceEmbedding)
            .filter_by(person_id=person_id)
            .order_by(FaceEmbedding.created_at.desc())
            .first()
        )

results["get_thumbnail_uncached"] = bench(
    "get_thumbnail() — uncached, 1 embedding",
    get_thumbnail_query,
    n=30,
)
cleanup()

# ── Summary ───────────────────────────────────────────────────────────────
print("\n" + "="*80)
print("BASELINE SUMMARY (mean latency)")
print("="*80)
for k, v in results.items():
    print(f"  {k:<50} {v['mean']:8.3f} ms")
print()

# Write JSON results for reference
import json
results_path = os.path.join(os.path.dirname(__file__), "baseline_results.json")
with open(results_path, "w") as f:
    json.dump(results, f, indent=2)
print(f"Results saved to {results_path}")

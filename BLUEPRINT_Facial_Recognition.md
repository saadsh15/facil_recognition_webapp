# Architectural Blueprint: Real-Time Facial Recognition Web App

## 1. Executive Summary

A locally-deployed facial recognition system with a React + Vite frontend and a Flask backend. The server reads directly from the local camera device (`/dev/video0`) using OpenCV, detects faces with MTCNN, extracts 512-dimensional embeddings using FaceNet (`InceptionResnetV1` via `facenet-pytorch`), and compares them against stored embeddings in PostgreSQL using the `pgvector` extension (cosine distance). Annotated frames are streamed to the browser as an MJPEG feed via a `multipart/x-mixed-replace` HTTP response. Users can register new faces through the React UI by triggering a frame capture, previewing the detected face crop, entering a name, and saving. All data stays on the local machine — no authentication required.

**Primary User Flow:**
1. User opens `http://localhost:5173` in browser.
2. Live annotated video stream appears (bounding boxes + name labels).
3. User clicks "Register New Face" → backend captures current frame → MTCNN crops face → preview shown.
4. User types a name → clicks "Save" → embedding stored in PostgreSQL.
5. Face is recognised in real time from next frame onward.

**Stack:** Python 3.11 · Flask 3.0.3 · OpenCV 4.10.0 · facenet-pytorch 2.5.3 · PyTorch 2.3.1 · PostgreSQL 16 · pgvector 0.3.2 · SQLAlchemy 2.0.36 · React 18.3.1 · Vite 5.4.2 · Tailwind CSS 3.4.13

---

## 2. Dependency Matrix

### Backend (Python 3.11)
| Package | Version | Role in this project |
|---|---|---|
| `flask` | 3.0.3 | HTTP server, MJPEG streaming route, REST API endpoints |
| `flask-cors` | 4.0.1 | Allows React dev server (localhost:5173) to call Flask (localhost:5000) |
| `opencv-python` | 4.10.0.84 | Captures frames from `/dev/video0`, draws bounding boxes and labels, encodes frames as JPEG |
| `facenet-pytorch` | 2.5.3 | Provides MTCNN (face detection + cropping) and InceptionResnetV1 (512-d embedding extraction) |
| `torch` | 2.3.1 | PyTorch runtime required by facenet-pytorch; CPU build used for local deployment |
| `torchvision` | 0.18.1 | Required transitive dependency of facenet-pytorch |
| `numpy` | 1.26.4 | Frame array manipulation, embedding normalisation |
| `Pillow` | 10.4.0 | Converts OpenCV BGR frames to RGB PIL Images required by MTCNN/FaceNet |
| `psycopg2-binary` | 2.9.9 | PostgreSQL adapter used by SQLAlchemy |
| `sqlalchemy` | 2.0.36 | ORM for the `faces` table; manages connection pool |
| `pgvector` | 0.3.2 | SQLAlchemy type `Vector(512)` and registers `<=>` cosine distance operator |
| `python-dotenv` | 1.0.1 | Loads `DATABASE_URL` and `CAMERA_INDEX` from `.env` |

### Frontend (Node.js 20)
| Package | Version | Role in this project |
|---|---|---|
| `react` | 18.3.1 | Component tree, state management for face list and registration modal |
| `react-dom` | 18.3.1 | DOM rendering |
| `vite` | 5.4.2 | Dev server on port 5173, proxies `/api` and `/stream` to Flask |
| `@vitejs/plugin-react` | 4.3.1 | JSX transform for Vite |
| `axios` | 1.7.7 | HTTP calls to `/api/faces` (GET, POST, DELETE) and `/api/capture-frame` (POST) |
| `tailwindcss` | 3.4.13 | Utility CSS for layout, modal, face list cards |
| `postcss` | 8.4.47 | Required by Tailwind |
| `autoprefixer` | 10.4.20 | Required by Tailwind |

### System Prerequisites
- **PostgreSQL 16** with `pgvector` extension (`apt install postgresql-16-pgvector` on Debian/Arch: `pacman -S postgresql`)
- **Python 3.11** (`python3.11 -m venv`)
- **Node.js 20** (`node --version` must be ≥ 20)
- **Camera device** accessible at `/dev/video0` (configurable via `CAMERA_INDEX=0` in `.env`)

---

## 3. Data Models & Schemas

### PostgreSQL — `faces` table

```sql
-- Run once to enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE faces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    embedding   vector(512) NOT NULL,
    thumbnail   TEXT,          -- base64-encoded JPEG of the cropped face (120x120)
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast approximate nearest-neighbour cosine search
CREATE INDEX ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### SQLAlchemy ORM Model (`backend/models.py`)

```python
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func
import uuid

class Base(DeclarativeBase):
    pass

class Face(Base):
    __tablename__ = "faces"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name       = Column(String(255), nullable=False)
    embedding  = Column(Vector(512), nullable=False)
    thumbnail  = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

### Recognition Result (runtime dict — not persisted)

```python
{
    "face_id": "uuid-or-None",
    "name": "Alice",           # "Unknown" if no match
    "distance": 0.42,          # cosine distance; lower = more similar
    "box": [x1, y1, x2, y2],  # pixel coordinates in original frame
    "confidence": 0.998        # MTCNN detection confidence
}
```

---

## 4. System Architecture & Flow

### A. MJPEG Streaming Pipeline (continuous, threaded)

```
CameraThread (daemon thread)
  └─ cv2.VideoCapture(CAMERA_INDEX)
       └─ frame captured at ~30 fps → stored in shared FrameBuffer (threading.Lock)

RecognitionThread (daemon thread, runs at ~5 fps to avoid CPU saturation)
  └─ reads latest frame from FrameBuffer
       └─ PIL.Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            └─ MTCNN.detect(pil_image) → boxes[], probs[]
                 └─ for each box with prob > 0.90:
                      └─ crop face → resize to 160x160 → InceptionResnetV1 → 512-d embedding (L2-normalised)
                           └─ pgvector query: SELECT id, name, embedding <=> :q AS dist FROM faces ORDER BY dist LIMIT 1
                                └─ if dist < 0.70 → label = name, else → label = "Unknown"
                 └─ cv2.rectangle + cv2.putText drawn onto frame copy
                      └─ stored in shared AnnotatedFrameBuffer

Flask Route  GET /stream  (main thread)
  └─ reads from AnnotatedFrameBuffer in a generator
       └─ cv2.imencode('.jpg', frame) → bytes
            └─ yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n'
                 └─ Response(generator, mimetype='multipart/x-mixed-replace; boundary=frame')
```

### B. Face Registration Flow

```
React UI
  └─ User clicks "Capture Frame"
       └─ POST /api/capture-frame  (no body)
            └─ Flask reads latest raw frame from FrameBuffer
                 └─ MTCNN detects largest face → crops → resizes 120x120 → base64 JPEG
                      └─ InceptionResnetV1 → 512-d embedding (stored temporarily in Flask session dict keyed by capture_id UUID)
                           └─ returns JSON: { capture_id, thumbnail_base64 }

React UI
  └─ Displays thumbnail preview, user types name, clicks "Save Face"
       └─ POST /api/faces  body: { capture_id, name }
            └─ Flask retrieves embedding from session dict by capture_id
                 └─ INSERT INTO faces (name, embedding, thumbnail) VALUES (...)
                      └─ returns JSON: { id, name, created_at }

React UI
  └─ Appends new face card to face list, clears modal
```

### C. Face List Management

```
React UI mounts
  └─ GET /api/faces → returns [{id, name, thumbnail, created_at}]
       └─ Rendered as card grid

User clicks delete icon on a card
  └─ DELETE /api/faces/:id
       └─ Flask: DELETE FROM faces WHERE id = :id
            └─ React removes card from state
```

---

## 5. Directory Structure

```
facial_recognition/
├── BLUEPRINT_Facial_Recognition.md
├── backend/
│   ├── .env                    # DATABASE_URL, CAMERA_INDEX
│   ├── requirements.txt
│   ├── app.py                  # Flask app factory, routes
│   ├── camera.py               # CameraThread, AnnotationThread, FrameBuffer classes
│   ├── recognition.py          # MTCNN + FaceNet model loading, embed(), find_match()
│   ├── database.py             # SQLAlchemy engine, Session factory, init_db()
│   └── models.py               # Face ORM model
└── frontend/
    ├── package.json
    ├── vite.config.js           # proxy /api and /stream to localhost:5000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx              # Layout: stream panel + sidebar
        ├── api.js               # axios instance + typed API helpers
        └── components/
            ├── VideoStream.jsx  # <img src="/stream"> with connection status
            ├── FaceRegister.jsx # Capture → preview → name input → save modal
            └── FaceList.jsx     # Grid of known face cards with delete button
```

---

## 6. Step-by-Step Implementation Guide

### Phase 1: System & Database Setup

1. **Install PostgreSQL 16 and pgvector** (Arch Linux):
   ```bash
   sudo pacman -S postgresql
   sudo -u postgres initdb --locale en_US.UTF-8 -D /var/lib/postgres/data
   sudo systemctl enable --now postgresql
   # pgvector must be compiled from source on Arch:
   git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git /tmp/pgvector
   cd /tmp/pgvector
   make
   sudo make install
   ```

2. **Create database and user:**
   ```bash
   sudo -u postgres psql -c "CREATE USER facerec WITH PASSWORD 'facerec_pass';"
   sudo -u postgres psql -c "CREATE DATABASE facerec_db OWNER facerec;"
   sudo -u postgres psql -d facerec_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

3. **Create Python virtual environment:**
   ```bash
   cd /home/appuser/Projects/facial_recognition
   python3.11 -m venv backend/.venv
   source backend/.venv/bin/activate
   ```

4. **Create `backend/requirements.txt`** with exact content:
   ```
   flask==3.0.3
   flask-cors==4.0.1
   opencv-python==4.10.0.84
   facenet-pytorch==2.5.3
   torch==2.3.1
   torchvision==0.18.1
   numpy==1.26.4
   Pillow==10.4.0
   psycopg2-binary==2.9.9
   sqlalchemy==2.0.36
   pgvector==0.3.2
   python-dotenv==1.0.1
   ```

5. **Install Python dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```
   > Note: `torch==2.3.1` CPU-only. If CUDA is available, replace with `torch==2.3.1+cu121 --index-url https://download.pytorch.org/whl/cu121`.

6. **Create `backend/.env`:**
   ```
   DATABASE_URL=postgresql+psycopg2://facerec:facerec_pass@localhost:5432/facerec_db
   CAMERA_INDEX=0
   FLASK_ENV=development
   RECOGNITION_THRESHOLD=0.70
   RECOGNITION_FPS=5
   ```

---

### Phase 2: Backend Implementation

**Step 1 — Create `backend/models.py`:**
```python
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func
import uuid

class Base(DeclarativeBase):
    pass

class Face(Base):
    __tablename__ = "faces"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name       = Column(String(255), nullable=False)
    embedding  = Column(Vector(512), nullable=False)
    thumbnail  = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": str(self.id),
            "name": self.name,
            "thumbnail": self.thumbnail,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
```

**Step 2 — Create `backend/database.py`:**
```python
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from models import Base

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    """Create tables and IVFFlat index if they don't exist."""
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS faces_embedding_idx "
            "ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
        ))
        conn.commit()

def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
```

**Step 3 — Create `backend/recognition.py`:**
```python
import os
import torch
import numpy as np
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1
from sqlalchemy.orm import Session
from sqlalchemy import text

_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_mtcnn = None
_resnet = None

def get_models():
    global _mtcnn, _resnet
    if _mtcnn is None:
        _mtcnn = MTCNN(
            keep_all=True,
            device=_device,
            min_face_size=40,
            thresholds=[0.6, 0.7, 0.7],
            post_process=False,
        )
    if _resnet is None:
        _resnet = InceptionResnetV1(pretrained="vggface2").eval().to(_device)
    return _mtcnn, _resnet

def embed(face_tensor: torch.Tensor) -> np.ndarray:
    """
    face_tensor: (3, 160, 160) uint8 tensor in RGB, values 0-255.
    Returns: (512,) float32 L2-normalised numpy array.
    """
    _, resnet = get_models()
    face_tensor = face_tensor.float().div(255.0)
    face_tensor = (face_tensor - 0.5) / 0.5  # normalise to [-1, 1]
    face_tensor = face_tensor.unsqueeze(0).to(_device)
    with torch.no_grad():
        emb = resnet(face_tensor)
        emb = torch.nn.functional.normalize(emb, p=2, dim=1)
    return emb.squeeze(0).cpu().numpy().astype(np.float32)

def detect_and_embed(pil_image: Image.Image):
    """
    Returns list of dicts: [{box, prob, embedding, face_crop_tensor}]
    Only returns faces with detection probability > 0.90.
    """
    mtcnn, _ = get_models()
    boxes, probs, _ = mtcnn.detect(pil_image, landmarks=True)
    face_tensors = mtcnn(pil_image)  # (N, 3, 160, 160) or None

    results = []
    if boxes is None or face_tensors is None:
        return results

    for i, (box, prob) in enumerate(zip(boxes, probs)):
        if prob < 0.90:
            continue
        face_tensor = face_tensors[i]  # (3, 160, 160)
        embedding = embed(face_tensor)
        results.append({
            "box": [int(b) for b in box],
            "prob": float(prob),
            "embedding": embedding,
            "face_tensor": face_tensor,
        })
    return results

def find_match(embedding: np.ndarray, session: Session, threshold: float = 0.70):
    """
    Queries pgvector for closest stored embedding using cosine distance.
    Returns (face_id, name, distance) or (None, "Unknown", None).
    """
    emb_list = embedding.tolist()
    row = session.execute(
        text(
            "SELECT id, name, embedding <=> CAST(:emb AS vector) AS dist "
            "FROM faces ORDER BY dist LIMIT 1"
        ),
        {"emb": str(emb_list)},
    ).fetchone()

    if row is None or row.dist > threshold:
        return None, "Unknown", row.dist if row else None
    return str(row.id), row.name, float(row.dist)
```

**Step 4 — Create `backend/camera.py`:**
```python
import os
import cv2
import time
import base64
import threading
import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", 0))
RECOGNITION_FPS = int(os.environ.get("RECOGNITION_FPS", 5))
RECOGNITION_THRESHOLD = float(os.environ.get("RECOGNITION_THRESHOLD", 0.70))

class FrameStore:
    """Thread-safe store for the latest raw and annotated frames."""
    def __init__(self):
        self._lock = threading.Lock()
        self._raw_frame = None
        self._annotated_frame = None

    def set_raw(self, frame):
        with self._lock:
            self._raw_frame = frame.copy()

    def get_raw(self):
        with self._lock:
            return self._raw_frame.copy() if self._raw_frame is not None else None

    def set_annotated(self, frame):
        with self._lock:
            self._annotated_frame = frame.copy()

    def get_annotated(self):
        with self._lock:
            if self._annotated_frame is not None:
                return self._annotated_frame.copy()
            return self._raw_frame.copy() if self._raw_frame is not None else None

store = FrameStore()

def _camera_thread():
    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    while True:
        ret, frame = cap.read()
        if ret:
            store.set_raw(frame)
        else:
            time.sleep(0.05)

def _recognition_thread(session_factory):
    from recognition import detect_and_embed, find_match
    interval = 1.0 / RECOGNITION_FPS
    while True:
        start = time.time()
        raw = store.get_raw()
        if raw is None:
            time.sleep(interval)
            continue

        pil = Image.fromarray(cv2.cvtColor(raw, cv2.COLOR_BGR2RGB))
        detections = detect_and_embed(pil)

        annotated = raw.copy()
        session = session_factory()
        try:
            for det in detections:
                x1, y1, x2, y2 = det["box"]
                _, name, dist = find_match(det["embedding"], session, RECOGNITION_THRESHOLD)
                color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
                label = f"{name}" if name != "Unknown" else "Unknown"
                if dist is not None:
                    label += f" ({dist:.2f})"
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                cv2.putText(annotated, label, (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        finally:
            session.close()

        store.set_annotated(annotated)
        elapsed = time.time() - start
        sleep_time = max(0.0, interval - elapsed)
        time.sleep(sleep_time)

def start_threads(session_factory):
    t1 = threading.Thread(target=_camera_thread, daemon=True)
    t2 = threading.Thread(target=_recognition_thread, args=(session_factory,), daemon=True)
    t1.start()
    t2.start()

def generate_mjpeg():
    while True:
        frame = store.get_annotated()
        if frame is None:
            time.sleep(0.033)
            continue
        ret, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            continue
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" +
            jpeg.tobytes() +
            b"\r\n"
        )
        time.sleep(0.033)  # ~30 fps stream cap

def capture_single_face():
    """
    Captures current raw frame, runs MTCNN, returns embedding and thumbnail of
    the largest detected face. Used by the registration endpoint.
    Returns: (embedding: np.ndarray, thumbnail_b64: str) or raises ValueError.
    """
    from recognition import detect_and_embed
    import io
    raw = store.get_raw()
    if raw is None:
        raise ValueError("No frame available from camera.")
    pil = Image.fromarray(cv2.cvtColor(raw, cv2.COLOR_BGR2RGB))
    detections = detect_and_embed(pil)
    if not detections:
        raise ValueError("No face detected in the current frame.")
    # Pick the largest face by box area
    largest = max(detections, key=lambda d: (d["box"][2]-d["box"][0]) * (d["box"][3]-d["box"][1]))
    # Crop and resize to 120x120 for thumbnail
    x1, y1, x2, y2 = largest["box"]
    x1, y1 = max(0, x1), max(0, y1)
    cropped = pil.crop((x1, y1, x2, y2)).resize((120, 120), Image.LANCZOS)
    buf = io.BytesIO()
    cropped.save(buf, format="JPEG", quality=75)
    thumbnail_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return largest["embedding"], thumbnail_b64
```

**Step 5 — Create `backend/app.py`:**
```python
import uuid
from flask import Flask, Response, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from database import init_db, SessionLocal
from models import Face
from camera import start_threads, generate_mjpeg, capture_single_face
from recognition import get_models

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:5173"}})

# Temporary in-memory store for pending captures {capture_id: (embedding, thumbnail)}
_pending_captures: dict = {}

@app.before_request
def _once():
    pass  # placeholder; init handled at startup

@app.get("/stream")
def stream():
    return Response(generate_mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/capture-frame")
def capture_frame():
    try:
        embedding, thumbnail = capture_single_face()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    capture_id = str(uuid.uuid4())
    _pending_captures[capture_id] = (embedding, thumbnail)
    return jsonify({"capture_id": capture_id, "thumbnail": thumbnail})

@app.get("/api/faces")
def list_faces():
    session = SessionLocal()
    try:
        faces = session.query(Face).order_by(Face.created_at.desc()).all()
        return jsonify([f.to_dict() for f in faces])
    finally:
        session.close()

@app.post("/api/faces")
def create_face():
    data = request.get_json()
    capture_id = data.get("capture_id")
    name = (data.get("name") or "").strip()
    if not capture_id or not name:
        return jsonify({"error": "capture_id and name are required"}), 400
    if capture_id not in _pending_captures:
        return jsonify({"error": "capture_id not found or expired"}), 404

    embedding, thumbnail = _pending_captures.pop(capture_id)
    session = SessionLocal()
    try:
        face = Face(
            name=name,
            embedding=embedding.tolist(),
            thumbnail=thumbnail,
        )
        session.add(face)
        session.commit()
        session.refresh(face)
        return jsonify(face.to_dict()), 201
    finally:
        session.close()

@app.delete("/api/faces/<face_id>")
def delete_face(face_id):
    session = SessionLocal()
    try:
        face = session.query(Face).filter_by(id=face_id).first()
        if not face:
            return jsonify({"error": "Not found"}), 404
        session.delete(face)
        session.commit()
        return "", 204
    finally:
        session.close()

if __name__ == "__main__":
    print("Initialising database...")
    init_db()
    print("Pre-loading FaceNet models...")
    get_models()
    print("Starting camera and recognition threads...")
    start_threads(SessionLocal)
    print("Flask running on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, threaded=True, use_reloader=False)
```

---

### Phase 3: Frontend Implementation

**Step 1 — Initialise React + Vite project:**
```bash
cd /home/appuser/Projects/facial_recognition
npm create vite@5.4.2 frontend -- --template react
cd frontend
npm install
npm install axios@1.7.7
npm install -D tailwindcss@3.4.13 postcss@8.4.47 autoprefixer@10.4.20
npx tailwindcss init -p
```

**Step 2 — Configure `frontend/tailwind.config.js`** (replace generated content):
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

**Step 3 — Add Tailwind directives to `frontend/src/index.css`** (replace entire file):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4 — Create `frontend/vite.config.js`** (replace generated content):
```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/stream": "http://localhost:5000",
      "/api": "http://localhost:5000",
    },
  },
});
```

**Step 5 — Create `frontend/src/api.js`:**
```js
import axios from "axios";

const api = axios.create({ baseURL: "/" });

export const getFaces = () => api.get("/api/faces").then(r => r.data);
export const captureFrame = () => api.post("/api/capture-frame").then(r => r.data);
export const saveFace = (capture_id, name) =>
  api.post("/api/faces", { capture_id, name }).then(r => r.data);
export const deleteFace = (id) => api.delete(`/api/faces/${id}`);
```

**Step 6 — Create `frontend/src/components/VideoStream.jsx`:**
```jsx
export default function VideoStream() {
  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl">
      <img
        src="/stream"
        alt="Live facial recognition feed"
        className="w-full h-auto block"
        onError={(e) => {
          e.target.style.display = "none";
        }}
      />
      <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">
        LIVE
      </div>
    </div>
  );
}
```

**Step 7 — Create `frontend/src/components/FaceRegister.jsx`:**
```jsx
import { useState } from "react";
import { captureFrame, saveFace } from "../api";

export default function FaceRegister({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState("idle"); // idle | capturing | naming | saving
  const [thumbnail, setThumbnail] = useState(null);
  const [captureId, setCaptureId] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState(null);

  async function handleCapture() {
    setStage("capturing");
    setError(null);
    try {
      const data = await captureFrame();
      setThumbnail(data.thumbnail);
      setCaptureId(data.capture_id);
      setStage("naming");
    } catch (e) {
      setError(e.response?.data?.error || "Capture failed.");
      setStage("idle");
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setStage("saving");
    try {
      const face = await saveFace(captureId, name.trim());
      onSaved(face);
      setOpen(false);
      setStage("idle");
      setName("");
      setThumbnail(null);
    } catch (e) {
      setError(e.response?.data?.error || "Save failed.");
      setStage("naming");
    }
  }

  function handleClose() {
    setOpen(false);
    setStage("idle");
    setName("");
    setThumbnail(null);
    setError(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition"
      >
        + Register New Face
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Register Face</h2>

            {stage === "idle" && (
              <button
                onClick={handleCapture}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg transition"
              >
                Capture from Stream
              </button>
            )}

            {stage === "capturing" && (
              <p className="text-center text-gray-500">Capturing...</p>
            )}

            {(stage === "naming" || stage === "saving") && thumbnail && (
              <div className="flex flex-col items-center gap-3">
                <img src={thumbnail} alt="Captured face" className="w-24 h-24 rounded-full object-cover border-2 border-blue-400" />
                <input
                  type="text"
                  placeholder="Enter name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={stage === "saving" || !name.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg transition"
                >
                  {stage === "saving" ? "Saving..." : "Save Face"}
                </button>
                <button onClick={handleCapture} className="text-sm text-gray-400 hover:text-gray-600">
                  Retake
                </button>
              </div>
            )}

            {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}

            <button onClick={handleClose} className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

**Step 8 — Create `frontend/src/components/FaceList.jsx`:**
```jsx
import { deleteFace } from "../api";

export default function FaceList({ faces, onDeleted }) {
  async function handleDelete(id) {
    if (!confirm("Remove this face?")) return;
    await deleteFace(id);
    onDeleted(id);
  }

  if (faces.length === 0) {
    return <p className="text-sm text-gray-400 text-center mt-4">No faces registered yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2 mt-4 overflow-y-auto max-h-[480px] pr-1">
      {faces.map(face => (
        <div key={face.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2 border hover:border-blue-300 transition">
          {face.thumbnail
            ? <img src={face.thumbnail} alt={face.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            : <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
          }
          <span className="flex-1 font-medium text-gray-800 text-sm truncate">{face.name}</span>
          <button
            onClick={() => handleDelete(face.id)}
            className="text-gray-300 hover:text-red-500 transition text-lg leading-none"
            title="Remove face"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

**Step 9 — Create `frontend/src/App.jsx`** (replace generated content):
```jsx
import { useState, useEffect } from "react";
import { getFaces } from "./api";
import VideoStream from "./components/VideoStream";
import FaceRegister from "./components/FaceRegister";
import FaceList from "./components/FaceList";

export default function App() {
  const [faces, setFaces] = useState([]);

  useEffect(() => {
    getFaces().then(setFaces).catch(console.error);
  }, []);

  function handleSaved(newFace) {
    setFaces(prev => [newFace, ...prev]);
  }

  function handleDeleted(id) {
    setFaces(prev => prev.filter(f => f.id !== id));
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="bg-gray-800 px-6 py-3 shadow flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
        <h1 className="text-lg font-bold tracking-tight">FaceRec — Real-Time Recognition</h1>
      </header>

      <main className="flex flex-1 gap-0 overflow-hidden">
        {/* Stream panel */}
        <section className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-3xl">
            <VideoStream />
          </div>
        </section>

        {/* Sidebar */}
        <aside className="w-72 bg-gray-800 flex flex-col p-4 border-l border-gray-700">
          <h2 className="font-semibold text-sm uppercase tracking-widest text-gray-400 mb-3">
            Known Faces ({faces.length})
          </h2>
          <FaceRegister onSaved={handleSaved} />
          <FaceList faces={faces} onDeleted={handleDeleted} />
        </aside>
      </main>
    </div>
  );
}
```

**Step 10 — Update `frontend/src/main.jsx`** (replace generated content):
```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

---

### Phase 4: Integration & Running

**Step 1 — Start the Flask backend:**
```bash
cd /home/appuser/Projects/facial_recognition/backend
source .venv/bin/activate
python app.py
```
Expected output:
```
Initialising database...
Pre-loading FaceNet models...
Starting camera and recognition threads...
Flask running on http://localhost:5000
```
> On first run, `facenet-pytorch` downloads the VGGFace2-pretrained weights (~90 MB) to `~/.cache/torch/`.

**Step 2 — Start the React dev server (separate terminal):**
```bash
cd /home/appuser/Projects/facial_recognition/frontend
npm run dev
```
Expected output:
```
  ➜  Local:   http://localhost:5173/
```

**Step 3 — Open browser:** Navigate to `http://localhost:5173`. The live annotated stream should appear within 2–3 seconds.

**Step 4 — Register a face:**
1. Click "Register New Face"
2. Click "Capture from Stream" (face must be visible in camera)
3. Enter a name, click "Save Face"
4. Face card appears in sidebar; recognition activates within ~0.2 seconds

**Step 5 — Verify database contents:**
```bash
sudo -u postgres psql -d facerec_db -c "SELECT id, name, created_at FROM faces;"
```

**Step 6 — Smoke-test the API directly:**
```bash
# List faces
curl http://localhost:5000/api/faces

# Capture a frame (face must be in camera view)
curl -X POST http://localhost:5000/api/capture-frame

# Stream a few bytes of MJPEG
curl -s --max-time 1 http://localhost:5000/stream | head -c 200
```

---

## 7. Tuning & Known Constraints

| Parameter | Location | Default | Effect |
|---|---|---|---|
| `RECOGNITION_THRESHOLD` | `.env` | `0.70` | Lower = stricter matching (fewer false positives, more "Unknown") |
| `RECOGNITION_FPS` | `.env` | `5` | Increase for snappier labels; decreases if CPU is under load |
| `CAMERA_INDEX` | `.env` | `0` | Change to `1`, `2`, etc. if `/dev/video0` is not the desired camera |
| MTCNN `min_face_size` | `recognition.py:11` | `40` | Lower to detect smaller/more distant faces |
| IVFFlat `lists` | `database.py:18` | `100` | Tune to `sqrt(row_count)` once >10,000 faces are stored |

**Known constraint:** The IVFFlat index requires at least `lists` rows to perform approximate search. For fewer than 100 stored faces, PostgreSQL falls back to an exact sequential scan automatically — no action needed.

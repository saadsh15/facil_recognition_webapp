# Architectural Critique: Camera Module — Why It Does Not Work

---

## 🚨 Critical Failures (Drop Everything and Fix)

### 1. The running user `appuser` is NOT in the `video` group — camera access is unconditionally denied at the OS level

This is the immediate, concrete reason the camera does not work right now.

```
/dev/video0   crw-rw----+ 1 root video   (mode 660)
```

`cv2.VideoCapture(0)` calls `open("/dev/video0", O_RDWR)` under the hood. That call returns
`EACCES` because `appuser` is not a member of the `video` group. OpenCV silently eats the
`EACCES` and returns `cap.isOpened() == False`. The camera thread logs:

```
ERROR camera: Camera index 0 failed to open. Retrying in 1.0s.
```

...and loops forever with exponential backoff. No frame is ever produced. The stream is dead.
`/api/capture-frame` always returns 400 "No frame available". The application is completely
non-functional from a user perspective.

**Fix (one command):**
```bash
sudo usermod -aG video appuser
# Then LOG OUT and back in — group membership requires a new login session.
# Verify with: groups  (should show "video" in the list)
```

---

### 2. `gunicorn.conf.py` `post_fork` hook passes a bound method to `start_background_services` — camera thread never starts under Gunicorn

This bug silently swallows the camera and pipeline threads when the application is run in
production mode via Gunicorn. `python app.py` (dev mode) is unaffected.

```python
# gunicorn.conf.py:33-36
flask_app = worker.wsgi          # ← correctly the Flask app instance
if hasattr(flask_app, "wsgi_app"):
    flask_app = flask_app.wsgi_app  # ← WRONG: wsgi_app is an *instance method* on Flask
start_background_services(flask_app)  # ← receives a bound method, not a Flask app
```

`Flask` has a `wsgi_app` attribute — it is an instance method used internally for WSGI
dispatch. `hasattr(flask_app, "wsgi_app")` is therefore **always True** for a Flask app.
The reassignment silently replaces the Flask instance with `Flask.wsgi_app`, a bound method.

Inside `start_background_services(app: Flask)`:
```python
with app.app_context():   # AttributeError: 'method' object has no attribute 'app_context'
```

This raises `AttributeError`, is caught by the broad `except Exception as exc:` in the hook,
logged as an error, and silently swallowed. The camera thread, pipeline thread, and model
pre-loading are all never started. Gunicorn continues serving requests; `/stream` returns
an infinite empty MJPEG body; the app appears to start but is permanently broken.

**Root cause of the guard:** The intent was to unwrap a potential WSGI middleware wrapper
(e.g., `DispatcherMiddleware`) that sits in front of the Flask app. But Flask itself is the
WSGI callable — there is no wrapper here. The guard is both wrong and unnecessary.

**Fix:**
```python
# gunicorn.conf.py — post_fork
def post_fork(server, worker):
    from app import start_background_services
    try:
        flask_app = worker.wsgi
        # Flask IS the WSGI callable; wsgi_app is an instance method, not the app.
        # Do NOT unwrap. Pass the Flask instance directly.
        start_background_services(flask_app)
    except Exception as exc:
        logging.getLogger(__name__).error(
            "Failed to start background services: %s", exc, exc_info=True
        )
```

---

## ⚠️ Architectural Smells & Tech Debt

### 3. `cap.set()` resolution hints are silently ignored and never verified

```python
# camera.py:95-96
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
```

`VideoCapture.set()` returns a `bool` indicating whether the property was applied. Both
return values are discarded. If the camera does not support 640×480 (e.g., it only supports
1280×720 or 320×240), OpenCV silently uses a different resolution. The pipeline then
processes whatever size the camera decides to give it — the aspect ratio of the stream
changes, bounding boxes drawn at one resolution look wrong at another, and no warning is
ever produced. On the `FHD Camera` device detected on this system, V4L2 may select 1920×1080
as the default, not 640×480 — making each frame ~9× larger than expected and measurably
slower to process through MTCNN.

### 4. `camera.py` exposes no public API for "is the camera ready?" — callers fail blindly

`registration.py` calls `store.get_raw()` and immediately raises `ValueError` if the frame
is `None`. There is no readiness signal, no retry with timeout, and no distinction between
"camera is still warming up (wait a moment)" and "camera is broken (show an error)".
A user who clicks "Capture" in the first 1-2 seconds after startup always gets an error even
though the camera is fine and about to produce frames.

### 5. The `video` group permission requirement is undocumented anywhere in the project

There is no `README`, no `.env.example`, no startup script, no inline comment in `camera.py`
that mentions `sudo usermod -aG video $USER`. On any fresh Linux install, this is a guaranteed
silent breakage. The first symptom — an empty stream — gives no indication of the real cause.
The camera thread's error log (`Camera index 0 failed to open`) is only visible in the server
terminal, not surfaced to the UI.

---

## 🐢 Performance Bottlenecks

### 6. `cv2.VideoCapture` is opened with no backend hint — incurs V4L2 probe overhead

```python
cap = cv2.VideoCapture(CAMERA_INDEX)  # probes all backends in sequence
```

On Linux, OpenCV tries GStreamer, then V4L2, then FFMPEG until one succeeds. This adds
50-300ms of latency on every reconnect (including the normal exponential-backoff retry loop).

The correct call is:
```python
cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_V4L2)
```

This skips the probe entirely. The FHD Camera on this system is a USB V4L2 device — the
backend is known at compile time.

### 7. `_camera_thread` runs as a hot loop with no sleep when the camera is healthy

When `cap.read()` succeeds, the thread immediately calls `store.set_raw(frame)` and loops.
There is no frame rate cap. The camera is producing frames as fast as it can (typically
30-60 FPS), but the pipeline only processes 5 FPS and the stream only outputs 30 FPS.
The extra frames are overwritten immediately in `FrameStore` and thrown away, wasting CPU
on pixel copies (`frame.copy()` in `get_raw()`).

---

## 🔍 Edge Cases Ignored

### 8. Camera device index 0 may not be the capture device — it often isn't

V4L2 creates multiple device nodes per camera. The `FHD Camera` on this system is registered
as `/dev/video0`, `/dev/video1`, `/dev/video2`, `/dev/video3`. Index 0 is the metadata/control
node on many USB UVC cameras — the actual video capture node is index 2. `cv2.VideoCapture(0)`
may open the wrong node and read garbage or fail with `cap.isOpened() == False` for the
wrong reason.

Verify with:
```bash
v4l2-ctl --device /dev/video0 --info | grep "Video Capture"
v4l2-ctl --device /dev/video2 --info | grep "Video Capture"
```
The one that reports `Device Caps: Video Capture` is the correct index.

### 9. `cap.read()` failure after a successful `cap.open()` triggers backoff but not `cap.release()`-first

```python
# camera.py:110-118
ret, frame = cap.read()
if ret:
    store.set_raw(frame)
else:
    log.warning("Camera read failed — device may have disconnected.")
    cap.release()
    cap = None
    time.sleep(backoff)
    backoff = min(backoff * 2, 30.0)
```

On a transient read failure (e.g., USB glitch), the file descriptor for `/dev/video0` is
released and the backoff sleep runs. But the backoff is never reset after a read failure
followed by a successful reopen. The first read failure sets `backoff` to 2.0. Even after
the camera reopens successfully (line 108 resets `backoff = 1.0`), the `else` branch below
immediately doubles `backoff` again on any future failure. This is a latent bug — `backoff`
is correctly reset on open success but the read-failure branch re-enters exponential
backoff from whatever value it was at, not from 1.0.

---

## 💡 The Architect's Mandate (How to Do It Right)

### Fix 1 — Video group (immediate, blocking)
```bash
sudo usermod -aG video appuser && newgrp video
# or log out and back in
```

### Fix 2 — `gunicorn.conf.py` post_fork hook
Remove the `wsgi_app` unwrapping entirely:
```python
def post_fork(server, worker):
    from app import start_background_services
    import logging
    try:
        start_background_services(worker.wsgi)
    except Exception as exc:
        logging.getLogger("gunicorn.error").error(
            "Failed to start background services: %s", exc, exc_info=True
        )
```

### Fix 3 — `camera.py` correct V4L2 backend + resolution verification + frame rate cap
```python
CAMERA_FPS = int(os.environ.get("CAMERA_FPS", 30))

# In _camera_thread, replace the VideoCapture open block:
cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
if not cap.isOpened():
    ...

actual_w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
actual_h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
if actual_w != 640 or actual_h != 480:
    log.warning(
        "Requested 640x480 but camera gave %dx%d. "
        "Set CAMERA_INDEX to the correct capture node.",
        int(actual_w), int(actual_h),
    )

# Add sleep to cap read loop to avoid burning CPU past CAMERA_FPS:
interval = 1.0 / CAMERA_FPS
tick = time.time()
ret, frame = cap.read()
if ret:
    store.set_raw(frame)
    elapsed = time.time() - tick
    time.sleep(max(0.0, interval - elapsed))
```

### Fix 4 — Document the `video` group prerequisite
Add a `README.md` or at minimum a comment in `camera.py:20`:
```python
# Linux prerequisite: the user running this process must be in the 'video' group.
# If camera fails to open: sudo usermod -aG video $USER  (then re-login)
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", 0))
```

### Summary — The Camera Is Broken For Two Independent Reasons

| Cause | Affects | Fix |
|---|---|---|
| `appuser` not in `video` group | ALL run modes | `sudo usermod -aG video appuser` + re-login |
| `post_fork` passes bound method | Gunicorn only | Remove `flask_app.wsgi_app` reassignment |
| Wrong video node index (possible) | ALL run modes | Verify `/dev/video2` vs `/dev/video0` |

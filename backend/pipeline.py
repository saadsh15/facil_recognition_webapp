"""
pipeline.py — Annotation loop.

Reads raw frames from camera.store, runs face detection + recognition,
draws bounding boxes and labels, writes annotated frames back to camera.store.

Owns a single long-lived DB session (reconnects on failure).
Skips DB queries entirely when no persons are registered.
"""
import logging
import os
import threading
import time

import cv2
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

RECOGNITION_FPS = int(os.environ.get("RECOGNITION_FPS", 5))
RECOGNITION_THRESHOLD = float(os.environ.get("RECOGNITION_THRESHOLD", 0.70))

# Set to True by app.py when the first person is registered.
# Avoids hammering the DB when the face table is empty.
has_faces = False


def _annotate_frame(frame, detections: list, session) -> None:
    """
    Draw bounding boxes and name labels onto frame in-place.
    Runs one batched DB query for all detected faces in this frame.
    """
    from recognition import find_matches_batched

    if has_faces and detections:
        # Resolve all identities in a single query
        embeddings = [det["embedding"] for det in detections]
        matches = find_matches_batched(embeddings, session, RECOGNITION_THRESHOLD)
    else:
        matches = [(None, "Unknown", None)] * len(detections)

    for det, (person_id, name, dist) in zip(detections, matches):
        x1, y1, x2, y2 = det["box"]

        color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
        label = name if dist is None else f"{name} ({dist:.2f})"
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            frame, label, (x1, max(y1 - 10, 0)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2
        )



def _pipeline_thread(session_factory) -> None:
    """
    Main annotation loop. Uses a persistent session; reconnects on DB error
    with exponential backoff to prevent connection pool exhaustion during outages.

    Backoff behaviour:
      1st failure → wait 1s, 2nd → 2s, 3rd → 4s … capped at 30s.
      Resets to 1s on any successful tick.
    """
    from recognition import detect_and_embed
    from camera import store

    interval = 1.0 / RECOGNITION_FPS
    last_raw_version = 0
    session = None
    _db_backoff = 1.0  # seconds; doubles on each consecutive failure

    def _get_session():
        nonlocal session
        if session is None:
            session = session_factory()
        return session

    def _close_session():
        nonlocal session
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
            session = None

    while True:
        tick_start = time.time()

        try:
            raw, raw_version = store.get_raw()
            if raw is None or raw_version == last_raw_version:
                time.sleep(0.01)
                continue

            last_raw_version = raw_version
            pil = Image.fromarray(cv2.cvtColor(raw, cv2.COLOR_BGR2RGB))
            detections = detect_and_embed(pil)

            if detections:
                # Add labels via batched DB lookup
                from recognition import find_matches_batched
                matches = find_matches_batched(
                    [d["embedding"] for d in detections], 
                    _get_session(), 
                    RECOGNITION_THRESHOLD
                )
                for d, match in zip(detections, matches):
                    d["person_id"], d["name"], d["dist"] = match
            
            store.set_detections(detections)
            _db_backoff = 1.0  # reset on successful tick

        except Exception as exc:
            log.error(
                "Pipeline error: %s — closing session, backing off %.1fs.",
                exc, _db_backoff, exc_info=True,
            )
            _close_session()
            time.sleep(_db_backoff)
            _db_backoff = min(_db_backoff * 2, 30.0)
            continue  # skip the normal sleep; backoff already waited

        elapsed = time.time() - tick_start
        time.sleep(max(0.0, interval - elapsed))


def start_pipeline_thread(session_factory) -> None:
    t = threading.Thread(
        target=_pipeline_thread,
        args=(session_factory,),
        name="recognition-pipeline",
        daemon=True,
    )
    t.start()
    log.info("Recognition pipeline thread started.")

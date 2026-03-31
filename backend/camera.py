"""
camera.py — Single responsibility: capture frames from the device.

Owns the FrameStore (raw frames only) and the camera capture thread.
All annotation logic lives in pipeline.py.
All streaming logic lives in stream.py.
"""
import logging
import os
import threading
import time

import cv2
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", 0))
CAMERA_FPS = int(os.environ.get("CAMERA_FPS", 30))


class FrameStore:
    """
    Lock-protected double slot for the latest raw frame and detections.

    Uses a version counter so consumers can detect whether the frame has
    changed since they last read it — avoiding redundant copies and encodes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._raw_frame = None
        self._raw_version: int = 0
        self._latest_detections = []
        self._detections_version: int = 0

    # --- raw frame ---

    def set_raw(self, frame) -> None:
        with self._lock:
            self._raw_frame = frame  # caller passes a fresh array; we own it
            self._raw_version += 1

    def get_raw(self):
        """Returns (frame_copy, version) or (None, 0)."""
        with self._lock:
            if self._raw_frame is None:
                return None, 0
            return self._raw_frame.copy(), self._raw_version

    # --- detections ---

    def set_detections(self, detections: list) -> None:
        with self._lock:
            self._latest_detections = detections
            self._detections_version += 1

    def get_latest_data(self):
        """Returns (raw_frame_copy, detections, raw_version, det_version)."""
        with self._lock:
            if self._raw_frame is None:
                return None, [], 0, 0
            return (
                self._raw_frame.copy(),
                self._latest_detections,
                self._raw_version,
                self._detections_version,
            )


# Module-level singleton shared by pipeline.py, stream.py, and registration.py
store = FrameStore()


def _camera_thread() -> None:
    """
    Continuously reads frames from the camera device with exponential-backoff
    reconnection on failure. Logs camera open/close events.
    """
    backoff = 1.0
    cap = None

    while True:
        # --- (Re)open camera ---
        if cap is None or not cap.isOpened():
            log.info("Opening camera (index %d)...", CAMERA_INDEX)
            cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_V4L2)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
            if not cap.isOpened():
                log.error(
                    "Camera index %d failed to open. Retrying in %.1fs.",
                    CAMERA_INDEX,
                    backoff,
                )
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)  # cap at 30s
                cap = None
                continue
            
            actual_w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            actual_h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            if actual_w != 640 or actual_h != 480:
                log.warning(
                    "Requested 640x480 but camera gave %dx%d. "
                    "Set CAMERA_INDEX to the correct capture node.",
                    int(actual_w), int(actual_h),
                )
                
            log.info("Camera opened successfully.")
            backoff = 1.0  # reset on success

        interval = 1.0 / CAMERA_FPS
        tick = time.time()
        ret, frame = cap.read()
        if ret:
            store.set_raw(frame)
            elapsed = time.time() - tick
            time.sleep(max(0.0, interval - elapsed))
        else:
            log.warning("Camera read failed — device may have disconnected.")
            cap.release()
            cap = None
            time.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


def start_camera_thread() -> None:
    t = threading.Thread(target=_camera_thread, name="camera-capture", daemon=True)
    t.start()
    log.info("Camera capture thread started.")

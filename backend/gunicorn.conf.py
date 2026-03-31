"""
gunicorn.conf.py — Production server configuration.

Uses gthread workers (real OS threads) instead of gevent to avoid
PyTorch/gevent monkey-patching conflicts. A single worker process is
required so camera.store and pipeline state are shared across all
request-handling threads.

Start with:
    gunicorn -c gunicorn.conf.py "app:create_app()"

Background threads (camera, pipeline) are launched via the post_fork hook
so they start inside the worker process after forking.
"""
import logging

workers = 1          # Must be 1 — FrameStore lives in process memory
worker_class = "gthread"
threads = 20         # Up to 20 concurrent HTTP connections (including MJPEG streams)
bind = "0.0.0.0:5000"
timeout = 120        # MJPEG stream connections are long-lived
keepalive = 5
loglevel = "info"
accesslog = "-"
errorlog = "-"


def post_fork(server, worker):
    """Start background services inside the worker process after forking."""
    from app import start_background_services
    import logging
    # Gunicorn calls the app factory separately; we only need to start threads here.
    # We retrieve the already-created app via server.app.wsgi().
    try:
        flask_app = server.app.wsgi()
        start_background_services(flask_app)
    except Exception as exc:
        logging.getLogger("gunicorn.error").error(
            "Failed to start background services: %s", exc, exc_info=True
        )

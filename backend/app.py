"""
app.py — Flask application factory.

create_app() wires together the DB, routes, and request-scoped config.
Background threads (camera, pipeline) are started separately in __main__
so tests can import create_app() without launching hardware threads.
"""
import logging
import os
import threading
import time
import uuid

from dotenv import load_dotenv
from flask import Flask, Response, current_app, jsonify, request
from flask_cors import CORS

# Robust environment loading: find .env in the same directory as this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


def create_app(config: dict | None = None) -> Flask:
    """
    Build and return the configured Flask app.
    Does NOT start background threads — call start_background_services() for that.
    """
    app = Flask(__name__)

    cfg = {**os.environ, **(config or {})}
    cors_origin = cfg.get("CORS_ORIGIN", "http://localhost:5173")
    CORS(app, resources={r"/api/*": {"origins": cors_origin}})

    from database import create_db, init_db
    engine, SessionLocal = create_db(cfg["DATABASE_URL"])
    init_db(engine)

    # Inject dependencies into app config — routes access via current_app.config
    app.config["SessionLocal"] = SessionLocal

    # Thread-safe pending captures: {capture_id: (embedding, thumbnail, monotonic_ts)}
    app.config["pending_captures"] = {}
    app.config["captures_lock"] = threading.Lock()

    _start_capture_purge_thread(app.config)
    _register_routes(app)

    return app


def _start_capture_purge_thread(app_config: dict) -> None:
    """Daemon thread that evicts pending captures older than 5 minutes."""
    def _purge():
        while True:
            time.sleep(60)
            cutoff = time.monotonic() - 300
            with app_config["captures_lock"]:
                stale = [
                    k for k, v in app_config["pending_captures"].items()
                    if v[2] < cutoff
                ]
                for k in stale:
                    del app_config["pending_captures"][k]
                if stale:
                    log.debug("Purged %d stale pending captures.", len(stale))

    t = threading.Thread(target=_purge, name="capture-purge", daemon=True)
    t.start()


def _register_routes(app: Flask) -> None:

    @app.get("/api/camera/settings")
    def get_camera_settings():
        import subprocess
        import re
        from camera import CAMERA_INDEX
        try:
            res = subprocess.run(["v4l2-ctl", "-d", f"/dev/video{CAMERA_INDEX}", "-l"], capture_output=True, text=True, check=True)
            settings = {}
            for line in res.stdout.splitlines():
                match = re.search(r'^\s*([a-z_]+)\s+0x.*min=(-?\d+).*max=(-?\d+).*step=(\d+).*value=(-?\d+)', line)
                if match:
                    name, vmin, vmax, step, val = match.groups()
                    settings[name] = {
                        "min": int(vmin),
                        "max": int(vmax),
                        "step": int(step),
                        "value": int(val)
                    }
            return jsonify(settings)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.post("/api/camera/settings")
    def set_camera_settings():
        import subprocess
        from camera import CAMERA_INDEX
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "No data"}), 400
        try:
            for key, value in data.items():
                subprocess.run(["v4l2-ctl", "-d", f"/dev/video{CAMERA_INDEX}", "-c", f"{key}={value}"], check=True)
            return jsonify({"status": "success"})
        except subprocess.CalledProcessError as e:
            return jsonify({"error": f"v4l2-ctl failed: {e.stderr}"}), 500
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.get("/stream")
    def stream():
        from stream import generate_mjpeg
        return Response(
            generate_mjpeg(),
            mimetype="multipart/x-mixed-replace; boundary=frame",
        )

    @app.post("/api/capture-frame")
    def capture_frame():
        from registration import capture_single_face
        try:
            embedding, thumbnail = capture_single_face()
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        capture_id = str(uuid.uuid4())
        lock = current_app.config["captures_lock"]
        pending = current_app.config["pending_captures"]

        with lock:
            if len(pending) >= 100:
                return jsonify({"error": "Server busy — too many pending captures."}), 429
            pending[capture_id] = (embedding, thumbnail, time.monotonic())

        return jsonify({"capture_id": capture_id, "thumbnail": thumbnail})

    @app.get("/api/faces")
    def list_faces():
        from sqlalchemy import func
        from models import Person, FaceEmbedding
        SessionLocal = current_app.config["SessionLocal"]
        with SessionLocal() as session:
            rows = (
                session.query(Person, func.count(FaceEmbedding.id).label("emb_count"))
                .outerjoin(FaceEmbedding, FaceEmbedding.person_id == Person.id)
                .group_by(Person.id)
                .order_by(Person.created_at.desc())
                .all()
            )
            return jsonify([
                p.to_dict(embedding_count=count) for p, count in rows
            ])

    @app.post("/api/faces")
    def create_face():
        """
        Register a new person OR add an additional embedding angle to an existing person.
        Body: { capture_id, name, person_id? }
        - If person_id is omitted: creates a new Person with the given name.
        - If person_id is provided: adds the embedding to that existing person.
        """
        import pipeline
        from models import FaceEmbedding, Person
        SessionLocal = current_app.config["SessionLocal"]

        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON"}), 400

        capture_id = data.get("capture_id")
        name = (data.get("name") or "").strip()
        person_id = data.get("person_id")

        if not capture_id:
            return jsonify({"error": "capture_id is required"}), 400
        if not person_id and not name:
            return jsonify({"error": "name is required when registering a new person"}), 400

        lock = current_app.config["captures_lock"]
        pending = current_app.config["pending_captures"]
        with lock:
            if capture_id not in pending:
                return jsonify({"error": "capture_id not found or expired"}), 404
            embedding, thumbnail, _ = pending.pop(capture_id)

        with SessionLocal() as session:
            if person_id:
                person = session.get(Person, person_id)
                if not person:
                    return jsonify({"error": "Person not found"}), 404
            else:
                person = Person(name=name)
                session.add(person)
                session.flush()  # get person.id before inserting embedding

            fe = FaceEmbedding(
                person_id=person.id,
                embedding=embedding.tolist(),
                thumbnail=thumbnail,
            )
            session.add(fe)
            session.commit()
            session.refresh(person)

            # Signal pipeline that faces exist — skips empty-table guard
            pipeline.has_faces = True

            emb_count = session.query(FaceEmbedding).filter_by(person_id=person.id).count()
            return jsonify(person.to_dict(embedding_count=emb_count)), 201

    @app.get("/api/faces/thumbnails")
    def batch_thumbnails():
        """
        Returns a map of {person_id: thumbnail_b64} for up to 200 person IDs
        in a single DB query. Replaces N individual /thumbnail calls with 1.

        Usage: GET /api/faces/thumbnails?ids=uuid1,uuid2,...
        """
        from sqlalchemy import func
        from models import FaceEmbedding

        ids_param = request.args.get("ids", "").strip()
        if not ids_param:
            return jsonify({}), 200

        ids = [i.strip() for i in ids_param.split(",") if i.strip()]
        if len(ids) > 200:
            return jsonify({"error": "Maximum 200 IDs per request"}), 400

        SessionLocal = current_app.config["SessionLocal"]
        with SessionLocal() as session:
            # One query: latest thumbnail per person_id using a window function
            from sqlalchemy import select, func as sqlfunc
            from sqlalchemy.dialects.postgresql import UUID as PGUUID
            import uuid as _uuid

            # Parse IDs safely — skip malformed ones
            valid_ids = []
            for i in ids:
                try:
                    valid_ids.append(_uuid.UUID(i))
                except ValueError:
                    pass

            if not valid_ids:
                return jsonify({}), 200

            subq = (
                select(
                    FaceEmbedding.person_id,
                    FaceEmbedding.thumbnail,
                    func.row_number().over(
                        partition_by=FaceEmbedding.person_id,
                        order_by=FaceEmbedding.created_at.desc(),
                    ).label("rn"),
                )
                .where(FaceEmbedding.person_id.in_(valid_ids))
                .subquery()
            )
            rows = session.execute(
                select(subq.c.person_id, subq.c.thumbnail).where(subq.c.rn == 1)
            ).fetchall()

        return jsonify({
            str(row.person_id): row.thumbnail
            for row in rows
            if row.thumbnail
        })

    @app.get("/api/faces/<person_id>/thumbnail")
    def get_thumbnail(person_id):
        """Returns the most recent thumbnail for a single person."""
        from models import FaceEmbedding
        SessionLocal = current_app.config["SessionLocal"]
        with SessionLocal() as session:
            fe = (
                session.query(FaceEmbedding)
                .filter_by(person_id=person_id)
                .order_by(FaceEmbedding.created_at.desc())
                .first()
            )
            if not fe or not fe.thumbnail:
                return jsonify({"error": "No thumbnail found"}), 404
            return jsonify({"thumbnail": fe.thumbnail})

    @app.delete("/api/faces/<person_id>")
    def delete_face(person_id):
        """Delete a person and all their embeddings (CASCADE)."""
        import pipeline
        from models import Person, FaceEmbedding
        SessionLocal = current_app.config["SessionLocal"]
        with SessionLocal() as session:
            person = session.get(Person, person_id)
            if not person:
                return jsonify({"error": "Not found"}), 404
            session.delete(person)
            session.commit()
            # Update has_faces flag
            remaining = session.query(FaceEmbedding).count()
            pipeline.has_faces = remaining > 0
            return "", 204


def start_background_services(app: Flask) -> None:
    """Start camera + pipeline threads. Called from __main__ only."""
    from camera import start_camera_thread
    from pipeline import start_pipeline_thread
    from recognition import get_models
    from models import FaceEmbedding
    import pipeline

    log.info("Pre-loading FaceNet models...")
    get_models()

    # Initialise has_faces from DB so recognition works after restart
    with app.app_context():
        SessionLocal = app.config["SessionLocal"]
        with SessionLocal() as session:
            pipeline.has_faces = session.query(FaceEmbedding).count() > 0
        log.info("has_faces=%s at startup.", pipeline.has_faces)

    start_camera_thread()
    start_pipeline_thread(app.config["SessionLocal"])


if __name__ == "__main__":
    app = create_app()
    start_background_services(app)
    log.info("Starting Flask on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, threaded=True, use_reloader=False)

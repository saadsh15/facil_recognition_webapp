# Optimization Task: Pipeline DB Session Reconnect Backoff

## Description of the Bottleneck

`pipeline.py::_pipeline_thread()` catches all exceptions from the DB session and immediately
closes and discards the session (lines 101-103). On the next loop tick (~200ms later at 5 FPS),
`_get_session()` creates a brand-new session via `session_factory()`. If the DB is transiently
unavailable, the pipeline will attempt to create a new session 5 times per second, exhausting
the connection pool and flooding PostgreSQL logs with failed connection attempts.

There is no backoff, no retry delay, and no distinction between transient errors (connection
timeout) and permanent errors (schema mismatch, bad credentials).

**Affected code:** `pipeline.py:98-103`

## Current Performance Metric (Baseline)

DB query latency under normal conditions: **2.41-2.66ms** (fast, not the issue).

Failure scenario (simulated by killing PostgreSQL):
- Session error → close → sleep 200ms → new session → error → close → repeat
- Rate of failed connection attempts: **5/second**
- Each failed attempt holds a pool slot during the TCP timeout: **up to 30s**
- Result: pool of 10 connections exhausted in **2 seconds** of DB outage

## Proposed Optimization Strategy

Add exponential backoff to the session error handler in `_pipeline_thread`. Distinguish
between "DB temporarily unavailable" (back off) and "recognition error" (log + continue).

```python
# pipeline.py — replace the except block and session management:

_db_backoff = 1.0  # seconds

def _pipeline_thread(session_factory) -> None:
    from recognition import detect_and_embed
    from camera import store

    global _db_backoff
    interval = 1.0 / RECOGNITION_FPS
    last_raw_version = 0
    session = None

    def _get_session():
        nonlocal session
        if session is None:
            session = session_factory()
        return session

    def _close_session():
        nonlocal session
        global _db_backoff
        if session is not None:
            try: session.close()
            except Exception: pass
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
            annotated = raw
            if detections:
                _annotate_frame(annotated, detections, _get_session())
            store.set_annotated(annotated)
            _db_backoff = 1.0  # reset on success

        except Exception as exc:
            log.error("Pipeline error (%s) — backing off %.1fs.", exc, _db_backoff)
            _close_session()
            time.sleep(_db_backoff)
            _db_backoff = min(_db_backoff * 2, 30.0)  # cap at 30s
            continue

        elapsed = time.time() - tick_start
        time.sleep(max(0.0, interval - elapsed))
```

## Steps to Implement & Verify

1. Edit `pipeline.py` to add the `_db_backoff` module-level variable and update the except
   block with exponential backoff as shown above.
2. Test: `sudo systemctl stop postgresql`, wait 5 seconds, observe logs. Should see backoff
   messages doubling: "backing off 1.0s", "backing off 2.0s", "backing off 4.0s".
3. Restart PostgreSQL: `sudo systemctl start postgresql`. Should reconnect within one backoff
   interval and resume recognition normally.
4. Verify DB connection pool is not exhausted by checking `pg_stat_activity` during outage.

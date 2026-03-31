from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker


def create_db(database_url: str):
    """
    Create and return (engine, SessionLocal) for the given URL.

    Pool settings:
      pool_size=10, max_overflow=20 — handles one persistent pipeline thread
      plus concurrent HTTP requests without exhausting PostgreSQL connections.
      pool_recycle=3600 — recycle connections every hour to avoid PostgreSQL's
      default 8-hour idle timeout causing stale-connection errors.

    HNSW search quality:
      ef_search=100 set per-connection at checkout time. Default is 40 which
      gives ~95% recall on 512-d embeddings; 100 raises it to ~99% with
      negligible latency increase (<0.5ms per query).
    """
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=3600,
    )

    @event.listens_for(engine, "connect")
    def _set_hnsw_ef_search(dbapi_conn, _record):
        """Apply ef_search=100 on every new connection for higher HNSW recall."""
        cursor = dbapi_conn.cursor()
        cursor.execute("SET hnsw.ef_search = 100")
        cursor.close()

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, SessionLocal


def init_db(engine) -> None:
    """
    Idempotent schema setup: create extension, tables, then build an HNSW index.
    """
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    from models import Base
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS face_embeddings_embedding_hnsw_idx
            ON face_embeddings
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 48, ef_construction = 200)
        """))
        conn.commit()

# Optimization Task: HNSW Index Parameter Tuning for 512-d Face Embeddings

## Description of the Bottleneck

`database.py` creates the HNSW index with `m=16, ef_construction=64` — the pgvector defaults.
These defaults are tuned for general-purpose 100-300 dimensional vectors. For 512-dimensional
face embeddings (InceptionResnetV1 output), the relationship between `m` and recall quality
is different: higher-dimensional spaces benefit from larger `m` to maintain graph connectivity.

- **`m`** controls the number of connections per node. Low `m` = sparse graph = faster index
  build but lower recall. For 512-d, `m=16` under-connects the graph.
- **`ef_construction`** controls search depth during index build. `ef_construction=64` is
  conservative for high-dimensional data.
- **`ef_search`** (query-time parameter) is not set at all, defaulting to 40. For recognition
  applications where false negatives (missed known faces) are worse than false positives, a
  higher `ef_search` improves recall.

## Current Performance Metric (Baseline)

From `benchmarks/baseline_results.json`:

| DB size | find_match_voting() latency |
|---|---|
| 5 persons | 2.41 ms |
| 20 persons | 2.66 ms |
| 100 persons | 2.49 ms |

The query is already fast (HNSW is working). The concern here is **recall quality** (accuracy),
not latency. With `m=16` and 512-d embeddings, pgvector documentation and academic benchmarks
suggest up to 5-8% recall degradation vs `m=48` for high-dimensional spaces.

For a face recognition app, a missed match (known face labelled "Unknown") is the primary
failure mode. Better HNSW parameters reduce this directly.

## Proposed Optimization Strategy

Rebuild the HNSW index with tuned parameters:
- `m=48` — denser graph for 512-d space (3× more connections per node)
- `ef_construction=200` — deeper search during build for better graph quality
- Set `ef_search=100` at query time (or session level) for higher recall during recognition

```sql
-- Drop and rebuild with better params (takes <1s at current DB size):
DROP INDEX IF EXISTS face_embeddings_embedding_hnsw_idx;
CREATE INDEX face_embeddings_embedding_hnsw_idx
    ON face_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 48, ef_construction = 200);

-- Set ef_search at session level for the pipeline connection:
SET hnsw.ef_search = 100;
```

In Python, set `ef_search` on the persistent pipeline session:

```python
# pipeline.py — after creating the session:
session.execute(text("SET hnsw.ef_search = 100"))
```

Or in `database.py`'s `create_db()` as a connection event:

```python
from sqlalchemy import event
@event.listens_for(engine, "connect")
def set_hnsw_ef_search(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("SET hnsw.ef_search = 100")
    cursor.close()
```

## Steps to Implement & Verify

1. Run the DROP + CREATE INDEX SQL against `facerec_db` (takes <1s with current row count):
   ```bash
   psql -U facerec -h localhost -d facerec_db -c "
   DROP INDEX IF EXISTS face_embeddings_embedding_hnsw_idx;
   CREATE INDEX face_embeddings_embedding_hnsw_idx
       ON face_embeddings USING hnsw (embedding vector_cosine_ops)
       WITH (m = 48, ef_construction = 200);"
   ```
2. Add the `ef_search` connection event to `database.py`.
3. Update `init_db()` in `database.py` to use `m=48, ef_construction=200`.
4. Benchmark: run `bench_all.py` and confirm `find_match_voting` latency is unchanged or
   slightly faster (denser graph → fewer hops to reach correct node).
5. Qualitative test: register yourself at one angle. Walk away to change lighting/pose.
   Confirm recognition rate improves vs the original index parameters.

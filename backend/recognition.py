import threading
import numpy as np
import torch
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1
from facenet_pytorch.models.utils.detect_face import extract_face

_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_mtcnn: MTCNN | None = None
_resnet: InceptionResnetV1 | None = None
_models_lock = threading.Lock()
_inference_lock = threading.Lock()


def get_models() -> tuple[MTCNN, InceptionResnetV1]:
    """
    Thread-safe lazy initialisation with double-checked locking.
    Safe to call from any thread at any time.
    """
    global _mtcnn, _resnet
    if _mtcnn is not None and _resnet is not None:
        return _mtcnn, _resnet
    with _models_lock:
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
    Compute a 512-d L2-normalised embedding from a (3, 160, 160) uint8 face tensor.
    Returns a float32 numpy array.
    """
    _, resnet = get_models()
    t = face_tensor.float().div(255.0)
    t = (t - 0.5) / 0.5  # normalise to [-1, 1]
    t = t.unsqueeze(0).to(_device)
    with _inference_lock:
        with torch.no_grad():
            emb = resnet(t)
            emb = torch.nn.functional.normalize(emb, p=2, dim=1)
    return emb.squeeze(0).cpu().numpy().astype(np.float32)


def detect_and_embed(pil_image: Image.Image) -> list[dict]:
    """
    Single-pass MTCNN detection + batched FaceNet embedding.
    """
    mtcnn, resnet = get_models()
    
    with _inference_lock:
        boxes, probs = mtcnn.detect(pil_image)

    if boxes is None:
        return []

    candidates = []
    for box, prob in zip(boxes, probs):
        if prob < 0.90:
            continue
        face_tensor = extract_face(pil_image, box, image_size=160, margin=0)
        candidates.append(([int(b) for b in box], float(prob), face_tensor))

    if not candidates:
        return []

    batch = torch.stack([c[2] for c in candidates])
    batch = batch.float().div(255.0)
    batch = (batch - 0.5) / 0.5
    batch = batch.to(_device)

    with _inference_lock:
        with torch.no_grad():
            embeddings = resnet(batch)
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)

    embeddings_np = embeddings.cpu().numpy().astype(np.float32)

    return [
        {"box": box, "prob": prob, "embedding": emb}
        for (box, prob, _), emb in zip(candidates, embeddings_np)
    ]


def find_matches_batched(
    embeddings: list[np.ndarray],
    session,
    threshold: float = 0.70,
) -> list[tuple[str | None, str, float | None]]:
    """
    Batched recognition using individual find_match_voting calls.
    More stable than complex lateral join for now.
    """
    return [find_match_voting(emb, session, threshold) for emb in embeddings]


def find_match_voting(
    embedding: np.ndarray,
    session,
    threshold: float = 0.70,
) -> tuple[str | None, str, float | None]:
    """
    Voting-based person recognition using pgvector's native SQLAlchemy operator.
    """
    from sqlalchemy import select, func
    from models import FaceEmbedding, Person

    emb_list = embedding.tolist()

    # Sub-query: top-10 closest embeddings (uses HNSW index)
    inner = (
        select(
            FaceEmbedding.person_id,
            FaceEmbedding.embedding.cosine_distance(emb_list).label("dist"),
        )
        .order_by(FaceEmbedding.embedding.cosine_distance(emb_list))
        .limit(10)
        .subquery()
    )

    # Outer: group by person, count votes below threshold, pick best
    stmt = (
        select(
            inner.c.person_id,
            Person.name,
            func.count().label("votes"),
            func.min(inner.c.dist).label("best_dist"),
        )
        .join(Person, Person.id == inner.c.person_id)
        .where(inner.c.dist < threshold)
        .group_by(inner.c.person_id, Person.name)
        .order_by(func.count().desc(), func.min(inner.c.dist))
        .limit(1)
    )

    row = session.execute(stmt).fetchone()
    if row is None:
        return None, "Unknown", None
    return str(row.person_id), row.name, float(row.best_dist)

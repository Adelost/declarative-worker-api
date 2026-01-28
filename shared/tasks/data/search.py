"""
Semantic text search tasks.
Uses E5 or similar multilingual models.
"""

from typing import Optional
import numpy as np

from ..decorator import task


# Global model cache
_model = None


def _get_model(model_name: str = "intfloat/multilingual-e5-large"):
    """Get or create embedding model."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(model_name)
    return _model


@task(
    name="semantic.embed",
    tags=["data", "ai", "embed", "search"],
    gpu="T4",
    timeout=120,
)
def embed(
    texts: list[str],
    model_name: str = "intfloat/multilingual-e5-large",
    prefix: str = "passage: ",
    normalize: bool = True,
) -> list[list[float]]:
    """Generate embeddings for texts."""
    model = _get_model(model_name)

    if "e5" in model_name.lower():
        texts = [prefix + t for t in texts]

    embeddings = model.encode(texts, convert_to_numpy=True)

    if normalize:
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / (norms + 1e-8)

    return embeddings.tolist()


@task(
    name="semantic.search",
    tags=["data", "ai", "embed", "search"],
    gpu="T4",
    timeout=120,
)
def search(
    query: str,
    texts: list[str],
    embeddings: Optional[list[list[float]]] = None,
    top_k: int = 10,
    threshold: float = 0.0,
    model_name: str = "intfloat/multilingual-e5-large",
) -> list[dict]:
    """Search texts semantically."""
    # Get query embedding
    query_emb = np.array(embed([query], model_name, prefix="query: ")[0])

    # Get or compute text embeddings
    if embeddings is None:
        embeddings = embed(texts, model_name)

    embeddings_np = np.array(embeddings)

    # Compute similarities
    similarities = np.dot(embeddings_np, query_emb)

    # Get top results
    indices = np.argsort(similarities)[::-1]

    results = []
    for idx in indices[:top_k]:
        score = float(similarities[idx])
        if score >= threshold:
            results.append({
                "index": int(idx),
                "text": texts[idx],
                "score": score,
            })

    return results


@task(
    name="semantic.index",
    tags=["data", "ai", "embed", "search"],
    gpu="T4",
    timeout=300,
)
def index(
    texts: list[str],
    metadata: Optional[list[dict]] = None,
    model_name: str = "intfloat/multilingual-e5-large",
) -> dict:
    """Create a searchable index from texts."""
    embeddings = embed(texts, model_name)

    return {
        "texts": texts,
        "embeddings": embeddings,
        "metadata": metadata or [{} for _ in texts],
        "model": model_name,
    }


def clear_cache():
    """Clear model cache."""
    global _model
    _model = None

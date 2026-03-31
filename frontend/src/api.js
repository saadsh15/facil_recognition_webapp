import axios from "axios";

const api = axios.create({
  baseURL: "/",
  timeout: 8000, // 8s — covers worst-case MTCNN inference on CPU
});

/**
 * Returns [{id, name, created_at, embedding_count}]
 * Thumbnails are NOT included — fetch separately via getThumbnail().
 */
export const getFaces = () => api.get("/api/faces").then((r) => r.data);

/** Capture current frame; returns {capture_id, thumbnail}. */
export const captureFrame = () =>
  api.post("/api/capture-frame").then((r) => r.data);

/**
 * Register a new person: { capture_id, name }
 * Add an angle to an existing person: { capture_id, name, person_id }
 * Returns the saved Person object.
 */
export const saveFace = (capture_id, name, person_id = null) =>
  api
    .post("/api/faces", { capture_id, name, ...(person_id ? { person_id } : {}) })
    .then((r) => r.data);

/** Returns {thumbnail: "data:image/jpeg;base64,..."} */
export const getThumbnail = (person_id) =>
  api.get(`/api/faces/${person_id}/thumbnail`).then((r) => r.data.thumbnail);

/**
 * Fetch thumbnails for multiple persons in one request.
 * ids: string[] of person UUIDs
 * Returns {person_id: "data:image/jpeg;base64,..."} map.
 */
export const batchThumbnails = (ids) =>
  ids.length === 0
    ? Promise.resolve({})
    : api
        .get(`/api/faces/thumbnails?ids=${ids.join(",")}`)
        .then((r) => r.data);

/** Delete a person and all their embeddings. */
export const deleteFace = (id) => api.delete(`/api/faces/${id}`);

# Real-Time Facial Recognition System

A high-performance, real-time facial recognition application featuring a decoupled backend architecture, vector database similarity search, and a responsive frontend.

## Overview

This system leverages state-of-the-art machine learning models (MTCNN for face detection and FaceNet for embeddings) combined with a highly optimized PostgreSQL backend utilizing the `pgvector` extension with an HNSW index. The application employs a decoupled, multi-threaded architecture to ensure smooth video streaming and accurate recognition without blocking the main event loop.

## Key Features

- **Real-Time Recognition:** Processes live camera feeds to detect and recognize faces in real-time.
- **Voting-Based Matching:** Enhances accuracy by aggregating results from multiple registered angles (top-k closest embeddings) rather than a simple top-1 match.
- **Thread-Safe Frame Management:** A double-buffered `FrameStore` mechanism prevents redundant processing and decouples the camera capture, recognition pipeline, and MJPEG streaming threads.
- **Optimized Video Streaming:** Only re-encodes MJPEG frames when new recognition annotations are available, drastically reducing CPU load.
- **Vector Database:** Uses PostgreSQL with `pgvector` and HNSW indexing for rapid, high-recall similarity searches.
- **Scalable Frontend:** A modern React UI built with Vite and TailwindCSS. Utilizes `IntersectionObserver` to batch-fetch thumbnails efficiently as the database grows.

## Architecture & Tech Stack

**Backend:**
- **Framework:** Python / Flask
- **Computer Vision & ML:** OpenCV, PyTorch, MTCNN, FaceNet (`facenet-pytorch`)
- **Database:** PostgreSQL with `pgvector`
- **ORM:** SQLAlchemy

**Frontend:**
- **Framework:** React 18, Vite
- **Styling:** TailwindCSS
- **HTTP Client:** Axios

## Installation & Setup

### Prerequisites

- Python 3.10+ (tested up to 3.14)
- Node.js (v18+) and npm
- PostgreSQL with the `pgvector` extension installed
- A connected webcam or video input device (default: device index 0)

### 1. Database Setup

Ensure PostgreSQL is running and create a database for the application. You must enable the `vector` extension.

```sql
CREATE DATABASE facial_recognition;
\c facial_recognition
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. Backend Setup

Navigate to the `backend` directory and set up a virtual environment:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

Install the dependencies. Note the specific installation step for `facenet-pytorch` to bypass a stale numpy constraint:

```bash
# Install general dependencies
pip install -r requirements.txt

# Install facenet-pytorch without dependencies
pip install facenet-pytorch==2.6.0 --no-deps
```

Configure your environment variables. Create a `.env` file in the `backend` directory based on your PostgreSQL configuration:

```env
DATABASE_URL=postgresql://user:password@localhost/facial_recognition
```

Run the backend server:

```bash
# Development server
flask run

# Production server (using gunicorn, as configured in gunicorn.conf.py)
gunicorn app:app
```

### 3. Frontend Setup

Navigate to the `frontend` directory:

```bash
cd frontend
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`.

## Potential Considerations & Risks

- **Hardware/OS Lock-in:** The camera capture module is optimized for Linux (V4L2) and assumes device index 0. You may need to modify `backend/camera.py` for different OS environments or multiple cameras.
- **Resource Intensity:** The recognition pipeline is intentionally throttled to a target FPS (default 5 FPS) to prevent CPU/GPU saturation.
- **In-Memory Registrations:** Pending face registrations are stored in memory with a 5-minute Time-To-Live (TTL). If the limit (100) is reached under heavy load, new registrations might be blocked until older ones expire.

## License

MIT

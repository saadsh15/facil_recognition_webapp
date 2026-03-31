# Docker Deployment Guide for Real-Time Facial Recognition

This project is fully containerized using Docker and Docker Compose, including the frontend, backend, and a PostgreSQL database with the `pgvector` extension.

## Prerequisites

- **Docker** and **Docker Compose** installed on your system.
- **Linux users:** Your user must have access to `/dev/video0`.
- **Note for macOS/Windows:** Accessing a local webcam directly from a Docker container can be tricky. This setup is optimized for Linux but can be adapted for other systems (e.g., using a networked camera stream).

## Quick Start

1. **Configure Environment:**
   Copy the example environment file if needed, or use the defaults in `docker-compose.yml`.
   ```bash
   cp .env.docker .env
   ```

2. **Launch the Application:**
   ```bash
   docker-compose up -d --build
   ```

3. **Access the App:**
   - **Frontend:** Open your browser at `http://localhost`.
   - **Backend API:** `http://localhost/api/` (proxied through the frontend).
   - **Live Stream:** `http://localhost/stream` (proxied through the frontend).

## Managing the Containers

- **View Logs:**
  ```bash
  docker-compose logs -f
  ```

- **Stop the Application:**
  ```bash
  docker-compose down
  ```

- **Remove All Data (including database volume):**
  ```bash
  docker-compose down -v
  ```

## Troubleshooting Camera Access (Linux)

If the backend fails to open the camera:
1. Ensure `/dev/video0` exists on the host.
2. Check permissions: `ls -l /dev/video0`.
3. In `docker-compose.yml`, you might need to add `group_add: ["video"]` or use `privileged: true` if your system has strict device access policies.

Current configuration uses `devices: ["/dev/video0:/dev/video0"]`.

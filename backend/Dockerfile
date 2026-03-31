# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Set work directory
WORKDIR /app

# Install system dependencies for OpenCV and PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libpq-dev \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for caching
COPY requirements.txt .

# Install dependencies as specified in requirements.txt comments
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir facenet-pytorch==2.6.0 --no-deps

# Create a non-root user and add it to the existing video group
RUN useradd -m -G video appuser

# Copy the rest of the application code
COPY . .

# Ensure appuser owns the app directory
RUN chown -R appuser:appuser /app

# Switch to the non-root user
USER appuser

# Expose the port the app runs on
EXPOSE 5000

# Start the application using Gunicorn
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:create_app()"]

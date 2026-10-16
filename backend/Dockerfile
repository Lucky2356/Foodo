# Foodo API image. Build context: repository root (the API reads shared/data).
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --require-hashes -r requirements.txt

COPY shared /app/shared
COPY backend /app/backend
RUN rm -rf /app/backend/tests /app/backend/engine/tests \
    && FOODO_TESTING=1 DJANGO_STATIC_ROOT=/app/staticfiles python manage.py collectstatic --noinput -v0 \
    && useradd --system --uid 10001 --home /app foodo \
    && mkdir -p /app/media \
    && chown -R foodo /app/media

ARG FOODO_VERSION=dev
ENV FOODO_VERSION=${FOODO_VERSION} \
    DJANGO_STATIC_ROOT=/app/staticfiles \
    DJANGO_MEDIA_ROOT=/app/media \
    FOODO_SEED_DIR=/app/shared/data

USER foodo
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=4).status == 200 else 1)"
COPY --chmod=0755 backend/docker-entrypoint.sh /usr/local/bin/foodo-entrypoint
ENTRYPOINT ["foodo-entrypoint"]
CMD ["gunicorn", "foodo.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--access-logfile", "-", "--no-control-socket"]

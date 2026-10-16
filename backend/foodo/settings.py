"""Django settings. Every deployment-specific value comes from the environment (see .env.example)."""

from __future__ import annotations

import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG or os.environ.get("FOODO_TESTING") == "1":
        SECRET_KEY = "insecure-development-key-do-not-use-in-production"
    else:
        raise RuntimeError("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is off")

# Internal names are always allowed so container health checks and the nginx → api hop work.
ALLOWED_HOSTS = [*env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1"), "127.0.0.1", "localhost", "api"]
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

FOODO_APP_NAME = os.environ.get("FOODO_APP_NAME", "Foodo")
FOODO_SITE_URL = os.environ.get("FOODO_SITE_URL", "http://localhost:5173").rstrip("/")
FOODO_DEFAULT_CURRENCY = os.environ.get("FOODO_DEFAULT_CURRENCY", "RUB")
FOODO_DEFAULT_TIMEZONE = os.environ.get("FOODO_DEFAULT_TIMEZONE", "Europe/Moscow")
FOODO_SEED_DIR = Path(os.environ.get("FOODO_SEED_DIR", str(REPO_DIR / "shared" / "data")))
FOODO_IMPORT_MAX_BYTES = int(os.environ.get("FOODO_IMPORT_MAX_BYTES", str(2 * 1024 * 1024)))
FOODO_VERSION = os.environ.get("FOODO_VERSION", "dev")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "common",
    "catalog",
    "geo",
    "prices",
    "accounts",
    "households",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "common.middleware.NoStorePrivateApiMiddleware",
]

ROOT_URLCONF = "foodo.urls"
WSGI_APPLICATION = "foodo.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL", "postgres://foodo:foodo@127.0.0.1:5432/foodo"),
        conn_max_age=int(os.environ.get("DATABASE_CONN_MAX_AGE", "60")),
        conn_health_checks=True,
    )
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The database cache keeps throttling counters shared between gunicorn workers without Redis.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "foodo_cache",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_RESET_TIMEOUT = 60 * 60 * 24

LANGUAGE_CODE = "ru"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = Path(os.environ.get("DJANGO_STATIC_ROOT", str(BASE_DIR / "staticfiles")))
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media")))
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Sessions in HttpOnly cookies; CSRF token readable by the SPA (double submit via X-CSRFToken).
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_FAILURE_VIEW = "common.views.csrf_failure"
SECURE = env_bool("DJANGO_SECURE", not DEBUG)
SESSION_COOKIE_SECURE = SECURE
CSRF_COOKIE_SECURE = SECURE
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if env_bool("DJANGO_BEHIND_PROXY", True) else None
SECURE_SSL_REDIRECT = env_bool("DJANGO_SSL_REDIRECT", False)
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "0"))
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = FOODO_IMPORT_MAX_BYTES + 512 * 1024

EMAIL_BACKEND = os.environ.get("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "Foodo <noreply@example.com>")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser", "rest_framework.parsers.MultiPartParser"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "common.errors.exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "anon": "300/min",
        "user": "600/min",
        "login": os.environ.get("FOODO_THROTTLE_LOGIN", "10/min"),
        "register": os.environ.get("FOODO_THROTTLE_REGISTER", "20/hour"),
        "password_reset": os.environ.get("FOODO_THROTTLE_RESET", "5/hour"),
        "generate": os.environ.get("FOODO_THROTTLE_GENERATE", "60/hour"),
        "import": os.environ.get("FOODO_THROTTLE_IMPORT", "20/hour"),
        "price_share": os.environ.get("FOODO_THROTTLE_PRICE_SHARE", "200/day"),
    },
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"{FOODO_APP_NAME} API",
    "DESCRIPTION": "API бесплатного сервиса планирования питания. Приватные ресурсы требуют сессии и CSRF-токена.",
    "VERSION": FOODO_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
    # Request bodies (profiles, passwords) are never logged; django.request logs only path and status.
    "loggers": {"django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}

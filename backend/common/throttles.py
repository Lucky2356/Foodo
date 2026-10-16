from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class RegisterThrottle(AnonRateThrottle):
    scope = "register"


class PasswordResetThrottle(AnonRateThrottle):
    scope = "password_reset"


class GenerateThrottle(UserRateThrottle):
    scope = "generate"


class ImportThrottle(UserRateThrottle):
    scope = "import"


class PriceShareThrottle(UserRateThrottle):
    scope = "price_share"


class LoginIdentityThrottle(SimpleRateThrottle):
    """Limits attempts per e-mail address regardless of the client IP."""

    scope = "login"

    def get_cache_key(self, request, view):  # type: ignore[no-untyped-def]
        email = str(request.data.get("email", "")).strip().lower() if hasattr(request, "data") else ""
        if not email:
            return None
        return self.cache_format % {"scope": "login-email", "ident": email}

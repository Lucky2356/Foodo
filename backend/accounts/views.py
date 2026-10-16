"""Session authentication API: CSRF bootstrap, registration, login/logout, password reset,
password change, data export and account deletion."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, password_validation, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from common.errors import ApiError
from common.throttles import LoginIdentityThrottle, LoginThrottle, PasswordResetThrottle, RegisterThrottle
from households.export import export_user_data
from households.models import Household, Membership


def user_json(user: User) -> dict[str, Any]:
    households = [
        {"id": str(m.household_id), "name": m.household.name, "role": m.role}
        for m in Membership.objects.filter(user=user).select_related("household").order_by("created_at")
    ]
    return {"id": user.id, "email": user.email, "name": user.first_name, "households": households}


class CredentialsSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class RegisterSerializer(CredentialsSerializer):
    name = serializers.CharField(max_length=60, required=False, allow_blank=True)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie; the SPA sends it back in the X-CSRFToken header."""

    def get(self, request: Request) -> Response:
        return Response({"ok": True, "authenticated": request.user.is_authenticated})


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    throttle_classes = [RegisterThrottle]

    def post(self, request: Request) -> Response:
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"].strip().lower()
        if User.objects.filter(username=email).exists():
            raise ApiError("email_taken", "Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.", 409)
        user = User(username=email, email=email, first_name=s.validated_data.get("name", ""))
        try:
            password_validation.validate_password(s.validated_data["password"], user)
        except DjangoValidationError as e:
            raise ApiError("weak_password", " ".join(e.messages), 400) from e
        with transaction.atomic():
            user.set_password(s.validated_data["password"])
            user.save()
            household = Household.objects.create(name="Моя семья", owner=user)
            Membership.objects.create(household=household, user=user, role="owner")
        login(request, user)
        return Response(user_json(user), status=201)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    throttle_classes = [LoginThrottle, LoginIdentityThrottle]

    def post(self, request: Request) -> Response:
        s = CredentialsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request, username=s.validated_data["email"].strip().lower(), password=s.validated_data["password"])
        if user is None:
            raise ApiError("invalid_credentials", "Неверная почта или пароль.", 400)
        login(request, user)
        return Response(user_json(user))


class LogoutView(APIView):
    def post(self, request: Request) -> Response:
        logout(request)
        response = Response({"ok": True})
        # Tells the browser to drop cached data for this origin (the SPA also wipes its account store).
        response["Clear-Site-Data"] = '"cache"'
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(user_json(request.user))

    def patch(self, request: Request) -> Response:
        name = request.data.get("name")
        if name is not None:
            if not isinstance(name, str) or len(name) > 60:
                raise ApiError("invalid_name", "Имя — до 60 символов.")
            request.user.first_name = name
            request.user.save(update_fields=["first_name"])
        return Response(user_json(request.user))


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    throttle_classes = [PasswordResetThrottle]

    def post(self, request: Request) -> Response:
        email = str(request.data.get("email", "")).strip().lower()
        user = User.objects.filter(username=email, is_active=True).first()
        if user is not None:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.FOODO_SITE_URL}/#/reset-password?uid={uid}&token={token}"
            send_mail(
                subject=f"{settings.FOODO_APP_NAME}: восстановление пароля",
                message=f"Чтобы задать новый пароль, откройте ссылку (действует 24 часа):\n{link}\n\nЕсли вы не запрашивали восстановление, просто проигнорируйте письмо.",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
            )
        # The same answer whether or not the address exists, so accounts cannot be enumerated.
        return Response({"ok": True, "message": "Если такой аккаунт есть, мы отправили письмо со ссылкой."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    throttle_classes = [PasswordResetThrottle]

    def post(self, request: Request) -> Response:
        try:
            uid = force_str(urlsafe_base64_decode(str(request.data.get("uid", ""))))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None
        token = str(request.data.get("token", ""))
        if user is None or not default_token_generator.check_token(user, token):
            raise ApiError("invalid_reset_link", "Ссылка недействительна или устарела. Запросите новую.", 400)
        password = str(request.data.get("password", ""))
        try:
            password_validation.validate_password(password, user)
        except DjangoValidationError as e:
            raise ApiError("weak_password", " ".join(e.messages), 400) from e
        user.set_password(password)
        user.save()
        return Response({"ok": True})


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = request.user
        if not user.check_password(str(request.data.get("old_password", ""))):
            raise ApiError("invalid_password", "Текущий пароль указан неверно.", 400)
        new = str(request.data.get("new_password", ""))
        try:
            password_validation.validate_password(new, user)
        except DjangoValidationError as e:
            raise ApiError("weak_password", " ".join(e.messages), 400) from e
        user.set_password(new)
        user.save()
        update_session_auth_hash(request, user)
        return Response({"ok": True})


class AccountExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        response = Response(export_user_data(request.user))
        response["Content-Disposition"] = 'attachment; filename="foodo-account-export.json"'
        return response


class AccountDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = request.user
        if request.data.get("confirm") != "УДАЛИТЬ":
            raise ApiError("confirmation_required", "Введите слово УДАЛИТЬ, чтобы подтвердить удаление аккаунта.", 400)
        if not user.check_password(str(request.data.get("password", ""))):
            raise ApiError("invalid_password", "Пароль указан неверно.", 400)
        with transaction.atomic():
            Household.objects.filter(owner=user).delete()
            user.delete()
        logout(request)
        response = Response({"ok": True})
        response["Clear-Site-Data"] = '"cache"'  # never "storage": it would also erase guest data on this device
        return response

"""Private household API. Every handler starts with household_for(), which checks membership."""

from __future__ import annotations

import hashlib
import secrets
from datetime import date, timedelta
from typing import Any

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Product, Recipe
from catalog.services import engine_catalog, recipe_to_json, save_recipe, validation_reference
from catalog.validation import validate_recipes
from common.errors import ApiError
from common.throttles import GenerateThrottle, ImportThrottle, PriceShareThrottle
from engine import rank_candidates
from geo.models import City, StoreChain
from prices.services import share_observation

from . import services
from .guest_import import apply_guest_import, preview_guest_import
from .models import Favorite, Habit, HabitMark, Household, Invitation, Member, Membership, Menu, PantryItem, PriceEntry, WaterEntry
from .permissions import OWNER, READ, WRITE, household_for
from .validation import member_json, validate_household_settings, validate_member

JSON = dict[str, Any]


def _date(value: Any, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as e:
        raise ApiError("validation_error", f"Некорректная дата в поле «{field}».", 400, {"field": field}) from e


def household_json(h: Household, role: str) -> JSON:
    return {
        "id": str(h.id),
        "name": h.name,
        "role": role,
        "settings": services.household_settings(h),
        "city": {"id": h.city.id, "name": h.city.name, "region": h.city.region, "timezone": h.city.timezone} if h.city_id else None,
        "store_chain_id": h.store_chain_id,
        "share_prices": h.share_prices,
        "members": [member_json(m) for m in h.members.all()],
    }


class HouseholdListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        memberships = Membership.objects.filter(user=request.user).select_related("household", "household__city")
        return Response([household_json(m.household, m.role) for m in memberships])

    def post(self, request: Request) -> Response:
        name = str(request.data.get("name") or "Моя семья").strip()[:100]
        if Membership.objects.filter(user=request.user, role="owner").count() >= 10:
            raise ApiError("limit", "Можно создать не больше 10 семей.", 400)
        with transaction.atomic():
            h = Household.objects.create(name=name, owner=request.user)
            Membership.objects.create(household=h, user=request.user, role="owner")
        return Response(household_json(h, "owner"), status=201)


class HouseholdDetailView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, role = household_for(request, hid)
        return Response(household_json(h, role))

    def patch(self, request: Request, hid: str) -> Response:
        h, role = household_for(request, hid, WRITE)
        data = request.data
        if "name" in data:
            h.name = str(data["name"]).strip()[:100] or h.name
        if "settings" in data:
            h.settings = validate_household_settings(data["settings"])
        if "city_id" in data:
            h.city = get_object_or_404(City, pk=data["city_id"]) if data["city_id"] else None
        if "store_chain_id" in data:
            h.store_chain = get_object_or_404(StoreChain, pk=data["store_chain_id"]) if data["store_chain_id"] else None
        if "share_prices" in data:
            h.share_prices = bool(data["share_prices"])
        h.save()
        return Response(household_json(h, role))

    def delete(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, OWNER)
        h.delete()
        return Response(status=204)


class MemberListView(APIView):
    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        if h.members.count() >= 20:
            raise ApiError("limit", "В семье может быть не больше 20 участников.", 400)
        data = validate_member(request.data)
        m = Member.objects.create(household=h, **data)
        return Response(member_json(m), status=201)


class MemberDetailView(APIView):
    def patch(self, request: Request, hid: str, mid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        m = get_object_or_404(Member, pk=mid, household=h)
        merged = {**member_json(m), **request.data}
        data = validate_member(merged, partial=True)
        for k, v in data.items():
            setattr(m, k, v)
        m.save()
        return Response(member_json(m))

    def delete(self, request: Request, hid: str, mid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Member, pk=mid, household=h).delete()
        return Response(status=204)


class InvitationView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, OWNER)
        return Response(
            {
                "invitations": [
                    {"id": i.id, "email": i.email, "role": i.role, "expires_at": i.expires_at, "accepted": i.accepted_by_id is not None}
                    for i in h.invitations.order_by("-created_at")
                ],
                "memberships": [{"user_email": m.user.email, "role": m.role, "user_id": m.user_id} for m in h.memberships.select_related("user")],
            }
        )

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, OWNER)
        role = request.data.get("role", "editor")
        email = str(request.data.get("email", "")).strip().lower()
        if role not in ("editor", "viewer") or "@" not in email:
            raise ApiError("validation_error", "Укажите почту и роль (editor или viewer).")
        token = secrets.token_urlsafe(24)
        Invitation.objects.create(
            household=h, email=email, role=role, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=timezone.now() + timedelta(days=7)
        )
        # The owner shares the code personally; Foodo does not e-mail invitations to third parties.
        return Response({"token": token, "expires_in_days": 7}, status=201)

    def delete(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, OWNER)
        user_id = request.data.get("user_id")
        if user_id == request.user.id:
            raise ApiError("validation_error", "Владелец не может удалить себя из семьи.")
        Membership.objects.filter(household=h, user_id=user_id).exclude(role="owner").delete()
        return Response(status=204)


class AcceptInvitationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        token = str(request.data.get("token", ""))
        inv = Invitation.objects.filter(token_hash=hashlib.sha256(token.encode()).hexdigest(), accepted_by__isnull=True, expires_at__gt=timezone.now()).first()
        if inv is None or inv.email != request.user.email:
            raise ApiError("invalid_invitation", "Приглашение недействительно, устарело или выдано на другую почту.", 400)
        with transaction.atomic():
            Membership.objects.get_or_create(household=inv.household, user=request.user, defaults={"role": inv.role})
            inv.accepted_by = request.user
            inv.save(update_fields=["accepted_by"])
        return Response({"household_id": str(inv.household_id)})


class MenuListView(APIView):
    throttle_scope = None

    def get_throttles(self):  # type: ignore[no-untyped-def]
        return [GenerateThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response([services.menu_summary(m) for m in h.menus.all()[:200]])

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        start = _date(request.data.get("start_date") or date.today().isoformat(), "start_date")
        days = request.data.get("days")
        seed = request.data.get("seed")
        if days is not None and (not isinstance(days, int) or not 1 <= days <= 35):
            raise ApiError("invalid_days", "Период меню должен быть от 1 до 35 дней.")
        if seed is not None and (not isinstance(seed, int) or not 0 <= seed <= 4294967295):
            raise ApiError("invalid_seed", "Seed должен быть целым числом от 0 до 4294967295.")
        req = services.build_plan_request(h, start.isoformat(), days, seed)
        menu = services.create_menu(h, req, str(request.data.get("title", "")))
        return Response(services.menu_json(menu), status=201)


class MenuDetailView(APIView):
    def get(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid)
        return Response(services.menu_json(get_object_or_404(Menu, pk=menu_id, household=h)))

    def patch(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        menu = get_object_or_404(Menu, pk=menu_id, household=h)
        if "title" in request.data:
            menu.title = str(request.data["title"])[:120]
        if "is_favorite" in request.data:
            menu.is_favorite = bool(request.data["is_favorite"])
        menu.save(update_fields=["title", "is_favorite", "updated_at"])
        return Response(services.menu_summary(menu))

    def delete(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Menu, pk=menu_id, household=h).delete()
        return Response(status=204)


class MenuOpView(APIView):
    def post(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Menu, pk=menu_id, household=h)
        op = request.data.get("op")
        if not isinstance(op, dict):
            raise ApiError("validation_error", "Ожидается операция {op: {...}}.")
        menu = services.apply_op(h, menu_id, op, request.data.get("expected_revision"))
        return Response(services.menu_json(menu))


class MenuCandidatesView(APIView):
    def get(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid)
        menu = get_object_or_404(Menu, pk=menu_id, household=h)
        item_id = request.query_params.get("item_id")
        meal = next((m for m in menu.data["meals"] for i in m["items"] if i["id"] == item_id), None)
        if meal is None:
            raise ApiError("item_not_found", "Блюдо не найдено в меню.", 404)
        item = next(i for i in meal["items"] if i["id"] == item_id)
        members = [m for m in services.members_json(h) if m["id"] in item["portions"]]
        req = {
            **services.build_plan_request(h, menu.data["start_date"], menu.data["days"], menu.data["seed"], menu.data["slots"]),
            "settings": menu.data["settings"],
        }
        ranked = rank_candidates(req, engine_catalog(h.id), menu.data, meal["date"], meal["slot"], members, item_id)
        return Response(ranked[:30])


class ShoppingView(APIView):
    def get(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid)
        return Response(services.shopping_for(h, get_object_or_404(Menu, pk=menu_id, household=h)))

    def patch(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Menu, pk=menu_id, household=h)
        menu = services.update_shopping_state(h, menu_id, request.data, request.data.get("expected_revision"))
        return Response(services.shopping_for(h, menu))


class ShoppingTransferView(APIView):
    def post(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Menu, pk=menu_id, household=h)
        ids = request.data.get("line_ids")
        if not isinstance(ids, list) or len(ids) > 500:
            raise ApiError("validation_error", "Ожидается список строк.")
        return Response(services.transfer_purchases(h, menu_id, [str(i) for i in ids]))


class CookView(APIView):
    def post(self, request: Request, hid: str, menu_id: str, batch_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Menu, pk=menu_id, household=h)
        confirmation, created = services.confirm_cooking(h, menu_id, batch_id)
        return Response(
            {"batch_id": batch_id, "created": created, "allocations": confirmation.allocations, "pantry": services.pantry_json(h)},
            status=201 if created else 200,
        )


class ReportView(APIView):
    def get(self, request: Request, hid: str, menu_id: str) -> Response:
        h, _ = household_for(request, hid)
        return Response(services.report_for(h, get_object_or_404(Menu, pk=menu_id, household=h)))


def _pantry_fields(data: JSON) -> JSON:
    product = Product.objects.filter(pk=data.get("product_id")).first()
    if product is None:
        raise ApiError("unknown_product", "Неизвестный продукт.")
    qty = data.get("qty")
    if not isinstance(qty, (int, float)) or isinstance(qty, bool) or not 0 < qty <= 1_000_000:
        raise ApiError("validation_error", "Количество — положительное число.")
    unit = data.get("unit") or product.base_unit
    if unit != product.base_unit:
        raise ApiError("validation_error", f"Для «{product.name}» количество указывается в единице «{product.base_unit}».")
    expires = _date(data["expires"], "expires") if data.get("expires") else None
    return {"product": product, "qty": float(qty), "unit": unit, "location": str(data.get("location") or "")[:60], "expires": expires}


class PantryListView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response(services.pantry_json(h))

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        if h.pantry.count() >= 1000:
            raise ApiError("limit", "Слишком много записей остатков.")
        item = PantryItem.objects.create(household=h, **_pantry_fields(request.data))
        return Response(next(p for p in services.pantry_json(h) if p["id"] == item.id), status=201)


class PantryDetailView(APIView):
    def patch(self, request: Request, hid: str, item_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        item = get_object_or_404(PantryItem, pk=item_id, household=h)
        fields = _pantry_fields(
            {
                "product_id": item.product_id,
                "qty": item.qty,
                "unit": item.unit,
                "location": item.location,
                "expires": item.expires.isoformat() if item.expires else None,
                **request.data,
            }
        )
        for k, v in fields.items():
            setattr(item, k, v)
        item.save()
        return Response(next(p for p in services.pantry_json(h) if p["id"] == item.id))

    def delete(self, request: Request, hid: str, item_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(PantryItem, pk=item_id, household=h).delete()
        return Response(status=204)


def _price_fields(data: JSON) -> JSON:
    if not Product.objects.filter(pk=data.get("product_id")).exists():
        raise ApiError("unknown_product", "Неизвестный продукт.")
    price = data.get("price_kop")
    size = data.get("package_size")
    if not isinstance(price, int) or isinstance(price, bool) or not 0 < price <= 10_000_000:
        raise ApiError("validation_error", "Цена в копейках — положительное целое число.")
    if not isinstance(size, (int, float)) or isinstance(size, bool) or not 0 < size <= 100_000:
        raise ApiError("validation_error", "Размер упаковки — положительное число.")
    if data.get("package_unit") not in ("g", "kg", "ml", "l", "pcs"):
        raise ApiError("validation_error", "Единица упаковки: g, kg, ml, l или pcs.")
    chain_id = data.get("chain_id")
    if chain_id and not StoreChain.objects.filter(pk=chain_id).exists():
        raise ApiError("validation_error", "Неизвестная сеть.")
    kind = data.get("kind", "manual")
    if kind not in ("manual", "receipt"):
        raise ApiError("validation_error", "Вид цены: manual или receipt.")
    return {
        "product_id": data["product_id"],
        "price_kop": price,
        "package_size": float(size),
        "package_unit": data["package_unit"],
        "loose": bool(data.get("loose", False)),
        "observed_on": _date(data.get("date") or date.today().isoformat(), "date"),
        "source": str(data.get("source") or "вручную")[:120],
        "kind": kind,
        "chain_id": chain_id or None,
        "available": data.get("available") if isinstance(data.get("available"), bool) else None,
    }


class PriceListView(APIView):
    def get_throttles(self):  # type: ignore[no-untyped-def]
        return [PriceShareThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response({"own": [services.price_entry_json(e) for e in h.prices.all()], "profile": services.price_profile(h)})

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        rows = request.data.get("entries") if isinstance(request.data.get("entries"), list) else [request.data]
        if len(rows) > 1000:
            raise ApiError("too_large", "Не больше 1000 цен за раз.")
        fields = [_price_fields(r) for r in rows]
        shared = 0
        with transaction.atomic():
            created = [PriceEntry.objects.create(household=h, **f) for f in fields]
        if h.share_prices and h.city_id:
            for e in created:
                chain = StoreChain.objects.filter(pk=e.chain_id or h.store_chain_id).first()
                if chain is not None and share_observation(
                    user_id=request.user.id,
                    city=h.city,
                    chain=chain,
                    product_id=e.product_id,
                    price_kop=e.price_kop,
                    package_size=e.package_size,
                    package_unit=e.package_unit,
                    loose=e.loose,
                    observed_on=e.observed_on,
                ):
                    shared += 1
        return Response({"created": [services.price_entry_json(e) for e in created], "shared": shared}, status=201)


class PriceDetailView(APIView):
    def delete(self, request: Request, hid: str, price_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(PriceEntry, pk=price_id, household=h).delete()
        return Response(status=204)


class FavoriteView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response(list(h.favorites.values_list("recipe_id", flat=True)))

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        recipe = get_object_or_404(Recipe, pk=request.data.get("recipe_id"))
        if recipe.visibility == "private" and recipe.owner_household_id != h.id:
            raise ApiError("not_found", "Не найдено.", 404)
        Favorite.objects.get_or_create(household=h, recipe=recipe)
        return Response(list(h.favorites.values_list("recipe_id", flat=True)), status=201)

    def delete(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        Favorite.objects.filter(household=h, recipe_id=request.data.get("recipe_id")).delete()
        return Response(list(h.favorites.values_list("recipe_id", flat=True)))


class CustomRecipeView(APIView):
    """Private recipes of a household (never public)."""

    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response([recipe_to_json(r) for r in Recipe.objects.filter(owner_household=h).prefetch_related("ingredients", "methods")])

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        data = dict(request.data)
        rid = str(data.get("id") or "")
        if not rid.startswith("u-"):
            data["id"] = f"u-{str(h.id)[:8]}-{secrets.token_hex(4)}"
        existing = Recipe.objects.filter(pk=data["id"]).first()
        if existing is not None and existing.owner_household_id != h.id:
            raise ApiError("conflict", "Рецепт с таким идентификатором уже существует.", 409)
        products = set(Product.objects.values_list("id", flat=True))
        errors = validate_recipes([{**data, "source": data.get("source") or "user"}], products, validation_reference())
        if errors:
            raise ApiError("validation_error", "Проверьте рецепт.", 400, {"errors": errors})
        recipe, _ = save_recipe({**data, "source": data.get("source") or "user"}, owner_household_id=h.id)
        return Response(recipe_to_json(recipe), status=201)


class CustomRecipeDetailView(APIView):
    def delete(self, request: Request, hid: str, recipe_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Recipe, pk=recipe_id, owner_household=h).delete()
        return Response(status=204)


class WaterView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        member = get_object_or_404(Member, pk=request.query_params.get("member_id"), household=h)
        days = min(int(request.query_params.get("days", "14")), 120)
        today = services.local_today(member)
        entries = member.water.filter(local_date__gte=today - timedelta(days=days - 1))
        totals: dict[str, int] = {}
        for e in entries:
            totals[e.local_date.isoformat()] = totals.get(e.local_date.isoformat(), 0) + e.amount_ml
        return Response(
            {
                "member_id": member.id,
                "today": today.isoformat(),
                "goal_ml": member.water_goal_ml,
                "totals": totals,
                "entries": [{"id": e.id, "amount_ml": e.amount_ml, "local_date": e.local_date.isoformat(), "created_at": e.created_at} for e in entries],
            }
        )

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        member = get_object_or_404(Member, pk=request.data.get("member_id"), household=h)
        amount = request.data.get("amount_ml")
        if not isinstance(amount, int) or isinstance(amount, bool) or not 1 <= amount <= 5000:
            raise ApiError("validation_error", "Объём — от 1 до 5000 мл.")
        local = _date(request.data["local_date"], "local_date") if request.data.get("local_date") else services.local_today(member)
        entry = WaterEntry.objects.create(household=h, member=member, amount_ml=amount, local_date=local)
        return Response({"id": entry.id, "amount_ml": entry.amount_ml, "local_date": entry.local_date.isoformat()}, status=201)


class WaterDetailView(APIView):
    def delete(self, request: Request, hid: str, entry_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(WaterEntry, pk=entry_id, household=h).delete()
        return Response(status=204)


def habit_json(habit: Habit, days: int = 30) -> JSON:
    since = date.today() - timedelta(days=days)
    return {
        "id": habit.id,
        "member_id": habit.member_id,
        "name": habit.name,
        "archived": habit.archived,
        "marks": [m.local_date.isoformat() for m in habit.marks.filter(local_date__gte=since).order_by("local_date")],
    }


class HabitListView(APIView):
    def get(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid)
        return Response([habit_json(x) for x in h.habits.filter(archived=False)])

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        member = get_object_or_404(Member, pk=request.data.get("member_id"), household=h)
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 80:
            raise ApiError("validation_error", "Название привычки — от 1 до 80 символов.")
        return Response(habit_json(Habit.objects.create(household=h, member=member, name=name)), status=201)


class HabitDetailView(APIView):
    def delete(self, request: Request, hid: str, habit_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        get_object_or_404(Habit, pk=habit_id, household=h).delete()
        return Response(status=204)


class HabitMarkView(APIView):
    """PUT marks a day done, DELETE unmarks it. Both are idempotent."""

    def put(self, request: Request, hid: str, habit_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        habit = get_object_or_404(Habit, pk=habit_id, household=h)
        day = _date(request.data.get("local_date") or services.local_today(habit.member).isoformat(), "local_date")
        try:
            HabitMark.objects.get_or_create(habit=habit, local_date=day)
        except IntegrityError:
            pass
        return Response(habit_json(habit))

    def delete(self, request: Request, hid: str, habit_id: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        habit = get_object_or_404(Habit, pk=habit_id, household=h)
        day = _date(request.data.get("local_date") or services.local_today(habit.member).isoformat(), "local_date")
        HabitMark.objects.filter(habit=habit, local_date=day).delete()
        return Response(habit_json(habit))


class GuestImportView(APIView):
    """Explicit transfer of guest data: POST {data, mode: "preview"} shows what will be added and
    the conflicts; POST {data, mode: "apply", resolution} writes it in one transaction."""

    throttle_classes = [ImportThrottle]

    def post(self, request: Request, hid: str) -> Response:
        h, _ = household_for(request, hid, WRITE)
        data = request.data.get("data")
        if request.data.get("mode") == "apply":
            return Response(apply_guest_import(h, data, request.data.get("resolution") or {}), status=201)
        return Response(preview_guest_import(h, data))


READ_ONLY = READ

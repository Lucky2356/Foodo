"""Private user data. Every row belongs to a household; access is checked through Membership."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


def new_id() -> str:
    # Engine ids must never look like integers (JSON object key order); "m-…" style keeps them strings.
    return uuid.uuid4().hex


class Household(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("Название", max_length=100, default="Моя семья")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_households")
    # Plan settings (engine PlanSettings + slots + days) and the selected city/store.
    settings = models.JSONField(default=dict)
    city = models.ForeignKey("geo.City", null=True, blank=True, on_delete=models.SET_NULL)
    store_chain = models.ForeignKey("geo.StoreChain", null=True, blank=True, on_delete=models.SET_NULL)
    share_prices = models.BooleanField("Делиться ценами анонимно", default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Семья"
        verbose_name_plural = "Семьи"

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    ROLES = [("owner", "Владелец"), ("editor", "Может изменять"), ("viewer", "Только просмотр")]

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=ROLES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["household", "user"], name="unique_membership")]
        verbose_name = "Доступ к семье"
        verbose_name_plural = "Доступы к семьям"


class Invitation(models.Model):
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(max_length=10, choices=[("editor", "Может изменять"), ("viewer", "Только просмотр")])
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Приглашение"
        verbose_name_plural = "Приглашения"


class Member(models.Model):
    """A person the household plans meals for (may or may not have an account)."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="members")
    name = models.CharField(max_length=60)
    age = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(120)])
    sex = models.CharField(max_length=6, null=True, blank=True, choices=[("male", "мужской"), ("female", "женский")])
    height_cm = models.FloatField(null=True, blank=True, validators=[MinValueValidator(40), MaxValueValidator(250)])
    weight_kg = models.FloatField(null=True, blank=True, validators=[MinValueValidator(2), MaxValueValidator(400)])
    activity = models.CharField(max_length=10, null=True, blank=True)
    goal = models.CharField(max_length=10, null=True, blank=True)
    portion_mode = models.CharField(max_length=6, default="simple")
    portion_factor = models.FloatField(default=1, validators=[MinValueValidator(0.25), MaxValueValidator(3)])
    kcal_target = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(500), MaxValueValidator(6000)])
    macro_targets = models.JSONField(null=True, blank=True)
    restrictions = models.JSONField(default=dict)
    preferences = models.JSONField(default=dict)
    vitamin_targets_manual = models.JSONField(null=True, blank=True)
    water_goal_ml = models.PositiveIntegerField(null=True, blank=True)
    timezone = models.CharField(max_length=40, default="Europe/Moscow")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "name"]
        verbose_name = "Участник"
        verbose_name_plural = "Участники"


class Menu(models.Model):
    """A saved menu document (engine format, includes the recipe snapshot)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="menus")
    title = models.CharField(max_length=120, blank=True)
    start_date = models.DateField()
    days = models.PositiveSmallIntegerField()
    revision = models.PositiveIntegerField(default=1)
    data = models.JSONField()
    shopping_state = models.JSONField(default=dict)
    shopping_revision = models.PositiveIntegerField(default=1)
    is_favorite = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date", "-created_at"]
        verbose_name = "Меню"
        verbose_name_plural = "Меню"


class CookConfirmation(models.Model):
    """«Приготовлено»: pantry deduction for a batch happens exactly once (unique constraint)."""

    menu = models.ForeignKey(Menu, on_delete=models.CASCADE, related_name="cook_confirmations")
    batch_id = models.CharField(max_length=20)
    allocations = models.JSONField(default=list)
    confirmed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["menu", "batch_id"], name="unique_cook_confirmation")]


class PurchaseTransfer(models.Model):
    """«Перенести купленное в остатки»: one transfer per shopping line and menu."""

    menu = models.ForeignKey(Menu, on_delete=models.CASCADE, related_name="purchase_transfers")
    line_id = models.CharField(max_length=120)
    qty = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["menu", "line_id"], name="unique_purchase_transfer")]


class PantryItem(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="pantry")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)
    qty = models.FloatField(validators=[MinValueValidator(0)])
    unit = models.CharField(max_length=5, choices=[("g", "г"), ("ml", "мл"), ("pcs", "шт.")])
    location = models.CharField(max_length=60, blank=True)
    expires = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["expires", "created_at"]


class PriceEntry(models.Model):
    """The household's own prices (manual input, receipts or imported files)."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="prices")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE)
    chain = models.ForeignKey("geo.StoreChain", null=True, blank=True, on_delete=models.SET_NULL)
    price_kop = models.PositiveIntegerField(validators=[MaxValueValidator(10_000_000)])
    package_size = models.FloatField(validators=[MinValueValidator(0.001)])
    package_unit = models.CharField(max_length=5)
    loose = models.BooleanField(default=False)
    currency = models.CharField(max_length=3, default="RUB")
    observed_on = models.DateField()
    source = models.CharField(max_length=120, default="вручную")
    kind = models.CharField(max_length=10, default="manual", choices=[("manual", "вручную"), ("receipt", "чек")])
    available = models.BooleanField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-observed_on", "-created_at"]


class Favorite(models.Model):
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="favorites")
    recipe = models.ForeignKey("catalog.Recipe", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["household", "recipe"], name="unique_favorite")]


class WaterEntry(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="water")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="water")
    amount_ml = models.PositiveIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5000)])
    local_date = models.DateField(help_text="Дата в часовом поясе участника на момент записи")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["member", "local_date"])]


class Habit(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="habits")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="habits")
    name = models.CharField(max_length=80)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class HabitMark(models.Model):
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="marks")
    local_date = models.DateField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["habit", "local_date"], name="unique_habit_mark")]

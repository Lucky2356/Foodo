from __future__ import annotations

from django.core.validators import MinValueValidator
from django.db import models


class CatalogState(models.Model):
    """Singleton counter bumped on every catalog change; used as ETag and cache key."""

    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Версия каталога"
        verbose_name_plural = "Версия каталога"

    @classmethod
    def current(cls) -> CatalogState:
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class ReferenceData(models.Model):
    """Static reference lists (nutrient definitions, departments, meal slots, sources, …) in the
    shared JSON format. Categories, allergens, equipment, techniques and diet tags have their own
    tables so they can be managed comfortably in the admin."""

    data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Справочные данные"
        verbose_name_plural = "Справочные данные"


class Category(models.Model):
    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children", verbose_name="Родитель")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Категория продуктов"
        verbose_name_plural = "Категории продуктов"

    def __str__(self) -> str:
        return self.name


class Allergen(models.Model):
    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Аллерген"
        verbose_name_plural = "Аллергены"

    def __str__(self) -> str:
        return self.name


class Equipment(models.Model):
    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Кухонная техника"
        verbose_name_plural = "Кухонная техника"

    def __str__(self) -> str:
        return self.name


class Technique(models.Model):
    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    rank = models.PositiveSmallIntegerField("Уровень навыка", help_text="1 — начинающий, 2 — уверенный, 3 — опытный")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Кулинарный приём"
        verbose_name_plural = "Кулинарные приёмы"

    def __str__(self) -> str:
        return f"{self.name} ({self.rank})"


class DietTag(models.Model):
    """Recipe suitability tag with its weight in each diet mode (docs/NUTRITION_RULES.md)."""

    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    balanced_weight = models.FloatField("Вес в режиме «Сбалансированное (ПП)»", null=True, blank=True)
    regular_weight = models.FloatField("Вес в режиме «Обычное»", null=True, blank=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Тег режима питания"
        verbose_name_plural = "Теги режимов питания"

    def __str__(self) -> str:
        return self.name


class Product(models.Model):
    STATES = [("raw", "сырой"), ("dry", "сухой"), ("cooked", "приготовленный"), ("processed", "готовый продукт")]
    BASE_UNITS = [("g", "г"), ("ml", "мл"), ("pcs", "шт.")]
    PACKAGE_UNITS = [("g", "г"), ("kg", "кг"), ("ml", "мл"), ("l", "л"), ("pcs", "шт.")]

    id = models.SlugField(primary_key=True, max_length=60)
    name = models.CharField("Название", max_length=200)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, verbose_name="Категория")
    department = models.CharField("Отдел магазина", max_length=100)
    state = models.CharField("Состояние", max_length=20, choices=STATES)
    base_unit = models.CharField("Базовая единица", max_length=5, choices=BASE_UNITS)
    edible_fraction = models.FloatField("Съедобная доля", validators=[MinValueValidator(0.01)])
    piece_g = models.FloatField("Масса штуки, г", null=True, blank=True)
    density_g_ml = models.FloatField("Плотность, г/мл", null=True, blank=True)
    spoon_g = models.JSONField("Масса ложек/щепотки, г", default=dict, blank=True)
    package_size = models.FloatField("Типичная упаковка", null=True, blank=True)
    package_unit = models.CharField("Единица упаковки", max_length=5, choices=PACKAGE_UNITS, blank=True)
    allergens = models.ManyToManyField(Allergen, blank=True, verbose_name="Аллергены")
    contains = models.ManyToManyField("self", symmetrical=False, blank=True, related_name="contained_in", verbose_name="Состав")
    composition_known = models.BooleanField("Состав известен", default=True)
    purchasable = models.BooleanField("Покупается", default=True)
    source = models.CharField("Источник пищевой ценности", max_length=100)
    nutrients = models.JSONField("Пищевая ценность на 100 г съедобной части", default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Продукт"
        verbose_name_plural = "Продукты"

    def __str__(self) -> str:
        return self.name


class Recipe(models.Model):
    VISIBILITY = [("public", "Публичный"), ("private", "Приватный")]

    id = models.SlugField(primary_key=True, max_length=100)
    version = models.PositiveIntegerField(default=1, editable=False)
    name = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    category = models.CharField("Категория", max_length=40)
    meal_types = models.JSONField("Приёмы пищи", default=list)
    servings = models.PositiveSmallIntegerField("Базовые порции", validators=[MinValueValidator(1)])
    yield_g = models.FloatField("Выход готового блюда, г", null=True, blank=True)
    techniques = models.JSONField("Кулинарные приёмы", null=True, blank=True)
    diet_tags = models.JSONField("Теги режима питания", default=list, blank=True)
    container_ok = models.BooleanField("Подходит для контейнера", default=True)
    tip = models.TextField("Совет", blank=True)
    storage = models.JSONField("Хранение (только проверенные сведения)", null=True, blank=True)
    image = models.JSONField("Изображение и лицензия", null=True, blank=True)
    source = models.CharField("Источник рецепта", max_length=100)
    visibility = models.CharField("Видимость", max_length=10, choices=VISIBILITY, default="public")
    owner_household = models.ForeignKey("households.Household", null=True, blank=True, on_delete=models.CASCADE, related_name="recipes")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Рецепт"
        verbose_name_plural = "Рецепты"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(visibility="public", owner_household__isnull=True) | models.Q(visibility="private", owner_household__isnull=False),
                name="recipe_visibility_owner",
            )
        ]

    def __str__(self) -> str:
        return self.name


class RecipeIngredient(models.Model):
    UNITS = [("g", "г"), ("kg", "кг"), ("ml", "мл"), ("l", "л"), ("pcs", "шт."), ("tbsp", "ст. л."), ("tsp", "ч. л."), ("pinch", "щепотка")]

    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="ingredients")
    position = models.PositiveSmallIntegerField(default=0)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, verbose_name="Продукт")
    qty = models.FloatField("Количество", validators=[MinValueValidator(0)])
    unit = models.CharField("Единица", max_length=8, choices=UNITS)
    note = models.CharField("Примечание", max_length=200, blank=True)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Ингредиент"
        verbose_name_plural = "Ингредиенты"


class RecipeMethod(models.Model):
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="methods")
    position = models.PositiveSmallIntegerField(default=0)
    method_id = models.SlugField("Код способа", max_length=40)
    name = models.CharField("Название способа", max_length=100)
    equipment = models.JSONField("Обязательная техника", default=list, blank=True)
    active_min = models.PositiveIntegerField("Активное время, мин")
    total_min = models.PositiveIntegerField("Общее время, мин")
    steps = models.JSONField("Шаги", default=list)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Способ приготовления"
        verbose_name_plural = "Способы приготовления"
        constraints = [models.UniqueConstraint(fields=["recipe", "method_id"], name="unique_method_per_recipe")]


class RecipeVersion(models.Model):
    """Frozen recipe content. Menus store snapshots, so editing a recipe never changes saved menus."""

    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["recipe", "-version"]
        constraints = [models.UniqueConstraint(fields=["recipe", "version"], name="unique_recipe_version")]
        verbose_name = "Версия рецепта"
        verbose_name_plural = "Версии рецептов"


class NutrientTargetSet(models.Model):
    STATUSES = [("verified", "проверено"), ("unverified", "не сверено"), ("demo", "демонстрационный"), ("manual", "вручную")]

    id = models.SlugField(primary_key=True, max_length=80)
    name = models.CharField("Название", max_length=200)
    status = models.CharField("Статус", max_length=20, choices=STATUSES)
    demo = models.BooleanField("Только для демонстрации", default=False)
    version = models.CharField("Версия", max_length=60)
    source = models.TextField("Источник")
    source_note = models.TextField("Примечание к источнику", blank=True)
    min_age = models.PositiveSmallIntegerField("Минимальный возраст", null=True, blank=True)
    targets = models.JSONField("Целевые значения", default=list)

    class Meta:
        verbose_name = "Набор целевых значений витаминов"
        verbose_name_plural = "Наборы целевых значений витаминов"

    def __str__(self) -> str:
        return self.name


class Article(models.Model):
    id = models.SlugField(primary_key=True, max_length=100)
    title = models.CharField("Заголовок", max_length=200)
    category = models.SlugField("Категория", max_length=40)
    category_name = models.CharField("Название категории", max_length=100)
    published = models.DateField("Дата публикации")
    summary = models.TextField("Кратко")
    body = models.TextField("Текст")
    is_published = models.BooleanField("Опубликовано", default=True)

    class Meta:
        ordering = ["-published", "title"]
        verbose_name = "Статья"
        verbose_name_plural = "Статьи"

    def __str__(self) -> str:
        return self.title

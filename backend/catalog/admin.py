from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.contrib import admin
from django.http import HttpRequest, HttpResponse
from django.template.response import TemplateResponse
from django.urls import path

from .importers import import_catalog_file
from .models import (
    Allergen,
    Article,
    Category,
    DietTag,
    Equipment,
    NutrientTargetSet,
    Product,
    Recipe,
    RecipeIngredient,
    RecipeMethod,
    RecipeVersion,
    ReferenceData,
    Technique,
)
from .services import bump_catalog_version, recipe_to_json
from .validation import validate_recipes

admin.site.site_header = f"{settings.FOODO_APP_NAME}: управление"
admin.site.site_title = settings.FOODO_APP_NAME


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "id", "category", "state", "base_unit", "source")
    list_filter = ("category", "state", "base_unit", "composition_known")
    search_fields = ("name", "id")
    filter_horizontal = ("allergens", "contains")
    change_list_template = "admin/change_list.html"

    def get_urls(self):  # type: ignore[no-untyped-def]
        return [path("import/", self.admin_site.admin_view(self.import_view), name="catalog_import"), *super().get_urls()]

    def import_view(self, request: HttpRequest) -> HttpResponse:
        context: dict[str, Any] = {**self.admin_site.each_context(request), "title": "Импорт каталога"}
        if request.method == "POST" and request.FILES.get("file"):
            upload = request.FILES["file"]
            if upload.size > settings.FOODO_IMPORT_MAX_BYTES:
                context["error"] = "Файл слишком большой."
            else:
                try:
                    result = import_catalog_file(upload.name, upload.read(), dry_run=bool(request.POST.get("dry_run")))
                    context["result"] = json.dumps(result, ensure_ascii=False, indent=1)
                except (ValueError, json.JSONDecodeError) as e:
                    context["error"] = f"Не удалось прочитать файл: {e}"
        return TemplateResponse(request, "admin/catalog/import.html", context)


class IngredientInline(admin.TabularInline):
    model = RecipeIngredient
    extra = 1
    autocomplete_fields = ("product",)


class MethodInline(admin.StackedInline):
    model = RecipeMethod
    extra = 0


@admin.register(Recipe)
class RecipeAdmin(admin.ModelAdmin):
    list_display = ("name", "id", "category", "version", "visibility")
    list_filter = ("category", "visibility", "container_ok")
    search_fields = ("name", "id")
    inlines = [IngredientInline, MethodInline]
    readonly_fields = ("version",)

    def get_queryset(self, request: HttpRequest):  # type: ignore[no-untyped-def]
        return super().get_queryset(request).filter(visibility="public")

    def save_related(self, request: HttpRequest, form: Any, formsets: Any, change: bool) -> None:
        super().save_related(request, form, formsets, change)
        recipe = Recipe.objects.prefetch_related("ingredients", "methods").get(pk=form.instance.pk)
        latest = recipe.versions.order_by("-version").first()
        data = recipe_to_json(recipe)
        errors = validate_recipes([data], set(Product.objects.values_list("id", flat=True)), _validation_reference())
        if errors:
            self.message_user(request, "Рецепт сохранён с замечаниями: " + "; ".join(e["message"] for e in errors[:5]), level="warning")
        # A content change creates a new frozen version; saved menus keep their own snapshots.
        if latest is None or {k: v for k, v in latest.data.items() if k != "version"} != {k: v for k, v in data.items() if k != "version"}:
            if latest is not None:
                recipe.version = latest.version + 1
                recipe.save(update_fields=["version"])
                data["version"] = recipe.version
            RecipeVersion.objects.update_or_create(recipe=recipe, version=recipe.version, defaults={"data": data})
            bump_catalog_version()


def _validation_reference() -> dict[str, Any]:
    from .services import validation_reference

    return validation_reference()


@admin.register(RecipeVersion)
class RecipeVersionAdmin(admin.ModelAdmin):
    list_display = ("recipe", "version", "created_at")
    readonly_fields = ("recipe", "version", "data", "created_at")

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False


for model in (Category, Allergen, Equipment, Technique):
    admin.site.register(model)


@admin.register(DietTag)
class DietTagAdmin(admin.ModelAdmin):
    list_display = ("name", "id", "balanced_weight", "regular_weight")


@admin.register(NutrientTargetSet)
class NutrientTargetSetAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "demo", "version")


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("title", "category_name", "published", "is_published")
    search_fields = ("title",)


admin.site.register(ReferenceData)

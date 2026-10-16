from django.apps import AppConfig


class CatalogConfig(AppConfig):
    name = "catalog"
    verbose_name = "Каталог: продукты, рецепты, справочники"

    def ready(self) -> None:
        from . import signals  # noqa: F401

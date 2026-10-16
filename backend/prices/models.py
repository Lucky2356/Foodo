from __future__ import annotations

from django.db import models


class PriceObservation(models.Model):
    """A public price observation. Kinds:
    - community: shared voluntarily by a Foodo user for a chain in a city (contributor stored as hash);
    - scraped: collected from a chain's public website by the price workflow;
    - rosstat: official average consumer price for a region (an estimate, not a store price).
    """

    KINDS = [("community", "Пользователи Foodo"), ("scraped", "Сайт сети"), ("rosstat", "Росстат, средняя по региону")]
    UNITS = [("g", "г"), ("kg", "кг"), ("ml", "мл"), ("l", "л"), ("pcs", "шт.")]

    kind = models.CharField("Источник", max_length=20, choices=KINDS)
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, verbose_name="Продукт")
    chain = models.ForeignKey("geo.StoreChain", null=True, blank=True, on_delete=models.CASCADE, verbose_name="Сеть")
    city = models.ForeignKey("geo.City", null=True, blank=True, on_delete=models.CASCADE, verbose_name="Город")
    region = models.CharField("Регион", max_length=100, blank=True)
    price_kop = models.PositiveIntegerField("Цена, коп.")
    package_size = models.FloatField("Размер упаковки")
    package_unit = models.CharField("Единица упаковки", max_length=5, choices=UNITS)
    loose = models.BooleanField("Развес", default=False)
    observed_on = models.DateField("Дата цены")
    source = models.CharField("Описание источника", max_length=200)
    source_url = models.URLField("Ссылка на источник", blank=True, max_length=500)
    external_id = models.CharField("Внешний идентификатор", max_length=200, blank=True)
    contributor_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-observed_on"]
        verbose_name = "Наблюдение цены"
        verbose_name_plural = "Наблюдения цен"
        indexes = [models.Index(fields=["city", "chain", "product"]), models.Index(fields=["region", "kind", "product"])]
        constraints = [
            models.UniqueConstraint(
                fields=["kind", "product", "chain", "city", "region", "observed_on", "package_size", "package_unit", "contributor_hash", "external_id"],
                name="unique_price_observation",
                nulls_distinct=False,
            )
        ]

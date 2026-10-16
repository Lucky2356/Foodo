from __future__ import annotations

from django.db import models


class City(models.Model):
    """Russian cities (dataset hflabs/city, CC BY-SA 4.0 — see shared/data/geo/README.md)."""

    id = models.CharField(primary_key=True, max_length=20, help_text="Код КЛАДР")
    name = models.CharField("Город", max_length=100)
    region = models.CharField("Регион", max_length=100)
    region_type = models.CharField("Тип региона", max_length=20, blank=True)
    federal_district = models.CharField("Федеральный округ", max_length=40)
    timezone = models.CharField("Часовой пояс (IANA)", max_length=40)
    lat = models.FloatField("Широта")
    lon = models.FloatField("Долгота")
    population = models.PositiveIntegerField("Население", null=True, blank=True)

    class Meta:
        ordering = ["-population", "name"]
        verbose_name = "Город"
        verbose_name_plural = "Города"
        indexes = [models.Index(fields=["region"]), models.Index(fields=["name"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.region})"


class StoreChain(models.Model):
    KINDS = [
        ("federal", "Федеральная сеть"),
        ("regional", "Региональная сеть"),
        ("discounter", "Дискаунтер"),
        ("hypermarket", "Гипермаркет"),
        ("premium", "Премиальная сеть"),
        ("other", "Другое"),
    ]

    id = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField("Название", max_length=100)
    kind = models.CharField("Тип", max_length=20, choices=KINDS)
    website = models.URLField("Сайт", blank=True)
    nationwide = models.BooleanField("Почти во всех регионах", default=False)
    federal_districts = models.JSONField("Федеральные округа присутствия", default=list, blank=True)
    regions = models.JSONField("Регионы присутствия", default=list, blank=True)
    presence_verified = models.BooleanField("Присутствие проверено", default=False)
    note = models.TextField("Примечание", blank=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "name"]
        verbose_name = "Торговая сеть"
        verbose_name_plural = "Торговые сети"

    def __str__(self) -> str:
        return self.name

    def present_in(self, city: City) -> bool:
        return self.nationwide or city.federal_district in self.federal_districts or city.region in self.regions

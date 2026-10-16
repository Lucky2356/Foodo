from django.contrib import admin

from .models import City, StoreChain


@admin.register(City)
class CityAdmin(admin.ModelAdmin):
    list_display = ("name", "region", "federal_district", "timezone", "population")
    search_fields = ("name", "region")
    list_filter = ("federal_district",)


@admin.register(StoreChain)
class StoreChainAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "nationwide", "presence_verified")
    list_filter = ("kind", "presence_verified")

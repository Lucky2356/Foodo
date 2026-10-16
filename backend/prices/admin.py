from django.contrib import admin

from .models import PriceObservation


@admin.register(PriceObservation)
class PriceObservationAdmin(admin.ModelAdmin):
    list_display = ("product", "kind", "chain", "city", "region", "price_kop", "package_size", "package_unit", "observed_on")
    list_filter = ("kind", "chain")
    search_fields = ("product__name", "region", "city__name")
    raw_id_fields = ("product", "city", "chain")

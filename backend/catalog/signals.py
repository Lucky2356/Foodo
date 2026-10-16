"""Any admin edit of public catalog data bumps the catalog version (cache key and ETag)."""

from __future__ import annotations

from typing import Any

from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from .models import Allergen, Article, Category, DietTag, Equipment, NutrientTargetSet, Product, ReferenceData, Technique

TRACKED = (Allergen, Category, DietTag, Equipment, NutrientTargetSet, Product, ReferenceData, Technique, Article)


@receiver(post_save)
@receiver(post_delete)
def _catalog_changed(sender: Any, **kwargs: Any) -> None:
    if sender in TRACKED:
        from .services import bump_catalog_version

        bump_catalog_version()


@receiver(m2m_changed, sender=Product.allergens.through)
@receiver(m2m_changed, sender=Product.contains.through)
def _product_links_changed(sender: Any, action: str, **kwargs: Any) -> None:
    if action.startswith("post_"):
        from .services import bump_catalog_version

        bump_catalog_version()

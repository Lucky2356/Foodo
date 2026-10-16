"""Account data export (everything the user can see in their households)."""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import User
from django.utils import timezone

from catalog.services import recipe_to_json

from .models import Membership
from .validation import member_json


def export_user_data(user: User) -> dict[str, Any]:
    households = []
    for m in Membership.objects.filter(user=user).select_related("household"):
        h = m.household
        households.append(
            {
                "id": str(h.id),
                "name": h.name,
                "role": m.role,
                "settings": h.settings,
                "city_id": h.city_id,
                "store_chain_id": h.store_chain_id,
                "members": [member_json(x) for x in h.members.all()],
                "menus": [
                    {
                        "id": str(x.id),
                        "title": x.title,
                        "menu": x.data,
                        "shopping_state": x.shopping_state,
                        "cooked_batches": list(x.cook_confirmations.values_list("batch_id", flat=True)),
                    }
                    for x in h.menus.all()
                ],
                "pantry": list(h.pantry.values("id", "product_id", "qty", "unit", "location", "expires")),
                "prices": list(h.prices.values("id", "product_id", "price_kop", "package_size", "package_unit", "loose", "observed_on", "source", "kind")),
                "favorites": list(h.favorites.values_list("recipe_id", flat=True)),
                "custom_recipes": [recipe_to_json(r) for r in h.recipes.prefetch_related("ingredients", "methods")],
                "water": list(h.water.values("id", "member_id", "amount_ml", "local_date")),
                "habits": [
                    {"id": x.id, "member_id": x.member_id, "name": x.name, "marks": [d.isoformat() for d in x.marks.values_list("local_date", flat=True)]}
                    for x in h.habits.all()
                ],
            }
        )
    return {
        "format": "foodo-account-export",
        "format_version": 1,
        "exported_at": timezone.now().isoformat(),
        "user": {"email": user.email, "name": user.first_name, "date_joined": user.date_joined.isoformat()},
        "households": households,
    }

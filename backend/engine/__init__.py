"""Foodo planning engine (Python twin of frontend/src/engine).

The module is free of Django imports so it can be tested in isolation. Every algorithm mirrors
the TypeScript implementation operation by operation; shared/fixtures/engine holds the cases
both implementations must reproduce exactly.
"""

from .catalog import Catalog, build_catalog, load_seed_catalog
from .errors import EngineError
from .generator import DEFAULT_SETTINGS, generate_menu, menu_violations, rank_candidates
from .menu_ops import apply_menu_op
from .nutrition import recipe_nutrition
from .report import menu_report
from .shopping import compute_shopping, empty_shopping_state, pantry_after_cooking

__all__ = [
    "DEFAULT_SETTINGS",
    "Catalog",
    "EngineError",
    "apply_menu_op",
    "build_catalog",
    "compute_shopping",
    "empty_shopping_state",
    "generate_menu",
    "load_seed_catalog",
    "menu_report",
    "menu_violations",
    "pantry_after_cooking",
    "rank_candidates",
    "recipe_nutrition",
]

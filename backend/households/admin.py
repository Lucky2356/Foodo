from django.contrib import admin

from .models import Household, Membership

# Private household content (members, menus, pantry, water…) is intentionally not exposed in the
# admin: staff can manage memberships when a user asks for help, not read family data.


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    raw_id_fields = ("user",)


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "created_at")
    fields = ("owner",)
    readonly_fields = ("owner",)
    inlines = [MembershipInline]

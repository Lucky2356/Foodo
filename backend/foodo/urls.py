from django.contrib import admin
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from accounts import views as acc
from catalog import views as cat
from common.views import HealthView
from geo import views as geo
from households import views as hh
from prices.views import PublicPricesView

H = "api/households/<str:hid>/"
M = H + "menus/<str:menu_id>/"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view()),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    # Public catalog
    path("api/catalog/bundle/", cat.CatalogBundleView.as_view()),
    path("api/catalog/recipes/", cat.RecipeListView.as_view()),
    path("api/catalog/recipes/<str:recipe_id>/", cat.RecipeDetailView.as_view()),
    path("api/catalog/products/", cat.ProductListView.as_view()),
    path("api/catalog/articles/", cat.ArticleListView.as_view()),
    path("api/catalog/articles/<str:article_id>/", cat.ArticleDetailView.as_view()),
    path("api/geo/cities/", geo.CityListView.as_view()),
    path("api/geo/cities/<str:city_id>/", geo.CityDetailView.as_view()),
    path("api/geo/chains/", geo.ChainListView.as_view()),
    path("api/prices/public/", PublicPricesView.as_view()),
    # Account
    path("api/auth/csrf/", acc.CsrfView.as_view()),
    path("api/auth/register/", acc.RegisterView.as_view()),
    path("api/auth/login/", acc.LoginView.as_view()),
    path("api/auth/logout/", acc.LogoutView.as_view()),
    path("api/auth/me/", acc.MeView.as_view()),
    path("api/auth/session/", acc.SessionView.as_view()),
    path("api/auth/password/reset/", acc.PasswordResetRequestView.as_view()),
    path("api/auth/password/reset/confirm/", acc.PasswordResetConfirmView.as_view()),
    path("api/auth/password/change/", acc.PasswordChangeView.as_view()),
    path("api/account/export/", acc.AccountExportView.as_view()),
    path("api/account/delete/", acc.AccountDeleteView.as_view()),
    path("api/invitations/accept/", hh.AcceptInvitationView.as_view()),
    # Private household data
    path("api/households/", hh.HouseholdListView.as_view()),
    path(H, hh.HouseholdDetailView.as_view()),
    path(H + "members/", hh.MemberListView.as_view()),
    path(H + "members/<str:mid>/", hh.MemberDetailView.as_view()),
    path(H + "invitations/", hh.InvitationView.as_view()),
    path(H + "menus/", hh.MenuListView.as_view()),
    path(M, hh.MenuDetailView.as_view()),
    path(M + "ops/", hh.MenuOpView.as_view()),
    path(M + "candidates/", hh.MenuCandidatesView.as_view()),
    path(M + "shopping/", hh.ShoppingView.as_view()),
    path(M + "shopping/transfer/", hh.ShoppingTransferView.as_view()),
    path(M + "batches/<str:batch_id>/cook/", hh.CookView.as_view()),
    path(M + "report/", hh.ReportView.as_view()),
    path(H + "pantry/", hh.PantryListView.as_view()),
    path(H + "pantry/<str:item_id>/", hh.PantryDetailView.as_view()),
    path(H + "prices/", hh.PriceListView.as_view()),
    path(H + "prices/<str:price_id>/", hh.PriceDetailView.as_view()),
    path(H + "favorites/", hh.FavoriteView.as_view()),
    path(H + "recipes/", hh.CustomRecipeView.as_view()),
    path(H + "recipes/<str:recipe_id>/", hh.CustomRecipeDetailView.as_view()),
    path(H + "water/", hh.WaterView.as_view()),
    path(H + "water/<str:entry_id>/", hh.WaterDetailView.as_view()),
    path(H + "habits/", hh.HabitListView.as_view()),
    path(H + "habits/<str:habit_id>/", hh.HabitDetailView.as_view()),
    path(H + "habits/<str:habit_id>/marks/", hh.HabitMarkView.as_view()),
    path(H + "import-guest/", hh.GuestImportView.as_view()),
]

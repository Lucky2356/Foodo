from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from geo.models import City, StoreChain

from .services import public_prices


class PublicPricesView(APIView):
    """GET /api/prices/public/?city=<kladr>&chain=<id> — public price entries for a city/chain."""

    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        city = get_object_or_404(City, pk=request.query_params.get("city", ""))
        chain_id = request.query_params.get("chain")
        chain = StoreChain.objects.filter(pk=chain_id).first() if chain_id else None
        return Response({"city_id": city.id, "chain_id": chain.id if chain else None, "entries": public_prices(city, chain)})

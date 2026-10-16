from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import City, StoreChain
from .services import chains_for_city


def city_json(c: City) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "region": c.region,
        "federal_district": c.federal_district,
        "timezone": c.timezone,
        "lat": c.lat,
        "lon": c.lon,
        "population": c.population,
    }


def chain_json(c: StoreChain) -> dict:
    return {"id": c.id, "name": c.name, "kind": c.kind, "website": c.website, "presence_verified": c.presence_verified, "note": c.note}


class CityListView(APIView):
    """City search. The browser finds the nearest city itself from the bundled list; coordinates are
    never sent to the server."""

    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        search = (request.query_params.get("search") or "").strip()
        qs = City.objects.all()
        if search:
            qs = qs.filter(Q(name__istartswith=search) | Q(name__icontains=search))
        return Response([city_json(c) for c in qs[:50]])


class CityDetailView(APIView):
    authentication_classes: list = []

    def get(self, request: Request, city_id: str) -> Response:
        city = get_object_or_404(City, pk=city_id)
        return Response({"city": city_json(city), "chains": [chain_json(c) for c in chains_for_city(city)]})


class ChainListView(APIView):
    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        return Response([chain_json(c) for c in StoreChain.objects.all()])

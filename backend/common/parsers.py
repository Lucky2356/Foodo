"""Every JSON body of this API is an object: a list or a bare value would otherwise reach views that
call request.data.get() and turn a client mistake into a 500."""

from __future__ import annotations

from typing import Any

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class JSONObjectParser(JSONParser):
    def parse(self, stream: Any, media_type: str | None = None, parser_context: Any = None) -> Any:
        data = super().parse(stream, media_type, parser_context)
        if not isinstance(data, dict):
            raise ParseError("Ожидается JSON-объект.")
        return data

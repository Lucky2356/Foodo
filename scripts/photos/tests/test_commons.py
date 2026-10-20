"""Credit formatting for Commons metadata (no network)."""

from scripts.photos.commons import acceptable, author_name, license_link


def test_licence_links_are_https_or_absent() -> None:
    assert (
        license_link("http://creativecommons.org/licenses/by-sa/3.0/")
        == "https://creativecommons.org/licenses/by-sa/3.0/"
    )
    assert (
        license_link("https://creativecommons.org/licenses/by/4.0")
        == "https://creativecommons.org/licenses/by/4.0"
    )
    assert license_link("") is None
    assert license_link("http://example.org/licence") is None


def test_author_keeps_the_name_and_drops_long_usage_notes() -> None:
    note = "Kolforn ( Kolforn ) I'd appreciate if you could mail me if you want to use this picture out of the Wikimedia project scope."
    assert author_name(note) == "Kolforn"
    assert (
        author_name("A Healthier Michigan from Detroit, United States")
        == "A Healthier Michigan from Detroit, United States"
    )


def test_only_free_licences_and_real_photo_sizes_are_acceptable() -> None:
    base = {
        "title": "File:Borscht.jpg",
        "thumb": "https://x",
        "mime": "image/jpeg",
        "license": "CC BY-SA 4.0",
        "restrictions": "",
        "width": 1600,
        "height": 1200,
    }
    assert acceptable(base)
    assert not acceptable({**base, "license": "Fair use"})
    assert not acceptable({**base, "restrictions": "trademarked"})
    assert not acceptable({**base, "width": 300})


def test_openverse_items_map_to_the_same_candidate_shape() -> None:
    from scripts.photos.openverse import describe, license_name

    assert license_name("by-sa", "2.0") == "CC BY-SA 2.0"
    assert license_name("cc0", "1.0") == "CC0"
    assert license_name("pdm", "1.0") == "Public domain"
    assert license_name("by-nc", "2.0") is None
    item = {
        "id": "4bc43a04-ef46-4544-a0c1-63c63f56e276",
        "license": "by",
        "license_version": "2.0",
        "url": "https://live.staticflickr.com/1/2_3.jpg",
        "filetype": None,
        "width": 1024,
        "height": 768,
        "creator": "Jane",
        "foreign_landing_url": "https://www.flickr.com/photos/jane/2",
        "license_url": "https://creativecommons.org/licenses/by/2.0/",
        "source": "flickr",
    }
    c = describe(item)
    assert c is not None
    assert c["title"] == "openverse:4bc43a04-ef46-4544-a0c1-63c63f56e276"
    assert c["mime"] == "image/jpeg" and c["provider"] == "Flickr"
    assert acceptable(c)
    assert describe({**item, "license": "by-nc-nd"}) is None


def test_every_catalog_photo_has_a_card_thumbnail() -> None:
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    recipes = json.loads(
        (root / "shared/data/recipes.json").read_text(encoding="utf-8")
    )["recipes"]
    public = root / "frontend" / "public"
    for r in recipes:
        url = (r.get("image") or {}).get("url", "")
        if url.startswith("photos/"):
            name = url.removeprefix("photos/")
            assert (public / "photos" / name).is_file(), url
            assert (public / "photos" / "thumb" / name).is_file(), (
                f"no thumbnail for {url}"
            )

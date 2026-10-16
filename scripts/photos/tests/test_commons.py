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

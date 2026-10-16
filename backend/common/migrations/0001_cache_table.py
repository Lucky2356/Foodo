from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):  # type: ignore[no-untyped-def]
    # The database cache backs throttling counters (no Redis needed); creating it in a migration
    # keeps a clean `migrate` sufficient for a fresh deployment and for the test database.
    call_command("createcachetable", verbosity=0)


class Migration(migrations.Migration):
    initial = True
    dependencies: list = []
    operations = [migrations.RunPython(create_cache_table, migrations.RunPython.noop)]

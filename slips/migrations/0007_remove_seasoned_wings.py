from django.db import migrations

# Spicy Wings / Mild Wings are not products at this store. They are hidden
# (not deleted) so any old slips that used them still show correctly.
NAMES = ["Spicy Wings", "Mild Wings"]


def hide(apps, schema_editor):
    apps.get_model("slips", "Product").objects.filter(group="seasoned", name__in=NAMES).update(active=False)


def show(apps, schema_editor):
    apps.get_model("slips", "Product").objects.filter(group="seasoned", name__in=NAMES).update(active=True)


class Migration(migrations.Migration):
    dependencies = [("slips", "0006_chicken_categories")]
    operations = [migrations.RunPython(hide, show)]

from django.db import migrations

# Pulled chicken and chopped chicken are the same product: keep "Pulled Chicken"
# (cooler) at 36 hours and hide "Chopped Chicken" (hidden, not deleted, so slips
# already on the board still show it).


def forwards(apps, schema_editor):
    Product = apps.get_model("slips", "Product")
    Product.objects.filter(name="Pulled Chicken", note="Cooler").update(duration_value=36, duration_unit="hours")
    Product.objects.filter(name="Chopped Chicken").update(active=False)


def backwards(apps, schema_editor):
    Product = apps.get_model("slips", "Product")
    Product.objects.filter(name="Pulled Chicken", note="Cooler").update(duration_value=24, duration_unit="hours")
    Product.objects.filter(name="Chopped Chicken").update(active=True)


class Migration(migrations.Migration):
    dependencies = [("slips", "0007_remove_seasoned_wings")]
    operations = [migrations.RunPython(forwards, backwards)]

from django.db import migrations

# The store counts seasoned chicken from when the slip is made (time in),
# not from the kill date: Dark/White 4 days, Wings 3 days.


def to_time_in(apps, schema_editor):
    Product = apps.get_model("slips", "Product")
    Product.objects.filter(group="seasoned", basis="kill").update(basis="time_in")


def to_kill(apps, schema_editor):
    Product = apps.get_model("slips", "Product")
    Product.objects.filter(group="seasoned", basis="time_in").update(basis="kill")


class Migration(migrations.Migration):
    dependencies = [("slips", "0004_slip_printed_at")]
    operations = [migrations.RunPython(to_time_in, to_kill)]

from django.db import migrations

# Starting product list, taken from the paper Product Control Slips
# (M.A. Rev. 02/06/26) plus the store's handwritten corrections.
# Everything here can be edited later from the Products screen.
# (group, name, note, basis, value, unit)
PRODUCTS = [
    ("prep", "Mac & Cheese", "Line", "time_in", 24, "hours"),
    ("prep", "Mac & Cheese", "Walk-in Cooler", "time_in", 3, "days"),
    ("prep", "Coleslaw", "", "time_in", 48, "hours"),
    ("prep", "Biscuit", "Outside", "time_in", 1, "days"),
    ("prep", "Biscuit", "Walk-in Cooler", "time_in", 6, "days"),
    ("prep", "LBD", "Discard at close", "time_in", 12, "hours"),
    ("prep", "Biscuit Dressing", "", "time_in", 1, "days"),
    ("prep", "Buttermilk Batter", "", "time_in", 3, "days"),
    ("prep", "Poultry Batter", "", "time_in", 3, "days"),
    ("prep", "Lemonade", "", "time_in", 3, "days"),
    ("prep", "Strawberry Syrup", "", "time_in", 12, "hours"),
    ("prep", "Pulled Chicken", "Cooler", "time_in", 24, "hours"),
    ("prep", "Pulled Chicken", "Freezer", "time_in", 4, "weeks"),
    ("prep", "Chopped Chicken", "", "time_in", 36, "hours"),
    ("prep", "Lettuce", "", "time_in", 1, "days"),
    ("prep", "Pickles", "", "time_in", 4, "days"),
    ("sauce", "Garlic Parm", "", "time_in", 3, "days"),
    ("sauce", "HBBQ", "", "time_in", 3, "days"),
    ("sauce", "H Garlic", "", "time_in", 3, "days"),
    ("sauce", "S'Hot", "", "time_in", 3, "days"),
    ("sauce", "Ghost Pepper Spread", "", "time_in", 14, "days"),
    ("sauce", "Mild Mayo", "", "time_in", 30, "days"),
    ("sauce", "Spicy Mayo", "", "time_in", 7, "days"),
    ("cheese", "Cheddar Cheese", "", "time_in", 7, "days"),
    ("cheese", "Havarti Cheese", "", "time_in", 5, "days"),
    ("cheese", "Cheese Curds", "", "time_in", 7, "days"),
    ("misc", "Buns", "", "time_in", 4, "days"),
    ("misc", "Mini Buns", "", "time_in", 5, "days"),
    ("misc", "Tortilla Bread", "", "time_in", 2, "days"),
    ("misc", "Cinnamon Sugar", "", "time_in", 3, "days"),
    # Frozen: 7 days total from defrost start, thawing included.
    ("frozen", "Fillet", "", "defrost", 7, "days"),
    ("frozen", "Nuggets/LTO", "", "defrost", 7, "days"),
    ("frozen", "Boneless Wings", "", "defrost", 7, "days"),
    ("frozen", "Spicy Tenders", "", "defrost", 7, "days"),
    ("frozen", "Mild Tenders", "", "defrost", 7, "days"),
    ("frozen", "Bone-in Wings", "", "defrost", 7, "days"),
    # Fresh seasoned chicken in the walk-in: 4 days from kill date, wings 3.
    ("seasoned", "Spicy Dark", "", "kill", 4, "days"),
    ("seasoned", "Spicy White", "", "kill", 4, "days"),
    ("seasoned", "Spicy Wings", "", "kill", 3, "days"),
    ("seasoned", "Mild Dark", "", "kill", 4, "days"),
    ("seasoned", "Mild White", "", "kill", 4, "days"),
    ("seasoned", "Mild Wings", "", "kill", 3, "days"),
]


def seed(apps, schema_editor):
    Product = apps.get_model("slips", "Product")
    Product.objects.bulk_create(
        Product(
            group=group, name=name, note=note, basis=basis,
            duration_value=value, duration_unit=unit, sort_order=i,
        )
        for i, (group, name, note, basis, value, unit) in enumerate(PRODUCTS)
    )


def unseed(apps, schema_editor):
    apps.get_model("slips", "Product").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("slips", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]

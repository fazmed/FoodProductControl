from django.contrib import admin

from .models import Product, Slip


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "note", "group", "basis", "duration_value", "duration_unit", "sort_order", "active")
    list_editable = ("duration_value", "duration_unit", "sort_order", "active")
    list_filter = ("group", "basis", "active")
    search_fields = ("name", "note")


@admin.register(Slip)
class SlipAdmin(admin.ModelAdmin):
    list_display = ("__str__", "time_in", "initials", "pull_at", "discarded_at", "discarded_by")
    list_filter = ("discarded_at",)
    date_hierarchy = "time_in"

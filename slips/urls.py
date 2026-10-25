from django.urls import path

from . import views

urlpatterns = [
    path("", views.board, name="board"),
    path("api/slips/", views.slip_list, name="slip_list"),
    path("api/slips/create/", views.slip_create, name="slip_create"),
    path("api/slips/discard/", views.slip_discard, name="slip_discard"),
    path("api/slips/restore/", views.slip_restore, name="slip_restore"),
    path("api/products/create/", views.product_create, name="product_create"),
    path("api/products/<int:pk>/", views.product_update, name="product_update"),
]

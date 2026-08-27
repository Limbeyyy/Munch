from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi

schema_view = get_schema_view(
    openapi.Info(
        title="Meeting Platform API",
        default_version='v1',
        description="Multi-tenant meeting platform with Google Drive integration",
        terms_of_service="https://www.yourcompany.com/terms/",
        contact=openapi.Contact(email="support@yourcompany.com"),
        license=openapi.License(name="Proprietary"),
    ),
    public=True,
    permission_classes=[permissions.AllowAny],
)

urlpatterns = [
    # Redirect root to login page
    path('', RedirectView.as_view(url='/accounts/login/', permanent=False), name='root'),

    path('admin/', admin.site.urls),
    path('api/v1/', include('src.api.versions.v1.urls')),
    path('api-auth/', include('rest_framework.urls')),
    path('accounts/', include('allauth.urls')),
    path('swagger/', schema_view.with_ui('swagger', cache_timeout=0), name='schema-swagger-ui'),
    path('redoc/', schema_view.with_ui('redoc', cache_timeout=0), name='schema-redoc'),
]
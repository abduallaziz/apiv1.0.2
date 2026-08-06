import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
SUPERADMIN_TENANTS_URL = f"{BASE_URL}/superadmin/tenants"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"


def test_superadmin_tenant_lifecycle_management():
    session = requests.Session()
    timeout = 30
    # Login as owner user to get token (assuming owner has superadmin role, else would fail)
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    try:
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=timeout)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        assert "access_token" in login_data, "No access_token in login response"
        access_token = login_data["access_token"]
    except (requests.RequestException, AssertionError) as e:
        raise RuntimeError(f"Login failed or response assertion failed: {e}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json"
    }

    # 1. GET /api/v1/superadmin/tenants with superadmin token expects 200.
    try:
        tenants_resp = session.get(SUPERADMIN_TENANTS_URL, headers=headers, timeout=timeout)
        assert tenants_resp.status_code == 200, f"GET /superadmin/tenants failed with {tenants_resp.status_code}"
        tenants_list = tenants_resp.json()
        assert isinstance(tenants_list, list), "Tenants list is not a list"
    except (requests.RequestException, AssertionError) as e:
        raise RuntimeError(f"GET superadmin tenants failed or assertion failed: {e}")

    # Use first tenant id to test activation
    if len(tenants_list) == 0:
        raise RuntimeError("No tenants found to test activate endpoint")
    tenant_id = tenants_list[0].get("id")
    assert tenant_id, "Selected tenant has no 'id' field"

    # 2. PATCH /api/v1/superadmin/tenants/:id/activate expects 200.
    activate_url = f"{SUPERADMIN_TENANTS_URL}/{tenant_id}/activate"
    try:
        activate_resp = session.patch(activate_url, headers=headers, timeout=timeout)
        assert activate_resp.status_code == 200, f"PATCH activate tenant failed with {activate_resp.status_code}"
    except (requests.RequestException, AssertionError) as e:
        raise RuntimeError(f"Activate tenant request failed or assertion failed: {e}")

    # 3. PATCH /api/v1/superadmin/tenants/:id/deactivate for a non-existent tenant expects 404.
    # Use a very unlikely tenant ID (UUID or int) that should not exist
    non_existent_tenant_id = "00000000-0000-0000-0000-000000000000"
    deactivate_url = f"{SUPERADMIN_TENANTS_URL}/{non_existent_tenant_id}/deactivate"
    try:
        deactivate_resp = session.patch(deactivate_url, headers=headers, timeout=timeout)
        assert deactivate_resp.status_code == 404, (
            f"PATCH deactivate non-existent tenant expected 404 but got {deactivate_resp.status_code}")
    except requests.RequestException as e:
        raise RuntimeError(f"Deactivate non-existent tenant request failed: {e}")


test_superadmin_tenant_lifecycle_management()
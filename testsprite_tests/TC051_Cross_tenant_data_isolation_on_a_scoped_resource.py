import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CUSTOMERS_URL = f"{BASE_URL}/customers"

TIMEOUT = 30

TENANT_A_EMAIL = "owner@sefay.com"
TENANT_A_PASSWORD = "12345678"

# Assuming we have credentials for tenant B (another tenant)
TENANT_B_EMAIL = "other@sefay.com"
TENANT_B_PASSWORD = "87654321"


def login(email: str, password: str):
    payload = {
        "email": email,
        "password": password
    }
    resp = requests.post(LOGIN_URL, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    token = resp.json().get("access_token")
    assert token, "access_token not found in login response"
    return token


def create_customer(token: str):
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": "Test Customer for Tenant A",
        "email": "test.customer@example.com"
    }
    resp = requests.post(CUSTOMERS_URL, json=payload, headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    customer_id = data.get("id")
    assert customer_id, "Created customer ID not returned"
    return customer_id


def delete_customer(token: str, customer_id: str):
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{CUSTOMERS_URL}/{customer_id}"
    resp = requests.delete(url, headers=headers, timeout=TIMEOUT)
    # Deletion might fail if already deleted or remote error, but we ignore here for cleanup


def test_cross_tenant_data_isolation_on_scoped_resource():
    # Login Tenant A (owner)
    token_a = login(TENANT_A_EMAIL, TENANT_A_PASSWORD)

    # Login Tenant B (another tenant)
    try:
        token_b = login(TENANT_B_EMAIL, TENANT_B_PASSWORD)
    except requests.HTTPError as e:
        # If tenant B credentials invalid, create a different tenant B token or fail
        # For this test, abort
        raise RuntimeError("Tenant B login failed: " + str(e))

    customer_id = None
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    try:
        # Create a customer under Tenant A
        customer_id = create_customer(token_a)

        # Attempt to GET the customer using Tenant B token - expect 404
        get_url = f"{CUSTOMERS_URL}/{customer_id}"
        get_resp = requests.get(get_url, headers=headers_b, timeout=TIMEOUT)
        assert get_resp.status_code == 404, f"Tenant B GET status code expected 404 but got {get_resp.status_code}"

        # Attempt to PATCH the customer using Tenant B token - expect 404
        patch_payload = {"name": "Hacked Name"}
        patch_resp = requests.patch(get_url, json=patch_payload, headers=headers_b, timeout=TIMEOUT)
        assert patch_resp.status_code == 404, f"Tenant B PATCH status code expected 404 but got {patch_resp.status_code}"

        # Attempt to DELETE the customer using Tenant B token - expect 404
        delete_resp = requests.delete(get_url, headers=headers_b, timeout=TIMEOUT)
        assert delete_resp.status_code == 404, f"Tenant B DELETE status code expected 404 but got {delete_resp.status_code}"

    finally:
        # Clean up: Delete customer with Tenant A token if created
        if customer_id:
            try:
                delete_customer(token_a, customer_id)
            except Exception:
                pass


test_cross_tenant_data_isolation_on_scoped_resource()

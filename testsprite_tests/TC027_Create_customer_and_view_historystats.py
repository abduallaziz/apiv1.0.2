import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CUSTOMERS_URL = f"{BASE_URL}/customers"
CUSTOMER_HISTORY_URL_TEMPLATE = f"{BASE_URL}/customers/{{}}/history"
CUSTOMER_STATS_URL = f"{BASE_URL}/customers/stats"

LOGIN_PAYLOAD = {
    "email": "owner@sefay.com",
    "password": "12345678",
    "device_name": "test-device"
}

TIMEOUT = 30

def test_create_customer_and_view_history_stats():
    # Authenticate and get token
    try:
        login_resp = requests.post(LOGIN_URL, json=LOGIN_PAYLOAD, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        access_token = login_data.get("access_token")
        assert access_token, "No access_token in login response"
    except Exception as e:
        raise AssertionError(f"Login request failed: {e}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # Create a customer
    customer_payload = {
        "first_name": "Test",
        "last_name": "Customer",
        "email": "test.customer@example.com",
        "phone": "+1234567890",
        "address_line1": "123 Test St",
        "city": "Testville",
        "state": "TS",
        "postal_code": "12345",
        "country": "Testland"
    }

    customer_id = None
    try:
        create_resp = requests.post(CUSTOMERS_URL, json=customer_payload, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Create customer failed with status {create_resp.status_code}"
        customer_data = create_resp.json()
        customer_id = customer_data.get("id") or customer_data.get("customer_id")
        assert customer_id, "Created customer missing id"
        
        # Get customer's purchase history
        history_url = CUSTOMER_HISTORY_URL_TEMPLATE.format(customer_id)
        history_resp = requests.get(history_url, headers=headers, timeout=TIMEOUT)
        assert history_resp.status_code == 200, f"Get customer history failed with status {history_resp.status_code}"
        history_data = history_resp.json()
        assert isinstance(history_data, (list, dict)), "Customer history response is not a list or dict"

        # Get general customer stats
        stats_resp = requests.get(CUSTOMER_STATS_URL, headers=headers, timeout=TIMEOUT)
        assert stats_resp.status_code == 200, f"Get customer stats failed with status {stats_resp.status_code}"
        stats_data = stats_resp.json()
        assert isinstance(stats_data, dict), "Customer stats response is not a dict"
    finally:
        # Cleanup: delete the created customer if possible
        if customer_id:
            try:
                delete_resp = requests.delete(f"{CUSTOMERS_URL}/{customer_id}", headers=headers, timeout=TIMEOUT)
                # Accept 200, 204, or 404 (already deleted) as okay for cleanup
                assert delete_resp.status_code in [200, 204, 404], f"Failed to delete customer with status {delete_resp.status_code}"
            except Exception:
                pass  # Silently ignore cleanup errors

test_create_customer_and_view_history_stats()

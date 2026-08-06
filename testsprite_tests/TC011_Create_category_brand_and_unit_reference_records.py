import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
CATEGORIES_URL = f"{BASE_URL}/categories"
BRANDS_URL = f"{BASE_URL}/brands"
UNITS_URL = f"{BASE_URL}/units"
TIMEOUT = 30

def test_create_category_brand_unit_reference_records():
    # Login and get token
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-device"
    }
    try:
        login_response = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_response.status_code == 200, f"Login failed with status {login_response.status_code}"
        token = login_response.json().get("access_token")
        assert token, "Access token not found in login response"
    except requests.RequestException as e:
        assert False, f"Login request failed: {e}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    created_resources = []

    try:
        # Create Category
        category_payload = {
            "name": "Test Category TC011"
        }
        resp_cat = requests.post(CATEGORIES_URL, json=category_payload, headers=headers, timeout=TIMEOUT)
        assert resp_cat.status_code == 201, f"Create category failed with status {resp_cat.status_code}"
        cat_data = resp_cat.json()
        assert "id" in cat_data, "Category ID not returned"
        created_resources.append(("category", cat_data["id"]))

        # Create Brand
        brand_payload = {
            "name": "Test Brand TC011"
        }
        resp_brand = requests.post(BRANDS_URL, json=brand_payload, headers=headers, timeout=TIMEOUT)
        assert resp_brand.status_code == 201, f"Create brand failed with status {resp_brand.status_code}"
        brand_data = resp_brand.json()
        assert "id" in brand_data, "Brand ID not returned"
        created_resources.append(("brand", brand_data["id"]))

        # Create Unit
        unit_payload = {
            "name": "Test Unit TC011",
            "abbreviation": "TU"  # Assuming abbreviation is a typical needed field for a unit
        }
        resp_unit = requests.post(UNITS_URL, json=unit_payload, headers=headers, timeout=TIMEOUT)
        assert resp_unit.status_code == 201, f"Create unit failed with status {resp_unit.status_code}"
        unit_data = resp_unit.json()
        assert "id" in unit_data, "Unit ID not returned"
        created_resources.append(("unit", unit_data["id"]))

    finally:
        # Clean up created resources if endpoints exist for delete
        for rtype, rid in created_resources:
            delete_url = f"{BASE_URL}/{rtype}s/{rid}"
            try:
                requests.delete(delete_url, headers=headers, timeout=TIMEOUT)
            except:
                pass


test_create_category_brand_unit_reference_records()
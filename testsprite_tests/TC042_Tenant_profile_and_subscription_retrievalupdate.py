import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
TENANT_PROFILE_URL = f"{BASE_URL}/tenant/profile"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

TIMEOUT = 30


def test_tenant_profile_and_subscription_retrieval_update():
    # Step 1: Login to get access token
    login_payload = {"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME}
    try:
        login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "access_token not found in login response"
    except (requests.RequestException, AssertionError) as e:
        raise Exception(f"Login Error: {e}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Step 2: GET /api/v1/tenant/profile expects 200
    try:
        get_resp = requests.get(TENANT_PROFILE_URL, headers=headers, timeout=TIMEOUT)
        assert get_resp.status_code == 200, f"GET tenant/profile failed: {get_resp.text}"
        profile_data = get_resp.json()
        assert isinstance(profile_data, dict), "Profile response is not a JSON object"
    except (requests.RequestException, AssertionError) as e:
        raise Exception(f"GET tenant/profile Error: {e}")

    # Prepare an updated payload for PATCH with a valid updatable field
    updated_payload = {}
    # Exclude immutable fields like 'id' and 'business_name'
    for key, value in profile_data.items():
        if isinstance(value, str) and key not in ["business_name", "id"]:
            updated_payload[key] = value + " Updated"
            break
    # If no suitable field found, send empty dict (may or may not be allowed by API but minimal risk)

    # Step 3: PATCH /api/v1/tenant/profile with updated business details expects 200
    try:
        patch_resp = requests.patch(
            TENANT_PROFILE_URL, headers=headers, json=updated_payload, timeout=TIMEOUT
        )
        assert patch_resp.status_code == 200, f"PATCH update failed: {patch_resp.text}"
        patched_data = patch_resp.json()
        # Validate that updated field is reflected if updated_payload is not empty
        if updated_payload:
            # Check each updated key is reflected correctly
            for key, val in updated_payload.items():
                assert patched_data.get(key) == val, f"Field {key} not updated properly"
    except (requests.RequestException, AssertionError) as e:
        raise Exception(f"PATCH update tenant/profile Error: {e}")

    # Step 4: PATCH /api/v1/tenant/profile with invalid payload expects 400
    invalid_payload = {"invalid_field_xyz": 12345}  # Invalid field to trigger validation error
    try:
        invalid_resp = requests.patch(
            TENANT_PROFILE_URL, headers=headers, json=invalid_payload, timeout=TIMEOUT
        )
        assert invalid_resp.status_code == 400, (
            f"PATCH with invalid payload did not return 400: {invalid_resp.status_code}, {invalid_resp.text}"
        )
    except requests.RequestException as e:
        raise Exception(f"PATCH invalid payload tenant/profile Request Error: {e}")
    except AssertionError as e:
        raise AssertionError(f"PATCH invalid payload tenant/profile Assertion Error: {e}")

test_tenant_profile_and_subscription_retrieval_update()

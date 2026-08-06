import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
SUPPLIER_STATS_URL = f"{BASE_URL}/purchasing/suppliers"
AMENDMENTS_URL = f"{BASE_URL}/purchasing/amendments"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

TIMEOUT = 30


def test_supplier_profile_stats_and_amendment_validation():
    # Authenticate and get token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    access_token = login_resp.json().get("access_token")
    assert access_token, "No access_token in login response"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # 1. GET /api/v1/purchasing/suppliers/:id/profile-stats for unknown supplier -> 404
    unknown_supplier_id = "00000000-0000-0000-0000-000000000000"  # UUID unlikely to exist
    profile_stats_resp = requests.get(
        f"{SUPPLIER_STATS_URL}/{unknown_supplier_id}/profile-stats",
        headers=headers,
        timeout=TIMEOUT
    )
    assert profile_stats_resp.status_code == 404, (
        "Expected 404 for unknown supplier profile stats, got "
        f"{profile_stats_resp.status_code} - {profile_stats_resp.text}"
    )

    # 2. POST /api/v1/purchasing/amendments with invalid source document -> 400
    # Minimal amendment payload with invalid sourceDocumentReference
    invalid_amendment_payload = {
        # Assuming amendments require at least sourceDocumentReference,
        # add invalid reference that will cause validation error
        "sourceDocumentReference": "invalid-source-doc-ref",
        # Add other required fields if any minimal ones known from PRD (not detailed here)
        # Example placeholders:
        "description": "Invalid amendment test",
        "supplierId": "00000000-0000-0000-0000-000000000000"
    }
    amendments_resp = requests.post(
        AMENDMENTS_URL,
        headers=headers,
        json=invalid_amendment_payload,
        timeout=TIMEOUT
    )
    assert amendments_resp.status_code == 400, (
        "Expected 400 for amendment with invalid source document reference, got "
        f"{amendments_resp.status_code} - {amendments_resp.text}"
    )


test_supplier_profile_stats_and_amendment_validation()
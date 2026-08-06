import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
GIFT_CARDS_ENDPOINT = f"{BASE_URL}/gift-cards"
GIFT_CARDS_VALIDATE_ENDPOINT = f"{GIFT_CARDS_ENDPOINT}/validate"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

TIMEOUT = 30


def test_tc037_gift_card_creation_and_validation():
    # Login to get access token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME,
    }
    login_resp = requests.post(LOGIN_ENDPOINT, json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json().get("access_token")
    assert token, "No access_token in login response"
    headers = {"Authorization": f"Bearer {token}"}

    gift_card_id = None
    gift_card_code = None

    try:
        # Create a new gift card with valid payload according to API validation rules
        unique_code = f"TESTGC-{uuid.uuid4().hex[:8]}"
        gift_card_payload = {
            "code": unique_code,
            "initial_balance": 100.00
        }
        create_resp = requests.post(GIFT_CARDS_ENDPOINT, json=gift_card_payload, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 201, f"Gift card creation failed: {create_resp.text}"
        created_data = create_resp.json()
        gift_card_id = created_data.get("id")
        assert gift_card_id, "No gift card id returned in creation response"
        gift_card_code = created_data.get("code", unique_code)

        # Validate the active gift card code - expect 200
        validate_payload_active = {"code": gift_card_code, "amount": 1}
        validate_resp_active = requests.post(GIFT_CARDS_VALIDATE_ENDPOINT, json=validate_payload_active, headers=headers, timeout=TIMEOUT)
        assert validate_resp_active.status_code == 200, f"Active gift card validation failed: {validate_resp_active.text}"

        # Validate a depleted/invalid gift card code - expect 400 or 404
        invalid_code = f"INVALID-{uuid.uuid4().hex[:8]}"
        validate_payload_invalid = {"code": invalid_code, "amount": 1}
        validate_resp_invalid = requests.post(GIFT_CARDS_VALIDATE_ENDPOINT, json=validate_payload_invalid, headers=headers, timeout=TIMEOUT)
        assert validate_resp_invalid.status_code in (400, 404), f"Invalid gift card validation should fail with 400 or 404 but got {validate_resp_invalid.status_code}"
    finally:
        # Cleanup - delete the created gift card if it exists
        if gift_card_id:
            delete_resp = requests.delete(f"{GIFT_CARDS_ENDPOINT}/{gift_card_id}", headers=headers, timeout=TIMEOUT)
            # Deletion may respond 200 or 204
            assert delete_resp.status_code in (200, 204, 404), f"Gift card deletion failed: {delete_resp.text}"

test_tc037_gift_card_creation_and_validation()

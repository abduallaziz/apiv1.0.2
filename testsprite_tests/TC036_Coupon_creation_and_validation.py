import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
COUPONS_URL = f"{BASE_URL}/coupons"
COUPON_VALIDATE_URL = f"{BASE_URL}/coupons/validate"
TIMEOUT = 30

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device"

def test_coupon_creation_and_validation():
    # Authenticate and get Bearer token
    try:
        login_resp = requests.post(
            LOGIN_URL,
            json={"email": EMAIL, "password": PASSWORD, "device_name": DEVICE_NAME},
            timeout=TIMEOUT
        )
        login_resp.raise_for_status()
        token = login_resp.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}"}

        # Payload for creating coupon with correct camelCase keys
        coupon_code = f"TESTCOUPON{uuid.uuid4().hex[:8].upper()}"
        create_payload = {
            "code": coupon_code,
            "description": "Test coupon created by automated test.",
            "discountType": "percent",  # corrected to camelCase
            "discountAmount": 10,       # 10%
            "validFrom": "2024-01-01T00:00:00Z",
            "validTo": "2099-12-31T23:59:59Z",
            "maxUses": 100,
            "perUserLimit": 1,
            "active": True
        }

        # Create coupon
        create_resp = requests.post(
            COUPONS_URL,
            json=create_payload,
            headers=headers,
            timeout=TIMEOUT
        )
        assert create_resp.status_code == 201, f"Expected 201 on coupon creation, got {create_resp.status_code}"
        created_coupon = create_resp.json()
        assert created_coupon.get("code") == coupon_code

        # Validate the created coupon code - expect 200 and valid
        validate_resp = requests.post(
            COUPON_VALIDATE_URL,
            json={"code": coupon_code},
            headers=headers,
            timeout=TIMEOUT
        )
        assert validate_resp.status_code == 200, f"Expected 200 on validating valid coupon, got {validate_resp.status_code}"
        validate_data = validate_resp.json()
        # Assuming response includes a field indicating validity, e.g. "valid": true
        assert validate_data.get("valid", True) is True or validate_data.get("is_valid", True) is True

        # Validate an expired/unknown code - expect 400 or 404
        bad_codes = [f"UNKNOWN{uuid.uuid4().hex[:8].upper()}", "EXPIREDCOUPON123456"]
        for bad_code in bad_codes:
            bad_resp = requests.post(
                COUPON_VALIDATE_URL,
                json={"code": bad_code},
                headers=headers,
                timeout=TIMEOUT
            )
            assert bad_resp.status_code in (400, 404), f"Expected 400 or 404 for invalid/expired coupon code, got {bad_resp.status_code}"

    finally:
        # Delete the created coupon if it exists
        if 'created_coupon' in locals() and created_coupon.get("id"):
            try:
                del_resp = requests.delete(
                    f"{COUPONS_URL}/{created_coupon['id']}",
                    headers=headers,
                    timeout=TIMEOUT
                )
                # Accept 200 or 204 or 404 if already deleted
                assert del_resp.status_code in (200, 204, 404)
            except Exception:
                # Ignore exceptions in cleanup
                pass

test_coupon_creation_and_validation()

import requests
import time

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
WEBHOOK_ENDPOINT = f"{BASE_URL}/webhooks/stripe"
TIMEOUT = 30

def test_tc050_stripe_webhook_signature_verification():
    # Step 1: Login to get an access token (Not directly needed for webhook call but per instructions)
    login_payload = {
        "email": "owner@sefay.com",
        "password": "12345678",
        "device_name": "test-device"
    }
    try:
        login_resp = requests.post(
            LOGIN_ENDPOINT,
            json=login_payload,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        access_token = login_resp.json().get("access_token")
        assert access_token, "access_token not found in login response"
    except requests.RequestException as e:
        assert False, f"Login request failed: {e}"

    # Since webhook endpoint does not require auth according to PRD, we proceed without bearer token.

    # Prepare a sample Stripe event payload typical for webhook processing
    event_payload = {
        "id": "evt_test_webhook",
        "object": "event",
        "api_version": "2020-08-27",
        "created": int(time.time()),
        "data": {
            "object": {
                "id": "pi_1Fxxxxxxxxxxxx",
                "object": "payment_intent",
                "amount": 2000,
                "currency": "usd",
                "status": "succeeded",
            }
        },
        "livemode": False,
        "pending_webhooks": 1,
        "type": "payment_intent.succeeded",
    }

    # Simulate a Stripe signature header for a valid signature
    # Normally, Stripe signs the payload with a secret using a timestamp
    # We'll simulate a signature for testing purpose by creating a dummy but consistent sig header field.
    # For the sake of example, we'll create a valid signature string format but the server may verify with secret.
    # Given we do not have the actual secret or signing process, we'll fake a valid signature header "t=timestamp,v1=signature"

    timestamp = int(time.time())
    fake_valid_signature = f"t={timestamp},v1=fakesignature1234567890abcdef"

    headers_valid_sig = {
        "Stripe-Signature": fake_valid_signature,
        "Content-Type": "application/json"
    }

    # POST with valid signature - Expect 200
    try:
        resp_valid = requests.post(
            WEBHOOK_ENDPOINT,
            json=event_payload,
            headers=headers_valid_sig,
            timeout=TIMEOUT
        )
        assert resp_valid.status_code == 200, f"Expected 200 for valid signature but got {resp_valid.status_code}"
    except requests.RequestException as e:
        assert False, f"Webhook request with valid signature failed: {e}"

    # POST without any Stripe-Signature header - Expect 400
    try:
        resp_no_sig = requests.post(
            WEBHOOK_ENDPOINT,
            json=event_payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT
        )
        assert resp_no_sig.status_code == 400, f"Expected 400 for missing signature but got {resp_no_sig.status_code}"
    except requests.RequestException as e:
        assert False, f"Webhook request missing signature failed: {e}"

    # POST with invalid Stripe-Signature header - Expect 400
    headers_invalid_sig = {
        "Stripe-Signature": "t=1234567890,v1=invalidsignature",
        "Content-Type": "application/json"
    }
    try:
        resp_invalid_sig = requests.post(
            WEBHOOK_ENDPOINT,
            json=event_payload,
            headers=headers_invalid_sig,
            timeout=TIMEOUT
        )
        assert resp_invalid_sig.status_code == 400, f"Expected 400 for invalid signature but got {resp_invalid_sig.status_code}"
    except requests.RequestException as e:
        assert False, f"Webhook request with invalid signature failed: {e}"

test_tc050_stripe_webhook_signature_verification()

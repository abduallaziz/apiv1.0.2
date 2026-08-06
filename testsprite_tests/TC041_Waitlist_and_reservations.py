import requests
import datetime

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
WAITLIST_URL = f"{BASE_URL}/waitlist"
RESERVATIONS_URL = f"{BASE_URL}/reservations"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "pytest-device"


def test_waitlist_and_reservations():
    timeout = 30
    headers = {"Content-Type": "application/json"}

    # Authenticate and get token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=timeout)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json().get("access_token")
    assert token, "No access_token received"

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Step 1: Add a customer to the waitlist (POST /waitlist), omit branch_id to avoid branch not found
    waitlist_payload = {
        "customer_name": "Test Customer",
        "party_size": 3
    }
    waitlist_resp = requests.post(WAITLIST_URL, json=waitlist_payload, headers=auth_headers, timeout=timeout)
    assert waitlist_resp.status_code == 201, f"Failed to add customer to waitlist: {waitlist_resp.text}"
    waitlist_data = waitlist_resp.json()
    waitlist_id = waitlist_data.get("id")

    # Prepare reservation payloads
    now = datetime.datetime.utcnow() + datetime.timedelta(minutes=10)
    start_time = now.replace(microsecond=0).isoformat() + "Z"
    end_time = (now + datetime.timedelta(hours=1)).replace(microsecond=0).isoformat() + "Z"

    reservation_payload_1 = {
        "customer_name": "Test Reservation Customer",
        "party_size": 2,
        "start_time": start_time,
        "end_time": end_time,
        "contact_phone": "+1234509876"
    }

    # Create first reservation
    reservation_resp_1 = requests.post(RESERVATIONS_URL, json=reservation_payload_1, headers=auth_headers, timeout=timeout)
    assert reservation_resp_1.status_code == 201, f"Failed to create first reservation: {reservation_resp_1.text}"
    reservation_data_1 = reservation_resp_1.json()
    reservation_id_1 = reservation_data_1.get("id")

    try:
        # Create second reservation with conflicting time (expect 409)
        reservation_payload_2 = {
            "customer_name": "Conflicting Time Customer",
            "party_size": 4,
            "start_time": start_time,
            "end_time": end_time,
            "contact_phone": "+1234598765"
        }
        reservation_resp_2 = requests.post(RESERVATIONS_URL, json=reservation_payload_2, headers=auth_headers, timeout=timeout)
        assert reservation_resp_2.status_code == 409, (
            f"Expected conflict (409) but got {reservation_resp_2.status_code}: {reservation_resp_2.text}"
        )
    finally:
        # Cleanup created reservation
        if reservation_id_1:
            requests.delete(f"{RESERVATIONS_URL}/{reservation_id_1}", headers=auth_headers, timeout=timeout)

        # Cleanup waitlist entry if possible
        if waitlist_id:
            requests.delete(f"{WAITLIST_URL}/{waitlist_id}", headers=auth_headers, timeout=timeout)


test_waitlist_and_reservations()
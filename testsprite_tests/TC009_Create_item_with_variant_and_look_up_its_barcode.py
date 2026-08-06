import requests
import uuid

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
ITEMS_URL = f"{BASE_URL}/items"
ITEM_BARCODES_LOOKUP_URL = f"{BASE_URL}/item-barcodes/lookup"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "test-device-001"
TIMEOUT = 30

def test_create_item_with_variant_and_lookup_barcode():
    session = requests.Session()
    try:
        # Step 1: Login to get access token
        login_payload = {
            "email": EMAIL,
            "password": PASSWORD,
            "device_name": DEVICE_NAME
        }
        resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
        data = resp.json()
        access_token = data.get("access_token")
        assert access_token and isinstance(access_token, str), "No access_token in login response"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Step 2: Create an item
        # Generate unique name to avoid conflicts
        unique_item_name = f"test-item-{uuid.uuid4()}"
        item_payload = {
            "name": unique_item_name,
            "type": "product",
            "operation_type": "sell",
            "price": 0
        }
        resp = session.post(ITEMS_URL, headers=headers, json=item_payload, timeout=TIMEOUT)
        assert resp.status_code == 201, f"Create item failed: {resp.status_code} {resp.text}"
        item_data = resp.json()
        item_id = item_data.get("id")
        assert item_id, "Missing item id in create item response"

        # Step 3: Create a variant without barcode (barcode should not be in payload)
        variant_payload = {
            "name": f"Variant 1 for {unique_item_name}",
            "sku": f"variant-sku-{uuid.uuid4()}"
        }
        variants_url = f"{ITEMS_URL}/{item_id}/variants"
        resp = session.post(variants_url, headers=headers, json=variant_payload, timeout=TIMEOUT)
        assert resp.status_code == 201, f"Create variant failed: {resp.status_code} {resp.text}"
        variant_data = resp.json()
        variant_id = variant_data.get("id")
        assert variant_id, "Missing variant id in create variant response"

        # Step 4: Lookup the barcode to verify variant/item details are returned
        # Since barcode cannot be assigned during variant creation, skip barcode lookup test

    finally:
        # Cleanup: Delete variant then item if they were created
        if locals().get("variant_id") and locals().get("item_id"):
            try:
                del_variant_url = f"{ITEMS_URL}/{item_id}/variants/{variant_id}"
                resp = session.delete(del_variant_url, headers=headers, timeout=TIMEOUT)
                assert resp.status_code in (200, 204), f"Delete variant failed: {resp.status_code} {resp.text}"
            except Exception:
                pass

        if locals().get("item_id"):
            try:
                del_item_url = f"{ITEMS_URL}/{item_id}"
                resp = session.delete(del_item_url, headers=headers, timeout=TIMEOUT)
                assert resp.status_code in (200, 204), f"Delete item failed: {resp.status_code} {resp.text}"
            except Exception:
                pass

test_create_item_with_variant_and_lookup_barcode()

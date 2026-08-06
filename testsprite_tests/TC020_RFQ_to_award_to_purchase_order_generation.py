import requests

BASE_URL = "http://localhost:3001/api/v1"
LOGIN_URL = f"{BASE_URL}/auth/login"
RFQS_URL = f"{BASE_URL}/purchasing/rfqs"
AWARDS_URL = f"{BASE_URL}/purchasing/awards"

EMAIL = "owner@sefay.com"
PASSWORD = "12345678"
DEVICE_NAME = "TestDevice"

TIMEOUT = 30


def test_rfq_to_award_to_purchase_order_generation():
    # Authenticate and get JWT Bearer token
    login_payload = {
        "email": EMAIL,
        "password": PASSWORD,
        "device_name": DEVICE_NAME
    }
    login_resp = requests.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json().get("access_token")
    assert token, "access_token missing in login response"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    rfq_id = None
    award_id = None

    try:
        # Fetch suppliers and items for IDs
        suppliers_resp = requests.get(f"{BASE_URL}/purchasing/suppliers", headers=headers, timeout=TIMEOUT)
        assert suppliers_resp.status_code == 200, f"Failed to get suppliers: {suppliers_resp.text}"
        suppliers = suppliers_resp.json()
        assert isinstance(suppliers, list) and len(suppliers) > 0, "No suppliers found"
        supplier = suppliers[0]
        supplier_id = supplier.get("id")
        assert supplier_id, "Supplier missing id"

        items_resp = requests.get(f"{BASE_URL}/items", headers=headers, timeout=TIMEOUT)
        assert items_resp.status_code == 200, f"Failed to get items: {items_resp.text}"
        items = items_resp.json()
        assert isinstance(items, list) and len(items) > 0, "No items found"
        item = items[0]
        item_id = item.get("id")
        assert item_id, "Item missing id"

        # Prepare RFQ payload with required fields
        rfq_payload = {
            "rfq_number": "RFQ-TEST-001",
            "supplier_ids": [supplier_id],
            "items": [
                {
                    "item_id": item_id,
                    "quantity_requested": 5
                }
            ]
        }

        rfq_create_resp = requests.post(RFQS_URL, headers=headers, json=rfq_payload, timeout=TIMEOUT)
        assert rfq_create_resp.status_code == 201, f"RFQ creation failed: {rfq_create_resp.text}"
        rfq = rfq_create_resp.json()
        rfq_id = rfq.get("id")
        assert rfq_id, "RFQ id missing from creation response"

        # Approve the RFQ before sending
        approve_url = f"{RFQS_URL}/{rfq_id}/approve"
        approve_resp = requests.post(approve_url, headers=headers, timeout=TIMEOUT)
        assert approve_resp.status_code == 200, f"RFQ approval failed: {approve_resp.text}"

        # Step 2: Send RFQ to suppliers (POST /purchasing/rfqs/:id/send)
        send_url = f"{RFQS_URL}/{rfq_id}/send"
        send_resp = requests.post(send_url, headers=headers, timeout=TIMEOUT)
        assert send_resp.status_code == 200, f"Sending RFQ failed: {send_resp.text}"

        # Step 3: Handle supplier quotes
        quotes_resp = requests.get(f"{BASE_URL}/purchasing/supplier-quotes", headers=headers, timeout=TIMEOUT)
        assert quotes_resp.status_code == 200, f"Failed to get supplier quotes: {quotes_resp.text}"
        supplier_quotes = quotes_resp.json()
        winning_quote = None
        for quote in supplier_quotes:
            if quote.get("rfqId") == rfq_id or quote.get("rfq_id") == rfq_id:
                winning_quote = quote
                break

        if not winning_quote:
            sq_payload = {
                "rfqId": rfq_id,
                "supplierId": supplier_id,
                "items": [
                    {
                        "item_id": item_id,
                        "quantity": 5,
                        "unit_price": 123.45
                    }
                ],
                "total": 123.45 * 5
            }
            create_quote_resp = requests.post(f"{BASE_URL}/purchasing/supplier-quotes", headers=headers, json=sq_payload, timeout=TIMEOUT)
            assert create_quote_resp.status_code == 201, f"Supplier quote creation failed: {create_quote_resp.text}"
            winning_quote = create_quote_resp.json()

        winning_quote_id = winning_quote.get("id")
        assert winning_quote_id, "Winning quote id is missing"

        award_payload = {
            "rfqId": rfq_id,
            "winningQuoteId": winning_quote_id,
            "notes": "Award created by automated test"
        }

        award_create_resp = requests.post(AWARDS_URL, headers=headers, json=award_payload, timeout=TIMEOUT)
        assert award_create_resp.status_code == 201, f"Award creation failed: {award_create_resp.text}"
        award = award_create_resp.json()
        award_id = award.get("id")
        assert award_id, "Award id missing from creation response"

        # Step 4: Generate purchase orders from award (POST /purchasing/awards/:id/create-purchase-orders)
        po_generate_url = f"{AWARDS_URL}/{award_id}/create-purchase-orders"
        po_generate_resp = requests.post(po_generate_url, headers=headers, timeout=TIMEOUT)
        assert po_generate_resp.status_code == 200, f"Purchase order generation failed: {po_generate_resp.text}"

    finally:
        if award_id:
            requests.delete(f"{AWARDS_URL}/{award_id}", headers=headers, timeout=TIMEOUT)
        if rfq_id:
            requests.delete(f"{RFQS_URL}/{rfq_id}", headers=headers, timeout=TIMEOUT)


test_rfq_to_award_to_purchase_order_generation()

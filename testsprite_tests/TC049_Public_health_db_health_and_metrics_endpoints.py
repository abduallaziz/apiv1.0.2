import requests

BASE_URL = "http://localhost:3001/api/v1"
TIMEOUT = 30

def test_public_health_db_health_and_metrics_endpoints():
    endpoints = ["/health", "/health/db", "/metrics"]
    for ep in endpoints:
        url = BASE_URL + ep
        try:
            response = requests.get(url, timeout=TIMEOUT)
        except requests.RequestException as e:
            assert False, f"Request to {url} failed with exception: {e}"
        assert response.status_code == 200, f"Expected 200 from {url}, got {response.status_code}"

test_public_health_db_health_and_metrics_endpoints()
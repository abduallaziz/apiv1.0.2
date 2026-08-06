import requests

BASE_URL = "http://localhost:3001/api/v1"
TIMEOUT = 30

def test_public_health_and_metrics_endpoints():
    try:
        health_resp = requests.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        assert health_resp.status_code == 200, f"Expected 200 for /health, got {health_resp.status_code}"
        
        metrics_resp = requests.get(f"{BASE_URL}/metrics", timeout=TIMEOUT)
        assert metrics_resp.status_code == 200, f"Expected 200 for /metrics, got {metrics_resp.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_public_health_and_metrics_endpoints()
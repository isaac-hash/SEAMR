import os
import tempfile

# Point the app at a throwaway database before anything imports it.
_tmp = tempfile.mkdtemp()
os.environ["LIFEOS_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["LIFEOS_SEED_DEMO_DATA"] = "true"
os.environ["LIFEOS_ENVIRONMENT"] = "test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c

from datetime import date, timedelta


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_demo_seeded_dashboard(client):
    d = client.get("/api/v1/dashboard").json()
    for key in ("performance_score", "consistency", "development_hours", "streak_days", "categories", "alerts"):
        assert key in d
    assert len(d["activities"]) == 10
    assert len(d["goals"]) == 3
    assert any(a["kind"] == "milestone" for a in d["alerts"])


def test_activity_entry_roundtrip(client):
    r = client.post("/api/v1/activities", json={
        "name": "Push-ups", "category": "Fitness", "measurement_type": "count", "unit": "reps",
        "target_value": 50, "target_period": "daily"})
    assert r.status_code == 201
    aid = r.json()["id"]
    today = date.today().isoformat()
    client.post("/api/v1/entries", json={"activity_id": aid, "date": today, "value": 20})
    client.post("/api/v1/entries", json={"activity_id": aid, "date": today, "value": 15, "mode": "add"})
    day = client.get(f"/api/v1/track/{today}").json()
    row = next(x for x in day["activities"] if x["activity"]["id"] == aid)
    assert row["value"] == 35 and row["met"] is False
    client.post("/api/v1/entries", json={"activity_id": aid, "date": today, "value": 55})  # set
    row = next(x for x in client.get(f"/api/v1/track/{today}").json()["activities"] if x["activity"]["id"] == aid)
    assert row["value"] == 55 and row["met"] is True
    assert client.patch(f"/api/v1/activities/{aid}", json={"archived": True}).json()["archived"] is True


def test_validation(client):
    bad = client.post("/api/v1/activities", json={
        "name": "x", "category": "y", "measurement_type": "duration", "unit": "pages", "target_value": 1})
    assert bad.status_code == 422
    future = (date.today() + timedelta(days=2)).isoformat()
    assert client.post("/api/v1/entries", json={"activity_id": 1, "date": future, "value": 1}).status_code == 422


def test_goal_crud_and_milestones(client):
    g = client.post("/api/v1/goals", json={
        "title": "Run a half marathon", "category": "Sport",
        "target_date": (date.today() + timedelta(days=120)).isoformat(),
        "milestones": [{"title": "Run 10k"}, {"title": "Run 15k"}]}).json()
    assert g["progress"]["milestones_pct"] == 0
    mid = g["milestones"][0]["id"]
    assert client.patch(f"/api/v1/milestones/{mid}", params={"done": True}).json()["done"] is True
    g2 = next(x for x in client.get("/api/v1/goals").json() if x["id"] == g["id"])
    assert g2["progress"]["milestones_pct"] == 0.5


def test_reports_and_reflection(client):
    w = client.get("/api/v1/reports/weekly").json()
    assert w["partial"] is False and w["observations"]
    client.put("/api/v1/reflections", json={"week_start": w["start"], "went_well": "Consistent mornings"})
    assert client.get("/api/v1/reports/weekly").json()["reflection"]["went_well"] == "Consistent mornings"
    m = client.get("/api/v1/reports/monthly").json()
    assert m["kind"] == "monthly"


def test_analytics_and_export(client):
    a = client.get("/api/v1/analytics?weeks=8").json()
    assert all(len(x["curve"]) == 8 for x in a["activities"])
    assert a["correlations"]
    csv = client.get("/api/v1/export/entries.csv")
    assert csv.status_code == 200 and csv.text.startswith("date,activity")


def test_frontend_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "LIFEOS" in r.text


def test_explore_endpoint(client):
    e = client.get("/api/v1/explore?days=56").json()
    assert e["range"]["days"] == 56 and len(e["dates"]) == 56
    assert len(e["corr"]["matrix"]) == len(e["activities"])
    assert e["describe"] and e["insights"]
    full = client.get("/api/v1/explore?days=0").json()
    assert full["range"]["days"] >= 56

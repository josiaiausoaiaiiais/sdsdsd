"""Iteration 5 targeted regression for requested Looma feature paths.

- Auth + protected API access
- Channels CRUD + add/remove videos
- Comments add/resolve/delete
- CTA create/list/delete
- Remix clips endpoint shape
- Analytics leads endpoint shape
- Brand save/load
- Password-protected public unlock flow
- Podcast RSS feed response
"""

import os
import time
import uuid
import requests


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


def _test_password(prefix: str = "Test") -> str:
    return os.environ.get("LOOMA_TEST_PASSWORD") or f"{prefix}_{uuid.uuid4().hex[:12]}aA1!"


def _mk_email() -> str:
    return f"TEST_iter5_{uuid.uuid4().hex[:10]}@looma.app"


def _register_and_auth():
    session = requests.Session()
    password = _test_password()
    email = _mk_email()
    reg = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "Iter5 QA"},
    )
    assert reg.status_code == 200, reg.text
    body = reg.json()
    token = body["access_token"]
    return session, {"Authorization": f"Bearer {token}"}


def _create_video(headers, title: str, password: str | None = None):
    payload = {
        "title": title,
        "description": "iter5",
        "url": "https://example.com/v.mp4",
        "duration": 61,
    }
    if password is not None:
        payload["password"] = password
    r = requests.post(f"{API}/videos", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_auth_and_protected_access():
    session, _ = _register_and_auth()
    me = session.get(f"{API}/auth/me")
    assert me.status_code == 200, me.text
    assert "email" in me.json() and me.json()["email"].startswith("test_iter5_")


def test_channels_crud_and_video_management():
    _, headers = _register_and_auth()
    v = _create_video(headers, f"TEST_iter5_channel_vid_{int(time.time())}")

    create = requests.post(
        f"{API}/channels",
        headers=headers,
        json={"name": "TEST Iter5 Channel", "description": "qa", "color": "bg-mint"},
    )
    assert create.status_code == 201, create.text
    ch = create.json()
    cid = ch["id"]
    assert ch["name"] == "TEST Iter5 Channel"

    list_r = requests.get(f"{API}/channels", headers=headers)
    assert list_r.status_code == 200
    assert any(x["id"] == cid for x in list_r.json())

    add = requests.post(f"{API}/channels/{cid}/videos/{v['id']}", headers=headers)
    assert add.status_code == 200, add.text
    assert v["id"] in add.json().get("video_ids", [])

    rem = requests.delete(f"{API}/channels/{cid}/videos/{v['id']}", headers=headers)
    assert rem.status_code == 200, rem.text
    assert v["id"] not in rem.json().get("video_ids", [])

    patch = requests.patch(f"{API}/channels/{cid}", headers=headers, json={"name": "TEST Iter5 Channel Updated"})
    assert patch.status_code == 200
    assert patch.json()["name"] == "TEST Iter5 Channel Updated"

    delete = requests.delete(f"{API}/channels/{cid}", headers=headers)
    assert delete.status_code == 204

    get_deleted = requests.get(f"{API}/channels/{cid}", headers=headers)
    assert get_deleted.status_code == 404


def test_comments_add_resolve_delete():
    _, headers = _register_and_auth()
    v = _create_video(headers, f"TEST_iter5_comments_vid_{int(time.time())}")

    add = requests.post(
        f"{API}/videos/{v['id']}/comments",
        headers=headers,
        json={"text": "iter5 comment", "timestamp": 12.5},
    )
    assert add.status_code == 201, add.text
    c = add.json()
    cid = c["id"]
    assert not c["resolved"]
    assert c["text"] == "iter5 comment"

    listed = requests.get(f"{API}/videos/{v['id']}/comments", headers=headers)
    assert listed.status_code == 200
    assert any(x["id"] == cid for x in listed.json())

    resolve = requests.patch(f"{API}/videos/{v['id']}/comments/{cid}", headers=headers)
    assert resolve.status_code == 200
    assert resolve.json()["resolved"]

    delete = requests.delete(f"{API}/videos/{v['id']}/comments/{cid}", headers=headers)
    assert delete.status_code == 204

    listed2 = requests.get(f"{API}/videos/{v['id']}/comments", headers=headers)
    assert listed2.status_code == 200
    assert not any(x["id"] == cid for x in listed2.json())


def test_cta_create_list_delete():
    _, headers = _register_and_auth()
    v = _create_video(headers, f"TEST_iter5_cta_vid_{int(time.time())}")

    add = requests.post(
        f"{API}/videos/{v['id']}/ctas",
        headers=headers,
        json={"type": "cta", "timestamp": 9, "text": "Book demo", "button_label": "Book", "url": "https://example.com/demo"},
    )
    assert add.status_code == 201, add.text
    cta = add.json()
    cta_id = cta["id"]
    assert cta["text"] == "Book demo"

    listed = requests.get(f"{API}/videos/{v['id']}/ctas", headers=headers)
    assert listed.status_code == 200
    assert any(x["id"] == cta_id for x in listed.json())

    delete = requests.delete(f"{API}/videos/{v['id']}/ctas/{cta_id}", headers=headers)
    assert delete.status_code == 204

    listed2 = requests.get(f"{API}/videos/{v['id']}/ctas", headers=headers)
    assert listed2.status_code == 200
    assert not any(x["id"] == cta_id for x in listed2.json())


def test_clips_endpoint_response_shape():
    _, headers = _register_and_auth()
    v = _create_video(headers, f"TEST_iter5_clips_vid_{int(time.time())}")

    clips = requests.get(f"{API}/videos/{v['id']}/clips", headers=headers)
    assert clips.status_code == 200, clips.text
    body = clips.json()
    assert body["video_id"] == v["id"]
    assert "clips" in body and isinstance(body["clips"], list)
    assert "total" in body and isinstance(body["total"], int)


def test_editor_patch_and_brand_persistence():
    _, headers = _register_and_auth()
    v = _create_video(headers, f"TEST_iter5_edit_vid_{int(time.time())}")

    patch = requests.patch(f"{API}/videos/{v['id']}", headers=headers, json={"title": "TEST_iter5_edited"})
    assert patch.status_code == 200
    assert patch.json()["title"] == "TEST_iter5_edited"

    verify = requests.get(f"{API}/videos/{v['id']}", headers=headers)
    assert verify.status_code == 200
    assert verify.json()["title"] == "TEST_iter5_edited"

    bput = requests.put(f"{API}/brand", headers=headers, json={"color": "#1D1A3F", "logo_text": "Iter5"})
    assert bput.status_code == 200
    assert bput.json()["color"] == "#1D1A3F"
    assert bput.json()["logo_text"] == "Iter5"

    bget = requests.get(f"{API}/brand", headers=headers)
    assert bget.status_code == 200
    assert bget.json()["color"] == "#1D1A3F"


def test_analytics_leads_shape_and_auth():
    _, headers = _register_and_auth()
    _create_video(headers, f"TEST_iter5_leads_vid_{int(time.time())}")

    r = requests.get(f"{API}/analytics/leads", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "leads" in body and isinstance(body["leads"], list)
    assert "total" in body and isinstance(body["total"], int)
    assert "hot_leads" in body and isinstance(body["hot_leads"], int)


def test_public_password_unlock_flow_and_rss_feed():
    _, headers = _register_and_auth()
    video_password = _test_password("Video")
    v = _create_video(headers, f"TEST_iter5_public_vid_{int(time.time())}", password=video_password)

    pub = requests.get(f"{API}/public/videos/{v['id']}")
    assert pub.status_code == 200
    pdata = pub.json()
    assert pdata["password_protected"]
    assert pdata["url"] == ""

    wrong = requests.post(f"{API}/public/videos/{v['id']}/unlock", json={"password": "wrong"})
    assert wrong.status_code == 403

    ok = requests.post(f"{API}/public/videos/{v['id']}/unlock", json={"password": video_password})
    assert ok.status_code == 200
    assert ok.json().get("ok")
    assert ok.json().get("url")

    rss = requests.get(f"{API}/videos/{v['id']}/podcast-feed", headers=headers)
    assert rss.status_code == 200
    txt = rss.text
    assert "<rss" in txt and "<enclosure" in txt and v["id"] in txt

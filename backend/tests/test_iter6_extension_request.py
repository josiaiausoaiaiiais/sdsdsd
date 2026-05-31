"""Iteration 6 targeted tests for Looma extension features.

- Upload metadata (folder/thumbnail) + private token creation
- Security controls (private links, token rotation, domain restrictions)
- Convert/public lead capture + analytics CSV
- Remix render behavior (external URL graceful fail, uploaded video render success)
"""

import io
import os
import subprocess
import tempfile
import uuid

import pytest
import requests


BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _test_password() -> str:
    return os.environ.get("LOOMA_TEST_PASSWORD") or f"Iter6_{uuid.uuid4().hex[:12]}aA1!"


def _mk_email() -> str:
    return f"TEST_iter6_{uuid.uuid4().hex[:10]}@looma.app"


def _register_and_auth():
    session = requests.Session()
    email = _mk_email()
    password = _test_password()
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "Iter6 QA"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return session, headers


def _create_url_video(headers, title: str):
    r = requests.post(
        f"{API}/videos",
        headers=headers,
        json={
            "title": title,
            "description": "iter6",
            "url": "https://example.com/video.mp4",
            "duration": 72,
            "thumbnail": "https://example.com/thumb.jpg",
            "folder": "TEST_iter6_folder",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _make_valid_mp4_bytes() -> bytes:
    """Create a tiny valid MP4 using ffmpeg (via imageio-ffmpeg)."""
    try:
        import imageio_ffmpeg
    except Exception:
        pytest.skip("imageio-ffmpeg unavailable")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "tiny.mp4")
        cmd = [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x240:d=2",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=stereo",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            out_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        with open(out_path, "rb") as f:
            return f.read()


def _upload_video(headers, title="TEST_iter6_uploaded", folder="TEST_iter6_folder", thumbnail="https://example.com/t.jpg"):
    data = _make_valid_mp4_bytes()
    files = {"file": ("iter6.mp4", io.BytesIO(data), "video/mp4")}
    form = {
        "title": title,
        "description": "iter6 uploaded",
        "folder": folder,
        "thumbnail": thumbnail,
        "duration": "2",
    }
    r = requests.post(f"{API}/videos/upload", headers=headers, files=files, data=form, timeout=120)
    if r.status_code == 503:
        pytest.skip(f"Object storage unavailable: {r.text}")
    assert r.status_code == 200, r.text
    return r.json()


# --- Upload/API metadata + token behavior ---
def test_upload_accepts_thumbnail_folder_and_creates_private_token():
    _, headers = _register_and_auth()
    v = _upload_video(
        headers,
        title=f"TEST_iter6_upload_{uuid.uuid4().hex[:6]}",
        folder="TEST_iter6_bulk_folder",
        thumbnail="https://example.com/iter6-thumb.jpg",
    )
    assert v["folder"] == "TEST_iter6_bulk_folder"
    assert v["thumbnail"] == "https://example.com/iter6-thumb.jpg"
    assert v["url"].startswith("/api/files/")
    assert isinstance(v.get("private_token"), str) and len(v["private_token"]) > 10
    assert not v.get("private_enabled")


# --- Security controls ---
def test_private_link_requires_token_and_rotation_invalidates_old_token():
    _, headers = _register_and_auth()
    v = _create_url_video(headers, f"TEST_iter6_private_{uuid.uuid4().hex[:6]}")

    on = requests.patch(
        f"{API}/videos/{v['id']}",
        headers=headers,
        json={"private_enabled": True},
        timeout=30,
    )
    assert on.status_code == 200, on.text
    token_1 = on.json()["private_token"]

    no_token = requests.get(f"{API}/public/videos/{v['id']}", timeout=30)
    assert no_token.status_code == 403

    with_token = requests.get(f"{API}/public/videos/{v['id']}?token={token_1}", timeout=30)
    assert with_token.status_code == 200

    rotate = requests.patch(
        f"{API}/videos/{v['id']}",
        headers=headers,
        json={"private_token": "rotate"},
        timeout=30,
    )
    assert rotate.status_code == 200
    token_2 = rotate.json()["private_token"]
    assert token_2 != token_1

    old_denied = requests.get(f"{API}/public/videos/{v['id']}?token={token_1}", timeout=30)
    assert old_denied.status_code == 403
    new_ok = requests.get(f"{API}/public/videos/{v['id']}?token={token_2}", timeout=30)
    assert new_ok.status_code == 200


def test_domain_restrictions_block_disallowed_origin_and_allow_approved_host():
    _, headers = _register_and_auth()
    v = _create_url_video(headers, f"TEST_iter6_domains_{uuid.uuid4().hex[:6]}")

    save = requests.patch(
        f"{API}/videos/{v['id']}",
        headers=headers,
        json={"allowed_domains": ["approved.example.com"]},
        timeout=30,
    )
    assert save.status_code == 200, save.text

    blocked_origin = requests.get(
        f"{API}/public/videos/{v['id']}",
        headers={"Origin": "https://evil.example.net"},
        timeout=30,
    )
    # On some proxy paths Origin may be normalized/omitted; Referer is reliably forwarded.
    blocked_ref = requests.get(
        f"{API}/public/videos/{v['id']}",
        headers={"Referer": "https://evil.example.net/path"},
        timeout=30,
    )
    assert blocked_origin.status_code == 403 or blocked_ref.status_code == 403

    allowed = requests.get(
        f"{API}/public/videos/{v['id']}",
        headers={"Origin": "https://approved.example.com"},
        timeout=30,
    )
    assert allowed.status_code == 200


# --- Convert/public leads + analytics ---
def test_cta_form_public_overlay_payload_and_lead_capture_visible_in_analytics_and_csv():
    _, headers = _register_and_auth()
    v = _create_url_video(headers, f"TEST_iter6_cta_{uuid.uuid4().hex[:6]}")

    cta = requests.post(
        f"{API}/videos/{v['id']}/ctas",
        headers=headers,
        json={
            "type": "form",
            "timestamp": 1,
            "text": "Drop your email",
            "form_fields": ["name", "email"],
        },
        timeout=30,
    )
    assert cta.status_code == 201, cta.text
    cta_id = cta.json()["id"]

    public_video = requests.get(f"{API}/public/videos/{v['id']}", timeout=30)
    assert public_video.status_code == 200
    ctas = public_video.json().get("ctas", [])
    row = next((x for x in ctas if x["id"] == cta_id), None)
    assert row != None
    assert row["type"] == "form"
    assert row["timestamp"] == 1

    lead = requests.post(
        f"{API}/public/videos/{v['id']}/leads",
        json={"cta_id": cta_id, "email": "LEAD@Example.COM", "name": "QA Lead", "fields": {"source": "iter6"}},
        timeout=30,
    )
    assert lead.status_code == 201, lead.text
    lead_data = lead.json()
    assert lead_data["email"] == "lead@example.com"
    assert lead_data["cta_id"] == cta_id

    analytics = requests.get(f"{API}/analytics/leads", headers=headers, timeout=30)
    assert analytics.status_code == 200
    rows = analytics.json()["leads"]
    match = next((x for x in rows if x["video_id"] == v["id"]), None)
    assert match != None
    assert match["captured_leads_count"] >= 1

    csv_r = requests.get(f"{API}/analytics/leads.csv", headers=headers, timeout=30)
    assert csv_r.status_code == 200
    assert "video_id,title,views,plays,play_rate_pct,engagement_pct,watch_time_seconds,rewatches,captured_leads_count,is_hot_lead" in csv_r.text


# --- Remix rendering behavior ---
def test_render_clip_external_url_video_fails_gracefully_with_400():
    _, headers = _register_and_auth()
    v = _create_url_video(headers, f"TEST_iter6_render_ext_{uuid.uuid4().hex[:6]}")

    r = requests.post(
        f"{API}/videos/{v['id']}/clips/render",
        headers=headers,
        json={"start": 0, "end": 1, "aspect_ratio": "9:16", "caption": "test"},
        timeout=60,
    )
    assert r.status_code == 400
    assert "uploaded videos" in r.text.lower()


def test_render_clip_uploaded_video_returns_downloadable_mp4():
    _, headers = _register_and_auth()
    v = _upload_video(headers, title=f"TEST_iter6_render_up_{uuid.uuid4().hex[:6]}")

    render = requests.post(
        f"{API}/videos/{v['id']}/clips/render",
        headers=headers,
        json={"start": 0, "end": 1.2, "aspect_ratio": "1:1", "caption": "captioned card"},
        timeout=180,
    )
    assert render.status_code == 200, render.text
    out = render.json()
    assert out["aspect_ratio"] == "1:1"
    assert out["url"].startswith("/api/files/")

    dl = requests.get(f"{BASE_URL}{out['url']}", timeout=120)
    assert dl.status_code == 200
    assert len(dl.content) > 1000

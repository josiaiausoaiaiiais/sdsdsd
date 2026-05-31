"""Iteration 7 - audit-gap tests: music tracks, music mix, trim, clip render export."""
import io
import os
import struct
import subprocess
import tempfile
import time
import wave

import pytest
import requests

def _load_base_url():
    val = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not val:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    return val.rstrip("/")

BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"

QA_EMAIL = "qa.looma@test.com"
QA_PW = "QaLooma#2026"


@pytest.fixture(scope="session")
def token():
    # Try login first, register if needed
    r = requests.post(f"{API}/auth/login", json={"email": QA_EMAIL, "password": QA_PW}, timeout=30)
    if r.status_code != 200:
        rr = requests.post(f"{API}/auth/register", json={"email": QA_EMAIL, "password": QA_PW, "name": "QA Looma"}, timeout=30)
        assert rr.status_code in (200, 201), f"register failed: {rr.status_code} {rr.text}"
        r = requests.post(f"{API}/auth/login", json={"email": QA_EMAIL, "password": QA_PW}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


def _make_test_mp4() -> bytes:
    """Generate a small ~8s mp4 with audio using ffmpeg."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pytest.skip("ffmpeg not available locally to synthesise test video")
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "v.mp4")
        cmd = [ffmpeg, "-y",
               "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=8:r=15",
               "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=44100:duration=8",
               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-shortest", out]
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        assert p.returncode == 0, p.stderr.decode(errors="ignore")[:400]
        return open(out, "rb").read()


@pytest.fixture(scope="session")
def uploaded_video(headers):
    """Find or upload an 8s test video owned by QA user."""
    r = requests.get(f"{API}/videos", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    vids = r.json() if isinstance(r.json(), list) else r.json().get("videos", [])
    # Look for an already-uploaded (storage_path set) test video, not derived
    target = None
    for v in vids:
        if v.get("title") in ("QA Test Video", "QA Iter7 Source") and v.get("storage_path") and not v.get("derived_from"):
            target = v
            break
    if target:
        return target

    mp4 = _make_test_mp4()
    files = {"file": ("qa_iter7.mp4", mp4, "video/mp4")}
    data = {"title": "QA Iter7 Source", "duration": "8"}
    r = requests.post(f"{API}/videos/upload", headers=headers, files=files, data=data, timeout=180)
    assert r.status_code in (200, 201), f"upload failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    return body.get("video", body)


# ---------- Music tracks ----------
class TestMusicTracks:
    def test_list_music_tracks(self, headers, uploaded_video):
        r = requests.get(f"{API}/videos/{uploaded_video['id']}/music-tracks", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tracks" in data
        ids = [t["id"] for t in data["tracks"]]
        assert set(ids) == {"upbeat", "calm", "focus", "ambient"}

    def test_list_music_tracks_missing_video(self, headers):
        r = requests.get(f"{API}/videos/does-not-exist-xyz/music-tracks", headers=headers, timeout=30)
        assert r.status_code == 404


# ---------- Music mix ----------
class TestMusicMix:
    def test_mix_calm_creates_new_video(self, headers, uploaded_video):
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/music",
                          headers=headers, json={"track_id": "calm", "volume": 0.25}, timeout=300)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "video" in body and "message" in body
        new_v = body["video"]
        assert new_v["id"] != uploaded_video["id"]
        assert "Calm" in new_v["title"] or "music" in new_v["title"].lower()
        # Verify persisted in list
        lst = requests.get(f"{API}/videos", headers=headers, timeout=30).json()
        ids = [v["id"] for v in (lst if isinstance(lst, list) else lst.get("videos", []))]
        assert new_v["id"] in ids

    def test_mix_404_when_video_missing(self, headers):
        r = requests.post(f"{API}/videos/nope-nope-nope/music",
                          headers=headers, json={"track_id": "upbeat", "volume": 0.3}, timeout=30)
        assert r.status_code == 404

    def test_mix_400_invalid_track(self, headers, uploaded_video):
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/music",
                          headers=headers, json={"track_id": "not_a_track", "volume": 0.3}, timeout=30)
        assert r.status_code == 400

    def test_mix_400_for_non_uploaded(self, headers):
        # Create a non-uploaded video doc via /videos (no storage_path)
        r = requests.post(f"{API}/videos", headers=headers, json={
            "title": "TEST_iter7_ext", "url": "https://example.com/v.mp4", "duration": 12
        }, timeout=30)
        assert r.status_code in (200, 201), r.text
        v = r.json()
        rid = v.get("id") or v.get("video", {}).get("id")
        assert rid
        rr = requests.post(f"{API}/videos/{rid}/music",
                           headers=headers, json={"track_id": "focus", "volume": 0.3}, timeout=30)
        assert rr.status_code == 400


# ---------- Trim ----------
class TestTrim:
    def test_trim_two_segments(self, headers, uploaded_video):
        payload = {"keep": [{"start": 1, "end": 3}, {"start": 5, "end": 7}], "title": "TEST_iter7_trim"}
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/trim",
                          headers=headers, json=payload, timeout=300)
        assert r.status_code == 200, r.text
        body = r.json()
        v = body["video"]
        # Duration should be ~4s
        assert 3.5 <= float(v["duration"]) <= 4.5, f"duration={v['duration']}"
        assert v["title"] == "TEST_iter7_trim"

    def test_trim_400_empty_keep(self, headers, uploaded_video):
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/trim",
                          headers=headers, json={"keep": []}, timeout=30)
        assert r.status_code == 400

    def test_trim_400_invalid_segment(self, headers, uploaded_video):
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/trim",
                          headers=headers, json={"keep": [{"start": 4, "end": 2}]}, timeout=30)
        assert r.status_code == 400

    def test_trim_400_non_uploaded(self, headers):
        r = requests.post(f"{API}/videos", headers=headers, json={
            "title": "TEST_iter7_ext_trim", "url": "https://example.com/v2.mp4", "duration": 10
        }, timeout=30)
        v = r.json()
        rid = v.get("id") or v.get("video", {}).get("id")
        assert rid
        rr = requests.post(f"{API}/videos/{rid}/trim",
                           headers=headers, json={"keep": [{"start": 0, "end": 2}]}, timeout=30)
        assert rr.status_code == 400


# ---------- Clip render still functioning ----------
class TestClipRender:
    def test_render_clip_returns_url(self, headers, uploaded_video):
        r = requests.post(f"{API}/videos/{uploaded_video['id']}/clips/render",
                          headers=headers, json={"start": 0.5, "end": 3.5, "aspect_ratio": "9:16",
                                                  "caption": "TEST_iter7"}, timeout=240)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and body["url"].startswith("/api/files/")
        assert body.get("aspect_ratio") == "9:16"


# ---------- Light regression ----------
class TestRegression:
    def test_videos_list(self, headers):
        r = requests.get(f"{API}/videos", headers=headers, timeout=30)
        assert r.status_code == 200

    def test_me(self, headers):
        r = requests.get(f"{API}/auth/me", headers=headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == QA_EMAIL

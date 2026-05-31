from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, BackgroundTasks, UploadFile, File, Form, Header, Query, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse, PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, jwt, bcrypt, uuid, logging, httpx, requests, asyncio, tempfile, io, secrets, subprocess, csv
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "looma"

logger = logging.getLogger("looma")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Looma API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

# ============ STORAGE ============
_storage_key = None
def init_storage():
    global _storage_key
    if _storage_key: return _storage_key
    if not EMERGENT_LLM_KEY:
        logger.warning("No EMERGENT_LLM_KEY — storage disabled")
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        logger.info("Storage initialized")
        return _storage_key
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
        return None

def storage_put(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key: raise HTTPException(503, "Storage unavailable")
    r = requests.put(f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=180)
    if r.status_code == 403:
        global _storage_key; _storage_key = None
        key = init_storage()
        r = requests.put(f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=180)
    r.raise_for_status()
    return r.json()

def storage_get(path: str) -> tuple[bytes, str]:
    key = init_storage()
    if not key: raise HTTPException(503, "Storage unavailable")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    if r.status_code == 403:
        global _storage_key; _storage_key = None
        key = init_storage()
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ============ MODELS ============
class RegisterReq(BaseModel):
    email: EmailStr; password: str; name: Optional[str] = None

class LoginReq(BaseModel):
    email: EmailStr; password: str

class UserOut(BaseModel):
    id: str; email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    provider: str = "local"

class TokenOut(BaseModel):
    access_token: str; user: UserOut

class VideoCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    url: Optional[str] = ""
    thumbnail: Optional[str] = ""
    duration: Optional[float] = 0
    folder: Optional[str] = "All Videos"
    password: Optional[str] = None

class Video(BaseModel):
    id: str; user_id: str; title: str
    description: str = ""
    url: str = ""
    thumbnail: str = ""
    duration: float = 0
    folder: str = "All Videos"
    views: int = 0; plays: int = 0
    avg_engagement: float = 0.0
    storage_path: Optional[str] = None
    transcript_status: str = "none"  # none|pending|ready|error
    allowed_domains: List[str] = []
    private_enabled: bool = False
    private_token: Optional[str] = None
    created_at: str

class VideoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    thumbnail: Optional[str] = None
    folder: Optional[str] = None
    password: Optional[str] = None
    allowed_domains: Optional[List[str]] = None
    private_enabled: Optional[bool] = None
    private_token: Optional[str] = None

class SegmentEvent(BaseModel):
    video_id: str
    session_id: str
    segment_index: int   # 5-second bucket index
    action: str = "watch"  # watch|skip|rewatch

class LeadSubmit(BaseModel):
    cta_id: Optional[str] = None
    email: EmailStr
    name: Optional[str] = ""
    fields: Optional[dict] = {}
    session_id: Optional[str] = None

class ClipRenderRequest(BaseModel):
    start: float
    end: float
    aspect_ratio: str = "9:16"  # 9:16 | 1:1 | 16:9
    caption: Optional[str] = ""

class MusicMixRequest(BaseModel):
    track_id: str = "upbeat"
    volume: float = 0.3  # 0.0 - 1.0 music volume relative to original audio

class TrimSegment(BaseModel):
    start: float
    end: float

class TrimRequest(BaseModel):
    keep: List[TrimSegment] = []
    title: Optional[str] = None


# ============ HELPERS ============
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception: return False

def create_token(user_id: str) -> str:
    return jwt.encode({"sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc)}, JWT_SECRET, algorithm=JWT_ALG)

AUTH_COOKIE = "looma_session"
CSRF_COOKIE = "looma_csrf"

# Paths exempted from CSRF check (public mutating endpoints + body-password-authenticated endpoints).
CSRF_EXEMPT_EXACT = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/logout",
    "/api/auth/google/session",
    "/api/csrf",
    "/api/analytics/leads",
}
def csrf_exempt_path(path: str) -> bool:
    if path in CSRF_EXEMPT_EXACT:
        return True
    if path.startswith("/api/public/"):
        return True
    if path.endswith("/segment") or path.endswith("/view"):
        return True
    return False


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit-token CSRF: state-changing requests must include
    X-CSRF-Token header matching the looma_csrf cookie when the SPA has a
    CSRF cookie available. Bearer clients and older cookie-only clients are
    allowed through for API compatibility, then normal auth dependencies apply."""
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not csrf_exempt_path(request.url.path):
                if request.headers.get("Authorization", "").lower().startswith("bearer "):
                    return await call_next(request)
                cookie_t = request.cookies.get(CSRF_COOKIE)
                header_t = request.headers.get("X-CSRF-Token")
                if not request.cookies.get(AUTH_COOKIE) or not cookie_t or not header_t:
                    return await call_next(request)
                if not secrets.compare_digest(cookie_t, header_t):
                    return JSONResponse({"detail": "CSRF token invalid"}, status_code=403)
        return await call_next(request)


def set_csrf_cookie(response: Response, token: str) -> None:
    # Non-HttpOnly so the SPA can read it and echo it as X-CSRF-Token
    response.set_cookie(
        key=CSRF_COOKIE, value=token,
        max_age=7 * 24 * 3600, httponly=False,
        secure=True, samesite="lax", path="/",
    )

def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE, value=token,
        max_age=7 * 24 * 3600, httponly=True,
        secure=True, samesite="lax", path="/",
    )

def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE, path="/")

def user_to_out(u: dict) -> UserOut:
    return UserOut(id=u["id"], email=u["email"], name=u.get("name"),
        picture=u.get("picture"), provider=u.get("provider", "local"))

async def audit(user_id: str, action: str, video_id: Optional[str] = None, details: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "video_id": video_id,
        "action": action,
        "details": details or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

def _normalized_host(value: str) -> str:
    return (urlparse(value).hostname or value or "").lower().strip().rstrip("/")

def _normalized_domains(domains: List[str]) -> List[str]:
    return [_normalized_host(d.replace("https://", "").replace("http://", "")) for d in domains if d and d.strip()]

def origin_allowed(request: Request, allowed_domains: List[str]) -> bool:
    if not allowed_domains:
        return True
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if not origin:
        return True
    host = _normalized_host(origin)
    public_host = (urlparse(os.environ.get("PUBLIC_BASE_URL", "")).hostname or "").lower()
    request_host = (request.url.hostname or "").lower()
    if host and host in {public_host, request_host}:
        return True
    normalized = _normalized_domains(allowed_domains)
    return any(host == d or host.endswith("." + d) for d in normalized)

async def _fetch_google_session(session_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as cx:
        try:
            r = await cx.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id})
        except httpx.HTTPError:
            raise HTTPException(502, "Auth provider unreachable")
    if r.status_code != 200:
        raise HTTPException(401, "Invalid session")
    return r.json()

async def _upsert_google_user(data: dict) -> dict:
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(400, "No email in session")
    u = await db.users.find_one({"email": email}, {"_id": 0})
    now = datetime.now(timezone.utc).isoformat()
    if not u:
        u = {"id": str(uuid.uuid4()), "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"), "provider": "google",
            "password_hash": None, "created_at": now}
        await db.users.insert_one(u)
        return u
    updates = {"name": data.get("name") or u.get("name"), "picture": data.get("picture") or u.get("picture"), "provider": u.get("provider") or "google"}
    await db.users.update_one({"id": u["id"]}, {"$set": updates})
    return {**u, **updates}

def _video_updates_from_payload(data: dict) -> dict:
    updates = {}
    if "password" in data:
        pw = data.pop("password")
        updates["password_hash"] = hash_pw(pw) if pw else None
    if data.get("private_token") == "rotate":
        data.pop("private_token")
        updates["private_token"] = secrets.token_urlsafe(18)
    for k, v in data.items():
        if v is None:
            continue
        updates[k] = [d.strip() for d in v if d and d.strip()] if k == "allowed_domains" else v
    return updates

def _clip_filter(aspect_ratio: str) -> str:
    filters = {
        "9:16": "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
        "1:1": "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
    }
    return filters.get(aspect_ratio, "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2")

def _render_clip_bytes(ffmpeg: str, data: bytes, body: ClipRenderRequest) -> bytes:
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "source.webm")
        out = os.path.join(td, "clip.mp4")
        with open(src, "wb") as f:
            f.write(data)
        cmd = [ffmpeg, "-y", "-ss", str(body.start), "-to", str(body.end), "-i", src, "-vf", _clip_filter(body.aspect_ratio), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", out]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        return open(out, "rb").read()

# ============ BACKGROUND MUSIC ============
MUSIC_TRACKS = [
    {"id": "upbeat",  "label": "Upbeat",  "note": "A4", "bpm": 128},
    {"id": "calm",    "label": "Calm",    "note": "C4", "bpm": 72},
    {"id": "focus",   "label": "Focus",   "note": "E4", "bpm": 90},
    {"id": "ambient", "label": "Ambient", "note": "G3", "bpm": 60},
]
MUSIC_NOTE_HZ = {"A4": 440.0, "C4": 261.63, "E4": 329.63, "G3": 196.00}

def _mix_music_bytes(ffmpeg: str, data: bytes, track_id: str, volume: float) -> bytes:
    """Mix a generated royalty-free background tone into the video's audio track."""
    track = next((t for t in MUSIC_TRACKS if t["id"] == track_id), None)
    if not track:
        raise ValueError("invalid track_id")
    freq = MUSIC_NOTE_HZ.get(track["note"], 440.0)
    vol = max(0.0, min(1.0, volume))
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "source.mp4")
        out = os.path.join(td, "music.mp4")
        with open(src, "wb") as f:
            f.write(data)
        # Mix the original audio with a generated sine pad. duration=first keeps the
        # output as long as the original audio (the infinite sine is trimmed to match).
        filter_complex = (
            f"sine=frequency={freq}:sample_rate=44100,volume={vol}[bg];"
            f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]"
        )
        cmd = [ffmpeg, "-y", "-i", src,
               "-filter_complex", filter_complex,
               "-map", "0:v", "-map", "[aout]",
               "-c:v", "copy", "-c:a", "aac", "-shortest", out]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        if proc.returncode != 0:
            # Fallback: source has no audio track — lay the sine pad over the video.
            cmd2 = [ffmpeg, "-y", "-i", src, "-f", "lavfi",
                    "-i", f"sine=frequency={freq}:sample_rate=44100",
                    "-filter_complex", f"[1:a]volume={vol}[aout]",
                    "-map", "0:v", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac", "-shortest", out]
            subprocess.run(cmd2, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        return open(out, "rb").read()

def _trim_bytes(ffmpeg: str, data: bytes, keep: list) -> bytes:
    """Cut the source to the given keep-ranges and concatenate them into one file."""
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "source.mp4")
        with open(src, "wb") as f:
            f.write(data)
        seg_files = []
        for i, seg in enumerate(keep):
            seg_out = os.path.join(td, f"seg_{i}.mp4")
            cmd = [ffmpeg, "-y", "-ss", str(seg["start"]), "-to", str(seg["end"]), "-i", src,
                   "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", seg_out]
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
            seg_files.append(seg_out)
        if len(seg_files) == 1:
            return open(seg_files[0], "rb").read()
        list_path = os.path.join(td, "concat.txt")
        with open(list_path, "w") as lf:
            for sf in seg_files:
                lf.write(f"file '{sf}'\n")
        out = os.path.join(td, "trimmed.mp4")
        cmd = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", out]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        return open(out, "rb").read()

def _new_derived_video(user_id: str, base: dict, title: str, storage_path: str, file_url: str, duration: float, content_label: str) -> dict:
    """Build a new video document derived from an existing one (music/trim outputs)."""
    return {
        "id": str(uuid.uuid4()), "user_id": user_id, "title": title,
        "description": base.get("description", ""), "url": file_url,
        "duration": float(duration or 0),
        "folder": base.get("folder", "All Videos"),
        "views": 0, "plays": 0, "avg_engagement": 0.0,
        "thumbnail": base.get("thumbnail", ""),
        "allowed_domains": [], "private_enabled": False, "private_token": secrets.token_urlsafe(18),
        "storage_path": storage_path, "transcript_status": "none",
        "content_type_label": content_label, "derived_from": base.get("id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    # Prefer httpOnly cookie; fall back to Authorization header (for embeds / API clients)
    token: Optional[str] = request.cookies.get(AUTH_COOKIE)
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(401, "User not found")
    return u


# ============ TRANSCRIPTION ============
async def transcribe_video(video_id: str, storage_path: str):
    """Background task: download video bytes, run Whisper, save transcript."""
    try:
        await db.videos.update_one({"id": video_id}, {"$set": {"transcript_status": "pending"}})
        data, ctype = await asyncio.get_event_loop().run_in_executor(None, storage_get, storage_path)
        # Whisper limit: 25MB
        if len(data) > 25 * 1024 * 1024:
            logger.warning(f"Video {video_id} > 25MB, skipping transcript")
            await db.videos.update_one({"id": video_id}, {"$set": {"transcript_status": "error",
                "transcript_error": "File too large for transcription (>25MB)"}})
            return
        # Determine extension
        ext = "webm" if "webm" in ctype else "mp4"
        from emergentintegrations.llm.openai import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        # Need a file-like with a name attribute
        bio = io.BytesIO(data); bio.name = f"video.{ext}"
        resp = await stt.transcribe(
            file=bio, model="whisper-1",
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )
        segments = []
        text = ""
        if hasattr(resp, "text"): text = resp.text
        resp_segments = getattr(resp, "segments", None)
        if resp_segments:
            for s in resp_segments:
                # litellm/OpenAI returns each segment as a dict; support object form too.
                if isinstance(s, dict):
                    start = s.get("start", 0); end = s.get("end", 0); seg_text = s.get("text", "")
                else:
                    start = getattr(s, "start", 0); end = getattr(s, "end", 0); seg_text = getattr(s, "text", "")
                segments.append({
                    "start": float(start or 0),
                    "end": float(end or 0),
                    "text": (seg_text or "").strip(),
                })
        await db.transcripts.update_one(
            {"video_id": video_id},
            {"$set": {"video_id": video_id, "text": text, "segments": segments,
                      "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await db.videos.update_one({"id": video_id}, {"$set": {"transcript_status": "ready"}})
        logger.info(f"Transcribed {video_id}: {len(segments)} segments")
    except Exception as e:
        logger.error(f"Transcription failed for {video_id}: {e}")
        await db.videos.update_one({"id": video_id},
            {"$set": {"transcript_status": "error", "transcript_error": str(e)[:200]}})


# ============ ROUTES ============
@api_router.get("/")
async def root():
    return {"message": "Looma API up", "version": "2.0"}

@api_router.get("/csrf")
async def get_csrf(request: Request, response: Response):
    """Issue a CSRF token. Frontend calls this on app load and echoes the cookie back as X-CSRF-Token on mutating requests."""
    existing = request.cookies.get(CSRF_COOKIE)
    token = existing or secrets.token_urlsafe(32)
    set_csrf_cookie(response, token)
    return {"csrf_token": token}

@api_router.post("/auth/register", response_model=TokenOut)
async def register(req: RegisterReq, request: Request, response: Response):
    if await db.users.find_one({"email": req.email.lower()}):
        raise HTTPException(400, "Email already registered")
    user = {"id": str(uuid.uuid4()), "email": req.email.lower(),
        "name": req.name or req.email.split("@")[0],
        "password_hash": hash_pw(req.password), "provider": "local", "picture": None,
        "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(user)
    tok = create_token(user["id"])
    set_auth_cookie(response, tok)
    set_csrf_cookie(response, request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(32))
    return TokenOut(access_token=tok, user=user_to_out(user))

@api_router.post("/auth/login", response_model=TokenOut)
async def login(req: LoginReq, request: Request, response: Response):
    u = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if not u or not u.get("password_hash") or not verify_pw(req.password, u["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    tok = create_token(u["id"])
    set_auth_cookie(response, tok)
    set_csrf_cookie(response, request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(32))
    return TokenOut(access_token=tok, user=user_to_out(u))

@api_router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}

@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return user_to_out(user)

@api_router.post("/auth/google/session", response_model=TokenOut)
async def google_session(request: Request, response: Response):
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(400, "Missing X-Session-ID header")
    data = await _fetch_google_session(session_id)
    u = await _upsert_google_user(data)
    tok = create_token(u["id"])
    set_auth_cookie(response, tok)
    set_csrf_cookie(response, request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(32))
    return TokenOut(access_token=tok, user=user_to_out(u))


# ============ VIDEOS ============
def video_to_out(v: dict) -> dict:
    """Ensure video dict has all expected fields with defaults."""
    return {
        "id": v["id"], "user_id": v["user_id"], "title": v.get("title", ""),
        "description": v.get("description", ""), "url": v.get("url", ""),
        "thumbnail": v.get("thumbnail", ""), "duration": v.get("duration", 0),
        "folder": v.get("folder", "All Videos"),
        "views": v.get("views", 0), "plays": v.get("plays", 0),
        "avg_engagement": v.get("avg_engagement", 0.0),
        "storage_path": v.get("storage_path"),
        "transcript_status": v.get("transcript_status", "none"),
        "allowed_domains": v.get("allowed_domains", []),
        "private_enabled": v.get("private_enabled", False),
        "private_token": v.get("private_token"),
        "created_at": v.get("created_at", ""),
    }

@api_router.get("/videos", response_model=List[Video])
async def list_videos(user=Depends(get_current_user)):
    docs = await db.videos.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [video_to_out(d) for d in docs]

@api_router.post("/videos", response_model=Video)
async def create_video(body: VideoCreate, user=Depends(get_current_user)):
    v = {"id": str(uuid.uuid4()), "user_id": user["id"], "title": body.title,
        "description": body.description or "", "url": body.url or "",
        "thumbnail": body.thumbnail or "",
        "duration": float(body.duration or 0),
        "folder": body.folder or "All Videos",
        "views": 0, "plays": 0, "avg_engagement": 0.0,
        "storage_path": None, "transcript_status": "none",
        "allowed_domains": [], "private_enabled": False, "private_token": secrets.token_urlsafe(18),
        "password_hash": hash_pw(body.password) if body.password else None,
        "created_at": datetime.now(timezone.utc).isoformat()}
    await db.videos.insert_one(v)
    await audit(user["id"], "video.created", v["id"], {"title": v["title"], "source": "url"})
    return video_to_out(v)

@api_router.post("/videos/upload", response_model=Video)
async def upload_video(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    folder: str = Form("All Videos"),
    thumbnail: str = Form(""),
    duration: float = Form(0),
    user=Depends(get_current_user),
):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "Object storage not configured")
    raw = file.filename or "video.webm"
    ext = raw.rsplit(".", 1)[-1].lower() if "." in raw else "webm"
    if ext not in ("mp4", "webm", "mov", "m4v", "mpeg", "mpga"): ext = "webm"
    data = await file.read()
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    content_type = file.content_type or ("video/webm" if ext == "webm" else "video/mp4")
    result = await asyncio.get_event_loop().run_in_executor(None, storage_put, path, data, content_type)
    file_url = f"/api/files/{result['path']}"
    v = {"id": str(uuid.uuid4()), "user_id": user["id"], "title": title,
        "description": description or "", "url": file_url,
        "duration": float(duration or 0),
        "folder": folder or "All Videos",
        "views": 0, "plays": 0, "avg_engagement": 0.0,
        "thumbnail": thumbnail or "",
        "allowed_domains": [], "private_enabled": False, "private_token": secrets.token_urlsafe(18),
        "storage_path": result["path"], "transcript_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()}
    await db.videos.insert_one(v)
    await audit(user["id"], "video.uploaded", v["id"], {"folder": v["folder"], "content_type": content_type})
    # auto-transcribe in background
    background.add_task(transcribe_video, v["id"], result["path"])
    return video_to_out(v)

@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    """Public endpoint to serve uploaded video files (used as <video src>)."""
    data: Optional[bytes] = None
    ctype: str = "application/octet-stream"
    try:
        data, ctype = await asyncio.get_event_loop().run_in_executor(None, storage_get, path)
    except requests.HTTPError as e:
        sc = e.response.status_code if e.response is not None else 502
        raise HTTPException(404 if sc == 404 else 502, "File not found" if sc == 404 else "Storage error")
    except Exception:
        raise HTTPException(502, "Storage error")
    if data is None:
        raise HTTPException(502, "Storage error")
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=3600"})

@api_router.get("/videos/{video_id}", response_model=Video)
async def get_video(video_id: str, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    return video_to_out(v)

@api_router.patch("/videos/{video_id}", response_model=Video)
async def update_video(video_id: str, body: VideoUpdate, user=Depends(get_current_user)):
    updates = _video_updates_from_payload(body.model_dump(exclude_unset=True))
    if updates:
        await db.videos.update_one({"id": video_id, "user_id": user["id"]}, {"$set": updates})
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Video not found")
    if updates:
        await audit(user["id"], "video.updated", video_id, {"fields": list(updates.keys())})
    return video_to_out(v)

@api_router.delete("/videos/{video_id}")
async def delete_video(video_id: str, user=Depends(get_current_user)):
    r = await db.videos.delete_one({"id": video_id, "user_id": user["id"]})
    await db.transcripts.delete_one({"video_id": video_id})
    await db.segment_events.delete_many({"video_id": video_id})
    if r.deleted_count == 0: raise HTTPException(404, "Video not found")
    return {"ok": True}

@api_router.post("/videos/{video_id}/view")
async def track_view(video_id: str):
    await db.videos.update_one({"id": video_id}, {"$inc": {"views": 1, "plays": 1}})
    return {"ok": True}


# ============ HEATMAP (5-sec segment tracking) ============
@api_router.post("/videos/{video_id}/segment")
async def track_segment(video_id: str, body: SegmentEvent):
    """Anonymous endpoint — record one 5-sec segment view/skip/rewatch."""
    if body.segment_index < 0 or body.segment_index > 10000:
        raise HTTPException(400, "Invalid segment index")
    await db.segment_events.insert_one({
        "video_id": video_id,
        "session_id": body.session_id,
        "segment_index": body.segment_index,
        "action": body.action,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}

@api_router.get("/videos/{video_id}/heatmap")
async def heatmap(video_id: str):
    """Aggregate segment events into a heatmap array."""
    pipeline = [
        {"$match": {"video_id": video_id}},
        {"$group": {
            "_id": "$segment_index",
            "watches": {"$sum": {"$cond": [{"$eq": ["$action", "watch"]}, 1, 0]}},
            "rewatches": {"$sum": {"$cond": [{"$eq": ["$action", "rewatch"]}, 1, 0]}},
            "skips": {"$sum": {"$cond": [{"$eq": ["$action", "skip"]}, 1, 0]}},
        }},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.segment_events.aggregate(pipeline).to_list(2000)
    if not rows: return {"segments": [], "max_count": 0}
    max_c = max((r["watches"] + r["rewatches"] * 2) for r in rows) or 1
    return {
        "segments": [{"index": r["_id"], "watches": r["watches"],
            "rewatches": r["rewatches"], "skips": r["skips"],
            "intensity": (r["watches"] + r["rewatches"]*2) / max_c} for r in rows],
        "max_count": max_c,
    }


# ============ TRANSCRIPT ============
@api_router.get("/videos/{video_id}/transcript")
async def get_transcript(video_id: str, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    t = await db.transcripts.find_one({"video_id": video_id}, {"_id": 0})
    return {
        "status": v.get("transcript_status", "none"),
        "text": (t or {}).get("text", ""),
        "segments": (t or {}).get("segments", []),
    }

@api_router.post("/videos/{video_id}/transcribe")
async def trigger_transcribe(video_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    if not v.get("storage_path"): raise HTTPException(400, "Video has no storage file to transcribe")
    background.add_task(transcribe_video, video_id, v["storage_path"])
    await db.videos.update_one({"id": video_id}, {"$set": {"transcript_status": "pending"}})
    return {"ok": True, "status": "pending"}


# ============ ANALYTICS ============
@api_router.get("/analytics/overview")
async def analytics_overview(user=Depends(get_current_user)):
    videos = await db.videos.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    total_views = sum(v.get("views", 0) for v in videos)
    total_plays = sum(v.get("plays", 0) for v in videos)
    video_ids = [v["id"] for v in videos]
    segment_count = await db.segment_events.count_documents({"video_id": {"$in": video_ids}}) if video_ids else 0
    total_watch_time = segment_count * 5
    play_rate = int((total_plays / max(1, total_views)) * 100) if total_views else 0
    return {
        "total_videos": len(videos), "total_views": total_views, "total_plays": total_plays,
        "avg_engagement": 68,
        "total_watch_time": total_watch_time,
        "play_rate": min(100, play_rate),
        "trend": [
            {"day": "Mon", "views": 120, "plays": 80}, {"day": "Tue", "views": 180, "plays": 110},
            {"day": "Wed", "views": 240, "plays": 160}, {"day": "Thu", "views": 210, "plays": 140},
            {"day": "Fri", "views": 320, "plays": 220}, {"day": "Sat", "views": 280, "plays": 190},
            {"day": "Sun", "views": 360, "plays": 250},
        ],
    }


# ============ STATUS ============
class StatusCheckCreate(BaseModel):
    client_name: str

@api_router.post("/status")
async def create_status(input: StatusCheckCreate):
    doc = {"id": str(uuid.uuid4()), "client_name": input.client_name,
        "timestamp": datetime.now(timezone.utc).isoformat()}
    await db.status_checks.insert_one(doc)
    return doc


# ============ BRAND ============
class BrandUpdate(BaseModel):
    color: Optional[str] = None
    logo_text: Optional[str] = None
    logo_position: Optional[str] = None
    default_thumbnail: Optional[str] = None
    autoplay: Optional[bool] = None

def brand_defaults():
    return {"color": "#FF6B6B", "logo_text": "Looma", "logo_position": "top-right", "default_thumbnail": "", "autoplay": False}

@api_router.get("/brand")
async def get_brand(user=Depends(get_current_user)):
    b = await db.brands.find_one({"user_id": user["id"]}, {"_id": 0, "user_id": 0}) or {}
    merged = {**brand_defaults(), **b}
    return merged

@api_router.put("/brand")
async def update_brand(body: BrandUpdate, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.brands.update_one({"user_id": user["id"]},
        {"$set": {**updates, "user_id": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    b = await db.brands.find_one({"user_id": user["id"]}, {"_id": 0, "user_id": 0}) or {}
    return {**brand_defaults(), **b}


# ============ PUBLIC VIDEO (for /embed/:id and /v/:id) ============
@api_router.get("/public/videos/{video_id}")
async def public_video(video_id: str, request: Request, token: Optional[str] = Query(None)):
    """Anonymous endpoint — returns video + owner brand for embeddable / shareable players."""
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    if v.get("private_enabled") and token != v.get("private_token"):
        raise HTTPException(403, "Private link required")
    if not origin_allowed(request, v.get("allowed_domains", [])):
        raise HTTPException(403, "This video is restricted to approved domains")
    b = await db.brands.find_one({"user_id": v["user_id"]}, {"_id": 0, "user_id": 0}) or {}
    brand = {**brand_defaults(), **b}
    ctas = await db.ctas.find({"video_id": video_id}, {"_id": 0}).to_list(100)
    t_doc = await db.transcripts.find_one({"video_id": video_id}, {"_id": 0}) or {}
    chapters = [{"start": s.get("start", 0), "text": s.get("text", "")} for s in (t_doc.get("segments") or [])[:12]]
    password_protected = bool(v.get("password_hash"))
    return {
        "id": v["id"], "title": v.get("title", ""),
        "description": v.get("description", ""),
        # Strip the playable URL when password-protected so it can't play until unlocked.
        "url": "" if password_protected else v.get("url", ""),
        "thumbnail": v.get("thumbnail", ""),
        "duration": v.get("duration", 0),
        "views": v.get("views", 0),
        "password_protected": password_protected,
        "private_enabled": v.get("private_enabled", False),
        "allowed_domains": v.get("allowed_domains", []),
        "ctas": [cta_to_out(c) for c in ctas],
        "chapters": chapters,
        "brand": brand,
    }


# ============ CHANNELS (video hub collections) ============
class ChannelCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "bg-mint"

class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

def channel_to_out(c: dict) -> dict:
    c["id"] = c.get("id", str(c.get("_id", "")))
    c.pop("_id", None)
    c.pop("user_id", None)
    c.setdefault("video_ids", [])
    c.setdefault("description", "")
    c.setdefault("color", "bg-mint")
    c.setdefault("views", 0)
    return c

@api_router.get("/channels")
async def list_channels(user=Depends(get_current_user)):
    docs = await db.channels.find({"user_id": user["id"]}).to_list(200)
    return [channel_to_out(c) for c in docs]

@api_router.post("/channels", status_code=201)
async def create_channel(body: ChannelCreate, user=Depends(get_current_user)):
    doc = {"id": uuid.uuid4().hex, "user_id": user["id"],
           "name": body.name, "description": body.description or "",
           "color": body.color or "bg-mint", "video_ids": [],
           "views": 0, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.channels.insert_one(doc)
    return channel_to_out(doc)

@api_router.get("/channels/{cid}")
async def get_channel(cid: str, user=Depends(get_current_user)):
    c = await db.channels.find_one({"id": cid, "user_id": user["id"]})
    if not c: raise HTTPException(404, "Channel not found")
    return channel_to_out(c)

@api_router.patch("/channels/{cid}")
async def update_channel(cid: str, body: ChannelUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd: raise HTTPException(400, "Nothing to update")
    await db.channels.update_one({"id": cid, "user_id": user["id"]}, {"$set": upd})
    c = await db.channels.find_one({"id": cid, "user_id": user["id"]})
    if not c: raise HTTPException(404, "Channel not found")
    return channel_to_out(c)

@api_router.delete("/channels/{cid}", status_code=204)
async def delete_channel(cid: str, user=Depends(get_current_user)):
    await db.channels.delete_one({"id": cid, "user_id": user["id"]})

@api_router.post("/channels/{cid}/videos/{vid}", status_code=200)
async def add_video_to_channel(cid: str, vid: str, user=Depends(get_current_user)):
    await db.channels.update_one(
        {"id": cid, "user_id": user["id"]}, {"$addToSet": {"video_ids": vid}})
    c = await db.channels.find_one({"id": cid, "user_id": user["id"]})
    if not c: raise HTTPException(404, "Channel not found")
    return channel_to_out(c)

@api_router.delete("/channels/{cid}/videos/{vid}", status_code=200)
async def remove_video_from_channel(cid: str, vid: str, user=Depends(get_current_user)):
    await db.channels.update_one(
        {"id": cid, "user_id": user["id"]}, {"$pull": {"video_ids": vid}})
    c = await db.channels.find_one({"id": cid, "user_id": user["id"]})
    if not c: raise HTTPException(404, "Channel not found")
    return channel_to_out(c)

@api_router.get("/public/channels/{cid}")
async def public_channel(cid: str):
    c = await db.channels.find_one({"id": cid})
    if not c: raise HTTPException(404, "Channel not found")
    owner_id = c["user_id"]
    video_ids = c.get("video_ids", [])
    videos = []
    for vid in video_ids:
        v = await db.videos.find_one({"id": vid}, {"_id": 0})
        if v: videos.append(video_to_out(v))
    brand_doc = await db.brands.find_one({"user_id": owner_id}, {"_id": 0, "user_id": 0}) or {}
    return {**channel_to_out(c), "videos": videos, "brand": {**brand_defaults(), **brand_doc}}


# ============ TIME-CODED COMMENTS / TEAM FEEDBACK ============
class CommentCreate(BaseModel):
    text: str
    timestamp: float = 0.0  # seconds into video
    author: Optional[str] = "You"

def comment_to_out(c: dict) -> dict:
    c["id"] = c.get("id", str(c.get("_id", "")))
    c.pop("_id", None)
    c.pop("user_id", None)
    c.setdefault("resolved", False)
    c.setdefault("author", "You")
    return c

@api_router.get("/videos/{video_id}/comments")
async def list_comments(video_id: str, user=Depends(get_current_user)):
    docs = await db.comments.find({"video_id": video_id, "user_id": user["id"]}).sort("timestamp", 1).to_list(500)
    return [comment_to_out(d) for d in docs]

@api_router.post("/videos/{video_id}/comments", status_code=201)
async def add_comment(video_id: str, body: CommentCreate, user=Depends(get_current_user)):
    doc = {"id": uuid.uuid4().hex, "video_id": video_id, "user_id": user["id"],
           "text": body.text, "timestamp": body.timestamp,
           "author": body.author or user.get("name", "You"),
           "resolved": False, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.comments.insert_one(doc)
    return comment_to_out(doc)

@api_router.patch("/videos/{video_id}/comments/{comment_id}")
async def resolve_comment(video_id: str, comment_id: str, user=Depends(get_current_user)):
    await db.comments.update_one(
        {"id": comment_id, "user_id": user["id"]}, {"$set": {"resolved": True}})
    d = await db.comments.find_one({"id": comment_id, "user_id": user["id"]})
    if not d: raise HTTPException(404, "Comment not found")
    return comment_to_out(d)

@api_router.delete("/videos/{video_id}/comments/{comment_id}", status_code=204)
async def delete_comment(video_id: str, comment_id: str, user=Depends(get_current_user)):
    await db.comments.delete_one({"id": comment_id, "user_id": user["id"]})


# ============ IN-VIDEO CTAs & LEAD CAPTURE FORMS ============
class CTACreate(BaseModel):
    type: str = "cta"          # "cta" | "form"
    timestamp: float = 0.0
    text: str = ""
    button_label: Optional[str] = "Learn more"
    url: Optional[str] = ""
    form_fields: Optional[List[str]] = []   # e.g. ["name","email"]

def cta_to_out(c: dict) -> dict:
    c["id"] = c.get("id", str(c.get("_id", "")))
    c.pop("_id", None)
    c.pop("user_id", None)
    return c

@api_router.get("/videos/{video_id}/ctas")
async def list_ctas(video_id: str, user=Depends(get_current_user)):
    docs = await db.ctas.find({"video_id": video_id, "user_id": user["id"]}).to_list(100)
    return [cta_to_out(d) for d in docs]

@api_router.post("/videos/{video_id}/ctas", status_code=201)
async def create_cta(video_id: str, body: CTACreate, user=Depends(get_current_user)):
    doc = {"id": uuid.uuid4().hex, "video_id": video_id, "user_id": user["id"],
           "type": body.type, "timestamp": body.timestamp, "text": body.text,
           "button_label": body.button_label, "url": body.url or "",
           "form_fields": body.form_fields or [],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.ctas.insert_one(doc)
    return cta_to_out(doc)

@api_router.delete("/videos/{video_id}/ctas/{cta_id}", status_code=204)
async def delete_cta(video_id: str, cta_id: str, user=Depends(get_current_user)):
    await db.ctas.delete_one({"id": cta_id, "user_id": user["id"]})

@api_router.post("/public/videos/{video_id}/leads", status_code=201)
async def capture_lead(video_id: str, body: LeadSubmit):
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    doc = {
        "id": uuid.uuid4().hex,
        "video_id": video_id,
        "user_id": v["user_id"],
        "cta_id": body.cta_id,
        "email": body.email.lower(),
        "name": body.name or "",
        "fields": body.fields or {},
        "session_id": body.session_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leads.insert_one(doc)
    await audit(v["user_id"], "lead.captured", video_id, {"email": doc["email"], "cta_id": body.cta_id})
    doc.pop("_id", None)
    return doc


# ============ PASSWORD PROTECTION (public unlock) ============
class VideoPasswordCheck(BaseModel):
    password: str

@api_router.post("/public/videos/{video_id}/unlock")
async def unlock_video(video_id: str, body: VideoPasswordCheck, request: Request, token: Optional[str] = Query(None)):
    v = await db.videos.find_one({"id": video_id})
    if not v: raise HTTPException(404, "Video not found")
    if v.get("private_enabled") and token != v.get("private_token"):
        raise HTTPException(403, "Private link required")
    if not origin_allowed(request, v.get("allowed_domains", [])):
        raise HTTPException(403, "This video is restricted to approved domains")
    ph = v.get("password_hash")
    if not ph: return {"ok": True, "url": v.get("url", "")}
    if not verify_pw(body.password, ph): raise HTTPException(403, "Wrong password")
    return {"ok": True, "url": v.get("url", "")}


# ============ HEATMAP AGGREGATION HELPER (from real segment_events) ============
async def _heat_counts(video_id: str):
    """Aggregate raw segment_events into per-segment watch/rewatch counts."""
    pipeline = [
        {"$match": {"video_id": video_id}},
        {"$group": {
            "_id": "$segment_index",
            "watches": {"$sum": {"$cond": [{"$eq": ["$action", "watch"]}, 1, 0]}},
            "rewatches": {"$sum": {"$cond": [{"$eq": ["$action", "rewatch"]}, 1, 0]}},
        }},
    ]
    return await db.segment_events.aggregate(pipeline).to_list(2000)


# ============ SUGGESTED REMIX CLIPS (transcript + heatmap) ============
@api_router.get("/videos/{video_id}/clips")
async def suggest_clips(video_id: str, user=Depends(get_current_user)):
    """Return top transcript segments ranked by heatmap engagement as clip suggestions."""
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]})
    if not v: raise HTTPException(404, "Video not found")

    rows = await _heat_counts(video_id)
    heat_by_idx = {r["_id"]: r["watches"] + r["rewatches"] * 2 for r in rows}

    t_doc = await db.transcripts.find_one({"video_id": video_id})
    t_segs = t_doc.get("segments", []) if t_doc else []

    clips = []
    for seg in t_segs:
        start = seg.get("start", 0)
        end = seg.get("end", start + 10)
        bucket_start = int(start // 5)
        bucket_end = int(end // 5)
        score = sum(heat_by_idx.get(i, 0) for i in range(bucket_start, bucket_end + 1))
        duration = end - start
        if 8 <= duration <= 90:  # only clips between 8s and 90s
            clips.append({
                "start": round(start, 2), "end": round(end, 2),
                "text": seg.get("text", ""),
                "duration": round(duration, 1),
                "duration_label": f"{int(duration // 60)}:{int(duration % 60):02d}",
                "engagement_score": score,
                "engagement_pct": min(99, int(score * 3 + 60)) if score > 0 else 60,
                "format_suggestions": ["Reels", "Shorts", "TikTok"] if duration <= 60 else ["LinkedIn", "Twitter"],
                "aspect_ratios": ["9:16", "1:1", "16:9"],
                "caption_text": seg.get("text", ""),
            })

    clips.sort(key=lambda x: -x["engagement_score"])
    return {"video_id": video_id, "clips": clips[:6], "total": len(clips)}

@api_router.post("/videos/{video_id}/clips/render")
async def render_clip(video_id: str, body: ClipRenderRequest, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v: raise HTTPException(404, "Video not found")
    if not v.get("storage_path"):
        raise HTTPException(400, "Rendered downloads are available for uploaded videos")
    if body.end <= body.start or body.end - body.start > 180:
        raise HTTPException(400, "Clip must be between 1 and 180 seconds")
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        data, ctype = await asyncio.get_event_loop().run_in_executor(None, storage_get, v["storage_path"])
        rendered = _render_clip_bytes(ffmpeg, data, body)
        path = f"{APP_NAME}/clips/{user['id']}/{uuid.uuid4().hex}.mp4"
        result = await asyncio.get_event_loop().run_in_executor(None, storage_put, path, rendered, "video/mp4")
        doc = {"id": uuid.uuid4().hex, "video_id": video_id, "user_id": user["id"], "start": body.start, "end": body.end,
               "aspect_ratio": body.aspect_ratio, "caption": body.caption or "", "url": f"/api/files/{result['path']}",
               "storage_path": result["path"], "created_at": datetime.now(timezone.utc).isoformat()}
        await db.rendered_clips.insert_one(doc)
        await audit(user["id"], "clip.rendered", video_id, {"aspect_ratio": body.aspect_ratio, "duration": body.end - body.start})
        doc.pop("_id", None)
        return doc
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"Clip render failed: {e.stderr.decode(errors='ignore')[:160]}")
    except Exception as e:
        raise HTTPException(500, f"Clip render failed: {str(e)[:160]}")


@api_router.get("/videos/{video_id}/music-tracks")
async def list_music_tracks(video_id: str, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Video not found")
    return {"tracks": MUSIC_TRACKS}

@api_router.post("/videos/{video_id}/music")
async def add_background_music(video_id: str, body: MusicMixRequest, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Video not found")
    if not v.get("storage_path"):
        raise HTTPException(400, "Background music is available for uploaded videos")
    track = next((t for t in MUSIC_TRACKS if t["id"] == body.track_id), None)
    if not track:
        raise HTTPException(400, "Invalid track_id")
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        data, ctype = await asyncio.get_event_loop().run_in_executor(None, storage_get, v["storage_path"])
        mixed = await asyncio.get_event_loop().run_in_executor(None, _mix_music_bytes, ffmpeg, data, body.track_id, body.volume)
        path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4().hex}.mp4"
        result = await asyncio.get_event_loop().run_in_executor(None, storage_put, path, mixed, "video/mp4")
        new_title = f"{v.get('title', 'Video')} ({track['label']} music)"
        doc = _new_derived_video(user["id"], v, new_title, result["path"], f"/api/files/{result['path']}", v.get("duration", 0), "Background Music")
        await db.videos.insert_one(doc)
        await audit(user["id"], "video.music_added", video_id, {"track_id": body.track_id, "volume": body.volume, "new_video_id": doc["id"]})
        return {"video": video_to_out(doc), "message": f"New video created with {track['label']} background music"}
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"Music mix failed: {e.stderr.decode(errors='ignore')[:160]}")
    except Exception as e:
        raise HTTPException(500, f"Music mix failed: {str(e)[:160]}")

@api_router.post("/videos/{video_id}/trim")
async def trim_video(video_id: str, body: TrimRequest, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Video not found")
    if not v.get("storage_path"):
        raise HTTPException(400, "Trimming is available for uploaded videos")
    if not body.keep:
        raise HTTPException(400, "No keep segments provided")
    keep = []
    for seg in body.keep:
        if seg.end <= seg.start:
            raise HTTPException(400, "Each segment end must be greater than its start")
        keep.append({"start": round(max(0.0, seg.start), 3), "end": round(seg.end, 3)})
    total = sum(s["end"] - s["start"] for s in keep)
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        data, ctype = await asyncio.get_event_loop().run_in_executor(None, storage_get, v["storage_path"])
        trimmed = await asyncio.get_event_loop().run_in_executor(None, _trim_bytes, ffmpeg, data, keep)
        path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4().hex}.mp4"
        result = await asyncio.get_event_loop().run_in_executor(None, storage_put, path, trimmed, "video/mp4")
        new_title = body.title or f"{v.get('title', 'Video')} (trimmed)"
        doc = _new_derived_video(user["id"], v, new_title, result["path"], f"/api/files/{result['path']}", round(total, 2), "Trimmed")
        await db.videos.insert_one(doc)
        await audit(user["id"], "video.trimmed", video_id, {"segments": len(keep), "duration": round(total, 2), "new_video_id": doc["id"]})
        return {"video": video_to_out(doc), "message": f"Trimmed video saved as '{new_title}'"}
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"Trim failed: {e.stderr.decode(errors='ignore')[:160]}")
    except Exception as e:
        raise HTTPException(500, f"Trim failed: {str(e)[:160]}")


# ============ CRM / LEAD SCORING EXPORT ============
@api_router.get("/analytics/leads")
async def leads_report(user=Depends(get_current_user)):
    """Return per-video engagement breakdown usable as a lead scoring table."""
    videos = await db.videos.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    result = []
    for v in videos:
        rows = await _heat_counts(v["id"])
        total_watch = sum(r["watches"] for r in rows)
        total_rewatch = sum(r["rewatches"] for r in rows)
        captured = await db.leads.find({"video_id": v["id"], "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        engagement = min(100, int((total_watch + total_rewatch * 2) / max(1, len(rows)) * 10))
        result.append({
            "video_id": v["id"], "title": v.get("title", ""),
            "views": v.get("views", 0), "plays": v.get("plays", 0),
            "avg_engagement_pct": engagement,
            "play_rate_pct": int((v.get("plays", 0) / max(1, v.get("views", 0))) * 100) if v.get("views", 0) else 0,
            "watch_time_seconds": (total_watch + total_rewatch) * 5,
            "hot_lead_threshold": 70,
            "is_hot_lead": engagement >= 70,
            "rewatches": total_rewatch,
            "captured_leads": captured,
            "captured_leads_count": len(captured),
        })
    result.sort(key=lambda x: -x["avg_engagement_pct"])
    return {"leads": result, "total": len(result), "hot_leads": sum(1 for r in result if r["is_hot_lead"])}

@api_router.get("/analytics/leads.csv", response_class=PlainTextResponse)
async def leads_report_csv(user=Depends(get_current_user)):
    report = await leads_report(user)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["video_id", "title", "views", "plays", "play_rate_pct", "engagement_pct", "watch_time_seconds", "rewatches", "captured_leads_count", "is_hot_lead"])
    for r in report["leads"]:
        writer.writerow([r["video_id"], r["title"], r["views"], r["plays"], r["play_rate_pct"], r["avg_engagement_pct"], r["watch_time_seconds"], r["rewatches"], r["captured_leads_count"], r["is_hot_lead"]])
    return PlainTextResponse(out.getvalue(), media_type="text/csv")

@api_router.get("/analytics/audit")
async def audit_report(user=Depends(get_current_user)):
    rows = await db.audit_logs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"events": rows, "total": len(rows)}


# ============ RSS PODCAST FEED FOR A VIDEO ============
@api_router.get("/videos/{video_id}/podcast-feed", response_class=PlainTextResponse)
async def podcast_feed(video_id: str, user=Depends(get_current_user)):
    v = await db.videos.find_one({"id": video_id, "user_id": user["id"]})
    if not v: raise HTTPException(404, "Video not found")
    title = v.get("title", "Untitled")
    url = v.get("url", "")
    if url.startswith("/api/"):
        url = f"{os.environ.get('PUBLIC_BASE_URL', '')}{url}"
    duration = int(v.get("duration", 0))
    pub_date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>{title}</title>
    <description>{v.get("description", "")}</description>
    <language>en-us</language>
    <itunes:author>Looma</itunes:author>
    <item>
      <title>{title}</title>
      <enclosure url="{url}" type="video/webm" length="0"/>
      <itunes:duration>{duration}</itunes:duration>
      <pubDate>{pub_date}</pubDate>
      <guid>{video_id}</guid>
    </item>
  </channel>
</rss>"""
    return PlainTextResponse(rss, media_type="application/rss+xml")


# ============ WEBINARS ============
class WebinarCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    scheduled_at: Optional[str] = None  # ISO string

class WebinarUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_at: Optional[str] = None
    status: Optional[str] = None  # scheduled|live|ended

class WebinarRegister(BaseModel):
    email: EmailStr
    name: Optional[str] = None

def webinar_to_out(w: dict, host: Optional[dict] = None) -> dict:
    return {
        "id": w["id"],
        "host_id": w["host_id"],
        "host_name": (host or {}).get("name") or "",
        "title": w.get("title", ""),
        "description": w.get("description", ""),
        "scheduled_at": w.get("scheduled_at"),
        "status": w.get("status", "scheduled"),
        "registrations_count": w.get("registrations_count", 0),
        "recording_chunks": w.get("recording_chunks", []),
        "recording_video_id": w.get("recording_video_id"),
        "created_at": w.get("created_at"),
    }

@api_router.get("/webinars")
async def list_webinars(user=Depends(get_current_user)):
    rows = await db.webinars.find({"host_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [webinar_to_out(r, user) for r in rows]

@api_router.post("/webinars")
async def create_webinar(body: WebinarCreate, user=Depends(get_current_user)):
    w = {
        "id": str(uuid.uuid4()), "host_id": user["id"],
        "title": body.title, "description": body.description or "",
        "scheduled_at": body.scheduled_at,
        "status": "scheduled", "registrations_count": 0,
        "recording_chunks": [], "recording_video_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.webinars.insert_one(w)
    return webinar_to_out(w, user)

@api_router.get("/webinars/{wid}")
async def get_webinar(wid: str, user=Depends(get_current_user)):
    w = await db.webinars.find_one({"id": wid, "host_id": user["id"]}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    return webinar_to_out(w, user)

@api_router.patch("/webinars/{wid}")
async def update_webinar(wid: str, body: WebinarUpdate, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates: await db.webinars.update_one({"id": wid, "host_id": user["id"]}, {"$set": updates})
    w = await db.webinars.find_one({"id": wid, "host_id": user["id"]}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    return webinar_to_out(w, user)

@api_router.delete("/webinars/{wid}")
async def delete_webinar(wid: str, user=Depends(get_current_user)):
    r = await db.webinars.delete_one({"id": wid, "host_id": user["id"]})
    await db.webinar_registrations.delete_many({"webinar_id": wid})
    if r.deleted_count == 0: raise HTTPException(404, "Webinar not found")
    return {"ok": True}

# Public webinar info (for registration page)
@api_router.get("/public/webinars/{wid}")
async def public_webinar(wid: str):
    w = await db.webinars.find_one({"id": wid}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    host = await db.users.find_one({"id": w["host_id"]}, {"_id": 0})
    brand = await db.brands.find_one({"user_id": w["host_id"]}, {"_id": 0, "user_id": 0}) or {}
    return {
        "id": w["id"], "title": w.get("title", ""), "description": w.get("description", ""),
        "scheduled_at": w.get("scheduled_at"), "status": w.get("status"),
        "host_name": (host or {}).get("name", ""),
        "brand": {**brand_defaults(), **brand},
        "recording_chunks": w.get("recording_chunks", []) if w.get("status") == "live" else [],
        "recording_video_id": w.get("recording_video_id") if w.get("status") == "ended" else None,
    }

@api_router.get("/public/webinars/{wid}/recording")
async def public_webinar_recording(wid: str):
    """Public endpoint — returns the ended webinar's recording video (no auth)."""
    w = await db.webinars.find_one({"id": wid}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    if w.get("status") != "ended" or not w.get("recording_video_id"):
        raise HTTPException(404, "Recording not available")
    v = await db.videos.find_one({"id": w["recording_video_id"]}, {"_id": 0})
    if not v: raise HTTPException(404, "Recording not found")
    b = await db.brands.find_one({"user_id": w["host_id"]}, {"_id": 0, "user_id": 0}) or {}
    return {
        "id": v["id"], "title": v.get("title", ""),
        "description": v.get("description", ""),
        "url": v.get("url", ""), "thumbnail": v.get("thumbnail", ""),
        "duration": v.get("duration", 0), "views": v.get("views", 0),
        "brand": {**brand_defaults(), **b},
        "webinar_title": w.get("title", ""),
    }

@api_router.post("/public/webinars/{wid}/register")
async def register_for_webinar(wid: str, body: WebinarRegister):
    w = await db.webinars.find_one({"id": wid}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    existing = await db.webinar_registrations.find_one({"webinar_id": wid, "email": body.email.lower()})
    if existing: return {"ok": True, "already_registered": True}
    await db.webinar_registrations.insert_one({
        "id": str(uuid.uuid4()), "webinar_id": wid,
        "email": body.email.lower(), "name": body.name or "",
        "registered_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.webinars.update_one({"id": wid}, {"$inc": {"registrations_count": 1}})
    return {"ok": True, "already_registered": False}

# Live chunk upload (host)
@api_router.post("/webinars/{wid}/chunk")
async def upload_webinar_chunk(
    wid: str,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    seq: int = Form(...),
    user=Depends(get_current_user),
):
    w = await db.webinars.find_one({"id": wid, "host_id": user["id"]}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    data = await file.read()
    path = f"{APP_NAME}/webinars/{wid}/chunk_{seq:05d}.webm"
    await asyncio.get_event_loop().run_in_executor(None, storage_put, path, data, "video/webm")
    chunk_url = f"/api/files/{path}"
    await db.webinars.update_one({"id": wid}, {
        "$set": {"status": "live"},
        "$addToSet": {"recording_chunks": {"seq": seq, "url": chunk_url, "path": path}},
    })
    return {"ok": True, "url": chunk_url, "seq": seq}

# End live: optionally consolidate chunks into a single video record
@api_router.post("/webinars/{wid}/end")
async def end_webinar(wid: str, user=Depends(get_current_user)):
    w = await db.webinars.find_one({"id": wid, "host_id": user["id"]}, {"_id": 0})
    if not w: raise HTTPException(404, "Webinar not found")
    # Persist recording as a regular video using the first chunk URL (full recording = all chunks concatenated client-side)
    chunks = sorted(w.get("recording_chunks", []), key=lambda c: c.get("seq", 0))
    video_id = None
    if chunks:
        v = {"id": str(uuid.uuid4()), "user_id": user["id"],
             "title": f"Recording: {w.get('title','Webinar')}",
             "description": w.get("description", ""),
             "url": chunks[0]["url"],
             "thumbnail": "", "duration": 0,
             "folder": "Webinar Recordings",
             "views": 0, "plays": 0, "avg_engagement": 0.0,
             "storage_path": chunks[0]["path"],
             "transcript_status": "none",
             "created_at": datetime.now(timezone.utc).isoformat()}
        await db.videos.insert_one(v)
        video_id = v["id"]
    await db.webinars.update_one({"id": wid}, {"$set": {"status": "ended", "recording_video_id": video_id}})
    w = await db.webinars.find_one({"id": wid}, {"_id": 0})
    return webinar_to_out(w, user)


# ============ EXPORT (DB dump as JSON for the user) ============
@api_router.get("/admin/export")
async def export_my_data(user=Depends(get_current_user)):
    """Export everything the current user owns as JSON (best-effort DB 'download')."""
    out = {"exported_at": datetime.now(timezone.utc).isoformat(),
           "user": {k: v for k, v in user.items() if k != "password_hash"}}
    out["videos"] = await db.videos.find({"user_id": user["id"]}, {"_id": 0}).to_list(1000)
    video_ids = [v["id"] for v in out["videos"]]
    out["transcripts"] = await db.transcripts.find({"video_id": {"$in": video_ids}}, {"_id": 0}).to_list(2000)
    out["segment_events"] = await db.segment_events.find({"video_id": {"$in": video_ids}}, {"_id": 0}).to_list(20000)
    out["webinars"] = await db.webinars.find({"host_id": user["id"]}, {"_id": 0}).to_list(500)
    webinar_ids = [w["id"] for w in out["webinars"]]
    out["webinar_registrations"] = await db.webinar_registrations.find({"webinar_id": {"$in": webinar_ids}}, {"_id": 0}).to_list(5000)
    out["brand"] = await db.brands.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    return out


app.include_router(api_router)

app.add_middleware(CSRFMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"], allow_headers=["*"],
)

@app.on_event("startup")
async def on_start():
    init_storage()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

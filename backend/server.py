from dotenv import load_dotenv
load_dotenv()

import os
import jwt
import bcrypt
import secrets
import random
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, Response, Depends, APIRouter, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import uuid, pathlib, re
import fal_client

# ---------------- DB ----------------
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

# ---------------- Auth helpers ----------------
JWT_ALGORITHM = "HS256"

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(uid: str, email: str) -> str:
    return jwt.encode({"sub": uid, "email": email, "type": "access",
                       "exp": datetime.now(timezone.utc) + timedelta(minutes=60)},
                      os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)

def create_refresh_token(uid: str) -> str:
    return jwt.encode({"sub": uid, "type": "refresh",
                       "exp": datetime.now(timezone.utc) + timedelta(days=7)},
                      os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)

def set_auth_cookies(resp: Response, access: str, refresh: str):
    resp.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=3600, path="/")
    resp.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            token = h[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(401, "User not found")
        user["id"] = str(user.pop("_id"))
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

# ---------------- Models ----------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UploadIn(BaseModel):
    title: str
    source: str = "upload"  # ai|upload
    ratio: str = "16:9"
    duration_sec: int = 0
    thumbnail: Optional[str] = None

class FavoriteIn(BaseModel):
    upload_id: str

class PresetIn(BaseModel):
    accent_id: Optional[str] = None
    accent_hsl: Optional[str] = None
    accent_on: Optional[str] = None
    theme_id: Optional[str] = None
    icon_style: Optional[str] = None
    lower_third: Optional[str] = None

class ChannelIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    tagline: Optional[str] = ""
    slug: Optional[str] = None
    color: Optional[str] = "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))"
    upload_ids: list[str] = []

class ForgotIn(BaseModel):
    email: EmailStr

class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=6)

class RemixIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)
    style: Optional[str] = "Cozy Tutorial"
    ratio: Optional[str] = "9:16"

# ---------------- Seeding ----------------
SAMPLE_TITLES = [
    "How I priced my first membership tier",
    "Tuesday pep talk for shy creators",
    "Behind the scenes — studio setup",
    "Q&A: taxes, fans, & Friday-payday",
]
GRADIENTS = [
    "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))",
    "linear-gradient(135deg, hsl(170 40% 45%), hsl(152 45% 70%))",
    "linear-gradient(135deg, hsl(45 95% 65%), hsl(8 85% 67%))",
    "linear-gradient(135deg, hsl(170 40% 20%), hsl(170 40% 40%))",
]

async def seed_user_data(user_id: str):
    """Give every new user real, deterministic-but-unique baseline data."""
    rnd = random.Random(user_id)
    now = datetime.now(timezone.utc)
    metrics = {
        "user_id": user_id,
        "earnings_cents": rnd.randint(50000, 800000),
        "views": rnd.randint(2000, 50000),
        "new_fans": rnd.randint(20, 600),
        "streak_days": rnd.randint(1, 14),
        "earnings_delta": rnd.choice(["+8%", "+12%", "+18%", "+21%"]),
        "views_delta": rnd.choice(["+5%", "+9%", "+14%"]),
        "fans_delta": rnd.choice(["+10%", "+15%", "+22%"]),
        "updated_at": now,
    }
    await db.metrics.insert_one(metrics)
    docs = []
    for i, t in enumerate(SAMPLE_TITLES):
        docs.append({
            "user_id": user_id,
            "title": t,
            "source": "ai" if i % 2 == 0 else "upload",
            "ratio": ["16:9", "9:16", "1:1", "16:9"][i],
            "duration_sec": [252, 68, 346, 750][i],
            "views": rnd.randint(500, 6000),
            "thumbnail": GRADIENTS[i],
            "created_at": now - timedelta(days=i, hours=rnd.randint(0, 12)),
        })
    await db.uploads.insert_many(docs)

async def seed_admin():
    email = os.environ["ADMIN_EMAIL"]
    password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": email})
    if existing is None:
        res = await db.users.insert_one({
            "email": email, "password_hash": hash_password(password),
            "name": "Brewly Admin", "role": "admin",
            "created_at": datetime.now(timezone.utc),
        })
        await seed_user_data(str(res.inserted_id))
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})

# ---------------- App ----------------
app = FastAPI()
api = APIRouter(prefix="/api")

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.uploads.create_index("user_id")
    await db.favorites.create_index([("user_id", 1), ("upload_id", 1)], unique=True)
    await db.metrics.create_index("user_id", unique=True)
    await seed_admin()

@api.get("/")
async def root():
    return {"message": "Brewly API"}

# ---------- Auth ----------
def user_public(u: dict) -> dict:
    return {"id": u["id"] if "id" in u else str(u["_id"]), "email": u["email"],
            "name": u.get("name", ""), "role": u.get("role", "user")}

@api.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    res = await db.users.insert_one({
        "email": email, "password_hash": hash_password(body.password),
        "name": body.name, "role": "user",
        "created_at": datetime.now(timezone.utc),
    })
    uid = str(res.inserted_id)
    await seed_user_data(uid)
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": body.name, "role": "user"}

@api.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    # Key on email only — behind k8s ingress request.client.host varies per request
    ident = email
    rec = await db.login_attempts.find_one({"identifier": ident})
    now = datetime.now(timezone.utc)
    if rec and rec.get("count", 0) >= 5 and rec.get("locked_until"):
        lu = rec["locked_until"]
        if lu.tzinfo is None:
            lu = lu.replace(tzinfo=timezone.utc)
        if lu > now:
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        existing = await db.login_attempts.find_one({"identifier": ident})
        new_count = (existing.get("count", 0) if existing else 0) + 1
        update = {"$set": {"count": new_count}}
        if new_count >= 5:
            update["$set"]["locked_until"] = datetime.now(timezone.utc) + timedelta(minutes=15)
        await db.login_attempts.update_one({"identifier": ident}, update, upsert=True)
        raise HTTPException(401, "Invalid email or password")
    await db.login_attempts.delete_one({"identifier": ident})
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return user_public({**user, "id": uid})

@api.post("/auth/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user_public(user)

# ---------- Per-user data ----------
@api.get("/dashboard/metrics")
async def get_metrics(user: dict = Depends(get_current_user)):
    m = await db.metrics.find_one({"user_id": user["id"]}, {"_id": 0})
    if not m:
        await seed_user_data(user["id"])
        m = await db.metrics.find_one({"user_id": user["id"]}, {"_id": 0})
    favs_count = await db.favorites.count_documents({"user_id": user["id"]})
    uploads_count = await db.uploads.count_documents({"user_id": user["id"]})
    return {
        "earnings": f"${m['earnings_cents']/100:,.0f}",
        "views": f"{m['views']/1000:.1f}k" if m["views"] >= 1000 else str(m["views"]),
        "new_fans": m["new_fans"],
        "streak_days": m["streak_days"],
        "earnings_delta": m["earnings_delta"],
        "views_delta": m["views_delta"],
        "fans_delta": m["fans_delta"],
        "favorites_count": favs_count,
        "uploads_count": uploads_count,
    }

def upload_to_dict(u: dict) -> dict:
    return {
        "id": str(u["_id"]),
        "title": u["title"],
        "source": u.get("source", "upload"),
        "ratio": u.get("ratio", "16:9"),
        "duration_sec": u.get("duration_sec", 0),
        "views": u.get("views", 0),
        "thumbnail": u.get("thumbnail", GRADIENTS[0]),
        "video_url": u.get("video_url"),
        "preset": u.get("preset"),
        "created_at": u["created_at"].isoformat() if isinstance(u.get("created_at"), datetime) else str(u.get("created_at", "")),
    }

@api.get("/uploads")
async def list_uploads(user: dict = Depends(get_current_user)):
    docs = await db.uploads.find({"user_id": user["id"]}).sort("created_at", -1).to_list(200)
    return [upload_to_dict(d) for d in docs]

@api.post("/uploads")
async def create_upload(body: UploadIn, user: dict = Depends(get_current_user)):
    doc = {
        "user_id": user["id"], "title": body.title, "source": body.source,
        "ratio": body.ratio, "duration_sec": body.duration_sec,
        "views": 0, "thumbnail": body.thumbnail or GRADIENTS[random.randint(0, 3)],
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.uploads.insert_one(doc)
    doc["_id"] = res.inserted_id
    return upload_to_dict(doc)

@api.delete("/uploads/{upload_id}")
async def delete_upload(upload_id: str, user: dict = Depends(get_current_user)):
    try:
        res = await db.uploads.delete_one({"_id": ObjectId(upload_id), "user_id": user["id"]})
    except Exception:
        raise HTTPException(400, "Invalid id")
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    await db.favorites.delete_many({"user_id": user["id"], "upload_id": upload_id})
    return {"ok": True}

@api.get("/favorites")
async def list_favorites(user: dict = Depends(get_current_user)):
    favs = await db.favorites.find({"user_id": user["id"]}).to_list(500)
    ids = [ObjectId(f["upload_id"]) for f in favs if ObjectId.is_valid(f["upload_id"])]
    docs = await db.uploads.find({"_id": {"$in": ids}}).to_list(500)
    return [upload_to_dict(d) for d in docs]

@api.post("/favorites")
async def add_favorite(body: FavoriteIn, user: dict = Depends(get_current_user)):
    # Validate the upload exists and belongs to the current user
    if not ObjectId.is_valid(body.upload_id):
        raise HTTPException(400, "Invalid upload id")
    upload = await db.uploads.find_one({"_id": ObjectId(body.upload_id), "user_id": user["id"]})
    if not upload:
        raise HTTPException(404, "Upload not found")
    await db.favorites.update_one(
        {"user_id": user["id"], "upload_id": body.upload_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}}, upsert=True)
    return {"ok": True}

@api.delete("/favorites/{upload_id}")
async def remove_favorite(upload_id: str, user: dict = Depends(get_current_user)):
    await db.favorites.delete_one({"user_id": user["id"], "upload_id": upload_id})
    return {"ok": True}

# ---------- File upload (local storage) ----------
UPLOAD_DIR = pathlib.Path("/app/backend/uploads_data")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@api.post("/uploads/file")
async def upload_file(
    file: UploadFile = File(...),
    title: str = Form("Untitled video"),
    ratio: str = Form("16:9"),
    user: dict = Depends(get_current_user),
):
    if not (file.content_type or "").startswith("video/"):
        raise HTTPException(400, "Only video files are accepted")
    ext = pathlib.Path(file.filename or "").suffix.lower() or ".mp4"
    if ext not in [".mp4", ".mov", ".webm", ".m4v"]:
        ext = ".mp4"
    name = f"{user['id']}_{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / name
    size = 0
    with open(path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > 200 * 1024 * 1024:
                f.close(); path.unlink(missing_ok=True)
                raise HTTPException(413, "Max 200MB")
            f.write(chunk)
    video_url = f"/api/uploads/files/{name}"
    doc = {
        "user_id": user["id"], "title": title, "source": "upload",
        "ratio": ratio, "duration_sec": 0, "views": 0,
        "thumbnail": "linear-gradient(135deg, hsl(170 40% 35%), hsl(45 95% 65%))",
        "video_url": video_url, "size_bytes": size,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.uploads.insert_one(doc)
    doc["_id"] = res.inserted_id
    return upload_to_dict(doc)

# ---------- Studio preset per upload ----------
@api.put("/uploads/{upload_id}/preset")
async def save_preset(upload_id: str, body: PresetIn, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(upload_id):
        raise HTTPException(400, "Invalid id")
    res = await db.uploads.update_one(
        {"_id": ObjectId(upload_id), "user_id": user["id"]},
        {"$set": {"preset": body.model_dump(exclude_none=True), "preset_updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True, "preset": body.model_dump(exclude_none=True)}

@api.get("/uploads/{upload_id}/preset")
async def get_preset(upload_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(upload_id):
        raise HTTPException(400, "Invalid id")
    u = await db.uploads.find_one({"_id": ObjectId(upload_id), "user_id": user["id"]})
    if not u:
        raise HTTPException(404, "Not found")
    return u.get("preset") or {}

# ---------- Channels ----------
def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or uuid.uuid4().hex[:8]

def channel_to_dict(c: dict) -> dict:
    return {
        "id": str(c["_id"]),
        "slug": c["slug"],
        "name": c["name"],
        "tagline": c.get("tagline", ""),
        "color": c.get("color", ""),
        "upload_ids": c.get("upload_ids", []),
        "owner_name": c.get("owner_name", ""),
        "created_at": c["created_at"].isoformat() if isinstance(c.get("created_at"), datetime) else "",
    }

@api.get("/channels")
async def list_channels(user: dict = Depends(get_current_user)):
    docs = await db.channels.find({"user_id": user["id"]}).sort("created_at", -1).to_list(100)
    return [channel_to_dict(d) for d in docs]

@api.post("/channels")
async def create_channel(body: ChannelIn, user: dict = Depends(get_current_user)):
    slug = body.slug or slugify(body.name)
    if await db.channels.find_one({"slug": slug}):
        slug = f"{slug}-{uuid.uuid4().hex[:5]}"
    doc = {
        "user_id": user["id"], "owner_name": user.get("name", ""),
        "slug": slug, "name": body.name, "tagline": body.tagline or "",
        "color": body.color, "upload_ids": body.upload_ids,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.channels.insert_one(doc)
    doc["_id"] = res.inserted_id
    return channel_to_dict(doc)

@api.get("/channels/public/{slug}")
async def get_public_channel(slug: str):
    c = await db.channels.find_one({"slug": slug})
    if not c:
        raise HTTPException(404, "Channel not found")
    ids = [ObjectId(x) for x in c.get("upload_ids", []) if ObjectId.is_valid(x)]
    uploads = await db.uploads.find({"_id": {"$in": ids}}).to_list(200) if ids else []
    return {**channel_to_dict(c), "uploads": [upload_to_dict(u) for u in uploads]}

# ---------- Forgot / Reset password (console-log link only) ----------
@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "user_id": str(user["_id"]),
            "token": token,
            "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            "created_at": datetime.now(timezone.utc),
        })
        link = f"{os.environ.get('FRONTEND_URL','')}/reset-password?token={token}"
        print(f"\n[BREWLY] Password reset link for {email}:\n  {link}\n", flush=True)
    return {"ok": True}

@api.post("/auth/reset-password")
async def reset_password(body: ResetIn):
    rec = await db.password_reset_tokens.find_one({"token": body.token})
    if not rec or rec.get("used"):
        raise HTTPException(400, "Invalid or expired token")
    exp = rec["expires_at"]
    if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(400, "Token expired")
    await db.users.update_one({"_id": ObjectId(rec["user_id"])},
                              {"$set": {"password_hash": hash_password(body.password)}})
    await db.password_reset_tokens.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
    return {"ok": True}

# ---------- Remix (fal.ai) ----------
@api.post("/remix/generate")
async def remix_generate(body: RemixIn, user: dict = Depends(get_current_user)):
    """Use fal.ai text-to-video to generate a short clip from a prompt + style."""
    full_prompt = f"{body.prompt}. Style: {body.style}. Vertical short-form, cozy editorial mood."
    try:
        handler = await fal_client.submit_async(
            "fal-ai/minimax/video-01",
            arguments={"prompt": full_prompt[:500], "prompt_optimizer": True},
        )
        result = await handler.get()
        video_url = (result.get("video") or {}).get("url") if isinstance(result, dict) else None
        if not video_url:
            raise HTTPException(502, "Generation succeeded but no video URL returned")
        # Save as upload
        doc = {
            "user_id": user["id"],
            "title": body.prompt[:80],
            "source": "ai",
            "ratio": body.ratio,
            "duration_sec": 6,
            "views": 0,
            "thumbnail": "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))",
            "video_url": video_url,
            "remix_meta": {"style": body.style, "model": "fal-ai/minimax/video-01"},
            "created_at": datetime.now(timezone.utc),
        }
        res = await db.uploads.insert_one(doc)
        doc["_id"] = res.inserted_id
        return upload_to_dict(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"fal.ai error: {e}")

# ---------------- Mount ----------------
app.include_router(api)
app.mount("/api/uploads/files", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

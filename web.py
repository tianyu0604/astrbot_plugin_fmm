import asyncio
import hmac
import json
import logging
import secrets
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from aiohttp import web

from .store import require
from .legacy import register_legacy_routes

API = "/api/v1/fmm"
logger = logging.getLogger(__name__)


def result(data=None):
    return web.json_response({"code": 200, "msg": "成功", "data": data})


def password_for(data_dir, configured=""):
    if configured:
        require(len(configured) >= 12, "管理密码至少需要 12 位")
        return configured
    path = Path(data_dir) / "admin_password.txt"
    if path.exists():
        password = path.read_text(encoding="utf-8").strip()
        require(len(password) >= 12, "admin_password.txt 中的密码至少需要 12 位")
        return password
    password = secrets.token_urlsafe(24)
    path.write_text(password + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return password


def create_app(service, data_dir, password, static_dir=None, sync=None):
    data_dir = Path(data_dir)
    uploads = data_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    static_dir = Path(static_dir or Path(__file__).parent / "web")
    sessions = {}
    failures = {}

    @web.middleware
    async def boundary(request, handler):
        try:
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                origin = request.headers.get("Origin")
                if origin and urlsplit(origin).netloc != request.host:
                    raise web.HTTPForbidden(text="跨站请求被拒绝")
                require(request.content_type == "application/json", "请求需要使用 JSON")
            if request.path.startswith(API + "/") and request.path != API + "/login":
                token = request.cookies.get("fmm_session", "")
                if sessions.get(token, 0) <= time.monotonic():
                    sessions.pop(token, None)
                    raise web.HTTPUnauthorized(text="请先登录")
            response = await handler(request)
        except ValueError as exc:
            response = web.json_response({"code": 400, "msg": str(exc)}, status=400)
        except web.HTTPException as exc:
            response = web.json_response({"code": exc.status, "msg": exc.text}, status=exc.status)
        except (KeyError, TypeError, AttributeError, json.JSONDecodeError):
            response = web.json_response({"code": 400, "msg": "请求数据格式错误"}, status=400)
        except Exception:
            logger.exception("FMM API failure")
            response = web.json_response({"code": 500, "msg": "服务器内部错误，请检查插件日志"}, status=500)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        return response

    app = web.Application(middlewares=[boundary], client_max_size=8 * 1024 * 1024)

    async def login(request):
        now = time.monotonic()
        for key in list(failures):
            failures[key] = [t for t in failures[key] if now - t < 300]
            if not failures[key]:
                del failures[key]
        peer = request.remote or "unknown"
        attempts = failures.setdefault(peer, [])
        if len(attempts) >= 8 or sum(map(len, failures.values())) >= 100:
            raise web.HTTPTooManyRequests(text="登录尝试过多，请稍后重试")
        body = await request.json()
        supplied = body.get("password", "")
        if not isinstance(supplied, str) or not hmac.compare_digest(supplied.encode(), password.encode()):
            attempts.append(now)
            raise web.HTTPUnauthorized(text="密码错误")
        for key in list(sessions):
            if sessions[key] < now:
                del sessions[key]
        token = secrets.token_urlsafe(32)
        sessions[token] = now + 8 * 3600
        response = result()
        response.set_cookie("fmm_session", token, httponly=True, samesite="Strict", secure=request.secure,
                            max_age=8 * 3600, path="/")
        return response

    async def logout(request):
        sessions.pop(request.cookies.get("fmm_session", ""), None)
        response = result()
        response.del_cookie("fmm_session", path="/")
        return response

    async def state(request):
        return result(await service.state())

    async def members(request):
        if request.method == "POST":
            body = await request.json()
            await service.call("save_members", body.get("members"), body.get("id"), body.get("reason", ""))
        return result(await service.call("members"))

    async def delete_member(request):
        await service.call("delete_member", request.match_info["key"])
        return result()

    async def history(request):
        return result(await service.call("history", request.match_info["key"]))

    async def fields(request):
        return result({"customFields": await service.call("fields")})

    async def save_fields(request):
        body = await request.json()
        await service.call("save_fields", body.get("operations"))
        return result()

    async def save_rule(request):
        body = await request.json()
        platforms = await service.platforms()
        require(any(p["id"] == body.get("platform_id") for p in platforms), "机器人账号不可用，请检查 OneBot 连接配置")
        saved = await service.call("save_rule", body, request.match_info.get("key"))
        await service.reschedule()
        return result(saved)

    async def delete_rule(request):
        await service.call("delete_rule", request.match_info["key"])
        await service.reschedule()
        return result()

    async def test_rule(request):
        key = await service.dispatch(request.match_info["key"], test=True)
        require(key is not None, "排班不存在或插件正在关闭")
        return result(next(r for r in await service.call("logs") if r["id"] == key))

    async def resolve(request):
        body = await request.json()
        action = body.get("action")
        require(action in ("sent", "skipped"), "只能确认已发送或跳过本次")
        key = request.match_info["key"]
        async with service.lock:
            run = await asyncio.to_thread(service.store.run, key)
            require(run is not None and run["status"] in ("failed", "unknown"), "该记录无需人工处理")
            await asyncio.to_thread(service.store.finish, key, action, "管理员确认已发送" if action == "sent" else "管理员跳过；保留原轮换位置")
        return result()

    async def upload(request):
        import base64
        body = await request.json()
        try:
            data = base64.b64decode(body.get("data", ""), validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError("图片编码无效") from exc
        require(0 < len(data) <= 2 * 1024 * 1024, "图片不能超过 2MB")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            suffix = ".png"
        elif data.startswith(b"\xff\xd8\xff"):
            suffix = ".jpg"
        elif data[:6] in (b"GIF87a", b"GIF89a"):
            suffix = ".gif"
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            suffix = ".webp"
        else:
            raise ValueError("仅支持 PNG、JPEG、GIF、WebP 图片")
        name = uuid4().hex + suffix
        await asyncio.to_thread((uploads / name).write_bytes, data)
        return result({"url": API + "/images/" + name})

    async def image(request):
        name = request.match_info["name"]
        require(len(name.split(".")[0]) == 32 and all(c in "0123456789abcdef" for c in name.split(".")[0])
                and Path(name).suffix in (".png", ".jpg", ".gif", ".webp"), "图片路径无效")
        path = uploads / name
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    async def backup(request):
        # SQLite backup includes committed WAL content, unlike copying only the .db file.
        with tempfile.TemporaryDirectory(prefix="fmm-backup-") as folder:
            path = Path(folder) / "fmm.sqlite3"
            await service.call("backup", path)
            content = await asyncio.to_thread(path.read_bytes)
        return web.Response(body=content, content_type="application/octet-stream",
                            headers={"Content-Disposition": 'attachment; filename="fmm-backup.sqlite3"'})

    async def frontend(request):
        tail = request.match_info.get("tail", "")
        if tail.startswith("api/"):
            raise web.HTTPNotFound()
        candidate = (static_dir / (tail or "index.html")).resolve()
        if not candidate.is_relative_to(static_dir.resolve()) or not candidate.is_file():
            raise web.HTTPNotFound(text="未找到页面，请先构建插件前端")
        return web.FileResponse(candidate)

    app.router.add_post(API + "/login", login)
    app.router.add_post(API + "/logout", logout)
    app.router.add_get(API + "/state", state)
    app.router.add_get(API + "/members", members)
    app.router.add_post(API + "/members", members)
    app.router.add_delete(API + "/members/{key}", delete_member)
    app.router.add_get(API + "/members/{key}/history", history)
    app.router.add_get(API + "/archive_field/getCustomFields", fields)
    app.router.add_post(API + "/archive_field/saveChanges", save_fields)
    app.router.add_post(API + "/rules", save_rule)
    app.router.add_put(API + "/rules/{key}", save_rule)
    app.router.add_delete(API + "/rules/{key}", delete_rule)
    app.router.add_post(API + "/rules/{key}/test", test_rule)
    app.router.add_post(API + "/runs/{key}/resolve", resolve)
    app.router.add_post(API + "/upload", upload)
    app.router.add_get(API + "/images/{name}", image)
    app.router.add_get(API + "/backup", backup)
    async def sync_groups(request):
        require(sync is not None, "当前环境不支持同步（独立预览模式）")
        return result(await sync.groups(request.query.get("platform_id")))

    async def sync_preview(request):
        require(sync is not None, "当前环境不支持同步（独立预览模式）")
        body = await request.json() if request.method == "POST" else {}
        return result(await sync.preview(body.get("group_id"), body.get("platform_id")))

    async def sync_apply(request):
        require(sync is not None, "当前环境不支持同步（独立预览模式）")
        body = await request.json()
        outcome = await sync.apply(body)
        if outcome.get("stale"):
            # 确认前后群里变了：不按旧名单动手，把新差异丢回去让人再看一眼
            return web.json_response({"code": 409, "msg": "群成员刚刚有变化，请重新确认要同步的内容",
                                      "data": outcome["plan"]}, status=409)
        return result(outcome)

    app.router.add_get(API + "/sync/groups", sync_groups)
    app.router.add_post(API + "/sync/preview", sync_preview)
    app.router.add_post(API + "/sync/apply", sync_apply)
    register_legacy_routes(app, service, API, result)
    app.router.add_get("/{tail:.*}", frontend)
    return app

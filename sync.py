"""群成员档案同步。

「同步」永远分两步：先 preview 算出群成员与现有档案的差异（只读，不落库、不下载图片），
人看过确认了再 apply 落库。apply 会重算一遍差异并比对指纹——两次之间群里有任何变动就
拒绝执行并让人重新确认，避免按已经过期的名单动手。
"""

import asyncio
import hashlib
import json
import re
import urllib.request
from pathlib import Path
from uuid import uuid4

from .store import QQ, now_iso, require

AVATAR = "https://q1.qlogo.cn/g?b=qq&nk={qq}&s=640"
MAGIC = ((b"\xff\xd8\xff", ".jpg"), (b"\x89PNG\r\n\x1a\n", ".png"),
         (b"GIF87a", ".gif"), (b"GIF89a", ".gif"), (b"RIFF", ".webp"))
CLASS_RE = re.compile(r"^([\u4e00-\u9fa5]{2,6})\s*(\d{4})\s*(.*)$")
MARK_RE = re.compile(r"[\[［][^\]］]*[\]］]\s*$")
PAREN_RE = re.compile(r"[\(（][^\)）]*[\)）]")
SEX = {"male": "男", "female": "女", "unknown": "未知"}
DEPARTED = ("retire", "delete", "keep")
CLASS_NAMES = ("专业班级", "班级")


def parse_card(card, nickname):
    """群名片 → (姓名, 专业班级)。'数管2602周晨希（粥粥）[P]' → ('周晨希', '数管2602')"""
    text = (card or "").strip()
    if not text:
        return (nickname or "").strip()[:50], ""
    while True:
        mark = MARK_RE.search(text)
        if not mark:
            break
        text = text[:mark.start()].strip()
    cls, rest = "", text
    matched = CLASS_RE.match(text)
    if matched:
        cls, rest = matched.group(1) + matched.group(2), matched.group(3).strip()
    paren = PAREN_RE.search(rest)
    name = (rest[:paren.start()] if (paren and paren.start() > 0) else rest).strip()
    name = re.sub(r"^班[\s\u3000]*", "", name).strip()
    name = re.sub(r"\s+", " ", name)[:50]
    return (name or text[:50]), cls


def normalize(members, bot_qq=""):
    """OneBot 群成员列表 → 档案项。跳过机器人和 QQ 号不合规的。"""
    items, skipped = [], []
    for member in members:
        qq = str(member.get("user_id", "")).strip()
        if bot_qq and qq == str(bot_qq):
            skipped.append({"qq": qq, "reason": "机器人自己的账号"})
            continue
        if not QQ.fullmatch(qq):
            skipped.append({"qq": qq, "reason": "QQ 号不符合档案规则（5-12 位，不以 0 开头）"})
            continue
        name, cls = parse_card(member.get("card"), member.get("nickname"))
        if not 1 <= len(name) <= 50:
            skipped.append({"qq": qq, "reason": "解析出的姓名长度不合法"})
            continue
        items.append({"qq": qq, "name": name, "cls": cls,
                      "sex": SEX.get(member.get("sex"), "未知"),
                      "nickname": str(member.get("nickname") or "")[:50]})
    return items, skipped


def fingerprint(plan):
    """差异的指纹：确认前后只要群成员或档案变了，指纹就不一样。"""
    core = {
        "group": plan["group_id"],
        "added": sorted((x["qq"], x["name"], x["cls"]) for x in plan["added"]),
        "changed": sorted((x["qq"], x["name"], x["cls"],
                           sorted((c["field"], c["old"], c["new"]) for c in x["changes"]))
                          for x in plan["changed"]),
        "departed": sorted((x["qq"], x["name"]) for x in plan["departed"]),
    }
    blob = json.dumps(core, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


class SyncService:
    """由插件注入取值函数：fetch(platform_id, group_id)、groups_of(platform_id)、bot_qq(platform_id)。"""

    def __init__(self, store, config, fetch=None, groups_of=None, bot_qq=None,
                 uploads=None, image_prefix=""):
        self.store = store
        self.config = config
        self.fetch = fetch
        self.groups_of = groups_of
        self.bot_qq_of = bot_qq
        self.uploads = Path(uploads) if uploads else Path(".")
        self.image_prefix = image_prefix
        self.lock = asyncio.Lock()

    # ---------- 小工具 ----------

    def _enabled(self):
        require(self.fetch is not None, "当前环境不支持同步（独立预览模式）")

    def class_field(self):
        """专业班级写进哪个自定义字段：配置指定，否则自动找名为「专业班级」的字段。"""
        want = str(self.config.get("sync_class_field") or "").strip()
        fields = self.store.fields()
        if want:
            return want if any(f["id"] == want for f in fields) else ""
        for field in fields:
            if str(field.get("name", "")).strip() in CLASS_NAMES:
                return field["id"]
        return ""

    def _member(self, key):
        return next((m for m in self.store.members() if m["id"] == key), None)

    async def _bot_qq(self, platform_id):
        if self.bot_qq_of is None:
            return ""
        try:
            return str(await self.bot_qq_of(platform_id) or "")
        except Exception:
            return ""

    def _save_avatar(self, qq):
        """下载头像并存进插件自己的上传目录，返回站内 URL。"""
        request = urllib.request.Request(AVATAR.format(qq=qq), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        require(0 < len(data) <= 2 * 1024 * 1024, "头像超过 2MB")
        suffix = None
        for magic, ext in MAGIC:
            if data.startswith(magic) and (ext != ".webp" or data[8:12] == b"WEBP"):
                suffix = ext
                break
        require(suffix, "头像不是受支持的图片格式")
        name = uuid4().hex + suffix
        self.uploads.mkdir(parents=True, exist_ok=True)
        (self.uploads / name).write_bytes(data)
        return self.image_prefix + name

    async def avatar(self, qq, fallback=""):
        try:
            return await asyncio.to_thread(self._save_avatar, qq), ""
        except Exception as exc:
            if fallback:
                return fallback, ""
            return AVATAR.format(qq=qq), "头像下载失败：" + str(exc)[:60]

    # ---------- 对外三步 ----------

    async def groups(self, platform_id=None):
        self._enabled()
        rows = await self.groups_of(platform_id)
        out = [{"id": str(g.get("group_id", "")), "name": str(g.get("group_name", "")),
                "count": g.get("member_count")} for g in rows]
        out = [g for g in out if QQ.fullmatch(g["id"])]
        out.sort(key=lambda g: g["name"])
        return {"groups": out, "default": str(self.config.get("sync_group_id") or "").strip(),
                "class_field": self.class_field(), "class_field_name": self._class_field_name()}

    def _class_field_name(self):
        key = self.class_field()
        field = next((f for f in self.store.fields() if f["id"] == key), None)
        return str(field.get("name", "")) if field else ""

    async def preview(self, group_id, platform_id=None):
        self._enabled()
        group_id = str(group_id or "").strip()
        require(QQ.fullmatch(group_id), "群号格式不对")
        try:
            info, raw = await self.fetch(platform_id, group_id)
        except Exception as exc:
            raise ValueError("读取群成员失败：" + str(exc)[:150]) from exc
        require(isinstance(raw, list) and raw, "没有读到任何群成员，已中止（避免误判成全员退群）")
        items, skipped = normalize(raw, await self._bot_qq(platform_id))
        require(items, "群成员里没有一个可用的 QQ 号，已中止")

        field_id = self.class_field()
        current = {}
        for member in self.store.members():
            current[str(member["data"].get("qq", ""))] = member

        added, changed, unchanged = [], [], 0
        for item in items:
            member = current.get(item["qq"])
            if member is None:
                added.append(dict(item, avatar=AVATAR.format(qq=item["qq"])))
                continue
            data = member["data"]
            changes = []
            if item["name"] and data.get("name") != item["name"]:
                changes.append({"field": "姓名", "old": str(data.get("name", "")), "new": item["name"]})
            old_cls = str(data.get(field_id, "") or "") if field_id else ""
            if field_id and item["cls"] and old_cls != item["cls"]:
                changes.append({"field": "专业班级", "old": old_cls, "new": item["cls"]})
            if str(data.get("status", "")) != "在职":
                changes.append({"field": "状态", "old": str(data.get("status", "")), "new": "在职（已回群）"})
            if not data.get("photo"):
                changes.append({"field": "照片", "old": "无", "new": "补头像"})
            if changes:
                changed.append({"id": member["id"], "qq": item["qq"], "name": item["name"],
                                "cls": item["cls"], "avatar": AVATAR.format(qq=item["qq"]),
                                "changes": changes})
            else:
                unchanged += 1

        incoming = {item["qq"] for item in items}
        departed, retired_absent = [], []
        for qq, member in current.items():
            if qq in incoming:
                continue
            data = member["data"]
            row = {"id": member["id"], "qq": qq, "name": str(data.get("name", "")),
                   "cls": str(data.get(field_id, "") or "") if field_id else "",
                   "status": str(data.get("status", "")),
                   "photo": str(data.get("photo", ""))}
            # 已经处理过的退群（光荣退休/劝退）不再反复拿出来让人确认
            (retired_absent if row["status"] in ("光荣退休", "劝退") else departed).append(row)

        plan = {
            "group_id": group_id, "group_name": str(info.get("group_name", "")),
            "group_member_count": info.get("member_count", len(items) + len(skipped)),
            "profile_count": len(current), "class_field": field_id,
            "class_field_name": self._class_field_name(),
            "added": added, "changed": changed, "departed": departed,
            "retired_absent": retired_absent, "retired_absent_count": len(retired_absent),
            "unchanged": unchanged, "skipped": skipped,
            # 退群人数达到档案的一半以上（且不少于 3 人）就直接标红，防止把「读错了群」变成一次大清洗
            "suspicious": bool(current) and len(departed) >= max(3, len(current) // 2),
            "server_time": now_iso(),
        }
        plan["fingerprint"] = fingerprint(plan)
        return plan

    async def apply(self, payload):
        self._enabled()
        require(isinstance(payload, dict), "请求格式错误")
        platform_id = payload.get("platform_id")
        action = str(payload.get("departed") or "retire")
        require(action in DEPARTED, "退群处理方式无效")
        refresh = bool(payload.get("refresh_photos"))
        async with self.lock:
            plan = await self.preview(payload.get("group_id"), platform_id)
            if str(payload.get("fingerprint") or "") != plan["fingerprint"]:
                return {"stale": True, "plan": plan}
            if plan["suspicious"] and not payload.get("force"):
                raise ValueError("本次退群人数异常多，请确认群号是否选错，再点一次确认")

            field_id = plan["class_field"]
            done = {"added": [], "changed": [], "departed": [], "photos": 0, "failed": []}

            async def photo_for(qq, fallback=""):
                url, why = await self.avatar(qq, fallback)
                if url.startswith(self.image_prefix):
                    done["photos"] += 1
                elif why:
                    done["failed"].append({"qq": qq, "why": why})
                return url

            for item in plan["added"]:
                try:
                    entry = {"name": item["name"], "qq": item["qq"],
                             "gender": item.get("sex") or "未知", "status": "在职",
                             "photo": await photo_for(item["qq"])}
                    if field_id and item["cls"]:
                        entry[field_id] = item["cls"]
                    self.store.save_members([entry])
                    done["added"].append({"name": item["name"], "qq": item["qq"]})
                except Exception as exc:
                    done["failed"].append({"qq": item["qq"], "why": str(exc)[:120]})

            for item in plan["changed"]:
                try:
                    member = self._member(item["id"])
                    require(member, "成员已不存在")
                    data = dict(member["data"])
                    data.update({"name": item["name"], "qq": item["qq"], "status": "在职"})
                    data.setdefault("gender", "未知")
                    if field_id and item["cls"]:
                        data[field_id] = item["cls"]
                    old_photo = str(data.get("photo") or "")
                    if refresh or not old_photo or old_photo.startswith("http"):
                        data["photo"] = await photo_for(item["qq"], old_photo)
                    self.store.save_members([data], item["id"], "群成员同步")
                    done["changed"].append({"name": item["name"], "qq": item["qq"]})
                except Exception as exc:
                    done["failed"].append({"qq": item["qq"], "why": str(exc)[:120]})

            for item in plan["departed"]:
                if action == "keep":
                    continue
                try:
                    if action == "delete":
                        self.store.delete_member(item["id"])
                        done["departed"].append({"name": item["name"], "qq": item["qq"], "action": "删除档案"})
                        continue
                    member = self._member(item["id"])
                    require(member, "成员已不存在")
                    data = dict(member["data"])
                    data["status"] = "光荣退休"
                    self.store.save_members([data], item["id"], "已退出群聊")
                    done["departed"].append({"name": item["name"], "qq": item["qq"], "action": "标记为光荣退休"})
                except Exception as exc:
                    done["failed"].append({"qq": item["qq"], "why": str(exc)[:120]})

            after = await self.preview(payload.get("group_id"), platform_id)
        return {"stale": False, "done": done, "added": len(done["added"]),
                "changed": len(done["changed"]), "departed": len(done["departed"]),
                "photos": done["photos"], "failed": done["failed"],
                "left": {"added": len(after["added"]), "changed": len(after["changed"]),
                         "departed": len(after["departed"]), "unchanged": after["unchanged"],
                         "retired_absent": len(after["retired_absent"])}}

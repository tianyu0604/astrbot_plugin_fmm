"""SQLite persistence. Each operation owns a short-lived connection/transaction."""

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
QQ = re.compile(r"[1-9][0-9]{4,11}\Z")
FIELD_TYPES = {"text", "radio", "date", "number", "images"}


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            require(version <= 1, "数据库版本高于当前插件版本，请升级插件")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS members (
                    id TEXT PRIMARY KEY, qq TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS fields (id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS documents (
                    kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (kind, id)
                );
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY, member_id TEXT NOT NULL, data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rules (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
                    revision INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, day TEXT NOT NULL,
                    kind TEXT NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL,
                    error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, message_id TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS runs_daily ON runs(rule_id, day)
                    WHERE kind='scheduled';
                CREATE INDEX IF NOT EXISTS runs_status ON runs(rule_id, status);
                PRAGMA user_version=1;
            """)
            # A process exit between dispatch and commit is not evidence of non-delivery.
            db.execute("UPDATE runs SET status='unknown', error=? WHERE status='sending'",
                       ("插件重启，发送结果未确认；请先检查群消息",))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def members(self):
        with self.connect() as db:
            return [dict(id=r["id"], data=json.loads(r["data"]), createdAt=r["created_at"],
                         updatedAt=r["updated_at"]) for r in db.execute("SELECT * FROM members ORDER BY created_at, id")]

    def documents(self, kind):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute(
                "SELECT data FROM documents WHERE kind=? ORDER BY rowid DESC", (kind,))]

    def save_document(self, kind, key, data):
        require(isinstance(data, dict), "数据格式错误")
        encoded = json.dumps(data)
        require(len(encoded) <= 2_000_000, "数据过大，请减少记录后再保存")
        with self.connect() as db:
            db.execute("INSERT INTO documents VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
                       (kind, key, encoded))

    def delete_document(self, kind, key):
        with self.connect() as db:
            require(db.execute("DELETE FROM documents WHERE kind=? AND id=?", (kind, key)).rowcount,
                    "记录不存在")

    @staticmethod
    def validate_member(data):
        require(isinstance(data, dict), "成员数据格式错误")
        data = dict(data)
        data["name"] = str(data.get("name", "")).strip()
        data["qq"] = str(data.get("qq", "")).strip()
        require(1 <= len(data["name"]) <= 50, "姓名需要 1 到 50 个字")
        require(QQ.fullmatch(data["qq"]), "QQ 号必填，需要 5 到 12 位数字，且不能以 0 开头")
        require(data.get("gender") in ("男", "女", "未知"), "性别无效")
        require(data.get("status") in ("在职", "劝退", "光荣退休"), "成员状态无效")
        return data

    def save_members(self, entries, member_id=None, reason=""):
        require(isinstance(entries, list) and 0 < len(entries) <= 1000, "每次需要提交 1 到 1000 位成员")
        validated = [self.validate_member(e) for e in entries]
        require(member_id is None or len(validated) == 1, "编辑只能提交一位成员")
        stamp = now_iso()
        try:
            with self.connect() as db:
                for data in validated:
                    key = member_id or uuid4().hex
                    if member_id:
                        old = db.execute("SELECT data FROM members WHERE id=?", (key,)).fetchone()
                        require(old is not None, "成员不存在")
                        require(str(reason).strip(), "编辑成员需要填写修改原因")
                        record = {"id": uuid4().hex, "memberId": key, "timestamp": stamp,
                                  "editor": "管理员", "reason": str(reason)[:500], "changes": []}
                        before = json.loads(old["data"])
                        for field in before.keys() | data.keys():
                            if before.get(field) != data.get(field):
                                record["changes"].append({"field": field, "oldValue": before.get(field),
                                                          "newValue": data.get(field)})
                        db.execute("INSERT INTO history VALUES (?,?,?)", (record["id"], key, json.dumps(record)))
                        db.execute("UPDATE members SET qq=?,data=?,updated_at=? WHERE id=?",
                                   (data["qq"], json.dumps(data), stamp, key))
                    else:
                        db.execute("INSERT INTO members VALUES (?,?,?,?,?)",
                                   (key, data["qq"], json.dumps(data), stamp, stamp))
        except sqlite3.IntegrityError as exc:
            raise ValueError("QQ 号已被使用，本次提交未保存，请检查重复 QQ 号") from exc

    def delete_member(self, key):
        with self.connect() as db:
            for row in db.execute("SELECT data FROM rules"):
                require(key not in json.loads(row[0])["pool"], "成员仍在排班人员池中，请先从排班移除")
            require(db.execute("DELETE FROM members WHERE id=?", (key,)).rowcount == 1, "成员不存在")

    def history(self, key):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute(
                "SELECT data FROM history WHERE member_id=? ORDER BY rowid DESC", (key,))]

    def fields(self):
        with self.connect() as db:
            fields = [json.loads(r[0]) for r in db.execute("SELECT data FROM fields")]
        members = self.members()
        for field in fields:
            field["used"] = any(m["data"].get(field["id"]) not in (None, "", []) for m in members)
        return sorted(fields, key=lambda f: f["displayOrder"])

    def save_fields(self, operations):
        require(isinstance(operations, list), "字段操作格式错误")
        fields = {f["id"]: f for f in self.fields()}
        for op in operations:
            kind, key = op.get("opType"), op.get("id")
            if kind == "create":
                require(key and key not in fields, "字段 ID 重复或为空")
                fields[key] = {"id": key, "name": op.get("name"), "type": op.get("type"),
                               "options": op.get("options", []), "hidden": False, "used": False,
                               "isDeleted": False, "displayOrder": len(fields)}
            elif kind == "update":
                require(key in fields, "字段不存在")
                for prop in ("name", "type", "options"):
                    if prop in op:
                        fields[key][prop] = op[prop]
                if "action" in op:
                    fields[key]["hidden"] = op["action"] == "hide"
            elif kind == "delete":
                require(key in fields, "字段不存在")
                if op.get("action") == "hide" or fields[key]["used"]:
                    fields[key]["hidden"] = True
                else:
                    del fields[key]
            elif kind == "reorder":
                for item in op.get("orders", []):
                    require(item["id"] in fields, "排序字段不存在")
                    fields[item["id"]]["displayOrder"] = int(item["displayOrder"])
            else:
                raise ValueError("不支持的字段操作")
        for f in fields.values():
            require(isinstance(f["name"], str) and 1 <= len(f["name"].strip()) <= 30, "字段名称无效")
            require(f["name"] not in ("QQ号", "QQ号*", "姓名", "性别", "状态") and f["id"] not in ("qq", "name", "gender", "status", "photo"), "不能覆盖内置字段")
            require(f["type"] in FIELD_TYPES, "字段类型无效")
            require(isinstance(f["options"], list) and all(isinstance(o, str) for o in f["options"]), "字段选项无效")
        with self.connect() as db:
            db.execute("DELETE FROM fields")
            db.executemany("INSERT INTO fields VALUES (?,?)", [(k, json.dumps(v)) for k, v in fields.items()])

    def rules(self):
        with self.connect() as db:
            return [dict(json.loads(r["data"]), id=r["id"], cursor=r["cursor"], revision=r["revision"])
                    for r in db.execute("SELECT * FROM rules ORDER BY rowid")]

    def rule(self, key):
        return next((r for r in self.rules() if r["id"] == key), None)

    def save_rule(self, data, key=None):
        require(isinstance(data, dict), "排班格式错误")
        name = str(data.get("name", "")).strip()
        platform = str(data.get("platform_id", "")).strip()
        group = str(data.get("group_id", "")).strip()
        at = str(data.get("time", ""))
        weekdays = data.get("weekdays", [])
        pool = data.get("pool", [])
        count = data.get("count", 1)
        require(1 <= len(name) <= 50, "排班名称需要 1 到 50 个字")
        require(platform and len(platform) <= 100 and ":" not in platform, "请选择有效机器人账号")
        require(QQ.fullmatch(group), "请输入有效 QQ 群号")
        require(re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", at), "提醒时间无效")
        require(isinstance(weekdays, list) and weekdays and all(type(d) is int and 0 <= d <= 6 for d in weekdays), "至少选择一个执行星期")
        require(isinstance(pool, list) and pool and all(isinstance(m, str) for m in pool) and len(set(pool)) == len(pool), "人员池不能为空或重复")
        require(type(count) is int and 1 <= count <= len(pool), "每次提醒人数需在 1 和人员池大小之间")
        active = {m["id"] for m in self.members() if m["data"]["status"] == "在职"}
        require(all(m in active for m in pool), "人员池只能选择在职且 QQ 号完整的成员")
        try:
            start = datetime.strptime(str(data.get("start_date", "")), "%Y-%m-%d").date().isoformat()
        except ValueError as exc:
            raise ValueError("开始日期无效") from exc
        message = str(data.get("message", ""))
        require(len(message) <= 2000, "附加文案不能超过 2000 字")
        require(type(data.get("enabled", False)) is bool, "启用状态无效")
        saved = {"name": name, "platform_id": platform, "group_id": group, "time": at,
                 "weekdays": sorted(set(weekdays)), "pool": pool, "count": count,
                 "start_date": start, "message": message, "enabled": data.get("enabled", False)}
        with self.connect() as db:
            if key:
                old = db.execute("SELECT * FROM rules WHERE id=?", (key,)).fetchone()
                require(old is not None, "排班不存在")
                require(data.get("revision") == old["revision"], "排班已更新，请刷新后再编辑")
                require(not db.execute("SELECT 1 FROM runs WHERE rule_id=? AND kind='scheduled' AND status IN ('sending','failed','unknown')", (key,)).fetchone(), "存在未处理的发送记录，请先处理后再修改排班")
                previous = json.loads(old["data"])["pool"]
                next_id = previous[old["cursor"] % len(previous)]
                cursor = pool.index(next_id) if next_id in pool else 0
                db.execute("UPDATE rules SET data=?,cursor=?,revision=revision+1 WHERE id=?",
                           (json.dumps(saved), cursor, key))
            else:
                key = uuid4().hex
                db.execute("INSERT INTO rules (id,data) VALUES (?,?)", (key, json.dumps(saved)))
        return self.rule(key)

    def delete_rule(self, key):
        with self.connect() as db:
            require(not db.execute("SELECT 1 FROM runs WHERE rule_id=? AND kind='scheduled' AND status IN ('sending','failed','unknown')", (key,)).fetchone(), "请先处理未确认的发送记录")
            require(db.execute("DELETE FROM rules WHERE id=?", (key,)).rowcount == 1, "排班不存在")

    def selection(self, rule):
        members = {m["id"]: m for m in self.members()}
        pool = rule["pool"]
        # Scan in original pool order so departures do not silently reset rotation.
        selected, end = [], rule["cursor"]
        for offset in range(len(pool)):
            index = (rule["cursor"] + offset) % len(pool)
            member = members.get(pool[index])
            if member and member["data"]["status"] == "在职":
                selected.append(member)
                end = (index + 1) % len(pool)
                if len(selected) == rule["count"]:
                    return selected, end
        raise ValueError("人员池中的在职成员不足，请调整人员池或每次提醒人数")

    def claim(self, key, day, test=False):
        rule = self.rule(key)
        require(rule is not None, "排班不存在")
        selected, cursor = self.selection(rule)
        text = rule["message"].replace("{date}", day).replace("{names}", "、".join(m["data"]["name"] for m in selected)).replace("{schedule}", rule["name"])
        if test:
            text = "[测试提醒，不推进轮换]\n" + text
        snapshot = {"rule": rule, "members": selected, "next_cursor": cursor, "text": text}
        run = {"id": uuid4().hex, "rule_id": key, "day": day,
               "kind": "test" if test else "scheduled", "status": "sending", "snapshot": snapshot,
               "error": "", "created_at": now_iso(), "updated_at": now_iso(), "message_id": None}
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not test:
                if db.execute("SELECT 1 FROM runs WHERE rule_id=? AND (day=? OR status IN ('sending','failed','unknown')) AND kind='scheduled'", (key, day)).fetchone():
                    return None
            db.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (run["id"], key, day, run["kind"], "sending", json.dumps(snapshot), "", run["created_at"], run["updated_at"], None))
        return run

    def finish(self, key, status, error="", message_id=None):
        require(status in ("sent", "failed", "unknown", "skipped"), "发送状态无效")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute("SELECT * FROM runs WHERE id=?", (key,)).fetchone()
            require(run is not None, "发送记录不存在")
            require(run["status"] in ("sending", "failed", "unknown"), "发送记录已处理")
            if status == "sent" and run["kind"] == "scheduled":
                snap = json.loads(run["snapshot"])
                require(db.execute("UPDATE rules SET cursor=?,revision=revision+1 WHERE id=? AND revision=?",
                                   (snap["next_cursor"], run["rule_id"], snap["rule"]["revision"])).rowcount == 1,
                        "排班版本已改变，无法推进轮换")
            db.execute("UPDATE runs SET status=?,error=?,updated_at=?,message_id=? WHERE id=?",
                       (status, str(error)[:1000], now_iso(), str(message_id) if message_id else None, key))

    def logs(self, limit=200):
        with self.connect() as db:
            return [dict(r, snapshot=json.loads(r["snapshot"])) for r in db.execute(
                "SELECT * FROM runs WHERE rowid IN (SELECT rowid FROM runs ORDER BY rowid DESC LIMIT ?) "
                "OR status IN ('sending','failed','unknown') ORDER BY rowid DESC", (limit,))]

    def run(self, key):
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (key,)).fetchone()
            return dict(row, snapshot=json.loads(row["snapshot"])) if row else None

    def backup(self, path):
        target = sqlite3.connect(path)
        try:
            with self.connect() as source:
                source.backup(target)
            target.commit()
        finally:
            target.close()

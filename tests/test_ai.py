import asyncio
import json
import sqlite3

import pytest

from astrbot_plugin_fmm.ai.auth import PERMISSION_DENIED
from astrbot_plugin_fmm.ai.confirmations import ConfirmationManager
from astrbot_plugin_fmm.ai.service import AIManager
from astrbot_plugin_fmm.service import ReminderService
from astrbot_plugin_fmm.store import Store


class FakeEvent:
    def __init__(
        self,
        sender_id="10001",
        platform_id="onebot",
        session_id="aiocqhttp:GroupMessage:90001",
        admin=True,
        role="member",
    ):
        self.sender_id = sender_id
        self.platform_id = platform_id
        self.unified_msg_origin = session_id
        self.admin = admin
        self.role = role
        self.claimed_admin = admin

    def get_sender_id(self):
        return self.sender_id

    def get_platform_id(self):
        return self.platform_id

    def is_admin(self):
        return self.admin


async def platforms():
    return [{"id": "onebot", "name": "OneBot"}]


async def sender(_snapshot):
    return 1


def decode(result):
    return json.loads(result)


def member(name, qq, status="在职"):
    return {
        "name": name,
        "qq": qq,
        "gender": "未知",
        "status": status,
        "photo": "",
    }


def seed(store, count=3):
    store.save_members(
        [member(f"成员{index}", str(10001 + index)) for index in range(count)]
    )
    by_name = {item["data"]["name"]: item["id"] for item in store.members()}
    return [by_name[f"成员{index}"] for index in range(count)]


def save_rule(store, pool, **extra):
    data = {
        "name": "晚班",
        "platform_id": "onebot",
        "group_id": "123456789",
        "time": "20:00",
        "weekdays": [2],
        "pool": pool,
        "count": 1,
        "start_date": "2026-01-01",
        "message": "{names}",
        "enabled": True,
    }
    data.update(extra)
    return store.save_rule(data)


def admin_manager(store, admins=None):
    service = ReminderService(store, sender, platforms)
    configured = {"aiocqhttp:GroupMessage:90001": list(admins or ["10001"])}
    manager = AIManager(
        service,
        lambda event: {"admins_id": configured.get(event.unified_msg_origin, [])},
    )
    return manager, service, configured


def test_admin_can_query_members_schedules_rotation_and_records(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store)
        saved = save_rule(store, pool)
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            found = decode(
                await manager.execute(event, "fmm_find_members", name="成员")
            )
            assert found["ok"] is True
            assert found["count"] == 3

            schedules = decode(await manager.execute(event, "fmm_list_schedules"))
            assert schedules["count"] == 1
            assert schedules["schedules"][0]["next_members"] == ["成员0"]

            schedule = decode(
                await manager.execute(
                    event,
                    "fmm_get_schedule",
                    schedule_id=saved["id"],
                )
            )
            assert schedule["schedule"]["pool"] == pool
            assert schedule["schedule"]["next_members"][0]["name"] == "成员0"

            rotation = decode(
                await manager.execute(
                    event,
                    "fmm_preview_rotation",
                    schedule_name="晚班",
                    rounds=4,
                )
            )
            assert [
                item["members"][0]["name"] for item in rotation["rounds"]
            ] == ["成员0", "成员1", "成员2", "成员0"]

            records = decode(
                await manager.execute(event, "fmm_get_send_records")
            )
            assert records == {"ok": True, "count": 0, "records": []}
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())

    with sqlite3.connect(tmp_path / "fmm.sqlite3") as db:
        outcomes = db.execute(
            "SELECT outcome FROM ai_audit ORDER BY rowid"
        ).fetchall()
    assert outcomes == [("success",)] * 5


@pytest.mark.parametrize(
    ("tool_name", "params"),
    [
        ("fmm_find_members", {}),
        ("fmm_list_schedules", {}),
        ("fmm_preview_rotation", {}),
        (
            "fmm_create_member",
            {"name": "张三", "qq": "123456", "gender": "男"},
        ),
        ("fmm_move_member", {"mode": "to_first"}),
    ],
)
def test_non_admin_is_denied_before_every_business_operation(
    tmp_path, tool_name, params
):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, _ = admin_manager(store)
        try:
            result = await manager.execute(
                FakeEvent(admin=False),
                tool_name,
                **params,
            )
            assert result == PERMISSION_DENIED
            assert store.members() == []
            assert store.rules() == []
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())

    with sqlite3.connect(tmp_path / "fmm.sqlite3") as db:
        audit = db.execute(
            "SELECT tool_name, outcome FROM ai_audit"
        ).fetchall()
    assert audit == [(tool_name, "denied")]


@pytest.mark.parametrize("role", ["administrator", "owner", "群主", "管理员"])
def test_group_role_and_chat_claims_do_not_grant_admin(tmp_path, role):
    async def scenario():
        store = Store(tmp_path / f"{role}.sqlite3")
        manager, service, _ = admin_manager(store)
        event = FakeEvent(admin=False, role=role)
        try:
            result = await manager.execute(
                event,
                "fmm_find_members",
                is_admin=True,
                admins_id=["10001"],
            )
            assert result == PERMISSION_DENIED
            assert store.members() == []
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "event",
    [
        FakeEvent(sender_id=""),
        FakeEvent(platform_id=""),
        FakeEvent(session_id=""),
    ],
)
def test_missing_trusted_identity_is_denied(tmp_path, event):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, _ = admin_manager(store)
        try:
            assert await manager.execute(event, "fmm_find_members") == PERMISSION_DENIED
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_identity_api_error_is_denied_without_touching_business_data(tmp_path):
    class BrokenEvent(FakeEvent):
        def get_sender_id(self):
            raise RuntimeError("sender unavailable")

    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, _ = admin_manager(store)
        try:
            assert (
                await manager.execute(BrokenEvent(), "fmm_find_members")
                == PERMISSION_DENIED
            )
            assert store.members() == []
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_preview_is_not_persisted_and_confirmation_is_one_time(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            preview = decode(
                await manager.execute(
                    event,
                    "fmm_create_member",
                    name="张三",
                    qq="123456",
                    gender="男",
                )
            )
            assert preview["requires_confirmation"] is True
            assert preview["confirmation_id"]
            assert store.members() == []

            confirmed = decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert confirmed["confirmed"] is True
            assert [item["data"]["name"] for item in store.members()] == ["张三"]

            duplicate = decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert duplicate["ok"] is False
            assert "失效" in duplicate["error"]
            assert len(store.members()) == 1
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_create_schedule_is_paused_by_default_and_requires_confirmation(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store)
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            preview = decode(
                await manager.execute(
                    event,
                    "fmm_create_schedule",
                    name="周五提醒",
                    platform_id="onebot",
                    group_id="123456789",
                    time="20:00",
                    weekdays=[4],
                    pool=pool,
                    start_date="2026-01-01",
                )
            )
            assert preview["requires_confirmation"] is True
            assert preview["preview"]["after"]["enabled"] is False
            assert store.rules() == []

            confirmed = decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert confirmed["confirmed"] is True
            saved = store.rules()[0]
            assert saved["enabled"] is False
            assert saved["pool"] == pool
            assert saved["cursor"] == 0
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_revoked_admin_and_other_admin_cannot_confirm_same_preview(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, configured = admin_manager(
            store, ["10001", "10002"]
        )
        owner = FakeEvent(sender_id="10001")
        other = FakeEvent(sender_id="10002")
        try:
            preview = decode(
                await manager.execute(
                    owner,
                    "fmm_create_member",
                    name="张三",
                    qq="123456",
                    gender="男",
                )
            )
            token = preview["confirmation_id"]

            assert (
                decode(
                    await manager.execute(
                        other,
                        "fmm_confirm_change",
                        confirmation_id=token,
                    )
                )["ok"]
                is False
            )
            assert store.members() == []

            configured[owner.unified_msg_origin] = ["10002"]
            assert (
                await manager.execute(
                    owner,
                    "fmm_confirm_change",
                    confirmation_id=token,
                )
                == PERMISSION_DENIED
            )
            assert store.members() == []

            configured[owner.unified_msg_origin] = ["10001", "10002"]
            confirmed = decode(
                await manager.execute(
                    owner,
                    "fmm_confirm_change",
                    confirmation_id=token,
                )
            )
            assert confirmed["confirmed"] is True
            assert len(store.members()) == 1
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_expired_confirmation_is_rejected(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        service = ReminderService(store, sender, platforms)
        manager = AIManager(
            service,
            lambda _event: {"admins_id": ["10001"]},
            ConfirmationManager(ttl_seconds=0),
        )
        try:
            preview = decode(
                await manager.execute(
                    FakeEvent(),
                    "fmm_create_member",
                    name="张三",
                    qq="123456",
                    gender="男",
                )
            )
            result = decode(
                await manager.execute(
                    FakeEvent(),
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert result["ok"] is False
            assert "失效" in result["error"]
            assert store.members() == []
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_duplicate_qq_missing_fields_and_ambiguous_member_are_rejected(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        store.save_members([member("张三", "12345"), member("张三", "54321")])
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            duplicate = decode(
                await manager.execute(
                    event,
                    "fmm_create_member",
                    name="李四",
                    qq="12345",
                    gender="男",
                )
            )
            assert duplicate["ok"] is False
            assert "QQ" in duplicate["error"]

            missing = decode(
                await manager.execute(
                    event,
                    "fmm_create_member",
                    name="",
                    qq="123456",
                    gender="男",
                )
            )
            assert missing["ok"] is False
            assert "姓名" in missing["error"]

            ambiguous = decode(
                await manager.execute(
                    event,
                    "fmm_update_member",
                    member_name="张三",
                    status="劝退",
                    reason="同名校验",
                )
            )
            assert ambiguous["ok"] is False
            assert "多个同名" in ambiguous["error"]
            assert all(
                item["data"]["status"] == "在职" for item in store.members()
            )
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_pool_add_and_remove_require_confirmation(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store)
        saved = save_rule(store, pool[:2])
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            preview = decode(
                await manager.execute(
                    event,
                    "fmm_manage_pool_member",
                    schedule_id=saved["id"],
                    member_id=pool[2],
                    operation="add",
                )
            )
            assert preview["preview"]["after_order"] == ["成员0", "成员1", "成员2"]
            assert store.rule(saved["id"])["pool"] == pool[:2]
            decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert store.rule(saved["id"])["pool"] == pool

            preview = decode(
                await manager.execute(
                    event,
                    "fmm_manage_pool_member",
                    schedule_name="晚班",
                    member_qq="10002",
                    operation="remove",
                )
            )
            decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert store.rule(saved["id"])["pool"] == [pool[0], pool[2]]
            assert len(store.members()) == 3
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("mode", "member_index", "offset", "target_index", "expected"),
    [
        ("forward", 3, 2, None, [0, 3, 1, 2]),
        ("backward", 0, 2, None, [1, 2, 0, 3]),
        ("before", 3, 1, 1, [0, 3, 1, 2]),
        ("after", 0, 1, 2, [1, 2, 0, 3]),
        ("to_first", 3, 1, None, [3, 0, 1, 2]),
        ("to_last", 0, 1, None, [1, 2, 3, 0]),
    ],
)
def test_all_move_modes(
    tmp_path, mode, member_index, offset, target_index, expected
):
    async def scenario():
        store = Store(tmp_path / f"{mode}.sqlite3")
        pool = seed(store, 4)
        saved = save_rule(store, pool)
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        params = {
            "schedule_id": saved["id"],
            "member_id": pool[member_index],
            "mode": mode,
            "offset": offset,
        }
        if target_index is not None:
            params["target_member_id"] = pool[target_index]
        try:
            preview = decode(
                await manager.execute(event, "fmm_move_member", **params)
            )
            assert preview["requires_confirmation"] is True
            assert store.rule(saved["id"])["pool"] == pool
            confirmed = decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert confirmed["confirmed"] is True
            assert store.rule(saved["id"])["pool"] == [pool[index] for index in expected]
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_reorder_preview_keeps_cursor_runs_and_confirmation_keeps_next_member(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store, 4)
        saved = save_rule(store, pool)
        run = store.claim(saved["id"], "2026-10-15")
        store.finish(run["id"], "sent")
        before_rule = store.rule(saved["id"])
        before_runs = store.logs()

        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            preview = decode(
                await manager.execute(
                    event,
                    "fmm_move_member",
                    schedule_id=saved["id"],
                    member_id=pool[0],
                    mode="to_last",
                )
            )
            assert preview["preview"]["before_next"] == ["成员1"]
            assert preview["preview"]["after_next"] == ["成员1"]
            during = store.rule(saved["id"])
            assert during["cursor"] == before_rule["cursor"]
            assert during["revision"] == before_rule["revision"]
            assert store.logs() == before_runs

            decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            updated = store.rule(saved["id"])
            assert updated["pool"] == pool[1:] + pool[:1]
            assert updated["cursor"] == 0
            assert store.selection(updated)[0][0]["id"] == pool[1]
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_schedule_change_after_preview_is_rejected(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store)
        saved = save_rule(store, pool)
        manager, service, _ = admin_manager(store)
        event = FakeEvent()
        try:
            preview = decode(
                await manager.execute(
                    event,
                    "fmm_update_schedule",
                    schedule_id=saved["id"],
                    time="21:00",
                )
            )
            current = store.rule(saved["id"])
            store.save_rule(dict(current, time="22:00"), saved["id"])
            result = decode(
                await manager.execute(
                    event,
                    "fmm_confirm_change",
                    confirmation_id=preview["confirmation_id"],
                )
            )
            assert result["ok"] is False
            assert "已更新" in result["error"]
            assert store.rule(saved["id"])["time"] == "22:00"
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_unresolved_send_record_blocks_schedule_preview(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        pool = seed(store)
        saved = save_rule(store, pool)
        run = store.claim(saved["id"], "2026-10-15")
        store.finish(run["id"], "unknown", "结果待确认")
        manager, service, _ = admin_manager(store)
        try:
            result = decode(
                await manager.execute(
                    FakeEvent(),
                    "fmm_update_schedule",
                    schedule_id=saved["id"],
                    enabled=False,
                )
            )
            assert result["ok"] is False
            assert "未处理" in result["error"]
            assert store.rule(saved["id"])["enabled"] is True
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())


def test_success_denial_and_failure_are_written_to_ai_audit(tmp_path):
    async def scenario():
        store = Store(tmp_path / "fmm.sqlite3")
        manager, service, _ = admin_manager(store)
        try:
            await manager.execute(FakeEvent(), "fmm_find_members")
            await manager.execute(FakeEvent(admin=False), "fmm_find_members")
            await manager.execute(
                FakeEvent(),
                "fmm_create_member",
                name="张三",
                qq="",
                gender="男",
            )
        finally:
            await service.close()
            await manager.close()

    asyncio.run(scenario())

    with sqlite3.connect(tmp_path / "fmm.sqlite3") as db:
        rows = db.execute(
            "SELECT tool_name, outcome FROM ai_audit ORDER BY rowid"
        ).fetchall()
    assert rows == [
        ("fmm_find_members", "success"),
        ("fmm_find_members", "denied"),
        ("fmm_create_member", "failed"),
    ]

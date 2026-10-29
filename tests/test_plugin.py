import asyncio
import sqlite3
from datetime import datetime, timedelta

import pytest
from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer

from astrbot_plugin_fmm.service import DeliveryRejected, ReminderService
from astrbot_plugin_fmm.store import Store, TZ
from astrbot_plugin_fmm.web import API, create_app, password_for


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "fmm.sqlite3")


def member(name, qq, **extra):
    return dict(name=name, qq=qq, gender="未知", status="在职", **extra)


def seed(store, count=3):
    store.save_members([member(f"成员{i}", str(10001 + i)) for i in range(count)])
    return [m["id"] for m in store.members()]


def rule(store, pool=None, **extra):
    data = dict(name="每日值班", platform_id="onebot", group_id="123456789",
                time="09:00", weekdays=list(range(7)), pool=pool or seed(store), count=1,
                start_date="2026-01-01", message="{date} {schedule}: {names}", enabled=True)
    data.update(extra)
    return store.save_rule(data)


def test_required_unique_qq_atomic_batch_and_history(store):
    with pytest.raises(ValueError, match="QQ"):
        store.save_members([member("张三", "")])
    with pytest.raises(ValueError, match="QQ"):
        store.save_members([member("张三", "12345"), member("李四", "12345")])
    assert store.members() == []
    seed(store, 1)
    person = store.members()[0]
    store.save_members([dict(person["data"], qq="54321")], person["id"], "更正QQ")
    assert store.history(person["id"])[0]["changes"][0]["field"] == "qq"
    assert store.members()[0]["data"]["qq"] == "54321"


def test_round_robin_wrap_independent_pools_and_duplicate_day(store):
    pool = seed(store)
    first = rule(store, pool, count=2)
    other = rule(store, pool[::-1])
    expected = [pool[:2], [pool[2], pool[0]], pool[1:]]
    for index, selection in enumerate(expected):
        day = f"2026-10-{15 + index}"
        run = store.claim(first["id"], day)
        assert [m["id"] for m in run["snapshot"]["members"]] == selection
        assert store.claim(first["id"], day) is None
        store.finish(run["id"], "sent", message_id=index + 1)
        assert store.claim(first["id"], day) is None
    assert store.rule(other["id"])["cursor"] == 0
    assert store.selection(store.rule(other["id"]))[0][0]["id"] == pool[2]


@pytest.mark.parametrize("status", ["failed", "unknown"])
def test_failure_blocks_until_resolution_and_does_not_rotate(store, status):
    saved = rule(store)
    run = store.claim(saved["id"], "2026-10-15")
    store.finish(run["id"], status, "failure")
    assert store.rule(saved["id"])["cursor"] == 0
    assert store.claim(saved["id"], "2026-10-16") is None
    with pytest.raises(ValueError, match="未处理"):
        store.save_rule(saved, saved["id"])
    with pytest.raises(ValueError):
        store.delete_rule(saved["id"])
    store.finish(run["id"], "sent", "manual confirmation")
    assert store.rule(saved["id"])["cursor"] == 1
    with pytest.raises(ValueError, match="已处理"):
        store.finish(run["id"], "sent")
    assert store.claim(saved["id"], "2026-10-16") is not None


def test_test_send_skip_restart_and_backup(store, tmp_path):
    saved = rule(store)
    test = store.claim(saved["id"], "2026-10-15", True)
    store.finish(test["id"], "sent", message_id="123")
    assert store.rule(saved["id"])["cursor"] == 0
    scheduled = store.claim(saved["id"], "2026-10-15")
    restarted = Store(store.path)
    assert restarted.run(scheduled["id"])["status"] == "unknown"
    restarted.finish(scheduled["id"], "skipped")
    assert restarted.rule(saved["id"])["cursor"] == 0
    restarted.backup(tmp_path / "backup.sqlite3")
    with sqlite3.connect(tmp_path / "backup.sqlite3") as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 3


def test_reorder_preserves_next_and_revision_checks(store):
    pool = seed(store)
    saved = rule(store, pool)
    run = store.claim(saved["id"], "2026-10-15")
    store.finish(run["id"], "sent")
    with pytest.raises(ValueError, match="已更新"):
        store.save_rule(saved, saved["id"])
    updated = store.save_rule(dict(store.rule(saved["id"]), pool=pool[::-1]), saved["id"])
    assert store.selection(updated)[0][0]["id"] == pool[1]
    person = next(m for m in store.members() if m["id"] == pool[1])
    store.save_members([dict(person["data"], status="光荣退休")], person["id"], "退休")
    assert store.selection(updated)[0][0]["id"] == pool[0]
    with pytest.raises(ValueError, match="人员池"):
        store.delete_member(pool[0])


def test_old_unresolved_records_remain_visible(store):
    saved = rule(store)
    failed = store.claim(saved["id"], "2026-10-15")
    store.finish(failed["id"], "failed")
    for _ in range(201):
        test = store.claim(saved["id"], "2026-10-15", True)
        store.finish(test["id"], "sent")
    assert any(r["id"] == failed["id"] for r in store.logs())


def test_fields_atomic_and_used_fields_hidden(store):
    store.save_fields([dict(opType="create", id="role", name="职责", type="text")])
    store.save_members([member("张三", "12345", role="运营")])
    assert store.fields()[0]["used"]
    store.save_fields([dict(opType="delete", id="role", action="delete")])
    assert store.fields()[0]["hidden"]
    with pytest.raises(ValueError):
        store.save_fields([dict(opType="create", id="qq", name="QQ号", type="text")])
    assert len(store.fields()) == 1


async def platforms():
    return [dict(id="onebot", name="OneBot")]


@pytest.mark.parametrize("outcome", ["sent", "failed", "unknown"])
def test_scheduler_dispatch_once_and_test_does_not_rotate(store, outcome):
    async def scenario():
        now = datetime.now(TZ)
        saved = rule(store, time=now.strftime("%H:%M"), start_date=now.date().isoformat())
        calls = []

        async def sender(snapshot):
            calls.append(snapshot)
            if outcome == "failed":
                raise DeliveryRejected("rejected")
            if outcome == "unknown":
                raise RuntimeError("disconnected")
            return 123

        service = ReminderService(store, sender, platforms)
        try:
            await service.start()
            await asyncio.gather(service.dispatch(saved["id"]), service.dispatch(saved["id"]))
            assert len(calls) == 1
            assert store.logs()[0]["status"] == outcome
            cursor = store.rule(saved["id"])["cursor"]
            await service.dispatch(saved["id"], test=True)
            assert store.rule(saved["id"])["cursor"] == cursor
            state = await service.state()
            assert state["rules"][0]["blocked"] == (outcome != "sent")
        finally:
            await service.close()
    asyncio.run(scenario())


def test_future_schedule_not_dispatched(store):
    async def scenario():
        tomorrow = (datetime.now(TZ) + timedelta(days=1)).date().isoformat()
        saved = rule(store, start_date=tomorrow)
        async def sender(snapshot):
            pytest.fail("future schedule was dispatched")
        service = ReminderService(store, sender, platforms)
        await service.start()
        try:
            assert await service.dispatch(saved["id"]) is None
            assert store.logs() == []
        finally:
            await service.close()
    asyncio.run(scenario())


def test_password_generation_is_persistent(tmp_path):
    first = password_for(tmp_path)
    assert len(first) >= 12
    assert first == password_for(tmp_path)
    with pytest.raises(ValueError):
        password_for(tmp_path, "short")


def test_web_auth_crud_validation_csrf_and_backup(store, tmp_path):
    async def scenario():
        async def sender(snapshot):
            raise DeliveryRejected("preview: no delivery")
        service = ReminderService(store, sender, platforms)
        await service.start()
        app = create_app(service, tmp_path, "test-password-12345")
        client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
        await client.start_server()
        try:
            assert (await client.get(API + "/state")).status == 401
            assert (await client.get("/")).status == 200
            assert (await client.post(API + "/login", json=[])).status == 400
            assert (await client.post(API + "/login", json={"password": "wrong"})).status == 401
            response = await client.post(API + "/login", json={"password": "test-password-12345"})
            assert response.status == 200
            assert response.cookies["fmm_session"]["httponly"]
            assert (await client.get(API + "/state")).status == 200
            assert (await client.post(API + "/members", json={}, headers={"Origin": "https://evil.example"})).status == 403
            assert (await client.post(API + "/members", json=[])).status == 400
            response = await client.post(API + "/members", json={"members": [member("张三", "12345")]})
            assert response.status == 200
            person = (await response.json())["data"][0]
            saved = rule(store, [person["id"]], enabled=False)
            response = await client.post(API + f"/rules/{saved['id']}/test", json={})
            assert response.status == 200
            run = (await response.json())["data"]
            assert run["status"] == "failed"
            response = await client.post(API + f"/runs/{run['id']}/resolve", json={"action": "skipped"})
            assert response.status == 200
            assert (await client.delete(API + f"/members/{person['id']}", json={})).status == 400
            response = await client.get(API + "/backup")
            assert response.status == 200
            assert (await response.read()).startswith(b"SQLite format 3")
            assert (await client.post(API + "/logout", json={})).status == 200
            assert (await client.get(API + "/state")).status == 401
        finally:
            await client.close()
            await service.close()
    asyncio.run(scenario())

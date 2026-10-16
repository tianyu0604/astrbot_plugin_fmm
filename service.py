import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .store import TZ

logger = logging.getLogger(__name__)


class DeliveryRejected(Exception):
    """A preflight check or explicit platform rejection confirms no delivery."""


class ReminderService:
    def __init__(self, store, sender, platforms):
        self.store = store
        self.sender = sender
        self.platforms = platforms
        self.lock = asyncio.Lock()
        self.scheduler = AsyncIOScheduler(timezone=TZ)
        self.tasks = set()
        self.closing = False

    async def call(self, method, *args, **kwargs):
        async with self.lock:
            return await asyncio.to_thread(getattr(self.store, method), *args, **kwargs)

    async def start(self):
        self.scheduler.start(paused=True)
        await self.reschedule()
        self.scheduler.resume()

    async def reschedule(self):
        self.scheduler.remove_all_jobs()
        rules = await self.call("rules")
        now = datetime.now(TZ)
        for rule in rules:
            if not rule["enabled"]:
                continue
            hour, minute = map(int, rule["time"].split(":"))
            trigger = CronTrigger(hour=hour, minute=minute, day_of_week=",".join(map(str, rule["weekdays"])),
                                  start_date=rule["start_date"], timezone=TZ)
            self.scheduler.add_job(self.dispatch, trigger, args=[rule["id"]], id=rule["id"],
                                   coalesce=True, max_instances=1, misfire_grace_time=600)
            planned = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if rule["start_date"] <= now.date().isoformat() and now.weekday() in rule["weekdays"] and timedelta(0) <= now - planned <= timedelta(minutes=10):
                self.launch(rule["id"])

    def launch(self, key):
        if self.closing:
            return
        task = asyncio.create_task(self.dispatch(key))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def dispatch(self, key, test=False):
        if self.closing:
            return None
        task = asyncio.current_task()
        self.tasks.add(task)
        try:
            async with self.lock:
                rule = await asyncio.to_thread(self.store.rule, key)
                if not rule or (not test and not rule["enabled"]):
                    return None
                now = datetime.now(TZ)
                if not test:
                    planned = now.replace(hour=int(rule["time"][:2]), minute=int(rule["time"][3:]), second=0, microsecond=0)
                    if now.date().isoformat() < rule["start_date"] or now.weekday() not in rule["weekdays"] or not timedelta(0) <= now - planned <= timedelta(minutes=10):
                        return None
                try:
                    run = await asyncio.to_thread(self.store.claim, key, now.date().isoformat(), test)
                except ValueError:
                    logger.exception("FMM selection failed for rule %s", key)
                    if test:
                        raise
                    return None
                if run is None:
                    return None
                try:
                    message_id = await asyncio.wait_for(self.sender(run["snapshot"]), timeout=30)
                except DeliveryRejected as exc:
                    await asyncio.to_thread(self.store.finish, run["id"], "failed", str(exc))
                except asyncio.CancelledError:
                    await asyncio.to_thread(self.store.finish, run["id"], "unknown", "插件关闭，发送结果未确认")
                    raise
                except Exception as exc:
                    logger.exception("FMM delivery result uncertain")
                    await asyncio.to_thread(self.store.finish, run["id"], "unknown", str(exc))
                else:
                    await asyncio.to_thread(self.store.finish, run["id"], "sent", "", message_id)
                return run["id"]
        finally:
            self.tasks.discard(task)

    async def state(self):
        async with self.lock:
            members, rules, logs, fields = await asyncio.to_thread(self._state)
        for rule in rules:
            try:
                selected, _ = await self.call("selection", rule)
                rule["next_members"] = [m["data"]["name"] for m in selected]
                rule["selection_error"] = ""
            except ValueError as exc:
                rule["next_members"] = []
                rule["selection_error"] = str(exc)
            rule["blocked"] = any(r["rule_id"] == rule["id"] and r["kind"] == "scheduled" and r["status"] in ("failed", "unknown", "sending") for r in logs)
        platforms = await self.platforms()
        return {"members": members, "rules": rules, "logs": logs, "fields": fields,
                "platforms": platforms, "timezone": "Asia/Shanghai", "server_time": datetime.now(TZ).isoformat()}

    def _state(self):
        return self.store.members(), self.store.rules(), self.store.logs(), self.store.fields()

    async def close(self):
        self.closing = True
        if self.scheduler.running:
            self.scheduler.pause()
        tasks = list(self.tasks - {asyncio.current_task()})
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

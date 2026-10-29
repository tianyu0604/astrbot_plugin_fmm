"""Business adapter for FMM's administrator-only LLM tools."""

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Callable

from ..store import TZ
from .auth import (
    PERMISSION_DENIED,
    AdminDenied,
    AdminIdentity,
    require_fmm_admin,
)
from .confirmations import ConfirmationError, ConfirmationManager, PendingChange

logger = logging.getLogger(__name__)

TOOL_NAMES = (
    "fmm_find_members",
    "fmm_create_member",
    "fmm_update_member",
    "fmm_list_schedules",
    "fmm_get_schedule",
    "fmm_create_schedule",
    "fmm_update_schedule",
    "fmm_manage_pool_member",
    "fmm_move_member",
    "fmm_preview_rotation",
    "fmm_get_send_records",
    "fmm_confirm_change",
)

STATUSES = ("在职", "劝退", "光荣退休")
GENDERS = ("男", "女", "未知")
RUN_STATUSES = ("sending", "sent", "failed", "unknown", "skipped")
WRITE_TOOL_NAMES = {
    "fmm_create_member",
    "fmm_update_member",
    "fmm_create_schedule",
    "fmm_update_schedule",
    "fmm_manage_pool_member",
    "fmm_move_member",
    "fmm_confirm_change",
}


class ToolError(ValueError):
    """A safe, user-readable tool validation error."""


def _state_get(state: Any, key: str, default: Any = None) -> Any:
    getter = getattr(state, "get", None)
    return getter(key, default) if callable(getter) else default


class AIManager:
    """Authenticate, validate, preview, confirm, and audit FMM AI operations."""

    def __init__(
        self,
        reminder_service: Any,
        config_provider: Callable[[Any], Any],
        confirmations: ConfirmationManager | None = None,
    ):
        self.service = reminder_service
        self.store = reminder_service.store
        self.config_provider = config_provider
        self.confirmations = confirmations or ConfirmationManager()

    async def close(self) -> None:
        await self.confirmations.close()

    async def execute(self, event: Any, tool_name: str, **params: Any) -> str:
        if tool_name not in TOOL_NAMES:
            raise ValueError("未知的 FMM AI 工具")

        try:
            identity = require_fmm_admin(event, self.config_provider)
        except AdminDenied as exc:
            await self._audit(
                exc.identity,
                tool_name,
                params,
                outcome="denied",
                message="not an authenticated AstrBot administrator",
            )
            return PERMISSION_DENIED

        try:
            result = await self._dispatch(identity, tool_name, params)
        except (ToolError, ConfirmationError, ValueError) as exc:
            message = str(exc) or "操作未通过校验"
            await self._audit(identity, tool_name, params, outcome="failed", message=message)
            return self._encode({"ok": False, "error": message})
        except Exception as exc:
            logger.exception("FMM AI tool %s failed", tool_name)
            await self._audit(
                identity,
                tool_name,
                params,
                outcome="failed",
                message=f"internal error: {type(exc).__name__}",
            )
            return self._encode(
                {"ok": False, "error": "操作失败，请检查 AstrBot 插件日志"}
            )

        before = result.get("before") if isinstance(result, dict) else None
        after = result.get("after") if isinstance(result, dict) else None
        await self._audit(
            identity,
            tool_name,
            params,
            before=before,
            after=after,
            outcome="success",
        )
        return self._encode(result)

    @staticmethod
    def _encode(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    async def _dispatch(
        self,
        identity: AdminIdentity,
        tool_name: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        handlers = {
            "fmm_find_members": self._find_members,
            "fmm_create_member": self._create_member,
            "fmm_update_member": self._update_member,
            "fmm_list_schedules": self._list_schedules,
            "fmm_get_schedule": self._get_schedule,
            "fmm_create_schedule": self._create_schedule,
            "fmm_update_schedule": self._update_schedule,
            "fmm_manage_pool_member": self._manage_pool_member,
            "fmm_move_member": self._move_member,
            "fmm_preview_rotation": self._preview_rotation,
            "fmm_get_send_records": self._get_send_records,
            "fmm_confirm_change": self._confirm_change,
        }
        handler = handlers[tool_name]
        if tool_name in WRITE_TOOL_NAMES:
            return await handler(identity, **params)
        return await handler(**params)

    async def _audit(
        self,
        identity: AdminIdentity | None,
        tool_name: str,
        params: dict[str, Any],
        before: Any = None,
        after: Any = None,
        outcome: str = "success",
        message: str = "",
    ) -> None:
        target = self._target(params)
        try:
            await asyncio.to_thread(
                self.store.record_ai_audit,
                identity.admin_id if identity else "",
                identity.platform_id if identity else "",
                identity.session_id if identity else "",
                tool_name,
                target,
                before,
                after,
                outcome,
                message,
            )
        except Exception:
            logger.exception("Failed to write FMM AI audit record")

    @staticmethod
    def _target(params: dict[str, Any]) -> str:
        keys = (
            "schedule_id",
            "schedule_name",
            "member_id",
            "member_name",
            "member_qq",
            "confirmation_id",
        )
        parts = [f"{key}={params[key]}" for key in keys if params.get(key)]
        return ", ".join(parts)[:500]

    @staticmethod
    def _require_text(value: Any, label: str, maximum: int = 200) -> str:
        text = str(value or "").strip()
        if not text:
            raise ToolError(f"请提供{label}")
        if len(text) > maximum:
            raise ToolError(f"{label}过长")
        return text

    @staticmethod
    def _member_view(member: dict[str, Any]) -> dict[str, Any]:
        data = member["data"]
        return AIManager._member_data_view(data, member.get("updatedAt", ""), member["id"])

    @staticmethod
    def _member_data_view(
        data: dict[str, Any],
        updated_at: str = "",
        member_id: str = "",
    ) -> dict[str, Any]:
        builtin = {"name", "qq", "gender", "status", "photo"}
        return {
            "id": member_id,
            "name": data.get("name", ""),
            "qq": data.get("qq", ""),
            "gender": data.get("gender", ""),
            "status": data.get("status", ""),
            "custom_fields": {
                key: value for key, value in data.items() if key not in builtin
            },
            "updated_at": updated_at,
        }

    async def _members(self) -> list[dict[str, Any]]:
        return await self.service.call("members")

    async def _rules(self) -> list[dict[str, Any]]:
        return await self.service.call("rules")

    async def _find_members(
        self,
        name: str = "",
        qq: str = "",
        status: str = "",
    ) -> dict[str, Any]:
        name_filter = str(name or "").strip().casefold()
        qq_filter = str(qq or "").strip()
        status_filter = str(status or "").strip()
        if status_filter and status_filter not in STATUSES:
            raise ToolError("状态只能是：在职、劝退、光荣退休")

        matches = []
        for member in await self._members():
            data = member["data"]
            if name_filter and name_filter not in str(data.get("name", "")).casefold():
                continue
            if qq_filter and qq_filter not in str(data.get("qq", "")):
                continue
            if status_filter and data.get("status") != status_filter:
                continue
            matches.append(self._member_view(member))
        return {"ok": True, "count": len(matches), "members": matches[:100]}

    async def _resolve_member(
        self,
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        members: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        people = members if members is not None else await self._members()
        member_id = str(member_id or "").strip()
        member_name = str(member_name or "").strip()
        member_qq = str(member_qq or "").strip()
        if member_id:
            matches = [person for person in people if person["id"] == member_id]
        elif member_qq:
            matches = [
                person
                for person in people
                if str(person["data"].get("qq", "")) == member_qq
            ]
        elif member_name:
            needle = member_name.casefold()
            matches = [
                person
                for person in people
                if str(person["data"].get("name", "")).casefold() == needle
            ]
        else:
            raise ToolError("请提供成员 ID、姓名或 QQ 号")
        if not matches:
            raise ToolError("未找到匹配成员")
        if len(matches) > 1:
            raise ToolError("匹配到多个同名成员，请提供 QQ 号或成员 ID")
        return matches[0]

    async def _resolve_schedule(
        self,
        schedule_id: str = "",
        schedule_name: str = "",
        rules: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        items = rules if rules is not None else await self._rules()
        schedule_id = str(schedule_id or "").strip()
        schedule_name = str(schedule_name or "").strip()
        if schedule_id:
            matches = [rule for rule in items if rule["id"] == schedule_id]
        elif schedule_name:
            needle = schedule_name.casefold()
            matches = [
                rule
                for rule in items
                if str(rule.get("name", "")).casefold() == needle
            ]
        elif len(items) == 1:
            return items[0]
        else:
            raise ToolError("请提供排班 ID 或排班名称")
        if not matches:
            raise ToolError("未找到匹配排班")
        if len(matches) > 1:
            raise ToolError("匹配到多个排班，请提供排班 ID")
        return matches[0]

    async def _member_pending(
        self,
        identity: AdminIdentity,
        action: str,
        payload: dict[str, Any],
        preview: dict[str, Any],
    ) -> dict[str, Any]:
        change = await self.confirmations.create(identity, action, payload, preview)
        return {
            "ok": True,
            "requires_confirmation": True,
            "confirmation_id": change.token,
            "expires_in_seconds": self.confirmations.ttl_seconds,
            "action": action,
            "preview": preview,
            "before": preview.get("before", payload.get("before")),
            "after": preview.get("after", payload.get("after")),
            "message": "请把预览给管理员核对；管理员明确确认后调用 fmm_confirm_change。",
        }

    @staticmethod
    def _custom_field_map(fields: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {
            str(field.get("id", "")): field
            for field in fields
            if field.get("id")
            and not field.get("hidden")
            and not field.get("isDeleted")
        }

    async def _prepare_custom_fields(
        self,
        updates: dict[str, Any] | None,
        existing: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = dict(existing or {})
        if updates is None:
            return result
        if not isinstance(updates, dict):
            raise ToolError("自定义字段必须是对象")
        fields = self._custom_field_map(await self.service.call("fields"))
        unknown = [key for key in updates if key not in fields]
        if unknown:
            raise ToolError("自定义字段不存在或已隐藏：" + "、".join(sorted(unknown)))
        for key, value in updates.items():
            if value is None:
                result.pop(key, None)
                continue
            field = fields[key]
            field_type = field.get("type")
            label = str(field.get("name") or key)
            if field_type == "images":
                raise ToolError(f"AI 暂不支持修改图片字段：{label}")
            if field_type in ("text", "radio", "date"):
                if not isinstance(value, str):
                    raise ToolError(f"{label}需要填写文本")
                value = value.strip()
                if len(value) > 2000:
                    raise ToolError(f"{label}内容过长")
                if field_type == "date" and value:
                    try:
                        datetime.strptime(value, "%Y-%m-%d")
                    except ValueError as exc:
                        raise ToolError(f"{label}日期格式应为 YYYY-MM-DD") from exc
                if field_type == "radio" and value:
                    options = field.get("options", [])
                    if options and value not in options:
                        raise ToolError(f"{label}不在可选范围内")
            elif field_type == "number":
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ToolError(f"{label}需要填写数字")
            else:
                raise ToolError(f"不支持的自定义字段类型：{label}")
            result[key] = value
        return result

    async def _ensure_unique_qq(
        self,
        qq: str,
        members: list[dict[str, Any]] | None = None,
        exclude_id: str = "",
    ) -> None:
        people = members if members is not None else await self._members()
        if any(
            member["id"] != exclude_id
            and str(member["data"].get("qq", "")) == str(qq)
            for member in people
        ):
            raise ToolError("QQ 号已被使用")

    async def _create_member(
        self,
        identity: AdminIdentity,
        name: str = "",
        qq: str = "",
        gender: str = "",
        status: str = "在职",
        custom_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if gender not in GENDERS:
            raise ToolError("请提供有效性别：男、女或未知")
        if status not in STATUSES:
            raise ToolError("状态只能是：在职、劝退、光荣退休")
        data = {
            "name": self._require_text(name, "姓名", 50),
            "qq": self._require_text(qq, "QQ 号", 12),
            "gender": gender,
            "status": status,
            "photo": "",
            **await self._prepare_custom_fields(custom_fields),
        }
        data = await self.service.call("validate_member", data)
        await self._ensure_unique_qq(data["qq"])
        preview = {
            "title": "创建成员",
            "before": None,
            "after": self._member_data_view(data),
        }
        return await self._member_pending(
            identity,
            "create_member",
            {"before": None, "after": data},
            preview,
        )

    async def _update_member(
        self,
        identity: AdminIdentity,
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        name: str | None = None,
        qq: str | None = None,
        gender: str | None = None,
        status: str | None = None,
        custom_fields: dict[str, Any] | None = None,
        reason: str = "",
    ) -> dict[str, Any]:
        reason = self._require_text(reason, "修改原因", 500)
        members = await self._members()
        current = await self._resolve_member(
            member_id,
            member_name,
            member_qq,
            members,
        )
        before = dict(current["data"])
        after = dict(before)
        for key, value in {
            "name": name,
            "qq": qq,
            "gender": gender,
            "status": status,
        }.items():
            if value is not None:
                after[key] = value
        existing_custom = {
            key: value
            for key, value in before.items()
            if key not in {"name", "qq", "gender", "status", "photo"}
        }
        merged_custom = await self._prepare_custom_fields(
            custom_fields,
            existing_custom,
        )
        after = {
            "name": after.get("name", ""),
            "qq": after.get("qq", ""),
            "gender": after.get("gender", ""),
            "status": after.get("status", ""),
            "photo": before.get("photo", ""),
            **merged_custom,
        }
        after = await self.service.call("validate_member", after)
        await self._ensure_unique_qq(after["qq"], members, current["id"])
        if after == before:
            raise ToolError("没有检测到需要修改的成员字段")
        preview = {
            "title": "修改成员",
            "member_id": current["id"],
            "reason": reason,
            "before": self._member_data_view(before, current.get("updatedAt", "")),
            "after": self._member_data_view(
                after,
                current.get("updatedAt", ""),
                current["id"],
            ),
        }
        return await self._member_pending(
            identity,
            "update_member",
            {
                "member_id": current["id"],
                "before": before,
                "after": after,
                "reason": reason,
            },
            preview,
        )

    async def _create_schedule(
        self,
        identity: AdminIdentity,
        name: str = "",
        platform_id: str = "",
        group_id: str = "",
        time: str = "",
        weekdays: list[int] | None = None,
        pool: list[str] | None = None,
        count: int = 1,
        start_date: str = "",
        message: str = "",
        enabled: bool = False,
    ) -> dict[str, Any]:
        platform_id = self._require_text(platform_id, "机器人账号", 100)
        await self._validate_platform(platform_id)
        pool_ids = await self._resolve_pool(pool or [])
        if type(enabled) is not bool:
            raise ToolError("启用状态无效")
        data = {
            "name": name,
            "platform_id": platform_id,
            "group_id": group_id,
            "time": time,
            "weekdays": weekdays or [],
            "pool": pool_ids,
            "count": count,
            "start_date": start_date,
            "message": message,
            "enabled": enabled,
        }
        saved = await self.service.call("validated_rule", data)
        proposed = dict(saved, cursor=0)
        preview = await self._preview_schedule_change(
            dict(proposed, pool=[]),
            saved,
            "创建排班",
            creating=True,
        )
        return await self._member_pending(
            identity,
            "create_schedule",
            {"schedule_id": None, "before": None, "after": saved},
            preview,
        )

    async def _update_schedule(
        self,
        identity: AdminIdentity,
        schedule_id: str = "",
        schedule_name: str = "",
        name: str | None = None,
        platform_id: str | None = None,
        group_id: str | None = None,
        time: str | None = None,
        weekdays: list[int] | None = None,
        count: int | None = None,
        start_date: str | None = None,
        message: str | None = None,
        enabled: bool | None = None,
    ) -> dict[str, Any]:
        rule = await self._resolve_schedule(schedule_id, schedule_name)
        await self._ensure_rule_editable(rule)
        candidate = self._schedule_config(rule)
        updates = {
            "name": name,
            "platform_id": platform_id,
            "group_id": group_id,
            "time": time,
            "weekdays": weekdays,
            "count": count,
            "start_date": start_date,
            "message": message,
            "enabled": enabled,
        }
        for key, value in updates.items():
            if value is not None:
                candidate[key] = value
        if candidate == self._schedule_config(rule):
            raise ToolError("没有检测到需要修改的排班字段")
        await self._validate_platform(candidate["platform_id"])
        saved = await self.service.call("validated_rule", candidate)
        proposed = dict(saved, revision=rule["revision"])
        preview = await self._preview_schedule_change(rule, saved, "修改排班")
        return await self._member_pending(
            identity,
            "update_schedule",
            {
                "schedule_id": rule["id"],
                "before": self._schedule_view(rule),
                "after": proposed,
            },
            preview,
        )

    async def _manage_pool_member(
        self,
        identity: AdminIdentity,
        schedule_id: str = "",
        schedule_name: str = "",
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        operation: str = "",
    ) -> dict[str, Any]:
        rule = await self._resolve_schedule(schedule_id, schedule_name)
        await self._ensure_rule_editable(rule)
        member = await self._resolve_member(member_id, member_name, member_qq)
        action = self._normalize_pool_operation(operation)
        pool = list(rule.get("pool", []))
        if action == "add":
            if member["id"] in pool:
                raise ToolError("该成员已在排班人员池中")
            if member["data"].get("status") != "在职":
                raise ToolError("只能把在职成员加入排班")
            pool.append(member["id"])
            title = "加入排班人员池"
        else:
            if member["id"] not in pool:
                raise ToolError("该成员不在排班人员池中")
            if len(pool) == 1:
                raise ToolError("排班人员池不能清空")
            pool.remove(member["id"])
            title = "移出排班人员池"
        candidate = dict(self._schedule_config(rule), pool=pool)
        saved = await self.service.call("validated_rule", candidate)
        proposed = dict(saved, revision=rule["revision"])
        preview = await self._preview_schedule_change(rule, saved, title)
        return await self._member_pending(
            identity,
            "pool_member",
            {
                "schedule_id": rule["id"],
                "before": self._schedule_view(rule),
                "after": proposed,
            },
            preview,
        )

    async def _move_member(
        self,
        identity: AdminIdentity,
        schedule_id: str = "",
        schedule_name: str = "",
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        mode: str = "",
        offset: int = 1,
        target_member_id: str = "",
        target_member_name: str = "",
        target_member_qq: str = "",
    ) -> dict[str, Any]:
        rule = await self._resolve_schedule(schedule_id, schedule_name)
        await self._ensure_rule_editable(rule)
        members = await self._members()
        member = await self._resolve_member(
            member_id,
            member_name,
            member_qq,
            members,
        )
        pool = list(rule.get("pool", []))
        if member["id"] not in pool:
            raise ToolError("该成员不在排班人员池中")
        mode = self._normalize_move_mode(mode)
        if type(offset) is not int or not 1 <= offset <= 100:
            raise ToolError("移动位数需要在 1 到 100 之间")
        source_index = pool.index(member["id"])
        if mode in ("before", "after"):
            target = await self._resolve_member(
                target_member_id,
                target_member_name,
                target_member_qq,
                members,
            )
            if target["id"] == member["id"]:
                raise ToolError("不能移动到自己的前面或后面")
            if target["id"] not in pool:
                raise ToolError("目标成员不在该排班人员池中")
            pool.remove(member["id"])
            target_index = pool.index(target["id"])
            new_index = target_index if mode == "before" else target_index + 1
        else:
            if mode == "forward":
                new_index = source_index - offset
                if new_index < 0:
                    raise ToolError("向前移动位数超出了人员池范围")
            elif mode == "backward":
                new_index = source_index + offset
                if new_index >= len(pool):
                    raise ToolError("向后移动位数超出了人员池范围")
            elif mode == "to_first":
                new_index = 0
            else:
                new_index = len(pool) - 1
            pool.remove(member["id"])
        pool.insert(new_index, member["id"])
        if pool == rule.get("pool", []):
            raise ToolError("人员顺序没有发生变化")
        candidate = dict(self._schedule_config(rule), pool=pool)
        saved = await self.service.call("validated_rule", candidate)
        proposed = dict(saved, revision=rule["revision"])
        preview = await self._preview_schedule_change(rule, saved, "调整人员顺序")
        return await self._member_pending(
            identity,
            "move_member",
            {
                "schedule_id": rule["id"],
                "before": self._schedule_view(rule),
                "after": proposed,
            },
            preview,
        )

    async def _list_schedules(self, query: str = "") -> dict[str, Any]:
        needle = str(query or "").strip().casefold()
        output = []
        for rule in await self._rules():
            if needle and needle not in str(rule.get("name", "")).casefold():
                continue
            item = self._schedule_view(rule)
            try:
                selected, _ = await self.service.call("selection", rule)
                item["next_members"] = [m["data"]["name"] for m in selected]
                item["selection_error"] = ""
            except ValueError as exc:
                item["next_members"] = []
                item["selection_error"] = str(exc)
            output.append(item)
        return {"ok": True, "count": len(output), "schedules": output}

    @staticmethod
    def _schedule_view(rule: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": rule["id"],
            "name": rule.get("name", ""),
            "enabled": rule.get("enabled", False),
            "platform_id": rule.get("platform_id", ""),
            "group_id": rule.get("group_id", ""),
            "time": rule.get("time", ""),
            "weekdays": rule.get("weekdays", []),
            "pool": rule.get("pool", []),
            "count": rule.get("count", 1),
            "start_date": rule.get("start_date", ""),
            "message": rule.get("message", ""),
            "cursor": rule.get("cursor", 0),
            "revision": rule.get("revision", 0),
        }

    @staticmethod
    def _schedule_config(rule: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "name",
            "platform_id",
            "group_id",
            "time",
            "weekdays",
            "pool",
            "count",
            "start_date",
            "message",
            "enabled",
        )
        return {key: rule.get(key) for key in keys}

    async def _get_schedule(
        self,
        schedule_id: str = "",
        schedule_name: str = "",
    ) -> dict[str, Any]:
        members = await self._members()
        rule = await self._resolve_schedule(schedule_id, schedule_name)
        by_id = {person["id"]: person for person in members}
        try:
            selected, next_cursor = await self.service.call("selection", rule)
            next_members = [self._member_view(member) for member in selected]
            selection_error = ""
        except ValueError as exc:
            next_cursor = rule.get("cursor", 0)
            next_members = []
            selection_error = str(exc)
        result = self._schedule_view(rule)
        result["pool_members"] = [
            self._member_view(by_id[key])
            for key in rule.get("pool", [])
            if key in by_id
        ]
        result["next_cursor"] = next_cursor
        result["next_members"] = next_members
        result["selection_error"] = selection_error
        return {"ok": True, "schedule": result}

    async def _validate_platform(self, platform_id: str) -> None:
        configured = await self.service.platforms()
        if platform_id not in {str(item.get("id", "")) for item in configured}:
            raise ToolError("机器人账号不可用，请检查 OneBot 连接配置")

    async def _resolve_pool(self, values: list[str]) -> list[str]:
        if not isinstance(values, list) or not values:
            raise ToolError("人员池不能为空")
        members = await self._members()
        ids: list[str] = []
        for value in values:
            identifier = str(value or "").strip()
            if not identifier:
                raise ToolError("人员池成员标识不能为空")
            matches = [person for person in members if person["id"] == identifier]
            if not matches:
                matches = [
                    person
                    for person in members
                    if str(person["data"].get("qq", "")) == identifier
                ]
            if not matches:
                needle = identifier.casefold()
                matches = [
                    person
                    for person in members
                    if str(person["data"].get("name", "")).casefold() == needle
                ]
            if len(matches) != 1:
                raise ToolError(f"人员池成员无法唯一匹配：{identifier}")
            member = matches[0]
            if member["data"].get("status") != "在职":
                raise ToolError(f"人员池只能包含在职成员：{identifier}")
            if member["id"] in ids:
                raise ToolError("人员池不能包含重复成员")
            ids.append(member["id"])
        return ids

    @staticmethod
    def _normalize_pool_operation(operation: str) -> str:
        value = str(operation or "").strip().casefold()
        if value in {"add", "加入", "添加"}:
            return "add"
        if value in {"remove", "移出", "移除", "删除"}:
            return "remove"
        raise ToolError("人员池操作只能是 add 或 remove")

    @staticmethod
    def _normalize_move_mode(mode: str) -> str:
        value = str(mode or "").strip().casefold()
        aliases = {
            "forward": "forward",
            "向前": "forward",
            "前移": "forward",
            "上移": "forward",
            "backward": "backward",
            "向后": "backward",
            "后移": "backward",
            "下移": "backward",
            "to_first": "to_first",
            "first": "to_first",
            "第一位": "to_first",
            "移到第一位": "to_first",
            "to_last": "to_last",
            "last": "to_last",
            "最后一位": "to_last",
            "移到最后一位": "to_last",
            "before": "before",
            "前面": "before",
            "移到前面": "before",
            "after": "after",
            "后面": "after",
            "移到后面": "after",
        }
        if value not in aliases:
            raise ToolError("不支持的移动方式")
        return aliases[value]

    async def _preview_schedule_change(
        self,
        rule: dict[str, Any],
        saved: dict[str, Any],
        title: str,
        creating: bool = False,
    ) -> dict[str, Any]:
        members = await self._members()
        by_id = {person["id"]: person for person in members}
        old_pool = list(rule.get("pool", []))
        new_pool = list(saved.get("pool", []))
        old_cursor = int(rule.get("cursor", 0))
        next_id = old_pool[old_cursor % len(old_pool)] if old_pool else ""
        new_cursor = new_pool.index(next_id) if next_id in new_pool else 0
        proposed_rule = dict(saved, id=rule.get("id", ""), cursor=new_cursor)
        proposed_rule["revision"] = rule.get("revision", 0)
        before_next: list[str] = []
        before_error = ""
        if not creating:
            try:
                before, _ = await self.service.call("selection", rule)
                before_next = [member["data"]["name"] for member in before]
            except ValueError as exc:
                before_error = str(exc)
        after, _ = await self.service.call("selection", proposed_rule)

        def names(pool):
            return [
                by_id[key]["data"]["name"] for key in pool if key in by_id
            ]

        preview = {
            "title": title,
            "schedule_id": rule.get("id", ""),
            "revision": rule.get("revision", 0),
            "before_order": names(old_pool),
            "after_order": names(new_pool),
            "before_next": before_next,
            "before_selection_error": before_error,
            "after_next": [m["data"]["name"] for m in after],
            "after_cursor": new_cursor,
            "before": None if creating else self._schedule_view(rule),
            "after": self._schedule_view(proposed_rule),
            "schedule": self._schedule_view(proposed_rule),
        }
        return preview

    async def _ensure_rule_editable(self, rule: dict[str, Any]) -> None:
        logs = await self.service.call("logs")
        if any(
            item["rule_id"] == rule["id"]
            and item["kind"] == "scheduled"
            and item["status"] in ("sending", "failed", "unknown")
            for item in logs
        ):
            raise ToolError("存在未处理的发送记录，请先处理后再修改排班")

    async def _rotation_rounds(
        self,
        rule: dict[str, Any],
        rounds: int,
    ) -> list[dict[str, Any]]:
        output = []
        cursor = int(rule.get("cursor", 0))
        for _ in range(rounds):
            probe = dict(rule, cursor=cursor)
            selected, cursor = await self.service.call("selection", probe)
            output.append(
                {
                    "members": [self._member_view(member) for member in selected],
                    "next_cursor": cursor,
                }
            )
        return output

    async def _preview_rotation(
        self,
        schedule_id: str = "",
        schedule_name: str = "",
        rounds: int = 3,
    ) -> dict[str, Any]:
        # Read-only rotation preview never mutates rows, cursors, or runs.
        if type(rounds) is not int or not 1 <= rounds <= 20:
            raise ToolError("预览轮数需要在 1 到 20 之间")
        rule = await self._resolve_schedule(schedule_id, schedule_name)
        return {
            "ok": True,
            "schedule": self._schedule_view(rule),
            "rounds": await self._rotation_rounds(rule, rounds),
        }

    async def _get_send_records(
        self,
        schedule_id: str = "",
        schedule_name: str = "",
        status: str = "",
        limit: int = 50,
    ) -> dict[str, Any]:
        if status and status not in RUN_STATUSES:
            raise ToolError("发送状态无效")
        if type(limit) is not int or not 1 <= limit <= 200:
            raise ToolError("查询条数需要在 1 到 200 之间")
        rule = None
        if schedule_id or schedule_name:
            rule = await self._resolve_schedule(schedule_id, schedule_name)
        records = await self.service.call("logs", 200)
        output = []
        for record in records:
            if rule and record["rule_id"] != rule["id"]:
                continue
            if status and record["status"] != status:
                continue
            snapshot = record.get("snapshot", {})
            output.append(
                {
                    "id": record["id"],
                    "schedule_id": record["rule_id"],
                    "schedule_name": snapshot.get("rule", {}).get("name", ""),
                    "day": record["day"],
                    "kind": record["kind"],
                    "status": record["status"],
                    "error": record.get("error", ""),
                    "message_id": record.get("message_id"),
                    "created_at": record["created_at"],
                    "updated_at": record["updated_at"],
                    "members": [
                        member.get("data", {}).get("name", "")
                        for member in snapshot.get("members", [])
                    ],
                }
            )
            if len(output) >= limit:
                break
        return {"ok": True, "count": len(output), "records": output}

    async def _confirm_change(
        self,
        identity: AdminIdentity,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        change = await self.confirmations.consume(
            identity,
            str(confirmation_id or "").strip() or None,
        )
        result = await self._execute_change(change)
        return {
            "ok": True,
            "confirmed": True,
            "action": change.action,
            "result": result,
            "before": change.payload.get("before"),
            "after": change.payload.get("after"),
            "message": "操作已执行。",
        }

    async def _execute_change(self, change: PendingChange) -> dict[str, Any]:
        payload = change.payload
        if change.action == "create_member":
            return await self._commit_create_member(payload)
        if change.action == "update_member":
            return await self._commit_update_member(payload)
        if change.action in (
            "create_schedule",
            "update_schedule",
            "pool_member",
            "move_member",
        ):
            return await self._commit_schedule_change(change.action, payload)
        raise ToolError("待确认操作类型无效")

    async def _commit_create_member(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = dict(payload["after"])
        async with self.service.lock:
            members = await asyncio.to_thread(self.store.members)
            if any(
                str(member["data"].get("qq", "")) == str(data.get("qq", ""))
                for member in members
            ):
                raise ToolError("QQ 号已被使用")
            await asyncio.to_thread(self.store.save_members, [data])
            created = [
                member
                for member in await asyncio.to_thread(self.store.members)
                if member["data"].get("qq") == data.get("qq")
            ]
        if not created:
            raise ToolError("成员创建后未能读取到记录")
        return {"member": self._member_view(created[-1])}

    async def _commit_update_member(self, payload: dict[str, Any]) -> dict[str, Any]:
        expected = payload["before"]
        data = dict(payload["after"])
        reason = str(payload.get("reason") or "管理员通过 QQ AI 修改")
        member_id = payload["member_id"]
        async with self.service.lock:
            current = next(
                (
                    member
                    for member in await asyncio.to_thread(self.store.members)
                    if member["id"] == member_id
                ),
                None,
            )
            if current is None:
                raise ToolError("成员不存在或已被删除")
            if current["data"] != expected:
                raise ToolError("成员档案在预览后已被修改，请重新生成预览")
            await asyncio.to_thread(
                self.store.save_members,
                [data],
                member_id,
                reason,
            )
            updated = next(
                (
                    member
                    for member in await asyncio.to_thread(self.store.members)
                    if member["id"] == member_id
                ),
                None,
            )
        if updated is None:
            raise ToolError("成员修改后未能读取到记录")
        return {"member": self._member_view(updated)}

    async def _commit_schedule_change(
        self,
        action: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        key = payload.get("schedule_id")
        candidate = dict(payload["after"])
        await self._validate_platform(candidate["platform_id"])
        saved = await self.service.call("save_rule", payload["after"], key)
        await self.service.reschedule()
        return {"schedule": self._schedule_view(saved), "change": action}

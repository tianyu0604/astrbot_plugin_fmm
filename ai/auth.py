"""Trusted administrator authentication for FMM LLM tools."""

from dataclasses import dataclass
from typing import Any, Callable

PERMISSION_DENIED = "该功能仅限 AstrBot 管理员使用。"


class AdminDenied(Exception):
    """The current event is not an authenticated AstrBot administrator."""

    def __init__(self, identity: "AdminIdentity | None" = None):
        super().__init__(PERMISSION_DENIED)
        self.identity = identity


@dataclass(frozen=True)
class AdminIdentity:
    admin_id: str
    platform_id: str
    session_id: str


def _method_or_value(obj: Any, name: str) -> Any:
    value = getattr(obj, name, None)
    return value() if callable(value) else value


def _config_get(config: Any, key: str, default: Any = None) -> Any:
    getter = getattr(config, "get", None)
    return getter(key, default) if callable(getter) else default


def require_fmm_admin(
    event: Any,
    config_provider: Callable[[Any], Any],
) -> AdminIdentity:
    """Validate the real sender against AstrBot's current administrator config.

    The event role alone is not trusted. The sender must also still appear in
    the latest ``admins_id`` configuration for the event's session.
    """

    identity = None
    try:
        sender_id = str(
            _method_or_value(event, "get_sender_id") or ""
        ).strip()
        platform_id = str(
            _method_or_value(event, "get_platform_id") or ""
        ).strip()
        session_id = str(
            getattr(event, "unified_msg_origin", "") or ""
        ).strip()
        identity = (
            AdminIdentity(sender_id, platform_id, session_id)
            if sender_id and platform_id and session_id
            else None
        )
        if identity is None:
            raise AdminDenied(identity)
        is_admin = bool(_method_or_value(event, "is_admin"))
        config = config_provider(event)
        admins = _config_get(config, "admins_id", [])
        configured = {str(item).strip() for item in admins or [] if str(item).strip()}
    except AdminDenied:
        raise
    except Exception as exc:
        raise AdminDenied(identity) from exc

    if not is_admin or sender_id not in configured:
        raise AdminDenied(identity)
    return identity

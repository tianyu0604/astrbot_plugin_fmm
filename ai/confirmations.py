"""Short-lived, administrator-bound confirmations for FMM changes."""

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from .auth import AdminIdentity


class ConfirmationError(ValueError):
    """A pending change is missing, expired, consumed, or belongs to another user."""


@dataclass
class PendingChange:
    token: str
    identity: AdminIdentity
    action: str
    payload: dict[str, Any]
    preview: dict[str, Any]
    expires_at: float
    created_at: float = field(default_factory=time.time)


class ConfirmationManager:
    """In-memory one-time confirmations; plugin restart safely discards them."""

    def __init__(self, ttl_seconds: int = 10 * 60):
        self.ttl_seconds = ttl_seconds
        self._pending: dict[str, PendingChange] = {}
        self._lock = asyncio.Lock()

    def _purge(self, now: float) -> None:
        for token in [
            key for key, change in self._pending.items() if change.expires_at <= now
        ]:
            self._pending.pop(token, None)

    async def create(
        self,
        identity: AdminIdentity,
        action: str,
        payload: dict[str, Any],
        preview: dict[str, Any],
    ) -> PendingChange:
        async with self._lock:
            now = time.time()
            self._purge(now)
            # Only the latest pending change per administrator/session may execute.
            for token in [
                key
                for key, change in self._pending.items()
                if change.identity == identity
            ]:
                self._pending.pop(token, None)
            change = PendingChange(
                token=secrets.token_urlsafe(18),
                identity=identity,
                action=action,
                payload=payload,
                preview=preview,
                expires_at=now + self.ttl_seconds,
            )
            self._pending[change.token] = change
            return change

    async def peek(
        self,
        identity: AdminIdentity,
        token: str,
    ) -> PendingChange:
        async with self._lock:
            self._purge(time.time())
            change = self._pending.get(str(token))
            if change is None or change.identity != identity:
                raise ConfirmationError("待确认操作不存在或已经失效，请重新生成预览")
            return change

    async def consume(
        self,
        identity: AdminIdentity,
        token: str | None = None,
    ) -> PendingChange:
        async with self._lock:
            self._purge(time.time())
            if token:
                change = self._pending.get(str(token))
                if change is None or change.identity != identity:
                    raise ConfirmationError("待确认操作不存在或已经失效，请重新生成预览")
            else:
                matches = [
                    change
                    for change in self._pending.values()
                    if change.identity == identity
                ]
                if not matches:
                    raise ConfirmationError("当前会话没有待确认操作，请先让管理员生成预览")
                if len(matches) > 1:
                    raise ConfirmationError("当前会话存在多个待确认操作，请提供 confirmation_id")
                change = matches[0]
            # Consume before executing so concurrent duplicate confirms cannot both run.
            self._pending.pop(change.token, None)
            return change

    async def close(self) -> None:
        async with self._lock:
            self._pending.clear()

import asyncio
import importlib.util
import logging
import sys
import types
from pathlib import Path

import pytest

from astrbot_plugin_fmm.service import DeliveryRejected


@pytest.fixture
def plugin_module(monkeypatch):
    api = types.ModuleType("astrbot.api")
    api.AstrBotConfig = dict
    api.logger = logging.getLogger("test.astrbot")

    def llm_tool(name):
        def decorate(function):
            function._llm_tool_name = name
            return function

        return decorate

    api.llm_tool = llm_tool
    star = types.ModuleType("astrbot.api.star")

    class Star:
        def __init__(self, context):
            self.context = context

    star.Star, star.Context, star.StarTools = Star, object, object
    exceptions = types.ModuleType("aiocqhttp.exceptions")
    exceptions.ActionFailed = type("ActionFailed", (Exception,), {})
    for name, module in (("astrbot", types.ModuleType("astrbot")), ("astrbot.api", api),
                         ("astrbot.api.star", star), ("aiocqhttp", types.ModuleType("aiocqhttp")),
                         ("aiocqhttp.exceptions", exceptions)):
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location(
        "astrbot_plugin_fmm.main",
        Path(__file__).resolve().parents[1] / "main.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, exceptions.ActionFailed


def test_all_fmm_ai_tools_are_registered(plugin_module):
    module, _ = plugin_module
    names = [
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
    ]
    for name in names:
        method = getattr(module.FMMPlugin, name)
        assert callable(method)
        assert method._llm_tool_name == name


@pytest.mark.parametrize("outcome", ["sent", "preflight", "rejected", "missing_id", "disconnected"])
def test_onebot_structured_mentions_and_delivery_errors(plugin_module, outcome):
    module, action_failed = plugin_module
    calls = []

    class Bot:
        async def call_action(self, action, **params):
            calls.append((action, params))
            if action == "get_group_member_info" and outcome == "preflight":
                raise RuntimeError("not in group")
            if action == "send_group_msg":
                if outcome == "rejected":
                    raise action_failed("rejected")
                if outcome == "disconnected":
                    raise ConnectionError("closed")
                return {} if outcome == "missing_id" else {"message_id": 42}
            return {"ok": True}

    platform = types.SimpleNamespace(meta=lambda: types.SimpleNamespace(name="aiocqhttp", id="bot1"), get_client=lambda: Bot())
    context = types.SimpleNamespace(get_platform_inst=lambda key: platform)
    plugin = module.FMMPlugin(context, {})
    snapshot = {"rule": {"platform_id": "bot1", "group_id": "123456"},
                "members": [{"data": {"qq": "12345"}}, {"data": {"qq": "54321"}}],
                "text": "[CQ:at,qq=all] literal user text"}

    async def scenario():
        if outcome in ("preflight", "rejected"):
            with pytest.raises(DeliveryRejected):
                await plugin.send_reminder(snapshot)
        elif outcome in ("missing_id", "disconnected"):
            with pytest.raises((RuntimeError, ConnectionError)):
                await plugin.send_reminder(snapshot)
        else:
            assert await plugin.send_reminder(snapshot) == 42

    asyncio.run(scenario())
    sends = [params for action, params in calls if action == "send_group_msg"]
    if outcome == "preflight":
        assert sends == []
    else:
        assert sends[0]["group_id"] == 123456
        assert [segment["data"]["qq"] for segment in sends[0]["message"] if segment["type"] == "at"] == ["12345", "54321"]
        assert sends[0]["message"][-1] == {"type": "text", "data": {"text": "\n" + snapshot["text"]}}

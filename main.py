from pathlib import Path

from aiohttp import web
from astrbot.api import AstrBotConfig, logger
from astrbot.api.star import Context, Star, StarTools

from .service import DeliveryRejected, ReminderService
from .store import Store
from .sync import SyncService
from .web import API, create_app, password_for


class FMMPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        self.runner = None
        self.service = None

    async def platforms(self):
        return [{"id": p.meta().id, "name": p.meta().id}
                for p in self.context.platform_manager.get_insts() if p.meta().name == "aiocqhttp"]

    async def send_reminder(self, snapshot):
        rule = snapshot["rule"]
        platform = self.context.get_platform_inst(rule["platform_id"])
        if platform is None or platform.meta().name != "aiocqhttp":
            raise DeliveryRejected("OneBot 机器人账号不可用")
        bot = platform.get_client()
        try:
            await bot.call_action("get_group_info", group_id=int(rule["group_id"]))
            for member in snapshot["members"]:
                await bot.call_action("get_group_member_info", group_id=int(rule["group_id"]),
                                      user_id=int(member["data"]["qq"]), no_cache=True)
        except Exception as exc:
            raise DeliveryRejected("发送前群聊/成员检查失败：" + str(exc)) from exc
        message = []
        for member in snapshot["members"]:
            message.extend([{"type": "at", "data": {"qq": member["data"]["qq"]}},
                            {"type": "text", "data": {"text": " "}}])
        message.append({"type": "text", "data": {"text": "\n" + snapshot["text"]}})
        # OneBot structured segments prevent user prose from being parsed as CQ codes.
        from aiocqhttp.exceptions import ActionFailed
        try:
            response = await bot.call_action("send_group_msg", group_id=int(rule["group_id"]), message=message)
        except ActionFailed as exc:
            raise DeliveryRejected("OneBot 明确拒绝发送：" + str(exc)) from exc
        if not isinstance(response, dict) or not response.get("message_id"):
            raise RuntimeError("OneBot 未返回 message_id，请检查群消息后人工确认")
        return response["message_id"]

    def bot(self, platform_id=None):
        """取 OneBot 客户端：给了 platform_id 就用它，否则取第一个 aiocqhttp 实例。"""
        platform = self.context.get_platform_inst(platform_id) if platform_id else None
        if platform is None:
            platform = next((p for p in self.context.platform_manager.get_insts()
                             if p.meta().name == "aiocqhttp"), None)
        if platform is None or platform.meta().name != "aiocqhttp":
            raise DeliveryRejected("OneBot 机器人账号不可用")
        return platform.get_client()

    async def fetch_group(self, platform_id, group_id):
        bot = self.bot(platform_id)
        info = await bot.call_action("get_group_info", group_id=int(group_id))
        members = await bot.call_action("get_group_member_list", group_id=int(group_id))
        return info, members

    async def fetch_groups(self, platform_id=None):
        return await self.bot(platform_id).call_action("get_group_list")

    async def fetch_bot_qq(self, platform_id=None):
        info = await self.bot(platform_id).call_action("get_login_info")
        return str(info.get("user_id", ""))

    async def initialize(self):
        data_dir = StarTools.get_data_dir("astrbot_plugin_fmm")
        password = password_for(data_dir, str(self.config.get("web_password", "")))
        store = Store(data_dir / "fmm.sqlite3")
        self.service = ReminderService(store, self.send_reminder, self.platforms)
        sync = SyncService(store, self.config, fetch=self.fetch_group, groups_of=self.fetch_groups,
                           bot_qq=self.fetch_bot_qq, uploads=data_dir / "uploads",
                           image_prefix=API + "/images/")
        self.runner = web.AppRunner(create_app(self.service, data_dir, password, sync=sync))
        try:
            await self.runner.setup()
            host = self.config.get("web_host", "127.0.0.1")
            port = int(self.config.get("web_port", 8765))
            await web.TCPSite(self.runner, host, port).start()
            await self.service.start()
        except Exception:
            await self.terminate()
            raise
        logger.info("FMM 管理页面：http://%s:%s；数据目录：%s", host, port, data_dir)
        if not self.config.get("web_password"):
            logger.info("FMM 管理密码保存在 %s", data_dir / "admin_password.txt")

    async def terminate(self):
        if self.runner:
            await self.runner.cleanup()
            self.runner = None
        if self.service:
            await self.service.close()
            self.service = None

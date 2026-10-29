from pathlib import Path

from aiohttp import web
from astrbot.api import AstrBotConfig, llm_tool, logger
from astrbot.api.star import Context, Star, StarTools

from .ai import AIManager
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
        self.ai = None

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
        self.ai = AIManager(
            self.service,
            lambda event: self.context.get_config(umo=event.unified_msg_origin),
        )
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
        if self.ai:
            await self.ai.close()
            self.ai = None
        if self.service:
            await self.service.close()
            self.service = None

    @llm_tool("fmm_find_members")
    async def fmm_find_members(
        self,
        event,
        name: str = "",
        qq: str = "",
        status: str = "",
    ) -> str:
        """查询 FMM 成员档案。仅在管理员需要查找成员时调用。

        Args:
            name(string): 姓名或姓名的一部分，可为空。
            qq(string): QQ 号或其中一部分，可为空。
            status(string): 在职、劝退或光荣退休，可为空。
        """
        return await self.ai.execute(
            event,
            "fmm_find_members",
            name=name,
            qq=qq,
            status=status,
        )

    @llm_tool("fmm_create_member")
    async def fmm_create_member(
        self,
        event,
        name: str,
        qq: str,
        gender: str,
        status: str = "在职",
        custom_fields: dict | None = None,
    ) -> str:
        """预览创建 FMM 成员。必须取得管理员明确确认后才能提交。

        Args:
            name(string): 成员真实姓名。
            qq(string): 唯一的 5 到 12 位 QQ 号。
            gender(string): 男、女或未知。
            status(string): 在职、劝退或光荣退休，默认在职。
            custom_fields(object): 可选，自定义字段 ID 到值的对象。
        """
        return await self.ai.execute(
            event,
            "fmm_create_member",
            name=name,
            qq=qq,
            gender=gender,
            status=status,
            custom_fields=custom_fields,
        )

    @llm_tool("fmm_update_member")
    async def fmm_update_member(
        self,
        event,
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        name: str | None = None,
        qq: str | None = None,
        gender: str | None = None,
        status: str | None = None,
        custom_fields: dict | None = None,
        reason: str = "",
    ) -> str:
        """预览修改 FMM 成员档案。必须取得管理员明确确认后才能提交。

        Args:
            member_id(string): 成员 ID；已知时优先使用。
            member_name(string): 成员姓名；仅在唯一匹配时使用。
            member_qq(string): 成员 QQ；用于唯一匹配。
            name(string): 修改后的姓名。
            qq(string): 修改后的 QQ。
            gender(string): 修改后的性别：男、女或未知。
            status(string): 修改后的状态：在职、劝退或光荣退休。
            custom_fields(object): 自定义字段 ID 到新值的对象；null 表示清空字段。
            reason(string): 修改原因，必填。
        """
        return await self.ai.execute(
            event,
            "fmm_update_member",
            member_id=member_id,
            member_name=member_name,
            member_qq=member_qq,
            name=name,
            qq=qq,
            gender=gender,
            status=status,
            custom_fields=custom_fields,
            reason=reason,
        )

    @llm_tool("fmm_list_schedules")
    async def fmm_list_schedules(self, event, query: str = "") -> str:
        """列出 FMM 排班及下一轮成员，可按排班名称筛选。

        Args:
            query(string): 排班名称的一部分，可为空。
        """
        return await self.ai.execute(event, "fmm_list_schedules", query=query)

    @llm_tool("fmm_get_schedule")
    async def fmm_get_schedule(
        self,
        event,
        schedule_id: str = "",
        schedule_name: str = "",
    ) -> str:
        """查询指定 FMM 排班的配置、有序人员池和下一次预计成员。

        Args:
            schedule_id(string): 排班 ID；已知时优先使用。
            schedule_name(string): 排班名称；仅在唯一匹配时使用。
        """
        return await self.ai.execute(
            event,
            "fmm_get_schedule",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
        )

    @llm_tool("fmm_create_schedule")
    async def fmm_create_schedule(
        self,
        event,
        name: str,
        platform_id: str,
        group_id: str,
        time: str,
        weekdays: list[int],
        pool: list[str],
        count: int = 1,
        start_date: str = "",
        message: str = "",
        enabled: bool = False,
    ) -> str:
        """预览创建 FMM 排班；默认暂停，只有管理员明确要求时才启用。

        Args:
            name(string): 排班名称。
            platform_id(string): AstrBot OneBot 机器人账号 ID。
            group_id(string): 目标 QQ 群号。
            time(string): 北京时间提醒时间，格式 HH:MM。
            weekdays(array[number]): 执行星期，0 表示周一，6 表示周日。
            pool(array[string]): 有序人员池，每项可填成员 ID、唯一姓名或 QQ。
            count(number): 每次提醒人数，默认 1。
            start_date(string): 开始日期，格式 YYYY-MM-DD。
            message(string): 附加文案，可使用 {date}、{names}、{schedule}。
            enabled(boolean): 是否启用；只有管理员明确要求时才设为 true。
        """
        return await self.ai.execute(
            event,
            "fmm_create_schedule",
            name=name,
            platform_id=platform_id,
            group_id=group_id,
            time=time,
            weekdays=weekdays,
            pool=pool,
            count=count,
            start_date=start_date,
            message=message,
            enabled=enabled,
        )

    @llm_tool("fmm_update_schedule")
    async def fmm_update_schedule(
        self,
        event,
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
    ) -> str:
        """预览修改 FMM 排班配置。必须取得管理员明确确认后才能提交。

        Args:
            schedule_id(string): 排班 ID；已知时优先使用。
            schedule_name(string): 排班名称；仅在唯一匹配时使用。
            name(string): 新排班名称。
            platform_id(string): 新 OneBot 机器人账号 ID。
            group_id(string): 新目标 QQ 群号。
            time(string): 新提醒时间，格式 HH:MM。
            weekdays(array[number]): 新执行星期，0 表示周一，6 表示周日。
            count(number): 新的一次提醒人数。
            start_date(string): 新开始日期，格式 YYYY-MM-DD。
            message(string): 新附加文案。
            enabled(boolean): 新启用状态。
        """
        return await self.ai.execute(
            event,
            "fmm_update_schedule",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
            name=name,
            platform_id=platform_id,
            group_id=group_id,
            time=time,
            weekdays=weekdays,
            count=count,
            start_date=start_date,
            message=message,
            enabled=enabled,
        )

    @llm_tool("fmm_manage_pool_member")
    async def fmm_manage_pool_member(
        self,
        event,
        schedule_id: str = "",
        schedule_name: str = "",
        member_id: str = "",
        member_name: str = "",
        member_qq: str = "",
        operation: str = "",
    ) -> str:
        """预览把已有成员加入或移出指定排班人员池，不删除成员档案。

        Args:
            schedule_id(string): 排班 ID；已知时优先使用。
            schedule_name(string): 排班名称；仅在唯一匹配时使用。
            member_id(string): 成员 ID；已知时优先使用。
            member_name(string): 唯一成员姓名。
            member_qq(string): 唯一成员 QQ。
            operation(string): add 表示加入，remove 表示移出。
        """
        return await self.ai.execute(
            event,
            "fmm_manage_pool_member",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
            member_id=member_id,
            member_name=member_name,
            member_qq=member_qq,
            operation=operation,
        )

    @llm_tool("fmm_move_member")
    async def fmm_move_member(
        self,
        event,
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
    ) -> str:
        """预览调整排班人员池顺序，并保持当前下一轮成员不变（如仍在池中）。

        Args:
            schedule_id(string): 排班 ID；已知时优先使用。
            schedule_name(string): 排班名称；仅在唯一匹配时使用。
            member_id(string): 要移动的成员 ID。
            member_name(string): 要移动的唯一成员姓名。
            member_qq(string): 要移动的唯一成员 QQ。
            mode(string): forward、backward、before、after、to_first 或 to_last。
            offset(number): 向前或向后移动位数，默认 1。
            target_member_id(string): before/after 模式的目标成员 ID。
            target_member_name(string): before/after 模式的目标成员唯一姓名。
            target_member_qq(string): before/after 模式的目标成员唯一 QQ。
        """
        return await self.ai.execute(
            event,
            "fmm_move_member",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
            member_id=member_id,
            member_name=member_name,
            member_qq=member_qq,
            mode=mode,
            offset=offset,
            target_member_id=target_member_id,
            target_member_name=target_member_name,
            target_member_qq=target_member_qq,
        )

    @llm_tool("fmm_preview_rotation")
    async def fmm_preview_rotation(
        self,
        event,
        schedule_id: str = "",
        schedule_name: str = "",
        rounds: int = 3,
    ) -> str:
        """只读预览排班接下来若干轮的成员，不推进轮换或发送消息。

        Args:
            schedule_id(string): 排班 ID；已知时优先使用。
            schedule_name(string): 排班名称；仅在唯一匹配时使用。
            rounds(number): 预览轮数，1 到 20，默认 3。
        """
        return await self.ai.execute(
            event,
            "fmm_preview_rotation",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
            rounds=rounds,
        )

    @llm_tool("fmm_get_send_records")
    async def fmm_get_send_records(
        self,
        event,
        schedule_id: str = "",
        schedule_name: str = "",
        status: str = "",
        limit: int = 50,
    ) -> str:
        """只读查询 FMM 群提醒发送历史和失败记录。

        Args:
            schedule_id(string): 可选排班 ID。
            schedule_name(string): 可选排班名称；仅在唯一匹配时使用。
            status(string): sending、sent、failed、unknown 或 skipped，可为空。
            limit(number): 最多返回条数，1 到 200，默认 50。
        """
        return await self.ai.execute(
            event,
            "fmm_get_send_records",
            schedule_id=schedule_id,
            schedule_name=schedule_name,
            status=status,
            limit=limit,
        )

    @llm_tool("fmm_confirm_change")
    async def fmm_confirm_change(
        self,
        event,
        confirmation_id: str = "",
    ) -> str:
        """提交本会话最近的待确认 FMM 修改。仅在真实管理员明确回复确认后调用。

        Args:
            confirmation_id(string): 预览返回的确认 ID；通常可省略。
        """
        return await self.ai.execute(
            event,
            "fmm_confirm_change",
            confirmation_id=confirmation_id,
        )

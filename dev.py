"""Run from the workspace: python -m astrbot_plugin_fmm.dev (never sends to QQ)."""
import argparse
import os
from pathlib import Path

from aiohttp import web

from .service import DeliveryRejected, ReminderService
from .store import Store
from .web import create_app, password_for


async def unavailable(snapshot):
    raise DeliveryRejected("独立预览模式没有连接 AstrBot，未发送 QQ 消息")


async def platforms():
    return [{"id": "preview-onebot", "name": "本地预览（不发送消息）"}]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", default=".fmm-preview")
    args = parser.parse_args()
    path = Path(args.data_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    password = password_for(path, os.environ.get("FMM_WEB_PASSWORD", ""))
    service = ReminderService(Store(path / "fmm.sqlite3"), unavailable, platforms)
    app = create_app(service, path, password)

    async def start(app):
        await service.start()

    async def stop(app):
        await service.close()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    print(f"Preview password file: {path / 'admin_password.txt'}")
    web.run_app(app, host="127.0.0.1", port=args.port, print=print)


if __name__ == "__main__":
    main()

import asyncio

import pytest
from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer

from astrbot_plugin_fmm.legacy import export_preview, member_data
from astrbot_plugin_fmm.service import ReminderService
from astrbot_plugin_fmm.store import Store
from astrbot_plugin_fmm.web import API, create_app


def test_original_member_mapping_and_export(tmp_path):
    store = Store(tmp_path / 'data.sqlite3')
    data = member_data(dict(name='同名', gender='未知', status='在职', photo=[],
                            customFields=dict(qq='12345', role='运营', points=2)))
    assert data['qq'] == '12345'
    store.save_members([data, dict(data, qq='54321', points=10)])
    preview = export_preview(store.members(), dict(filter=dict(customFields=dict(role=['运营'])),
                                                  sortRules=[dict(field='points', order='DESC')]))
    assert preview['total'] == 2
    assert preview['members'][0]['qq'] == '54321'
    assert preview['members'][0]['customFields']['points'] == 10
    assert export_preview(store.members(), dict(filter=dict(gender=['女'])))['total'] == 0
    with pytest.raises(ValueError):
        member_data(dict(name='错误', gender='未知', status='在职', photo='invalid'))


def test_original_pages_sqlite_routes_and_restart(tmp_path):
    async def scenario():
        store = Store(tmp_path / 'data.sqlite3')
        async def platforms():
            return []
        async def sender(snapshot):
            return 'test'
        service = ReminderService(store, sender, platforms)
        client = TestClient(TestServer(create_app(service, tmp_path, 'test-password-12345')),
                            cookie_jar=CookieJar(unsafe=True))
        await client.start_server()
        try:
            assert (await client.get(API + '/member/getMembers')).status == 401
            await client.post(API + '/login', json=dict(password='test-password-12345'))
            person = dict(name='张三', gender='未知', status='在职', photo=[], customFields=dict(qq='12345'))
            response = await client.post(API + '/member/batchMembers', json=dict(members=[person]))
            assert (await response.json())['data']['successCount'] == 1
            rows = (await (await client.get(API + '/member/getMembers')).json())['data']
            assert rows[0]['qq'] == '12345'
            assert (await client.post(API + '/member/batchMembers', json=dict(members=[person]))).status == 400
            person['customFields']['qq'] = '54321'
            await client.post(API + '/member/updateMember', json=dict(id=rows[0]['id'], updateDate=person, reason='更正'))
            history = (await (await client.post(API + '/member/getHistory', json=dict(id=rows[0]['id']))).json())['data']
            assert history[0]['afterDate']['qq'] == '54321'
            config = dict(title='团队名单', filter=dict(gender=[], status=[], customFields={}),
                          selectedFields=['name', 'qq'], sortRules=[])
            response = await client.post(API + '/export_roster/saveExportHistory', json=config)
            assert response.status == 200
            key = (await response.json())['data']['id']
            response = await client.post(API + '/export_roster/getExportHistoryDetail', json=dict(id=key))
            assert (await response.json())['data']['exportPreview']['members'][0]['qq'] == '54321'
            tasks = dict(tasks=[dict(id='task-1', name='原任务')], settings=dict(taskTypes=['推文'], departments=['MC']), history=[])
            assert (await client.post(API + '/tasks', json=tasks)).status == 200
            restarted = Store(store.path)
            assert restarted.documents('workspace')[0] == tasks
            assert restarted.documents('roster')[0]['selectedFields'] == ['name', 'qq']
            assert (await client.post(API + '/tasks', json=dict(tasks='invalid'))).status == 400
            assert (await client.post(API + '/export_roster/deleteExportHistory', json=dict(id=key))).status == 200
            assert Store(store.path).documents('roster') == []
        finally:
            await client.close()
            await service.close()
    asyncio.run(scenario())

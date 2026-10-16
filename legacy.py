"""Adapters for the original React member and roster pages."""

from uuid import uuid4

from .store import now_iso, require


def member_info(member):
    data = member["data"]
    builtin = {"name", "qq", "gender", "status", "photo"}
    return dict(id=member["id"], name=data["name"], qq=data["qq"], gender=data["gender"],
                status=data["status"], photo=[data["photo"]] if data.get("photo") else [],
                customFields={k: v for k, v in data.items() if k not in builtin},
                createTime=member["createdAt"], updateTime=member["updatedAt"])


def member_data(data):
    require(isinstance(data, dict), "成员数据格式错误")
    custom = data.get("customFields", {})
    require(isinstance(custom, dict), "自定义字段格式错误")
    photos = data.get("photo", [])
    require(isinstance(photos, list), "照片格式错误")
    return {**custom, **{k: data[k] for k in ("name", "gender", "status")},
            "qq": data.get("qq", custom.get("qq", "")), "photo": photos[0] if photos else ""}


def export_preview(members, config):
    filters = config.get("filter", {})
    require(isinstance(filters, dict), "筛选条件格式错误")
    custom = filters.get("customFields", {})
    require(isinstance(custom, dict), "筛选字段格式错误")
    constraints = {**custom, **{k: filters[k] for k in ("gender", "status") if k in filters}}
    require(all(isinstance(v, list) for v in constraints.values()), "筛选选项格式错误")
    selected = []
    for member in members:
        data = member["data"]
        if all(not values or any(str(v) in values for v in
               (data.get(key) if isinstance(data.get(key), list) else [data.get(key, "")]))
               for key, values in constraints.items()):
            selected.append(member_info(member))
    rules = config.get("sortRules", [])
    require(isinstance(rules, list), "排序规则格式错误")
    for rule in reversed(rules):
        key = rule["field"]
        def value(member):
            item = member.get(key, member["customFields"].get(key, ""))
            return (0, item) if isinstance(item, (int, float)) else (1, str(item or ""))
        selected.sort(key=value, reverse=rule.get("order") == "DESC")
    return {"members": selected, "total": len(selected)}


def register_legacy_routes(app, service, prefix, result):
    async def members(request):
        return result([member_info(m) for m in await service.call("members")])

    async def batch(request):
        body = await request.json()
        entries = body.get("members")
        require(isinstance(entries, list), "成员列表格式错误")
        await service.call("save_members", [member_data(m) for m in entries])
        return result(dict(successCount=len(entries), duplicateCount=[], paraseErrors=[]))

    async def update(request):
        body = await request.json()
        await service.call("save_members", [member_data(body["updateDate"])], body["id"], body.get("reason", ""))
        return result()

    async def history(request):
        body = await request.json()
        records = await service.call("history", body["id"])
        return result([dict(id=r["id"], memberId=r["memberId"], reason=r["reason"], updateTime=r["timestamp"],
                            beforeDate={c["field"]: c["oldValue"] for c in r["changes"]},
                            afterDate={c["field"]: c["newValue"] for c in r["changes"]}) for r in records])

    async def preview(request):
        return result(export_preview(await service.call("members"), await request.json()))

    async def options(request):
        fields = await service.call("fields")
        people = await service.call("members")
        output = []
        for field in fields:
            if field["hidden"] or field["type"] == "images":
                continue
            values = set()
            for person in people:
                value = person["data"].get(field["id"])
                for item in value if isinstance(value, list) else [value]:
                    if item is not None and str(item):
                        values.add(str(item))
            output.append(dict(id=field["id"], name=field["name"], options=sorted(values)))
        return result(output)

    async def save_export(request):
        body = await request.json()
        require(isinstance(body.get("title"), str) and 1 <= len(body["title"]) <= 100, "导出标题无效")
        require(isinstance(body.get("selectedFields"), list), "导出字段格式错误")
        export_preview(await service.call("members"), body)
        key = uuid4().hex
        saved = {**body, "id": key, "createTime": now_iso(), "isDeleted": False, "deletedTime": None}
        await service.call("save_document", "roster", key, saved)
        return result(saved)

    async def exports(request):
        rows = await service.call("documents", "roster")
        return result([dict(id=r["id"], title=r["title"], createTime=r["createTime"],
                            fieldCount=len(r["selectedFields"]), ruleCount=len(r.get("sortRules", []))) for r in rows])

    async def detail(request):
        body = await request.json()
        row = next((r for r in await service.call("documents", "roster") if r["id"] == body["id"]), None)
        require(row is not None, "导出记录不存在")
        row["exportPreview"] = export_preview(await service.call("members"), row)
        return result(row)

    async def delete_export(request):
        body = await request.json()
        await service.call("delete_document", "roster", body["id"])
        return result()

    async def tasks(request):
        if request.method == "POST":
            data = await request.json()
            require(isinstance(data.get("tasks"), list) and isinstance(data.get("settings"), dict)
                    and isinstance(data.get("history"), list), "任务数据格式错误")
            await service.call("save_document", "workspace", "tasks", data)
        rows = await service.call("documents", "workspace")
        return result(rows[0] if rows else None)

    app.router.add_get(prefix + "/member/getMembers", members)
    app.router.add_post(prefix + "/member/batchMembers", batch)
    app.router.add_post(prefix + "/member/updateMember", update)
    app.router.add_post(prefix + "/member/getHistory", history)
    app.router.add_post(prefix + "/export_roster/getExportPreview", preview)
    app.router.add_get(prefix + "/export_roster/getUsedOptions", options)
    app.router.add_post(prefix + "/export_roster/saveExportHistory", save_export)
    app.router.add_get(prefix + "/export_roster/getExportLists", exports)
    app.router.add_post(prefix + "/export_roster/getExportHistoryDetail", detail)
    app.router.add_post(prefix + "/export_roster/deleteExportHistory", delete_export)
    app.router.add_get(prefix + "/tasks", tasks)
    app.router.add_post(prefix + "/tasks", tasks)

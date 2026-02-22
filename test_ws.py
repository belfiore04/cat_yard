#!/usr/bin/env python3
"""
WebSocket 微信聊天系统测试脚本
测试内容：
1. 连接 /ws/chat WebSocket
2. 发送 sync 消息同步游戏状态
3. 发送 user_message 消息并验证收到 typing + message 响应
4. 静默等待，验证是否收到主动消息 (proactive)
"""

import asyncio
import json
import websockets
import sys

WS_URL = "ws://localhost:8090/ws/chat"

MOCK_STATE = {
    "type": "sync",
    "name": "保镖小哥",
    "persona": "冷酷但内心温柔的保镖，话不多但偶尔会吐槽",
    "schedule": {
        "routine": [
            {"days": [1, 2, 3, 4, 5], "start": 9, "end": 18, "activity": "工作", "location": "out", "reply_delay": [30, 120]},
        ],
        "sleep": [23, 7],
        "home_activities": ["休息", "擦拭装备", "发呆"]
    },
    "character_state": "home",
    "current_activity": "发呆",
    "simulated_day": 6,
    "simulated_hour": 20,
    "simulated_minute": 30,
    "voice_id": "test_voice"
}

async def test_ws():
    print(f"🔌 正在连接 {WS_URL}...")
    try:
        async with websockets.connect(WS_URL) as ws:
            print("✅ WebSocket 连接成功！\n")

            # 测试 1: 同步游戏状态
            print("📡 测试 1: 发送 sync 消息...")
            await ws.send(json.dumps(MOCK_STATE))
            print("   ✅ sync 消息已发送\n")
            await asyncio.sleep(1)

            # 测试 2: 发送用户消息
            print("💬 测试 2: 发送用户消息 '在干嘛呢'...")
            user_msg = {
                "type": "user_message",
                "content": "在干嘛呢",
                "history": [{"role": "user", "content": "在干嘛呢"}]
            }
            await ws.send(json.dumps(user_msg))

            received_typing = False
            received_messages = []
            print(f"   ⏳ 等待响应 (最长 30 秒)...")
            try:
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=30)
                    data = json.loads(raw)
                    print(f"   📨 收到: {data}")

                    if data.get("type") == "typing":
                        received_typing = True
                        print("   ✅ 收到 typing 状态")
                    elif data.get("type") == "message":
                        received_messages.append(data)
                        print(f"   ✅ 收到消息: \"{data.get('content')}\"")
                        if len(received_messages) >= 1:
                            try:
                                while True:
                                    raw2 = await asyncio.wait_for(ws.recv(), timeout=3)
                                    data2 = json.loads(raw2)
                                    if data2.get("type") == "message":
                                        received_messages.append(data2)
                                        print(f"   ✅ 收到连发消息: \"{data2.get('content')}\"")
                            except asyncio.TimeoutError:
                                break
            except asyncio.TimeoutError:
                print("   ⚠️ 等待超时")

            print(f"\n📊 测试 2 结果:")
            print(f"   - typing 状态: {'✅ 收到' if received_typing else '❌ 未收到'}")
            print(f"   - 消息数量: {len(received_messages)}")
            for i, msg in enumerate(received_messages):
                print(f"   - 消息 {i+1}: \"{msg.get('content')}\" (delay: {msg.get('delay_seconds')}s)")

            # 测试 3: 等待主动消息
            print(f"\n🕐 测试 3: 静默等待主动消息 (最长 90 秒)...")
            print("   （后端每30秒检查一次，30%概率触发，请耐心等待...）")
            proactive_received = False
            try:
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=90)
                    data = json.loads(raw)
                    print(f"   📨 收到: {data}")
                    if data.get("type") == "typing":
                        print("   ⏳ 角色正在输入...")
                    elif data.get("type") == "proactive":
                        print(f"   🎉 收到主动消息: \"{data.get('content')}\"")
                        proactive_received = True
                        break
            except asyncio.TimeoutError:
                print("   ⚠️ 90秒内未收到主动消息（概率性的，属正常现象）")

            # 总结
            print(f"\n{'='*50}")
            print("📋 测试总结:")
            print(f"   1. WebSocket 连接: ✅")
            print(f"   2. sync 状态同步: ✅")
            print(f"   3. typing 状态推送: {'✅' if received_typing else '❌'}")
            print(f"   4. message 消息推送: {'✅' if received_messages else '❌'}")
            print(f"   5. proactive 主动消息: {'✅' if proactive_received else '⏳ 未在本次触发'}")
            print(f"{'='*50}")

            all_pass = received_typing and len(received_messages) > 0
            if all_pass:
                print("🎉 核心功能全部通过！")
            else:
                print("⚠️ 部分测试未通过，请检查后端日志")
            return all_pass

    except ConnectionRefusedError:
        print("❌ 连接失败：服务器未启动或端口不对")
        return False
    except Exception as e:
        print(f"❌ 测试异常: {e}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_ws())
    sys.exit(0 if result else 1)

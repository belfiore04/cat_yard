import os
import json
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
from typing import List, Dict
from tts import text_to_speech

app = FastAPI()

# 默认使用 aidramaplayer 中的配置，你也可以通过环境变量覆盖
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "sk-8fda6213e6b740e299e093c615f98633")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-v3")

class PersonaInput(BaseModel):
    name: str
    persona: str

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatInput(BaseModel):
    name: str
    persona: str
    time_info: str
    schedule_info: str = ""
    user_message: str
    history: List[ChatMessage]

class SurpriseInput(BaseModel):
    name: str
    persona: str
    time_info: str
    schedule_info: str = ""

async def call_deepseek(messages: List[Dict[str, str]]) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {LLM_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": LLM_MODEL,
                    "messages": messages,
                    "temperature": 0.8
                }
            )
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"Error calling LLM: {e}")
            raise HTTPException(status_code=500, detail="LLM call failed")

@app.post("/api/generate_schedule")
async def generate_schedule(data: PersonaInput):
    sys_prompt = '''你是一个虚拟陪伴游戏的神编剧。请根据用户提供的角色姓名和人设，生成一个符合该性格的人物【每周规律作息表】。
严格以JSON格式输出。包含以下三个字段：
1. "routine": 数组，每个元素是一个规律活动对象。
  - "days": [1,2,3...7] 适用的星期（1为周一，7为周日）
  - "start": 开始小时(0-23)
  - "end": 结束小时(0-23)
  - "activity": 活动名称（如：上班、健身、去酒吧、赴约等）
  - "location": 必须固定为 "out" 代表外出
  - "reply_delay": [最小分钟, 最大分钟] 玩家此时发微信，该角色需要多久才能回复（如 [5, 15]、[30, 120]）
2. "sleep": [入睡小时, 起床小时] （如 [23, 7] 表示晚上11点睡早上7点起）
3. "home_activities": 数组，角色周末或平时在家不外出时，会做的随机小事（如 ["擦拭装备", "发呆随想", "看书"]）

仅输出可以被解析的JSON代码，不要解释，不要带 markdown 代码块标记。
'''
    user_prompt = f"角色姓名：{data.name}\n角色人设：{data.persona}"
    
    content = await call_deepseek([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_prompt}
    ])
    
    # 清理多余字符以防解析失败
    content = content.strip()
    if content.startswith("```json"): content = content[7:]
    elif content.startswith("```"): content = content[3:]
    if content.endswith("```"): content = content[:-3]
    content = content.strip()
        
    try:
        schedule_data = json.loads(content)
        return schedule_data
    except Exception as e:
        print("JSON parse failed. Fallback to default schedule. Original text:", content)
        # 降级处理
        return {
            "routine": [
                {"days": [1, 2, 3, 4, 5], "start": 9, "end": 18, "activity": "工作", "location": "out", "reply_delay": [30, 120]},
                {"days": [6, 7], "start": 14, "end": 16, "activity": "健身体能训练", "location": "out", "reply_delay": [10, 30]}
            ],
            "sleep": [23, 7],
            "home_activities": ["休息", "整理衣服", "发呆"]
        }

@app.post("/api/chat")
async def chat(data: ChatInput):
    # 【防御时间幻觉核心】：强行剥夺模型自行计算时间的能力，将游戏虚拟状态以自然语言注入系统。
    sys_prompt = f'''你正在扮演陪伴游戏中的角色。你的名字是 {data.name}。你的性格设定是：{data.persona}。
你的每周作息表如下（JSON格式）：
{data.schedule_info}
!!!必须遵守的当前物理情境（绝对防御你的时间幻觉）!!!：
【{data.time_info}】

你要像平常真实聊天一样回复玩家，简短、口语化，非常真实，切忌像个AI客服或机器人。
如果你当前处于外出的物理情境，你可以说自己刚刚抽出空回手机。千万不能说违背当前物理情境的话。

!!!关键通讯格式要求!!!：
为了模拟真人聊天的真实感，你必须以 JSON 格式输出一个包含多条消息的数组（真人打字经常是一段话分两三次发送）。
请根据你要表达的内容、情绪和性格，拆分成 1 到 4 条消息连发。每条消息必须设定一个由于打字或发呆产生的停顿时间（秒）。
严格按照如下 JSON 结构输出：
{{
  "messages": [
    {{ "content": "刚开完会", "delay_seconds": 0 }},
    {{ "content": "怎么啦？", "delay_seconds": 3 }}
  ]
}}
即使只回一条，也必须放在此 JSON 数组中。不要带 markdown 代码块标记，直接输出紧凑的JSON文本。
'''
    messages = [{"role": "system", "content": sys_prompt}]
    for msg in data.history:
        messages.append({"role": msg.role, "content": msg.content})
    
    # 兼容处理：如果前端传了单独的 user_message 也追加进去
    if data.user_message:
        messages.append({"role": "user", "content": data.user_message})
    
    content = await call_deepseek(messages)
    content = content.strip()
    if content.startswith("```json"): content = content[7:]
    elif content.startswith("```"): content = content[3:]
    if content.endswith("```"): content = content[:-3]
    content = content.strip()
        
    try:
        reply_data = json.loads(content)
        if "messages" not in reply_data:
            return {"messages": [{"content": str(reply_data), "delay_seconds": 0}]}
        return reply_data
    except Exception as e:
        print("Chat JSON parse failed. Fallback to raw text:", content)
        return {"messages": [{"content": content, "delay_seconds": 0}]}

@app.post("/api/surprise")
async def generate_surprise(data: SurpriseInput):
    sys_prompt = f'''你正在扮演陪伴游戏中的角色。你的名字是 {data.name}。你的性格设定是：{data.persona}。
你的每周作息表如下（JSON格式）：
{data.schedule_info}
当前的虚拟时间情境是：{data.time_info}
你给玩家在桌子上留了一张便签，可能是一句简单的关心、分享你刚才见到的趣事、或者带了一个小礼物的留言。
只输出便签文字内容，不要带引号，不要超过3句话。
'''
    reply = await call_deepseek([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": "请写一张桌上的便签。"}
    ])
    return {"surprise": reply}


class RandomEventInput(BaseModel):
    name: str
    persona: str
    time_info: str
    schedule_info: str = ""

@app.post("/api/random_event")
async def generate_random_event(data: RandomEventInput):
    sys_prompt = f'''你是一个虚拟陪伴游戏的神编剧。请根据角色姓名 {data.name} 和人设 {data.persona}，
你的每周作息表如下（JSON格式）：
{data.schedule_info}
结合他当前所处的绝对情境【{data.time_info}】，
马上生成一件他“此刻突然决定去做”或者“刚刚碰上的”随机小事件（必须符合常理但又有一点突发感，不要太惊悚）。
严格以JSON格式输出：
- "activity": 事件描述（如："半夜饿了下楼买烧烤"、"突然下雨在便利店躲雨"）
- "location": "out" 或 "home" （根据这件突发事通常在哪里发生来决定）
- "duration": 持续分钟数（通常为 10-60 分钟）
- "reply_delay": [最小分钟, 最大分钟] 玩家此时如果给他发微信，预估多久能回？（如如果是去洗澡就是[10, 20]，出去买东西就是[5, 10]）

仅输出可以被解析的JSON代码，不要解释，不要带 markdown 标记。
'''
    content = await call_deepseek([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": "请生成一个他现在的突发事件。"}
    ])
    
    content = content.strip()
    if content.startswith("```json"): content = content[7:]
    elif content.startswith("```"): content = content[3:]
    if content.endswith("```"): content = content[:-3]
    content = content.strip()
        
    try:
        event_data = json.loads(content)
        return event_data
    except Exception as e:
        print("Random event JSON parse failed. Original text:", content)
        return {
            "activity": "发了一会呆",
            "location": "home",
            "duration": 10,
            "reply_delay": [1, 3]
        }

class TTSInput(BaseModel):
    text: str
    voice_id: str

@app.post("/api/tts")
async def generate_tts(data: TTSInput):
    """
    提供给前端的 TTS 流式获取接口
    """
    result = await text_to_speech(
        text=data.text,
        speaker_name=data.voice_id,
        speed=1.0
    )
    if result.success:
        return {"audio_base64": result.audio_base64, "duration_ms": result.duration_ms}
    else:
        raise HTTPException(status_code=500, detail=result.error)

# 静态文件挂载
if os.path.exists("assets"):
    app.mount("/assets", StaticFiles(directory="assets"), name="assets")

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/{filename}")
async def serve_static(filename: str):
    if os.path.exists(filename):
        return FileResponse(filename)
    return HTMLResponse(status_code=404)

if __name__ == "__main__":
    import uvicorn
    # 为了避免和旧的8089以及被占用的8080发生潜在的残余占位冲突，我们使用8090端口
    uvicorn.run(app, host="0.0.0.0", port=8090)

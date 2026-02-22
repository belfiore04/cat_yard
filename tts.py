"""
MiniMax TTS WebSocket 客户端
完全复用自 ai_drama_player，支持角色音色映射和流式音频生成
"""
import asyncio
import json
import ssl
import base64
from dataclasses import dataclass
import websockets

import os

TTS_API_KEY = os.getenv("TTS_API_KEY", "sk-api-zXJJxChrDLeRVIcjFXBALV4Tb1zPvwSS4VzoK04aJhec79EEcA07jX4pARnPuWuAuafw0Wn2PhslrR9vNFO-6n5yItgVf29evRVGDGr3XTcCqiy9BBnfMAQ")
TTS_WS_URL = os.getenv("TTS_WS_URL", "wss://api.minimaxi.com/ws/v1/t2a_v2")
TTS_MODEL = os.getenv("TTS_MODEL", "speech-2.6-hd")


@dataclass
class TTSResult:
    """TTS 生成结果"""
    success: bool
    audio_base64: str = ""
    duration_ms: float = 0
    error: str = ""


class TTSClient:
    """MiniMax TTS WebSocket 客户端"""

    def __init__(self):
        self.api_key = TTS_API_KEY
        self.ws_url = TTS_WS_URL
        self.model = TTS_MODEL

    def get_voice_id(self, speaker_name: str) -> str:
        """根据角色名获取音色 ID，在 V0.6 中，前端将会直接传入明确的 voice_id 字符串作为此处的参数"""
        return speaker_name

    async def generate(self, text: str, speaker_name: str = "旁白", speed: float = 1.0) -> TTSResult:
        """
        生成语音

        Args:
            text: 要合成的文本
            speaker_name: 角色名（用于选择音色）
            speed: 语速，0.5~2.0，默认 1.0

        Returns:
            TTSResult: 包含 base64 音频数据
        """
        if not text.strip():
            return TTSResult(success=False, error="文本为空")

        voice_id = self.get_voice_id(speaker_name)
        headers = {"Authorization": f"Bearer {self.api_key}"}

        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        ws = None
        try:
            ws = await websockets.connect(
                self.ws_url,
                extra_headers=headers,
                ssl=ssl_context
            )

            # 等待连接成功
            connected_msg = await ws.recv()
            connected = json.loads(connected_msg)
            if connected.get("event") != "connected_success":
                return TTSResult(success=False, error=f"连接失败: {connected}")

            # 发送任务开始
            start_payload = {
                "event": "task_start",
                "model": self.model,
                "voice_setting": {
                    "voice_id": voice_id,
                    "speed": speed,
                    "vol": 1.0,
                    "pitch": 0,
                },
                "audio_setting": {
                    "sample_rate": 32000,
                    "bitrate": 128000,
                    "format": "mp3",
                    "channel": 1
                }
            }
            await ws.send(json.dumps(start_payload))

            started_msg = await ws.recv()
            started = json.loads(started_msg)
            if started.get("event") != "task_started":
                return TTSResult(success=False, error=f"任务启动失败: {started}")

            # 发送文本
            await ws.send(json.dumps({
                "event": "task_continue",
                "text": text
            }))

            # 接收音频
            audio_data = b""
            while True:
                msg = await ws.recv()
                response = json.loads(msg)

                if "data" in response and "audio" in response["data"]:
                    audio_hex = response["data"]["audio"]
                    if audio_hex:
                        audio_data += bytes.fromhex(audio_hex)

                if response.get("is_final"):
                    break

            # 关闭任务
            await ws.send(json.dumps({"event": "task_finish"}))

            # 预估音频时长（MP3 128kbps ≈ 16KB/s）
            audio_bytes = len(audio_data)
            duration_ms = (audio_bytes / (128 * 1024 / 8)) * 1000 if audio_bytes > 0 else 0

            # 转为 base64
            audio_base64 = base64.b64encode(audio_data).decode("utf-8")

            return TTSResult(
                success=True,
                audio_base64=audio_base64,
                duration_ms=duration_ms
            )

        except Exception as e:
            return TTSResult(success=False, error=str(e))
        finally:
            if ws:
                await ws.close()


# 全局 TTS 客户端实例
_tts_client = None


def get_tts_client() -> TTSClient:
    """获取 TTS 客户端单例"""
    global _tts_client
    if _tts_client is None:
        _tts_client = TTSClient()
    return _tts_client


async def text_to_speech(text: str, speaker_name: str = "旁白", speed: float = 1.0) -> TTSResult:
    """便捷函数：文本转语音"""
    client = get_tts_client()
    return await client.generate(text, speaker_name, speed=speed)

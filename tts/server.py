import argparse
from collections.abc import Iterable
import io
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re
import struct
from threading import Lock
import wave

os.environ.setdefault("HF_HOME", os.path.abspath("voices/hf"))

import numpy as np
from pythaitts import TTS


SPEAKERS = {
    "angry-boss": "newvoice_male",
    "demanding-client": None,
    "difficult-customer": "newvoice_female",
}
STREAM_TYPE = "application/vnd.angry-boss.pcm"
SAMPLE_RATE = 24_000
MAX_REQUEST_BYTES = 8 * 1024
MAX_TEXT_LENGTH = 1000
MAX_AUDIO_BYTES = 8 * 1024 * 1024
synthesizing = Lock()


def synthesize(engine: TTS, text: str, speaker: str | None):
    # The Thai phonemizer reads an ASCII question mark as a glottal stop.
    text = re.sub(r"[?？][?？!！]*[ \t]*", "\n", text).strip()
    if not text:
        return
    # Short reactions sound more continuous when the model sees the entire line.
    if len(text) <= 48 and "\n" not in text:
        audio = engine.tts(text, speaker_idx=speaker, return_type="waveform")
        yield (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    else:
        yield from engine.stream(text, speaker_idx=speaker, return_type="bytes")


def checked_chunks(chunks: Iterable[bytes]):
    size = 0
    for chunk in chunks:
        size += len(chunk) + 4
        if not chunk or len(chunk) % 2 or size + 4 > MAX_AUDIO_BYTES:
            raise ValueError("invalid PCM size")
        yield chunk


class SpeechHandler(BaseHTTPRequestHandler):
    timeout = 5
    engines: dict[str, TTS]

    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path != "/speak":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST_BYTES:
                raise ValueError("invalid request size")
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("expected an object")
            scenario = request.get("scenarioId")
            text = request.get("text")
            if not isinstance(scenario, str) or scenario not in SPEAKERS:
                raise ValueError("unknown character")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_LENGTH:
                raise ValueError("invalid dialogue")
        except (ValueError, TimeoutError):
            self.send_error(400)
            return

        if not synthesizing.acquire(timeout=1):
            self.send_error(503)
            return
        started = False
        chunks = checked_chunks(synthesize(self.engines[scenario], text.strip(), SPEAKERS[scenario]))
        try:
            first = next(chunks)
            if self.headers.get("Accept") == STREAM_TYPE:
                started = True
                self.send_response(200)
                self.send_header("Content-Type", STREAM_TYPE)
                self.end_headers()
                self.write_frame(first)
                for chunk in chunks:
                    self.write_frame(chunk)
                self.write_frame(b"")
            else:
                with io.BytesIO() as audio:
                    with wave.open(audio, "wb") as wav:
                        wav.setparams((1, 2, SAMPLE_RATE, 0, "NONE", ""))
                        wav.writeframesraw(first)
                        for chunk in chunks:
                            wav.writeframesraw(chunk)
                    result = audio.getvalue()
                if len(result) > MAX_AUDIO_BYTES:
                    raise ValueError("invalid WAV size")
                started = True
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(result)))
                self.end_headers()
                self.wfile.write(result)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            logging.exception("Thai speech synthesis failed for %s", scenario)
            if not started:
                self.send_error(500)
        finally:
            chunks.close()
            synthesizing.release()

    def write_frame(self, chunk: bytes):
        self.wfile.write(struct.pack("<I", len(chunk)) + chunk)
        self.wfile.flush()


def main():
    parser = argparse.ArgumentParser(description="Local Thai speech for NPC calls")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), SpeechHandler) as server:
        print("Loading Thai character voices (downloads models on first run)...", flush=True)
        makham = TTS(pretrained="makham", speaker_idx="newvoice_male", intra_op_threads=4)
        paradee = TTS(pretrained="makham_paradee", intra_op_threads=4)
        SpeechHandler.engines = {
            scenario: makham if speaker else paradee
            for scenario, speaker in SPEAKERS.items()
        }
        for scenario, speaker in SPEAKERS.items():
            list(SpeechHandler.engines[scenario].stream(
                "สวัสดี", speaker_idx=speaker, return_type="bytes"
            ))
        print(f"Thai speech ready at http://{args.host}:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

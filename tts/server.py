import argparse
import io
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

from vachanatts import TTS


SPEAKERS = {
    "angry-boss": "th_m_1",
    "demanding-client": "th_f_1",
    "difficult-customer": "th_f_2",
}
MAX_REQUEST_BYTES = 8 * 1024
MAX_TEXT_LENGTH = 1000
MAX_AUDIO_BYTES = 8 * 1024 * 1024
synthesizing = Lock()


class SpeechHandler(BaseHTTPRequestHandler):
    timeout = 5

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

        if not synthesizing.acquire(blocking=False):
            self.send_error(503)
            return
        try:
            with io.BytesIO() as audio:
                TTS(text.strip(), voice=SPEAKERS[scenario], output=audio)
                wav = audio.getvalue()
            if not 44 < len(wav) <= MAX_AUDIO_BYTES:
                raise ValueError("invalid WAV size")
        except Exception:
            logging.exception("Thai speech synthesis failed for %s", scenario)
            self.send_error(500)
            return
        finally:
            synthesizing.release()

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        try:
            self.wfile.write(wav)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass


def main():
    parser = argparse.ArgumentParser(description="Local Thai speech for NPC calls")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), SpeechHandler) as server:
        print("Loading Thai character voices (downloads models on first run)...", flush=True)
        for speaker in SPEAKERS.values():
            with io.BytesIO() as audio:
                TTS("สวัสดี", voice=speaker, output=audio)
        print(f"Thai speech ready at http://127.0.0.1:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

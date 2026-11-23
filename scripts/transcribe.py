import os
import subprocess
import sys
import numpy as np

os.environ.setdefault("HF_HOME", "D:/caches/huggingface")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from faster_whisper import WhisperModel


def decode_with_ffmpeg(audio_path: str) -> np.ndarray:
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-threads",
        "0",
        "-i",
        audio_path,
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        "16000",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: transcribe.py <arquivo_audio>", file=sys.stderr)
        return 1

    audio_path = sys.argv[1]
    model_size = os.environ.get("WHISPER_MODEL", "small")
    cache_dir = os.environ.get("WHISPER_CACHE_DIR", "D:/caches/whisper")
    os.makedirs(cache_dir, exist_ok=True)

    audio = decode_with_ffmpeg(audio_path)
    model = WhisperModel(
        model_size,
        device="cpu",
        compute_type="int8",
        download_root=cache_dir,
    )
    segments, _ = model.transcribe(audio, language="pt", vad_filter=True)
    text = " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

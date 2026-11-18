from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

ALLOWED_EXTENSIONS = {".wav", ".flac", ".mp3", ".aiff", ".aif", ".ogg", ".m4a", ".aac"}


class AudioIngestionError(ValueError):
    """Raised when an uploaded audio file fails format, header, or bounds validation."""


@dataclass
class LoadedAudio:
    samples: np.ndarray  # shape: (n_samples, n_channels), float32
    sample_rate: int
    channels: int
    bit_depth: int
    duration_sec: float
    waveform_peaks: list[list[float]]


def _run_ffprobe(file_path: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(file_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=20)
    except FileNotFoundError as exc:
        raise AudioIngestionError("ffprobe binary is not available on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise AudioIngestionError("Audio validation timed out inspecting file header.") from exc

    if proc.returncode != 0 or not proc.stdout.strip():
        raise AudioIngestionError("Corrupt or unrecognized audio container/header.")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AudioIngestionError("Could not parse audio stream metadata.") from exc

    audio_streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not audio_streams:
        raise AudioIngestionError("No valid audio stream found in uploaded file.")

    stream = audio_streams[0]
    fmt = data.get("format", {})
    sample_rate = int(stream.get("sample_rate") or 0)
    channels = int(stream.get("channels") or 0)
    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    bit_depth = int(
        stream.get("bits_per_raw_sample")
        or stream.get("bits_per_sample")
        or (24 if "24" in str(stream.get("codec_name", "")) else 16)
    )
    if bit_depth <= 0:
        bit_depth = 16

    if sample_rate <= 0 or channels <= 0:
        raise AudioIngestionError("Invalid sample rate or channel count in audio stream.")
    if duration < 0.05:
        raise AudioIngestionError("Audio clip is too short (< 50 ms) or contains an empty stream.")

    return {
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_sec": duration,
        "bit_depth": bit_depth,
        "codec_name": stream.get("codec_name", ""),
    }


def _compute_waveform_peaks(samples: np.ndarray, num_bins: int = 240) -> list[list[float]]:
    if len(samples) == 0:
        return []
    mono = np.mean(samples, axis=1, dtype=np.float32) if samples.ndim > 1 else samples
    actual_bins = min(num_bins, len(mono))
    chunks = np.array_split(mono, actual_bins)
    peaks: list[list[float]] = []
    for chunk in chunks:
        if len(chunk) == 0:
            peaks.append([0.0, 0.0])
        else:
            peaks.append([round(float(np.min(chunk)), 4), round(float(np.max(chunk)), 4)])
    return peaks


def load_audio_file(file_path: Path, max_bytes: int | None = None) -> LoadedAudio:
    if not file_path.exists():
        raise AudioIngestionError("Uploaded audio file could not be found on disk.")
    ext = file_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise AudioIngestionError(
            f"Unsupported audio extension '{ext}'. Allowed: WAV, FLAC, MP3, AIFF, OGG, M4A."
        )
    file_size = file_path.stat().st_size
    if file_size <= 0:
        raise AudioIngestionError("Uploaded audio file is empty (0 bytes).")
    if max_bytes is not None and file_size > max_bytes:
        raise AudioIngestionError(
            f"File exceeds size limit ({file_size / (1024 * 1024):.1f} MB)."
        )

    probe = _run_ffprobe(file_path)

    samples: np.ndarray | None = None
    sample_rate = probe["sample_rate"]
    channels = probe["channels"]
    bit_depth = probe["bit_depth"]

    # Read lossless mono/stereo directly at native sample rate as float32 (halves RAM vs float64).
    # Surround (>2 ch) files are always routed through FFmpeg (-ac 2) for ITU-R standard downmix.
    if channels <= 2:
        try:
            info = sf.info(str(file_path))
            subtype = str(info.subtype or "")
            if "24" in subtype:
                bit_depth = 24
            elif "32" in subtype or "FLOAT" in subtype:
                bit_depth = 32
            elif "16" in subtype:
                bit_depth = 16

            with sf.SoundFile(str(file_path)) as f:
                sample_rate = f.samplerate
                channels = f.channels
                if channels <= 2:
                    total_frames = int(f.frames or 0)
                    if total_frames > 0:
                        buf = np.empty((total_frames, channels), dtype=np.float32)
                        offset = 0
                        for block in f.blocks(blocksize=262144, dtype="float32", always_2d=True):
                            n_read = block.shape[0]
                            end = min(total_frames, offset + n_read)
                            if end > offset:
                                buf[offset:end] = block[: end - offset]
                                offset = end
                        samples = buf[:offset] if offset < total_frames else buf
                    else:
                        chunks: list[np.ndarray] = []
                        for block in f.blocks(blocksize=262144, dtype="float32", always_2d=True):
                            chunks.append(block)
                        if chunks:
                            samples = np.vstack(chunks).astype(np.float32, copy=False)
                            chunks.clear()
        except Exception:
            samples = None

    # Decode compressed formats (MP3/M4A/AAC) or downmix surround (>2ch) via FFmpeg
    if samples is None:
        target_channels = min(2, max(1, channels))
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = Path(tmp.name)
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(file_path),
                "-vn",
                "-ac",
                str(target_channels),
                "-acodec",
                "pcm_f32le",
                str(tmp_wav),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
            if proc.returncode != 0:
                raise AudioIngestionError(
                    f"Failed to decode audio stream: {proc.stderr.strip() or 'invalid payload'}"
                )
            samples, sample_rate = sf.read(str(tmp_wav), dtype="float32", always_2d=True)
            channels = samples.shape[1]
        finally:
            tmp_wav.unlink(missing_ok=True)

    if samples is None or samples.shape[0] == 0:
        raise AudioIngestionError("Decoded audio contains zero samples.")

    if samples.dtype != np.float32:
        samples = samples.astype(np.float32, copy=False)

    # Safety guard if any container still reported >2 channels
    if samples.shape[1] > 2:
        samples = samples[:, :2]
        channels = 2

    duration_sec = float(samples.shape[0] / sample_rate)
    if duration_sec < 0.05:
        raise AudioIngestionError("Decoded audio is shorter than 50 ms.")

    return LoadedAudio(
        samples=samples,
        sample_rate=sample_rate,
        channels=channels,
        bit_depth=bit_depth,
        duration_sec=round(duration_sec, 3),
        waveform_peaks=_compute_waveform_peaks(samples),
    )


def create_playback_proxy(source_path: Path, target_dir: Path, stem_name: str = "proxy") -> Path:
    """Create a lightweight 44.1 kHz browser playback proxy so tabs never decode 96 kHz WAVs."""
    target_dir.mkdir(parents=True, exist_ok=True)
    m4a_path = target_dir / f"{stem_name}.m4a"
    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-vn",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(m4a_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
    if proc.returncode == 0 and m4a_path.exists() and m4a_path.stat().st_size > 0:
        return m4a_path

    wav_path = target_dir / f"{stem_name}.wav"
    fallback_cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-vn",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-acodec",
        "pcm_s16le",
        str(wav_path),
    ]
    subprocess.run(fallback_cmd, capture_output=True, text=True, check=True, timeout=60)
    return wav_path


def extract_audio_clip(
    source_path: Path,
    target_path: Path,
    start_sec: float = 0.0,
    duration_sec: float = 25.0,
) -> Path:
    """Extract a short compressed MP3 snippet strictly for opt-in multimodal Gemini analysis."""
    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-ss",
        f"{max(0.0, start_sec):.2f}",
        "-t",
        f"{max(3.0, min(30.0, duration_sec)):.2f}",
        "-i",
        str(source_path),
        "-vn",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(target_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=30)
    if proc.returncode != 0 or not target_path.exists():
        # Fallback to AAC m4a if libmp3lame is unavailable
        aac_target = target_path.with_suffix(".m4a")
        fallback = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{max(0.0, start_sec):.2f}",
            "-t",
            f"{max(3.0, min(30.0, duration_sec)):.2f}",
            "-i",
            str(source_path),
            "-vn",
            "-ar",
            "44100",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(aac_target),
        ]
        subprocess.run(fallback, capture_output=True, text=True, check=True, timeout=30)
        return aac_target
    return target_path

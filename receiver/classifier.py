"""Optimized feature extraction with DC removal, peak normalization, and cached Mel filterbank."""
import hashlib
import threading
from pathlib import Path
import librosa
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

SAMPLE_RATE = 22050
CLIP_SAMPLES = 44100
N_FFT = 2048
HOP_LENGTH = 512
N_MELS = 128
TIME_STEPS = 87
TOP_DB_TRIM = 30.0
TOP_DB_POWER = 80.0
PEAK_EPSILON = 1e-6

_FILTER_LOCK = threading.Lock()
_MEL_BASIS = None
_HANN_WINDOW = None


def _spectral_tables():
    global _MEL_BASIS, _HANN_WINDOW
    if _MEL_BASIS is None or _HANN_WINDOW is None:
        with _FILTER_LOCK:
            if _MEL_BASIS is None:
                _MEL_BASIS = librosa.filters.mel(
                    sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS, dtype=np.float32
                )
            if _HANN_WINDOW is None:
                _HANN_WINDOW = np.hanning(N_FFT + 1)[:-1].astype(np.float32)
    return _MEL_BASIS, _HANN_WINDOW


def extract_features(raw):
    mel_basis, hann = _spectral_tables()
    y = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    # Remove I2S MEMS microphone DC offset and normalize quiet/distant captures
    # so log-power (amin=1e-10) preserves full spectral dynamic range.
    y -= np.mean(y)
    peak = float(np.max(np.abs(y)))
    if peak > PEAK_EPSILON:
        y /= peak

    pad = N_FFT // 2
    padded_trim = np.pad(y, pad)
    frames_trim = sliding_window_view(padded_trim, N_FFT)[::HOP_LENGTH]
    rms = np.sqrt(np.mean(frames_trim * frames_trim, axis=1))
    rms_db = 20.0 * np.log10(np.maximum(1e-5, rms))
    nonzero = np.flatnonzero(rms_db - float(rms_db.max()) > -TOP_DB_TRIM)
    if len(nonzero):
        start = int(nonzero[0]) * HOP_LENGTH
        end = min(len(y), int(nonzero[-1] + 1) * HOP_LENGTH)
        trimmed = y[start:end]
    else:
        trimmed = y
    if len(trimmed) == 0:
        trimmed = y

    processed = trimmed[:CLIP_SAMPLES]
    if len(processed) < CLIP_SAMPLES:
        processed = np.pad(processed, (0, CLIP_SAMPLES - len(processed)))

    padded_stft = np.pad(processed, pad)
    frames = sliding_window_view(padded_stft, N_FFT)[::HOP_LENGTH][:TIME_STEPS] * hann
    spectrum = np.fft.rfft(frames, axis=1)
    power = (spectrum.real * spectrum.real + spectrum.imag * spectrum.imag).T.astype(np.float32)
    mel = mel_basis @ power
    log_spec = 10.0 * np.log10(np.maximum(1e-10, mel))
    features = np.maximum(log_spec - float(log_spec.max()), -TOP_DB_POWER)[:, :TIME_STEPS]
    if features.shape[1] < TIME_STEPS:
        features = np.pad(features, ((0, 0), (0, TIME_STEPS - features.shape[1])))

    minimum, maximum = float(features.min()), float(features.max())
    if maximum > minimum:
        features = (features - minimum) / (maximum - minimum)
    return features.reshape(1, N_MELS, TIME_STEPS, 1).astype(np.float32)


class Classifier:
    def __init__(self, model):
        self.path = Path(model)
        self.interpreter = None
        self.lock = threading.Lock()
        _spectral_tables()

    def _ensure_loaded(self):
        if self.interpreter is not None:
            return
        from ai_edge_litert.interpreter import Interpreter
        model_bytes = self.path.read_bytes()
        model_hash = hashlib.sha256(model_bytes).hexdigest()
        interpreter = Interpreter(model_content=model_bytes)
        interpreter.allocate_tensors()
        inputs = interpreter.get_input_details()
        outputs = interpreter.get_output_details()
        if (
            len(inputs) != 1
            or len(outputs) != 1
            or tuple(inputs[0]['shape']) != (1, N_MELS, TIME_STEPS, 1)
            or inputs[0]['dtype'] != np.float32
            or outputs[0]['dtype'] != np.float32
            or int(np.prod(outputs[0]['shape'])) != 1
        ):
            raise ValueError('Incompatible model tensors')
        self.interpreter = interpreter
        self.input = inputs[0]
        self.output = outputs[0]
        self.model_hash = model_hash

    def warmup(self):
        with self.lock:
            self._ensure_loaded()

    def __call__(self, raw):
        features = extract_features(raw)
        with self.lock:
            self._ensure_loaded()
            self.interpreter.set_tensor(self.input['index'], features)
            self.interpreter.invoke()
            probability = float(self.interpreter.get_tensor(self.output['index']).reshape(-1)[0])
            model_hash = self.model_hash
        if not np.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError('Invalid model probability')
        return probability, model_hash

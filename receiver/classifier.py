"""Original feature extraction, with lazy model loading."""
import hashlib
from pathlib import Path

class Classifier:
    def __init__(self, model):
        self.path = Path(model)
        self.interpreter = None

    def __call__(self, raw):
        import numpy as np
        import librosa
        if self.interpreter is None:
            from ai_edge_litert.interpreter import Interpreter
            model_bytes = self.path.read_bytes()
            model_hash = hashlib.sha256(model_bytes).hexdigest()
            interpreter = Interpreter(model_content=model_bytes)
            interpreter.allocate_tensors()
            inputs = interpreter.get_input_details()
            outputs = interpreter.get_output_details()
            if len(inputs) != 1 or len(outputs) != 1 or tuple(inputs[0]['shape']) != (1, 128, 87, 1) or inputs[0]['dtype'] != np.float32 or outputs[0]['dtype'] != np.float32 or int(np.prod(outputs[0]['shape'])) != 1:
                raise ValueError('Incompatible model tensors')
            self.interpreter, self.input, self.output, self.model_hash = interpreter, inputs[0], outputs[0], model_hash
        y = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        trimmed, _ = librosa.effects.trim(y, top_db=30)
        if len(trimmed) == 0:
            trimmed = y
        processed = trimmed[:44100]
        if len(processed) < 44100:
            processed = np.pad(processed, (0, 44100 - len(processed)))
        mel = librosa.feature.melspectrogram(y=processed, sr=22050, n_mels=128, n_fft=2048, hop_length=512)
        features = librosa.power_to_db(mel, ref=np.max)[:, :87]
        if features.shape[1] < 87:
            features = np.pad(features, ((0, 0), (0, 87 - features.shape[1])))
        minimum, maximum = features.min(), features.max()
        if maximum > minimum:
            features = (features - minimum) / (maximum - minimum)
        features = features.reshape(1, 128, 87, 1).astype(np.float32)
        self.interpreter.set_tensor(self.input['index'], features)
        self.interpreter.invoke()
        probability = float(self.interpreter.get_tensor(self.output['index']).reshape(-1)[0])
        if not np.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError('Invalid model probability')
        return probability, self.model_hash

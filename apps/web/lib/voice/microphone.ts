import { CAPTURE_FRAME_BYTES, CAPTURE_FRAME_SAMPLES, VOICE_INPUT_SAMPLE_RATE } from "./protocol";

/** Public URL of the capture worklet (apps/web/public/voice/pcm-capture-worklet.js). */
export const CAPTURE_WORKLET_URL = "/voice/pcm-capture-worklet.js";
const CAPTURE_PROCESSOR_NAME = "finvoice-pcm-capture";

export type MicrophoneFailure =
  /** The user or the browser denied microphone access. */
  | "denied"
  /** No microphone is available. */
  | "not_found"
  /** Anything else (for example, no AudioWorklet support). */
  | "unavailable";

export class MicrophoneError extends Error {
  constructor(readonly failure: MicrophoneFailure) {
    super(`Microphone ${failure}`);
    this.name = "MicrophoneError";
  }
}

/**
 * Facts about the capture pipeline, for development diagnostics. Settings the browser does not
 * report are null. Contains no audio.
 */
export type MicrophoneDiagnostics = {
  /** Rate of the audio the resampler receives (the AudioContext's rate). */
  inputSampleRate: number;
  /** Rate the browser reports for the microphone track, if any. */
  trackSampleRate: number | null;
  /** Channels delivered by the microphone track (mixed down to mono before resampling). */
  channelCount: number | null;
  outputSampleRate: number;
  frameSamples: number;
  frameBytes: number;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
};

export type MicrophoneCapture = {
  diagnostics: MicrophoneDiagnostics;
  /** Stops capture and releases the microphone (the browser's recording indicator goes off). */
  stop(): void;
};

/** Speech-friendly processing, requested as preferences ("ideal") so no browser rejects them. */
const SPEECH_CONSTRAINTS = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
} as const;

/**
 * The audio constraints to request: the speech preferences the browser says it supports. An
 * empty result means plain `audio: true`.
 */
export function speechAudioConstraints(
  supported: MediaTrackSupportedConstraints,
): MediaTrackConstraints | true {
  const constraints: MediaTrackConstraints = {};
  for (const [name, value] of Object.entries(SPEECH_CONSTRAINTS)) {
    if (supported[name as keyof MediaTrackSupportedConstraints] === true) {
      Object.assign(constraints, { [name]: value });
    }
  }
  return Object.keys(constraints).length > 0 ? constraints : true;
}

/**
 * Captures the microphone as 40 ms frames of 16 kHz mono 16-bit little-endian PCM. The
 * conversion (mono mix-down and windowed-sinc resampling from the AudioContext's actual rate)
 * runs in an AudioWorklet, never a ScriptProcessorNode. Frames are handed to `onFrame` and not
 * kept. Nothing is encoded or stored.
 */
export async function startMicrophone(
  context: AudioContext,
  onFrame: (pcm: ArrayBuffer) => void,
): Promise<MicrophoneCapture> {
  const stream = await openMicrophone();

  try {
    await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onFrame(event.data);
    };
    source.connect(node);
    return {
      diagnostics: describe(context, stream),
      stop: () => {
        node.port.onmessage = null;
        node.port.close();
        source.disconnect();
        node.disconnect();
        stopTracks(stream);
      },
    };
  } catch {
    stopTracks(stream);
    throw new MicrophoneError("unavailable");
  }
}

async function openMicrophone(): Promise<MediaStream> {
  const { mediaDevices } = navigator;
  const supported =
    typeof mediaDevices.getSupportedConstraints === "function"
      ? mediaDevices.getSupportedConstraints()
      : {};
  try {
    return await mediaDevices.getUserMedia({ audio: speechAudioConstraints(supported) });
  } catch (error) {
    const failure = toFailure(error);
    if (failure !== "unavailable") {
      throw new MicrophoneError(failure);
    }
  }
  // A browser that cannot apply the preferences at all: one attempt with plain audio.
  try {
    return await mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new MicrophoneError(toFailure(error));
  }
}

function describe(context: AudioContext, stream: MediaStream): MicrophoneDiagnostics {
  const settings: MediaTrackSettings = stream.getAudioTracks()[0]?.getSettings() ?? {};
  return {
    inputSampleRate: context.sampleRate,
    trackSampleRate: settings.sampleRate ?? null,
    channelCount: settings.channelCount ?? null,
    outputSampleRate: VOICE_INPUT_SAMPLE_RATE,
    frameSamples: CAPTURE_FRAME_SAMPLES,
    frameBytes: CAPTURE_FRAME_BYTES,
    echoCancellation:
      typeof settings.echoCancellation === "boolean" ? settings.echoCancellation : null,
    noiseSuppression: settings.noiseSuppression ?? null,
    autoGainControl: settings.autoGainControl ?? null,
  };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function toFailure(error: unknown): MicrophoneFailure {
  // getUserMedia rejects with a DOMException; only its name is used.
  const name =
    typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError") {
    return "not_found";
  }
  return "unavailable";
}

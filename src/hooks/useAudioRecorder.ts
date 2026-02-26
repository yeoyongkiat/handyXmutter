/**
 * Mobile audio recording via WebView Web Audio API.
 *
 * Records audio at 16kHz mono, accumulates raw f32 samples,
 * and writes them to a temp file for the Rust backend to process.
 *
 * Desktop recording is handled natively by the Rust AudioRecordingManager;
 * this hook is only used on mobile (Android/iOS).
 */
import { useRef, useCallback, useState } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";

export interface AudioRecorderState {
  isRecording: boolean;
  /** Request microphone permission. Returns true if granted. */
  requestPermission: () => Promise<boolean>;
  /** Start recording. Returns true if started successfully. */
  start: () => Promise<boolean>;
  /** Stop recording and return the path to the raw f32 audio temp file. */
  stop: () => Promise<string | null>;
  /** Cancel recording and discard audio. */
  cancel: () => void;
}

const TARGET_SAMPLE_RATE = 16000;

export function useAudioRecorder(): AudioRecorderState {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      // getUserMedia triggers the Android permission dialog via RustWebChromeClient
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop — we just needed the permission grant
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err) {
      console.error("Microphone permission denied:", err);
      return false;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Create AudioContext — try to use 16kHz, fall back to device default
      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        // Some devices don't support 16kHz — use default and we'll downsample
        context = new AudioContext();
      }

      const source = context.createMediaStreamSource(stream);

      // ScriptProcessorNode for capturing raw PCM samples
      // Buffer size 4096 gives ~256ms chunks at 16kHz (good balance of latency vs overhead)
      const processor = context.createScriptProcessor(4096, 1, 1);

      samplesRef.current = [];

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // If context sample rate differs from target, downsample
        if (context.sampleRate !== TARGET_SAMPLE_RATE) {
          const ratio = context.sampleRate / TARGET_SAMPLE_RATE;
          const downsampled = new Float32Array(
            Math.floor(inputData.length / ratio),
          );
          for (let i = 0; i < downsampled.length; i++) {
            downsampled[i] = inputData[Math.floor(i * ratio)];
          }
          samplesRef.current.push(new Float32Array(downsampled));
        } else {
          samplesRef.current.push(new Float32Array(inputData));
        }
      };

      source.connect(processor);
      processor.connect(context.destination);

      streamRef.current = stream;
      contextRef.current = context;
      processorRef.current = processor;
      setIsRecording(true);

      return true;
    } catch (err) {
      console.error("Failed to start recording:", err);
      return false;
    }
  }, []);

  const stop = useCallback(async (): Promise<string | null> => {
    try {
      // Stop capture
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (contextRef.current) {
        await contextRef.current.close();
        contextRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      setIsRecording(false);

      // Merge all chunks into a single Float32Array
      const chunks = samplesRef.current;
      samplesRef.current = [];

      if (chunks.length === 0) return null;

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      // Write raw f32 bytes to a temp file
      const dataDir = await appDataDir();
      const tempFileName = `recording-${Date.now()}.raw`;
      const tempPath = `${dataDir}/${tempFileName}`;

      // Convert Float32Array to Uint8Array (raw little-endian f32 bytes)
      const rawBytes = new Uint8Array(merged.buffer);
      await writeFile(tempPath, rawBytes);

      return tempPath;
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setIsRecording(false);
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    samplesRef.current = [];
    setIsRecording(false);
  }, []);

  return { isRecording, requestPermission, start, stop, cancel };
}

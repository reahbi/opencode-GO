export interface TranscriptionPort {
  transcribe(audio: Uint8Array, format: string): Promise<string>
}

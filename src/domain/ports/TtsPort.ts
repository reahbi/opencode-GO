export interface TtsOptions {
  gender: 'female' | 'male'
  speed: number
  language: 'ko' | 'en'
}

export interface TtsPort {
  synthesize(text: string, options: TtsOptions): Promise<Uint8Array>
}

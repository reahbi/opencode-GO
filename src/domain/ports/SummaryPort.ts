export interface SummaryPort {
  summarize(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
    expertise: 'vibe' | 'developer' | 'beginner',
  ): Promise<string>

  summarizeForVoice(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
    targetLength: number,
    language: 'ko' | 'en',
    hardCap: number,
    expertise: 'vibe' | 'developer' | 'beginner',
  ): Promise<string>
}

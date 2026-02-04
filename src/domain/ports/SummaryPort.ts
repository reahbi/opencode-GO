export interface SummaryPort {
  summarize(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
  ): Promise<string>

  summarizeForVoice(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
    maxLength: number,
    language: 'ko' | 'en',
  ): Promise<string>
}

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
    targetLength: number,
    language: 'ko' | 'en',
    hardCap: number,
  ): Promise<string>
}

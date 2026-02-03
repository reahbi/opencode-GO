/** Summary service port for generating AI response summaries */
export interface SummaryPort {
  summarize(
    directory: string,
    content: string,
    model: { providerID: string; modelID: string },
  ): Promise<string>
}

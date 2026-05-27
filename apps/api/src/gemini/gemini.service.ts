import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VertexAI, GenerativeModel, Tool } from '@google-cloud/vertexai';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly model: GenerativeModel;

  constructor(private readonly config: ConfigService) {
    const vertexAI = new VertexAI({
      project: this.config.getOrThrow('GCP_PROJECT_ID'),
      location: this.config.get('GCP_LOCATION', 'us-central1'),
    });

    this.model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8192,
      },
    });
  }

  /**
   * Call Gemini with a prompt and parse the response as JSON.
   * Use this for all structured skill outputs (S3, S5, S7, S10).
   */
  async generateJSON<T>(systemPrompt: string, userMessage: string, retries = 2): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.model.generateContent({
          systemInstruction: systemPrompt,
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        });

        const text = response.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        // Strip markdown code fences if present
        const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        return JSON.parse(cleaned) as T;
      } catch (err) {
        this.logger.warn(`Gemini JSON parse failed (attempt ${attempt + 1}): ${err}`);
        if (attempt === retries) throw err;
      }
    }
    throw new Error('Gemini generateJSON failed after retries');
  }

  /**
   * Multi-step chain: run a sequence of prompts where each step's output
   * is injected as context into the next step.
   */
  async chainJSON<T>(steps: Array<{ system: string; user: string }>): Promise<T> {
    let context = '';
    let lastResult: unknown;

    for (const [i, step] of steps.entries()) {
      const userWithContext = i === 0
        ? step.user
        : `Previous step result:\n${context}\n\n${step.user}`;

      lastResult = await this.generateJSON(step.system, userWithContext);
      context = JSON.stringify(lastResult, null, 2);
    }

    return lastResult as T;
  }

  /**
   * Plain text generation — for summaries, PR comments, Slack messages.
   */
  async generateText(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.model.generateContent({
      systemInstruction: systemPrompt,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    });
    return response.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  /**
   * Return the raw model — used by AgentService for the ReAct tool-call loop.
   */
  getModel(systemInstruction: string, tools: Tool[]): GenerativeModel {
    const vertexAI = new VertexAI({
      project: this.config.getOrThrow('GCP_PROJECT_ID'),
      location: this.config.get('GCP_LOCATION', 'us-central1'),
    });

    return vertexAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      generationConfig: { temperature: 0.1, topP: 0.8, maxOutputTokens: 8192 },
      systemInstruction,
      tools,
    });
  }
}

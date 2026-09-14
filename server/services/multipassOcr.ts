/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Architectural blueprint for the Multi-Pass Premium OCR System
// Orchestrates GCP Document AI, Azure Document Intelligence, and AWS Textract.
// Follows Stage 4 (Truthful demonstration/live separation): missing services or credentials
// never yield fabricated results, sample substitution, or fake success.

export interface OcrResult {
  engine: string;
  rawText: string;
  confidence: number;
  metadata: {
    handwritingDetected: boolean;
    languages: string[];
    fileType: string;
  };
}

export class ServiceUnavailableError extends Error {
  public readonly code: string;
  public readonly service: string;
  public readonly status: number;

  constructor(service: string, message: string, code = 'SERVICE_UNCONFIGURED', status = 503) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.service = service;
    this.code = code;
    this.status = status;
  }
}

export function isCloudOcrConfigured(): boolean {
  return Boolean(
    (process.env.GCP_DOC_AI_KEY && process.env.GCP_PROJECT_ID) ||
    (process.env.AZURE_DOC_KEY && process.env.AZURE_DOC_ENDPOINT) ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  );
}

export function isDemoFixturesAllowed(): boolean {
  return process.env.ENABLE_DEMO_FIXTURES === 'true' && process.env.NODE_ENV !== 'production';
}

export class MultipassOcrOrchestrator {
  private async runGcpDocumentAI(_buffer: Buffer): Promise<OcrResult> {
    if (!process.env.GCP_DOC_AI_KEY || !process.env.GCP_PROJECT_ID) {
      throw new ServiceUnavailableError(
        'gcp_document_ai',
        'Google Cloud Document AI is unconfigured. Missing GCP_DOC_AI_KEY or GCP_PROJECT_ID.'
      );
    }
    throw new ServiceUnavailableError(
      'gcp_document_ai',
      'Google Cloud Document AI driver is pending live integration.'
    );
  }

  private async runAzureIntelligence(_buffer: Buffer): Promise<OcrResult> {
    if (!process.env.AZURE_DOC_KEY || !process.env.AZURE_DOC_ENDPOINT) {
      throw new ServiceUnavailableError(
        'azure_document_intelligence',
        'Azure Document Intelligence is unconfigured. Missing AZURE_DOC_KEY or AZURE_DOC_ENDPOINT.'
      );
    }
    throw new ServiceUnavailableError(
      'azure_document_intelligence',
      'Azure Document Intelligence driver is pending live integration.'
    );
  }

  private async runAwsTextract(_buffer: Buffer): Promise<OcrResult> {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new ServiceUnavailableError(
        'aws_textract',
        'AWS Textract is unconfigured. Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY.'
      );
    }
    throw new ServiceUnavailableError(
      'aws_textract',
      'AWS Textract driver is pending live integration.'
    );
  }

  /**
   * Executes a consensus-based multi-pass OCR strategy.
   * If credentials are unconfigured and demo mode is not active, throws ServiceUnavailableError.
   */
  public async processDocument(buffer: Buffer, onProgress: (msg: string) => void): Promise<OcrResult> {
    if (!isCloudOcrConfigured()) {
      if (isDemoFixturesAllowed()) {
        onProgress('Dispatching to isolated Demo Mock OCR adapter...');
        return {
          engine: 'DEMO_MOCK_ADAPTER',
          rawText: buffer.toString('utf-8'),
          confidence: 90.0,
          metadata: {
            handwritingDetected: false,
            languages: ['en-AU'],
            fileType: 'text/plain',
          },
        };
      }

      throw new ServiceUnavailableError(
        'multipass',
        'Cloud OCR services (GCP, Azure, AWS) are unconfigured. Missing credentials and demo fixtures are disabled in live mode.'
      );
    }

    onProgress('Dispatching to Multi-Pass Engine (GCP, Azure, AWS)...');

    const [gcp, azure, aws] = await Promise.all([
      this.runGcpDocumentAI(buffer),
      this.runAzureIntelligence(buffer),
      this.runAwsTextract(buffer),
    ]);

    onProgress('Consolidating OCR Vector Spaces...');

    let bestResult = gcp;
    if (azure.metadata.handwritingDetected || azure.confidence > gcp.confidence) {
      bestResult = azure;
    }
    if (aws.confidence > bestResult.confidence) {
      bestResult = aws;
    }

    onProgress(`Multi-Pass Complete. Selected consensus from ${bestResult.engine} (Confidence: ${bestResult.confidence}%)`);
    return bestResult;
  }
}

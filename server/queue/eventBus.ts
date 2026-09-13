/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Simulated In-Memory Pub/Sub to mimic Redis/Kafka for horizontal scaling
import { EventEmitter } from 'events';

class EventBus extends EventEmitter {}
export const globalQueue = new EventBus();

export const Topics = {
  DOCUMENT_INGESTED: 'DOCUMENT_INGESTED',
  OCR_STAGE_COMPLETED: 'OCR_STAGE_COMPLETED',
  MATCHING_COMPLETED: 'MATCHING_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
};

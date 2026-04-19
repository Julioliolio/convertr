export interface EstimateParams {
  jobId: string;
  outputFormat: string;
  fps: number | string;
  width: number | string;
  dither: string;
  crf: number;
  codec: string;
  audio?: boolean;
  fastCut?: boolean;
  trimStart: number;
  trimEnd: number;
}

let controller: AbortController | null = null;

export async function fetchEstimate(params: EstimateParams): Promise<number | null> {
  if (controller) controller.abort();
  controller = new AbortController();
  try {
    const res = await fetch('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.estimatedBytes === 'number' ? data.estimatedBytes : null;
  } catch (err: any) {
    if (err.name === 'AbortError') return null;
    return null;
  }
}

export function cancelEstimate(): void {
  if (controller) { controller.abort(); controller = null; }
}

import { RetryStrategy, PipelineResponse } from "@azure/core-rest-pipeline";

/**
 * The header that comes back from services representing
 * the amount of time (minimum) to wait to retry (in seconds or timestamp after which we can retry).
 */
const RetryAfterHeader = "Retry-After";
/**
 * The headers that come back from services representing
 * the amount of time (minimum) to wait to retry.
 *
 * "retry-after-ms", "x-ms-retry-after-ms" : milliseconds
 * "Retry-After" : seconds or timestamp
 */
const AllRetryAfterHeaders: string[] = ["retry-after-ms", "x-ms-retry-after-ms", RetryAfterHeader];


/**
 * @internal
 * @returns the parsed value or undefined if the parsed value is invalid.
 */
function parseHeaderValueAsNumber(
  response: PipelineResponse,
  headerName: string,
): number | undefined {
  const value = response.headers.get(headerName);
  if (!value) return;
  const valueAsNum = Number(value);
  if (Number.isNaN(valueAsNum)) return;
  console.log(valueAsNum);
  return valueAsNum;
}

/**
 * A response is a throttling retry response if it has a throttling status code (429 or 503),
 * as long as one of the [ "Retry-After" or "retry-after-ms" or "x-ms-retry-after-ms" ] headers has a valid value.
 *
 * Returns the `retryAfterInMs` value if the response is a throttling retry response.
 * If not throttling retry response, returns `undefined`.
 *
 * @internal
 */
function getRetryAfterInMs(response?: PipelineResponse): number | undefined {
  if (!(response && [429, 503].includes(response.status))) return undefined;
  try {
    // Headers: "retry-after-ms", "x-ms-retry-after-ms", "Retry-After"
    for (const header of AllRetryAfterHeaders) {
      const retryAfterValue = parseHeaderValueAsNumber(response, header);
      if (retryAfterValue === 0 || retryAfterValue) {
        // "Retry-After" header ==> seconds
        // "retry-after-ms", "x-ms-retry-after-ms" headers ==> milli-seconds
        const multiplyingFactor = header === RetryAfterHeader ? 1000 : 1;
        return retryAfterValue * multiplyingFactor; // in milli-seconds
      }
    }
    
    // RetryAfterHeader ("Retry-After") has a special case where it might be formatted as a date instead of a number of seconds
    const retryAfterHeader = response.headers.get(RetryAfterHeader);
    if (!retryAfterHeader) return;

    const date = Date.parse(retryAfterHeader);
    const diff = date - Date.now();
    // negative diff would mean a date in the past, so retry asap with 0 milliseconds
    return Number.isFinite(diff) ? Math.max(0, diff) : undefined;
  } catch (e: any) {
    return undefined;
  }
}

/**
 * A response is a retry response if it has a throttling status code (429 or 503),
 * as long as one of the [ "Retry-After" or "retry-after-ms" or "x-ms-retry-after-ms" ] headers has a valid value.
 */
export function isThrottlingRetryResponse(response?: PipelineResponse): boolean {
  return Number.isFinite(getRetryAfterInMs(response));
}

/**
 * Provided a collection of endpoints, this strategy will redirect to the next OpenAI host in the list after every 
 * throttling response. See {@link isThrottlingRetryResponse} for more information on what constitutes a throttling response.
 * @param openAiHosts 
 * @returns {@link RetryStrategy} redirectTo
 */
export function roundRobinThrottlingStrategy(openAiHosts: string[]): RetryStrategy {
  return {
    name: "throttlingRetryStrategy",
    retry({ response, retryCount }) {
      const requestWasThrottled = isThrottlingRetryResponse(response);
      if (!requestWasThrottled) {
        return { skipStrategy: true };
      }
      
      // Here we replace the base URL with the next endpoint in the list
      const currentUrl = new URL(response.request.url);
      const backupEndpoint = openAiHosts[retryCount % openAiHosts.length + 1];
      const redirectTo = backupEndpoint + currentUrl.pathname + currentUrl.search;
      return {
        redirectTo
      };
    },
  };
}
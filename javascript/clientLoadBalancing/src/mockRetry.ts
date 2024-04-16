import { createHttpHeaders, PipelinePolicy, PipelineRetryOptions, PipelineRequest, PipelineResponse, RetryPolicyOptions, RestError, SendRequest, RetryStrategy } from "@azure/core-rest-pipeline";
import { createClientLogger  } from "@azure/logger";
import { AbortError } from "@azure/abort-controller";
import { delay } from '@azure/core-util';

const DEFAULT_RETRY_POLICY_COUNT = 3;
const retryPolicyLogger = createClientLogger("core-rest-pipeline retryPolicy");

/**
 * Options that control how to retry failed requests.
 */
export interface DefaultRetryPolicyOptions extends PipelineRetryOptions {}

/**
 * A policy that retries according to three strategies:
 * - When the server sends a 429 response with a Retry-After header.
 * - When there are errors in the underlying transport layer (e.g. DNS lookup failures).
 * - Or otherwise if the outgoing request fails, it will retry with an exponentially increasing delay.
 * 
 * The original default retrypolicy uses the following strategies, which don't seem to be exported:
 * Exponential Retry returns an exponential backoff delay in milliseconds when:
 * - there are errors in the underlying transport layer (e.g. DNS lookup failures).
 * - if the outgoing request fails (408, greater or equal than 500, except for 501 and 505).
 * 
 * Throttling Retry returns the amount of time to wait in milliseconds before retrying the operation when:
 * - it has a throttling status code (429 or 503)
 * - as long as one of the [ "Retry-After" or "retry-after-ms" or "x-ms-retry-after-ms" ] headers has a valid value.
 * 
 * https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/ts-http-runtime/src/retryStrategies/exponentialRetryStrategy.ts 
 * https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/ts-http-runtime/src/retryStrategies/throttlingRetryStrategy.ts
 */

/**
 * The programmatic identifier of the retryPolicy.
 */
const retryPolicyName = "retryPolicy";

/**
 * This copies the retryPolicy from the core-rest-pipeline package, but forces the first request to return a 429 status code.
 */
export function mockRetryPolicy(
  strategies: RetryStrategy[],
  options: RetryPolicyOptions = { maxRetries: DEFAULT_RETRY_POLICY_COUNT }
): PipelinePolicy {
  const logger = options.logger || retryPolicyLogger;
  return {
    name: retryPolicyName,
    async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
      let response: PipelineResponse | undefined;
      let responseError: RestError | undefined;
      let retryCount = -1;

      // eslint-disable-next-line no-constant-condition
      retryRequest: while (true) {
        retryCount += 1;
        response = undefined;
        responseError = undefined;

        try {
          logger.info(`Retry ${retryCount}: Attempting to send request`, request.requestId);
          // For the first request, imitate a 429 response
          if (retryCount === 0){
            response = {
              status: 429,
              request: request,
              headers: createHttpHeaders({
                "Content-Type": "text/plain",
                "retry-after-ms": 1000
              }),
              bodyAsText: "Too Many Requests"
            }
          } else {
            response = await next(request);
          }
          console.log(response)
          console.log(retryCount)

          logger.info(`Retry ${retryCount}: Received a response from request`, request.requestId);
        } catch (e: any) {
          logger.error(`Retry ${retryCount}: Received an error from request`, request.requestId);

          // RestErrors are valid targets for the retry strategies.
          // If none of the retry strategies can work with them, they will be thrown later in this policy.
          // If the received error is not a RestError, it is immediately thrown.
          responseError = e as RestError;
          if (!e || responseError.name !== "RestError") {
            throw e;
          }

          response = responseError.response;
        }
        if (request.abortSignal?.aborted) {
          logger.error(`Retry ${retryCount}: Request aborted.`);
          const abortError = new AbortError();
          throw abortError;
        }

        if (retryCount >= (options.maxRetries ?? DEFAULT_RETRY_POLICY_COUNT)) {
          logger.info(
            `Retry ${retryCount}: Maximum retries reached. Returning the last received response, or throwing the last received error.`,
          );
          if (responseError) {
            throw responseError;
          } else if (response) {
            return response;
          } else {
            throw new Error("Maximum retries reached with no response or error to throw");
          }
        }

        logger.info(`Retry ${retryCount}: Processing ${strategies.length} retry strategies.`);

        strategiesLoop: for (const strategy of strategies) {
          console.log(response);
          const strategyLogger = strategy.logger || retryPolicyLogger;
          strategyLogger.info(`Retry ${retryCount}: Processing retry strategy ${strategy.name}.`);
          
          const modifiers = strategy.retry({
            retryCount,
            response,
            responseError,
          });

          if (modifiers.skipStrategy) {
            strategyLogger.info(`Retry ${retryCount}: Skipped.`);
            continue strategiesLoop;
          }

          // Both throttlingRetryStrategy and exponentialRetryStrategy return retryAfterInMs
          const { errorToThrow, retryAfterInMs, redirectTo } = modifiers;

          if (errorToThrow) {
            strategyLogger.error(
              `Retry ${retryCount}: Retry strategy ${strategy.name} throws error:`,
              errorToThrow,
            );
            throw errorToThrow;
          }

          if (retryAfterInMs || retryAfterInMs === 0) {
            strategyLogger.info(
              `Retry ${retryCount}: Retry strategy ${strategy.name} retries after ${retryAfterInMs}`,
            );
            await delay(retryAfterInMs, { abortSignal: request.abortSignal });
            continue retryRequest;
          }

          if (redirectTo) {
            strategyLogger.info(
              `Retry ${retryCount}: Retry strategy ${strategy.name} redirects to ${redirectTo}`,
            );
            request.url = redirectTo;
            continue retryRequest;
          }
        }

        if (responseError) {
          logger.info(
            `None of the retry strategies could work with the received error. Throwing it.`,
          );
          throw responseError;
        }
        if (response) {
          logger.info(
            `None of the retry strategies could work with the received response. Returning it.`,
          );
          return response;
        }

        // If all the retries skip and there's no response,
        // we're still in the retry loop, so a new request will be sent
        // until `maxRetries` is reached.
      }
    },
  };
}
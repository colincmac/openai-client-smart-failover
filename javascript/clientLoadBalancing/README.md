# OpenAI Client-based Failover

## Description

The [roundRobinThrottlingStrategy.ts](./src/roundRobinThrottlingStrategy.ts) file contains the implementation of a retry strategy that uses a round-robin approach to handle throttling responses from the OpenAI API.

This strategy is designed to redirect to the next OpenAI host in the list after every throttling response. A throttling response is identified by a status code of 429 or 503, along with a valid value in one of the following headers: "Retry-After", "retry-after-ms", or "x-ms-retry-after-ms".

This strategy function takes a list of OpenAI hosts as input and returns a RetryStrategy object. This object contains a retry method that checks if a response was throttled. If so, it calculates the next endpoint in the list and constructs a new URL to redirect to.

## Installation
1. Run `npm build`.
2. Open dist/index.html in a browser and fill out the form.


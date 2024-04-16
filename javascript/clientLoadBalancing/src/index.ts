import { AzureKeyCredential } from "@azure/core-auth";
import { OpenAIClient } from "@azure/openai";
import { roundRobinThrottlingStrategy } from "./roundRobinThrottlingStrategy";
import { mockRetryPolicy } from "./mockRetry";
// Use this for the real retryPolicy
import { retryPolicy } from "@azure/core-rest-pipeline";

function init() {
  const form = document.querySelector("form");
  form?.addEventListener("submit", submitHandler);
}

async function submitHandler(e: Event) {
  e.preventDefault();
  
  const deploymentId = document.getElementById("deploymentId") as HTMLInputElement;
  const azureKey = document.getElementById("azureKey") as HTMLInputElement;
  const endpoint = document.getElementById("endpoint") as HTMLInputElement;
  const promptInput = document.getElementById("promptInput") as HTMLTextAreaElement;
  console.log(promptInput.value); 
  const result = getCompletion(deploymentId.value, azureKey.value, endpoint.value, promptInput.value);
  const resultContainer = document.getElementById("result");
  const resultText = document.createElement("p");
  if (resultContainer) {
    resultText.textContent = await result;
    resultContainer.appendChild(resultText);
  }
}

/**
 * getCompletion is purposefully configured with a bad endpoint to demonstrate the round-robin load balancing strategy.
 * The first request will always return a 429 status code, and the second request will be routed to the second endpoint provided to the strategy.
 * mockRetry 
 */
async function getCompletion(deploymentId: string, azureKey: string, endpoint: string, promptInput: string) {
  const credential = new AzureKeyCredential(azureKey);
  // The roundRobinThrottlingStrategy
  const client = new OpenAIClient("https://example.com", credential, {
    additionalPolicies: [
      {
        position: "perCall",
        policy: mockRetryPolicy([roundRobinThrottlingStrategy([
          "https://example.com",
          endpoint
        ])], { maxRetries: 3 })
      }
    ],
  });

  var messages = [
    {
      role: "user",
      content: promptInput
    }
  ]
  const { choices } = await client.getChatCompletions(deploymentId, messages, { 
    maxTokens: 150
  })

  return choices.map((choice) => choice.message.content).join("\n");
}

init();
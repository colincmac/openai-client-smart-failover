import { AzureKeyCredential } from "@azure/core-auth";
import { OpenAIClient, OpenAIClientOptions } from "@azure/openai";
import { PipelinePolicy, PipelineRetryOptions, PipelineRequest, SendRequest, PipelineResponse, HttpHeaders } from "@azure/core-rest-pipeline";
import * as openaiRest from "@azure-rest/openai";

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


const sendFailedRequest = (request: PipelineRequest, next: SendRequest) => {
  return next(request);
};

async function getCompletion(deploymentId: string, azureKey: string, endpoint: string, promptInput: string) {
  const credential = new AzureKeyCredential(azureKey);
  const coordinator = new OpenAIEndpointCoordinator([
    "https://api.openai.com",
    endpoint
  ]);

  const client = new OpenAIClient(endpoint, credential, {
    additionalPolicies: [
      {
        position: "perCall",
        policy: coordinator.mockRetry()
      },
      {
        position: "perRetry",
        policy: coordinator.switchEndpoint()
      }
    ]
  });

  var messages = [
    {
      role: "user",
      content: promptInput
    }
  ]
  const { choices } = await client.getChatCompletions(deploymentId, messages, { 
    maxTokens: 150,
    onResponse: (response) => {
      console.log(response);
      if (response.status === 429) {
        console.log("Retrying request");
        return true;
      }

    },
  })
  // const { choices } = await client.getCompletions(deploymentId, [promptInput]);
  console.log(choices);
  return choices.map((choice) => choice.message.content).join("\n");
}
class OpenAIEndpointCoordinator {
  currentRetries = 0;
  openAIEndpoints: string[];
  constructor(endpoints: string[]) {
    this.openAIEndpoints = endpoints;
  }
  mockRetry(): PipelinePolicy {
    const policy: PipelinePolicy = {
      name: "mockRetry",
      sendRequest: (request, next) => {
        console.log("Mocking retry");
        if (this.currentRetries <= 0) {
          return next(request);
        }
        this.currentRetries++;
        const resp: PipelineResponse = {
          status: 429,
          request: request,
          headers: {} as HttpHeaders,
          bodyAsText: "Too Many Requests"
        }
        return new Promise((resolve, reject) => resolve(resp));
      },
    };
    return policy;
  }
  switchEndpoint(): PipelinePolicy {
    const policy: PipelinePolicy = {
      name: "switchEndpoint",
      sendRequest: (request, next) => {
        console.log("Switching endpoint due to having %d retries left", this.currentRetries);
        if(this.currentRetries === 0) {
          return next(request);
        }

        const currentUrl = new URL(request.url);
        request.url = this.openAIEndpoints[this.currentRetries % this.openAIEndpoints.length + 1] + currentUrl.pathname + currentUrl.search;
        return next(request);
      },
    };
    return policy;
  }
}

init();
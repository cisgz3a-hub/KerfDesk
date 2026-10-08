import { html } from './html.mjs';

export function aiPrivacy() {
  return html`<h3 id="ai-assistant">Optional desktop AI assistant</h3>
    <p>
      The assistant is optional and uses your own OpenAI API account. Configuring it does not
      request a draft. Your API key and model are stored separately from project files, encrypted
      with operating-system secure storage. If secure storage is unavailable, configuration is
      refused. Forget connection removes the saved configuration.
    </p>
    <p>
      When you choose Request draft, the desktop app sends your prompt, requested dimensions and
      task to api.openai.com. A material request also sends the listed candidate recipe names and
      descriptions, and an optional photograph you select. The interface shows the candidate scope
      before sending. It does not attach the open project, canvas, machine settings or toolpaths.
      Your API key authenticates this request; OpenAI also receives ordinary connection details,
      including your IP address and request time.
    </p>
    <p>
      Requests set store to false. This does not promise Zero Data Retention: OpenAI may retain
      abuse-monitoring data under its account policies. Review
      <a href="https://developers.openai.com/api/docs/guides/your-data">OpenAI’s API data policy</a>
      before sending private material. The response is a draft to inspect. Applying artwork or a
      saved material recipe is a separate action, and the assistant cannot control a machine.
      Ordinary design, recipes and output continue to work without an AI connection.
    </p>`;
}

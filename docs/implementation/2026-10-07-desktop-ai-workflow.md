# Optional desktop AI workflow

7 October 2026. Original implementation in `codex/xtool-workflows-20261007`. The API connection is optional; existing local design, measured material libraries and output remain usable without it.

## Operator flow

1. In the desktop app, open Tools → AI Assistant. The browser shows the desktop availability explanation and accepts no API key.
2. Enter your own OpenAI API key and a model available to your account that supports Responses structured output; photo requests also need image-input support. Save encrypted connection uses Electron operating-system secure storage. There is no plaintext fallback and configuration makes no generation request. Forget connection removes the separate saved credential file.
3. Choose editable vector design or saved material suggestions. Enter a prompt and dimensions. A material request can include a photograph explicitly selected for this request and a search-filtered list of up to 50 recipe names/descriptions. The sent scope is displayed before Request draft.
4. Choose Request draft. The assistant sends this explicit request to the fixed OpenAI Responses endpoint. The open canvas, complete project, machine settings, toolpaths and unlisted request fields are not attached. Cancel aborts request preparation/provider reading; late responses cannot become a draft.
5. Inspect the explanation, uncertainty and preview. Vector output is bounded to the requested millimetre rectangle, 100 paths and 20,000 total points. Apply adds ordinary editable artwork and an operation using the existing defaults, with Undo. A changed/replaced project or exhausted save budget prevents Apply without mutating the scene.
6. Material matches can refer only to candidate IDs that were sent. Review the captured recipe revision and its existing provenance/settings before choosing the ordinary library Apply action. AI never generates power, speed, depth, focus, conveyor, firmware or machine-control commands. A photo does not establish composition, processing safety, thickness or material qualification.

## Storage and provider contract

The API key/model are stored in `ai-assistant.v1` in the app's user-data directory, outside projects and local libraries, encrypted through Electron `safeStorage`. Linux insecure/basic-text backends are refused. Status reads do not write or rotate credentials: an old asynchronous decrypt cannot recreate a file after Forget. An explicit configuration Save encrypts with the current backend. Credentials are not returned to the renderer or diagnostics.

Trusted `app://app` routes require the assistant header, exact address and bounded JSON bodies. A UUID header reserves generation ownership before body reading and must match the body's identity. Early cancellation has a bounded short-lived record, so reversed route delivery cannot start an already cancelled request. One in-flight operation, a 120-second timeout, strict schema validation at both boundaries and sanitized error messages keep the review contract consistent.

Requests use `https://api.openai.com/v1/responses`, reject redirects, set `store: false`, use no API tools or arbitrary URL/file loading, and have no automatic retry. `store: false` does not promise Zero Data Retention; OpenAI's account/data policies still apply. The canonical privacy page and generated app notice disclose the request, provider connection information and credential storage.

Primary sources: [Responses API](https://developers.openai.com/api/reference/python/resources/responses/methods/create), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [API data handling](https://developers.openai.com/api/docs/guides/your-data) and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Verification boundary

Automated tests use synthetic credentials, isolated temporary files and an injected fake provider. They cover the real request/response contract, secure-storage availability, bounds, trusted routes, unknown-field stripping, no request on idle/configuration, review/Apply/Undo, candidate identity, frozen recipe ownership, photo preparation races, project drift, budget refusal, cancellation and the Configure/Forget race. They do not establish a real account, compatible chosen model, actual provider quality, native installed OS key protection, an installed package or physical material recognition accuracy. No artwork or key was sent to OpenAI during development verification.

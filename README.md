# Contract Review App

A simple web app for asking questions about a PDF contract. Upload a contract, read it on the left, and ask questions in the chat on the right. Answers come from an n8n workflow and show the exact clauses they are based on.

Built with plain HTML, CSS and JavaScript. There are no frameworks, packages or build steps.

## Key features

- **Contract preview:** drag and drop a PDF, or browse for one. It opens in the left panel using your browser's PDF viewer.
- **Side-by-side layout:** the contract and the chat each scroll on their own, so you can read while you ask.
- **Answers with sources:** each reply shows the answer, the contract clauses it relies on (with section or page), and a short reason linking the two.
- **Honest "not found" replies:** if the contract doesn't cover a question, the app says so instead of guessing.
- **Quick questions:** one-click buttons for common questions like "Summarize key terms" and "Flag risks".
- **Clear error messages:** for when the webhook can't be reached, takes too long, or replies in an unexpected format.

## How it works

When you send a question, the app posts a `multipart/form-data` request to your n8n webhook with two fields:

| Field     | Contents             |
|-----------|----------------------|
| `file`    | The uploaded PDF     |
| `message` | The user's question  |

The webhook must reply with JSON in this shape:

```json
{
  "response": "The answer, based only on the contract",
  "citation": ["Section 3.2 (Page 2): the exact clause text"],
  "reasoning": "1-2 sentences on how the citations support the answer"
}
```

If the contract doesn't contain the answer, `response` is `"This information is not mentioned in the contract."`, `citation` is `[]` and `reasoning` is `""`.

## Run it locally

1. **Download the code.**

   ```bash
   git clone https://github.com/prashantdang/contract-review-app.git
   ```

   ```bash
   cd contract-review-app
   ```

2. **Add your webhook address.** Copy the example settings file:

   ```bash
   cp config.example.js config.js
   ```

   Then open `config.js` and replace the placeholder with your n8n webhook URL. `config.js` is listed in `.gitignore`, so your address is never committed.

3. **Open the app.** Double-click `index.html`, or run:

   ```bash
   open index.html
   ```

   No server or install is needed.

### n8n setup notes

- The workflow must end with a **Respond to Webhook** node that returns the JSON above.
- A **test URL** (`/webhook-test/`) only answers while "Listen for test event" is active in n8n. For everyday use, activate the workflow and use the **production URL** (`/webhook/`).
- If the browser blocks the request, set **Allowed Origins (CORS)** on the Webhook node to `*`.
- The webhook address is visible to anyone who can open the app in a browser. Turn on authentication on the Webhook node before sharing it widely.

## Project files

| File                | Purpose                                         |
|---------------------|-------------------------------------------------|
| `index.html`        | Page layout                                     |
| `styles.css`        | Styling (navy and orange theme)                 |
| `app.js`            | Upload, preview, chat and webhook logic         |
| `config.example.js` | Template for your private `config.js`           |

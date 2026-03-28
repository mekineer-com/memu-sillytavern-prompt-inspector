# Prompt Inspector — memU fork

**Power users only.** This extension lets you view and edit the raw JSON sent to the LLM before each generation. Editing malformed JSON will break generation silently or loudly. If you don't know what a JSON prompt array is, this tool is not for you.

## What it is

A fork of the [SillyTavern Prompt Inspector](https://github.com/Cohee1207/SillyTavern) extension, modified to work alongside the [memU Inspect panel](https://github.com/mekineer-com/memu-sillytavern-extension). The memU panel injects live memory state (retrieved items, turn contract, intentions, cache) directly into the inspector popup.

## Install

In SillyTavern → Extensions → Install extension, paste:

```
https://github.com/mekineer-com/memu-sillytavern-prompt-inspector
```

Or clone manually into `data/default-user/extensions/prompt-inspector/`.

Requires [memu-sillytavern-extension](https://github.com/mekineer-com/memu-sillytavern-extension) for the memU panel to appear.

## Warning

Editing the prompt JSON and saving changes will modify what the model actually receives. There is no undo. If you corrupt the JSON, generation will fail. The Raw JSON tab is read-only by intent for most users — treat it that way.

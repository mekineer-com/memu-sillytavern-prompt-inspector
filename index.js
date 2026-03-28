import { eventSource, event_types, main_api, stopGeneration } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { t } from '../../../i18n.js';

const path = 'third-party/prompt-inspector';

if (!('GENERATE_AFTER_COMBINE_PROMPTS' in event_types) || !('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
    toastr.error('Required event types not found. Update SillyTavern to the latest version.');
    throw new Error('Events not found.');
}

function isChatCompletion() {
    return main_api === 'openai';
}

function addLaunchButton() {
    const enabledText = t`Stop Inspecting`;
    const disabledText = t`Inspect Prompts`;
    const enabledIcon = 'fa-solid fa-bug-slash';
    const disabledIcon = 'fa-solid fa-bug';

    const getIcon = () => inspectEnabled ? enabledIcon : disabledIcon;
    const getText = () => inspectEnabled ? enabledText : disabledText;

    const launchButton = document.createElement('div');
    launchButton.id = 'inspectNextPromptButton';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = t`Toggle prompt inspection`;
    const icon = document.createElement('i');
    icon.className = getIcon();
    launchButton.appendChild(icon);
    const textSpan = document.createElement('span');
    textSpan.textContent = getText();
    launchButton.appendChild(textSpan);

    const extensionsMenu = document.getElementById('prompt_inspector_wand_container') ?? document.getElementById('extensionsMenu');
    extensionsMenu.classList.add('interactable');
    extensionsMenu.tabIndex = 0;

    if (!extensionsMenu) {
        throw new Error('Could not find the extensions menu');
    }

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', () => {
        toggleInspectNext();
        textSpan.textContent = getText();
        icon.className = getIcon();
    });
}

let inspectEnabled = localStorage.getItem('promptInspectorEnabled') === 'true' || false;

function toggleInspectNext() {
    inspectEnabled = !inspectEnabled;
    toastr.info(`Prompt inspection is now ${inspectEnabled ? 'enabled' : 'disabled'}`);
    localStorage.setItem('promptInspectorEnabled', String(inspectEnabled));
}

function renderFormatted(json) {
    try {
        const messages = JSON.parse(json);
        if (!Array.isArray(messages)) return '<div style="opacity:0.5">(not a message array)</div>';
        return messages.map(msg => {
            const role = String(msg.role || 'unknown');
            const content = String(msg.content || '');
            const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="pi-message"><div class="pi-role">${role}</div><pre class="pi-content">${escaped}</pre></div>`;
        }).join('');
    } catch {
        return '<div style="opacity:0.5;font-style:italic">(not valid JSON — switch to Raw to edit)</div>';
    }
}

async function showPromptInspector(input) {
    const template = $(await renderExtensionTemplateAsync(path, 'template'));
    const textarea = template.find('#inspectPrompt');
    textarea.val(input);

    const rawPane = template.find('#piRawPane')[0];
    const formattedPane = template.find('#piFormattedPane')[0];
    const tabRaw = template.find('#piTabRaw')[0];
    const tabFormatted = template.find('#piTabFormatted')[0];

    function showTab(tab) {
        if (tab === 'formatted') {
            formattedPane.innerHTML = renderFormatted(textarea.val());
            rawPane.style.display = 'none';
            formattedPane.style.display = '';
            tabRaw.classList.remove('pi-tab-active');
            tabFormatted.classList.add('pi-tab-active');
        } else {
            rawPane.style.display = '';
            formattedPane.style.display = 'none';
            tabFormatted.classList.remove('pi-tab-active');
            tabRaw.classList.add('pi-tab-active');
        }
    }

    tabRaw.addEventListener('click', () => showTab('raw'));
    tabFormatted.addEventListener('click', () => showTab('formatted'));

    const customButton = {
        text: 'Cancel generation',
        result: POPUP_RESULT.CANCELLED,
        appendAtEnd: true,
        action: async () => {
            await stopGeneration();
            await popup.complete(POPUP_RESULT.CANCELLED);
        },
    };
    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '', { wide: true, large: true, okButton: 'Save changes', cancelButton: 'Discard changes', customButtons: [customButton] });
    const result = await popup.show();

    if (!result) {
        return input;
    }

    return String(textarea.val());
}

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!inspectEnabled || data.dryRun || !isChatCompletion()) return;

    const promptJson = JSON.stringify(data.chat, null, 4);
    const result = await showPromptInspector(promptJson);

    if (result === promptJson) return;

    try {
        const chat = JSON.parse(result);
        if (Array.isArray(chat) && Array.isArray(data.chat)) {
            data.chat.splice(0, data.chat.length, ...chat);
        }
    } catch {
        toastr.error('Invalid JSON');
    }
});

eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, async (data) => {
    if (!inspectEnabled || data.dryRun || isChatCompletion()) return;
    const result = await showPromptInspector(data.prompt);
    if (result !== data.prompt) data.prompt = result;
});

(function init() {
    addLaunchButton();
})();
